import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { SCHEDULE_EDIT_EXPIRE_MS } from "@eventer/shared";
import type { ScheduleEditingState, ScheduleItem } from "@eventer/shared";
import { bindEnv, type Env } from "../src/runtime.js";

/**
 * タイムテーブルの同時編集の対策 (#340)。
 *
 * 2段構えになっている。
 *
 * - **編集中ステータス** … 助言。誰が編集中かを見せるだけで、編集も保存も止めない
 * - **保存時の版の突き合わせ** … 防衛。読んだ版と食い違えば保存を止める
 *
 * ここで確かめるのは、助言のほうが「見える・自動的に解除される・奪わない」こと、
 * 防衛のほうが「食い違いを止める・止めたときは1文字も書いていない」こと。
 */

const BASE = "https://example.com";
const HOUR = 3600_000;

beforeAll(() => {
  bindEnv(env as unknown as Env);
});

/** 非adminのユーザーを1人作る */
async function makeUser(name: string): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, `u_${uid.slice(0, 6)}`, name, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

/** イベントを作る。published=false なら下書きのまま（公開前 #339） */
async function setupEvent(cookie: string, published = true): Promise<string> {
  const startsAt = Date.now() + 24 * HOUR;
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "同時編集E2E",
      venueType: "offline",
      startsAt,
      endsAt: startsAt + 8 * HOUR,
    }),
  });
  expect(create.status).toBe(201);
  const { event } = (await create.json()) as { event: { id: string } };
  if (published) {
    const patch = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ status: "published" }),
    });
    expect(patch.status).toBe(200);
  }
  return event.id;
}

/** そのイベントの staff メンバーを1人作る */
async function makeStaff(
  eventId: string,
  name: string,
): Promise<{ userId: string; cookie: string }> {
  const u = await makeUser(name);
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, 'staff', NULL, 'confirmed', 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, u.userId, Date.now())
    .run();
  return u;
}

interface Timetable {
  items: ScheduleItem[];
  version: number;
}

async function getTimetable(eventId: string, cookie: string): Promise<Timetable> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Timetable;
}

