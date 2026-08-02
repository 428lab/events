import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { ScheduleItem } from "@eventer/shared";

const BASE = "https://example.com";

/** dev-login（DevUser=staff/管理者）してセッションcookieを返す */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** 公開イベントを作って ID を返す */
async function setupEvent(cookie: string): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "タイムテーブルE2E",
      venueType: "offline",
      startsAt: 1,
      endsAt: 99999999999999,
    }),
  });
  expect(create.status).toBe(201);
  const { event } = (await create.json()) as { event: { id: string } };
  const patch = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ status: "published" }),
  });
  expect(patch.status).toBe(200);
  return event.id;
}

/** 非adminのユーザーを1人作る（メンバーにはしない）。 */
async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, `u_${uid.slice(0, 6)}`, "テスト", Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

/** 非adminのメンバーを1人作る */
async function makeMember(
  eventId: string,
  role: "participant" | "staff" | "judge" | "observer",
): Promise<{ userId: string; cookie: string }> {
  const u = await makeUser();
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, 'confirmed', 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, u.userId, role, Date.now())
    .run();
  return u;
}

function putTimetable(
  eventId: string,
  cookie: string | null,
  items: unknown[],
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ items }),
  });
}

async function getTimetable(
  eventId: string,
  cookie?: string,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("イベントのタイムテーブル (#116)", () => {
  it("staff が保存でき、公開GETで並び順どおり・担当者解決付きで読める", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const speaker = await makeMember(eventId, "participant");

    const saved = await putTimetable(eventId, admin, [
      { title: "開場・受付", durationMin: 15 },
      {
        title: "セッション 1",
        description: "はじめの一歩",
        durationMin: 40,
        speakerUserId: speaker.userId,
      },
      {
        title: "セッション 2",
        durationMin: 40,
        startsAt: 1700000000000,
        speakerName: "ゲスト太郎",
      },
    ]);
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as { items: ScheduleItem[] };
    expect(savedBody.items).toHaveLength(3);

    // 未ログインでも公開イベントのタイムテーブルは読める
    const anon = await getTimetable(eventId);
    expect(anon.status).toBe(200);
    const { items } = (await anon.json()) as { items: ScheduleItem[] };
    expect(items.map((i) => i.title)).toEqual([
      "開場・受付",
      "セッション 1",
      "セッション 2",
    ]);
    expect(items.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
    // メンバーの担当者はユーザー情報に解決される
    expect(items[1].speaker).toMatchObject({
      id: speaker.userId,
      globalName: "テスト",
    });
    expect(items[1].speaker!.username).toMatch(/^u_/);
    // フリーテキストの担当者はリンクなし
    expect(items[2].speaker).toBeNull();
    expect(items[2].speakerName).toBe("ゲスト太郎");
    // 明示的な開始時刻の上書きが保存される
    expect(items[2].startsAt).toBe(1700000000000);
    expect(items[0].startsAt).toBeNull();
  });

  it("非staffのPUTは403、未ログインは401。バリデーション違反は400", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const participant = await makeMember(eventId, "participant");
    const outsider = await makeUser();

    const items = [{ title: "誰かの企み", durationMin: 10 }];
    expect((await putTimetable(eventId, participant.cookie, items)).status).toBe(403);
    expect((await putTimetable(eventId, outsider.cookie, items)).status).toBe(403);
    expect([401, 403]).toContain((await putTimetable(eventId, null, items)).status);

    // タイトル空は 400
    const invalid = await putTimetable(eventId, admin, [
      { title: "", durationMin: 10 },
    ]);
    expect(invalid.status).toBe(400);
  });

  it("非メンバーの speakerUserId は黙って null に落ちる（フリーテキストは残る）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const outsider = await makeUser();

    const saved = await putTimetable(eventId, admin, [
      {
        title: "怪しいセッション",
        durationMin: 30,
        speakerUserId: outsider.userId,
        speakerName: "部外者",
      },
    ]);
    expect(saved.status).toBe(200);
    const { items } = (await saved.json()) as { items: ScheduleItem[] };
    expect(items[0].speaker).toBeNull();
    expect(items[0].speakerName).toBe("部外者");
  });

  it("下書きイベントのタイムテーブルは非メンバー・未ログインには読めない", async () => {
    const admin = await loginDev();
    // setupEvent は公開するので、ここでは下書きのまま作る
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({
        title: "下書きタイムテーブルE2E",
        venueType: "offline",
        startsAt: 1,
        endsAt: 99999999999999,
      }),
    });
    const { event } = (await create.json()) as { event: { id: string } };
    await putTimetable(event.id, admin, [{ title: "内緒の進行", durationMin: 5 }]);

    expect((await getTimetable(event.id)).status).toBe(403);

    const outsider = await makeUser();
    expect((await getTimetable(event.id, outsider.cookie)).status).toBe(403);

    // メンバー（下書きイベントの staff=作成者）は読める
    const staffGet = await getTimetable(event.id, admin);
    expect(staffGet.status).toBe(200);
    const { items } = (await staffGet.json()) as { items: ScheduleItem[] };
    expect(items).toHaveLength(1);
  });

  it("保存は全置き換え：3件のあと2件を保存すると2件だけ残る", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);

    await putTimetable(eventId, admin, [
      { title: "その1", durationMin: 10 },
      { title: "その2", durationMin: 10 },
      { title: "その3", durationMin: 10 },
    ]);
    const second = await putTimetable(eventId, admin, [
      { title: "新その1", durationMin: 20 },
      { title: "新その2", durationMin: 20 },
    ]);
    expect(second.status).toBe(200);

    const res = await getTimetable(eventId);
    const { items } = (await res.json()) as { items: ScheduleItem[] };
    expect(items.map((i) => i.title)).toEqual(["新その1", "新その2"]);
  });
});