function putTimetable(
  eventId: string,
  cookie: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

function editing(
  eventId: string,
  cookie: string,
  method: "GET" | "POST" | "DELETE",
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/timetable/editing`, {
    method,
    headers: { cookie },
  });
}

async function editingState(
  eventId: string,
  cookie: string,
  method: "GET" | "POST" | "DELETE" = "GET",
): Promise<ScheduleEditingState> {
  const res = await editing(eventId, cookie, method);
  expect(res.status).toBe(200);
  return (await res.json()) as ScheduleEditingState;
}

/** 最後の心拍を巻き戻して、放置されたまま期限が切れた状態を作る */
async function expireEditing(eventId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE event_schedule_state SET editor_seen_at = ? WHERE event_id = ?",
  )
    .bind(Date.now() - SCHEDULE_EDIT_EXPIRE_MS - 1000, eventId)
    .run();
}

describe("編集中ステータス (#340)", () => {
  it("編集を始めた人が、ほかの運営に名前つきで見える", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const alice = await makeStaff(eventId, "アリス");
    const bob = await makeStaff(eventId, "ボブ");

    // 誰も編集していない
    expect((await editingState(eventId, bob.cookie)).editor).toBeNull();

    const claimed = await editingState(eventId, alice.cookie, "POST");
    expect(claimed.editor?.userId).toBe(alice.userId);

    const seen = await editingState(eventId, bob.cookie);
    expect(seen.editor?.userId).toBe(alice.userId);
    expect(seen.editor?.name).toBe("アリス");
    expect(seen.editor?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("編集中は他の人に奪われないが、編集も保存も止めない（助言でしかない）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const alice = await makeStaff(eventId, "アリス");
    const bob = await makeStaff(eventId, "ボブ");

    await editingState(eventId, alice.cookie, "POST");
    // ボブが編集画面を開いても、編集中はアリスのまま
    const bobClaim = await editingState(eventId, bob.cookie, "POST");
    expect(bobClaim.editor?.userId).toBe(alice.userId);

    // それでもボブの保存は通る（止めているのは版だけ）
    const { version } = await getTimetable(eventId, bob.cookie);
    const saved = await putTimetable(eventId, bob.cookie, {
      version,
      items: [{ title: "ボブの追加", durationMin: 10 }],
    });
    expect(saved.status).toBe(200);
  });

  it("放置されると自動的に解除され、次の人が引き継げる", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const alice = await makeStaff(eventId, "アリス");
    const bob = await makeStaff(eventId, "ボブ");

    await editingState(eventId, alice.cookie, "POST");
    await expireEditing(eventId);

    // 期限切れは「誰も編集していない」と見える（行を消して回る仕組みは持たない）
    expect((await editingState(eventId, bob.cookie)).editor).toBeNull();
    // 空いているのでボブが取れる
    const bobClaim = await editingState(eventId, bob.cookie, "POST");
    expect(bobClaim.editor?.userId).toBe(bob.userId);
  });

  it("編集をやめたことを伝えられるのは本人だけ", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const alice = await makeStaff(eventId, "アリス");
    const bob = await makeStaff(eventId, "ボブ");

    await editingState(eventId, alice.cookie, "POST");
    // 他人は外せない
    expect(
      (await editingState(eventId, bob.cookie, "DELETE")).editor?.userId,
    ).toBe(alice.userId);
    // 本人は外せる
    expect(
      (await editingState(eventId, alice.cookie, "DELETE")).editor,
    ).toBeNull();
  });

  it("公開前の下書きイベントでも動き、編集できない人には見えない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin, false);
    const alice = await makeStaff(eventId, "アリス");
    const outsider = await makeUser("部外者");

    const claimed = await editingState(eventId, alice.cookie, "POST");
    expect(claimed.editor?.userId).toBe(alice.userId);
    expect((await editing(eventId, outsider.cookie, "GET")).status).toBe(403);
  });

  it("解除しても版は消えない（同じ行に持っているため）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const alice = await makeStaff(eventId, "アリス");

    const first = await putTimetable(eventId, alice.cookie, {
      version: 0,
      items: [{ title: "オープニング", durationMin: 10 }],
    });
    expect(first.status).toBe(200);

    await editingState(eventId, alice.cookie, "POST");
    const released = await editingState(eventId, alice.cookie, "DELETE");
    expect(released.editor).toBeNull();
    expect(released.version).toBe(1);
  });
});

describe("保存時の衝突検知 (#340)", () => {
  it("保存すると版が1つ進む", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    expect((await getTimetable(eventId, admin)).version).toBe(0);

    const res = await putTimetable(eventId, admin, {
      version: 0,
      items: [{ title: "オープニング", durationMin: 10 }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { version: number }).version).toBe(1);
    expect((await getTimetable(eventId, admin)).version).toBe(1);
  });

  it("版が食い違うと保存が止まり、先に保存した内容が残る", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const alice = await makeStaff(eventId, "アリス");
    const bob = await makeStaff(eventId, "ボブ");

    await putTimetable(eventId, admin, {
      version: 0,
      items: [{ title: "オープニング", durationMin: 10 }],
    });

    // 2人が同じ状態を読む
    const forAlice = await getTimetable(eventId, alice.cookie);
    const forBob = await getTimetable(eventId, bob.cookie);
    expect(forAlice.version).toBe(forBob.version);

    // アリスが先に保存
    const aliceSave = await putTimetable(eventId, alice.cookie, {
      version: forAlice.version,
      items: [
        { id: forAlice.items[0]!.id, title: "オープニング", durationMin: 10 },
        { title: "アリスのセッション", durationMin: 30 },
      ],
    });
    expect(aliceSave.status).toBe(200);

    // ボブは古い版のまま保存しようとする（＝手元の全項目で丸ごと上書き）
    const bobSave = await putTimetable(eventId, bob.cookie, {
      version: forBob.version,
      items: [
        { id: forBob.items[0]!.id, title: "オープニング", durationMin: 10 },
        { title: "ボブのセッション", durationMin: 30 },
      ],
    });
    expect(bobSave.status).toBe(409);
    const body = (await bobSave.json()) as { error: string; version: number };
    expect(body.error).toBe("conflict");
    // 読み直すべき版を返す
    expect(body.version).toBe(forAlice.version + 1);

    // アリスの内容が残り、ボブの分は1件も入っていない
    const after = await getTimetable(eventId, admin);
    expect(after.items.map((i) => i.title)).toEqual([
      "オープニング",
      "アリスのセッション",
    ]);
  });

  it("編集画面を開いたまま他人が消したセッションは、保存しても復活しない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const alice = await makeStaff(eventId, "アリス");
    const bob = await makeStaff(eventId, "ボブ");

    await putTimetable(eventId, admin, {
      version: 0,
      items: [
        { title: "オープニング", durationMin: 10 },
        { title: "消される枠", durationMin: 30 },
      ],
    });
    // ボブが編集画面を開く（この時点の状態を手元に抱える）
    const forBob = await getTimetable(eventId, bob.cookie);
    const doomedId = forBob.items[1]!.id;

    // その間にアリスが「消される枠」を消す
    const forAlice = await getTimetable(eventId, alice.cookie);
    const aliceSave = await putTimetable(eventId, alice.cookie, {
      version: forAlice.version,
      items: [
        { id: forAlice.items[0]!.id, title: "オープニング", durationMin: 10 },
      ],
    });
    expect(aliceSave.status).toBe(200);

    // ボブが手元の全項目を保存 → 版が古いので止まる
    const stale = await putTimetable(eventId, bob.cookie, {
      version: forBob.version,
      items: forBob.items.map((it) => ({
        id: it.id,
        title: it.title,
        durationMin: it.durationMin,
      })),
    });
    expect(stale.status).toBe(409);

    // 版だけ最新にして送り直しても、知らない ID なので止まる
    // （ここが無いと、消えた枠が新しい ID で復活し、トラックの割り当てだけが消える）
    const latest = await getTimetable(eventId, bob.cookie);
    const revived = await putTimetable(eventId, bob.cookie, {
      version: latest.version,
      items: forBob.items.map((it) => ({
        id: it.id,
        title: it.title,
        durationMin: it.durationMin,
      })),
    });
    expect(revived.status).toBe(409);

    // 消された枠はどこにも残っていない
    const after = await getTimetable(eventId, admin);
    expect(after.items.map((i) => i.title)).toEqual(["オープニング"]);
    expect(after.items.some((i) => i.id === doomedId)).toBe(false);
  });

  it("登壇者が資料URLを更新すると版が進み、staff の巻き戻し保存が止まる", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const staff = await makeStaff(eventId, "運営");
    const speaker = await makeUser("登壇者");
    await env.DB.prepare(
      "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, 'participant', NULL, 'confirmed', 0, ?)",
    )
      .bind(crypto.randomUUID(), eventId, speaker.userId, Date.now())
      .run();

    await putTimetable(eventId, admin, {
      version: 0,
      items: [
        {
          title: "LT",
          durationMin: 10,
          speakerUserId: speaker.userId,
          materialUrl: "",
        },
      ],
    });

    // staff が編集画面を開く（materialUrl は空のまま手元に抱える）
    const forStaff = await getTimetable(eventId, staff.cookie);
    const itemId = forStaff.items[0]!.id;

    // その間に登壇者本人が資料URLを入れる
    const patch = await SELF.fetch(
      `${BASE}/api/events/${eventId}/timetable/${itemId}/material`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: speaker.cookie,
        },
        body: JSON.stringify({ materialUrl: "https://example.com/deck" }),
      },
    );
    expect(patch.status).toBe(200);

    // staff が手元の（空の）URL で全体保存 → 巻き戻さずに止まる
    const rollback = await putTimetable(eventId, staff.cookie, {
      version: forStaff.version,
      items: [
        {
          id: itemId,
          title: "LT",
          durationMin: 10,
          speakerUserId: speaker.userId,
          materialUrl: "",
        },
      ],
    });
    expect(rollback.status).toBe(409);

    const after = await getTimetable(eventId, admin);
    expect(after.items[0]!.materialUrl).toBe("https://example.com/deck");
  });

  it("版を送らない保存は 400 で弾く（衝突検知をすり抜けさせない）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const res = await putTimetable(eventId, admin, {
      items: [{ title: "オープニング", durationMin: 10 }],
    });
    expect(res.status).toBe(400);
  });
});
