import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { ScheduleItem } from "@eventer/shared";
import { parseOgImage } from "../src/lib/materialMeta.js";
import { isPrivateHost } from "../src/lib/urlGuard.js";

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

describe("登壇資料URL (#146)", () => {
  it("http(s)のURLは保存・取得でき、javascript:等は400", async () => {
    const cookie = await loginDev();
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        title: "資料URL E2E",
        venueType: "online",
        startsAt: Date.now() + 3600_000,
        endsAt: Date.now() + 7200_000,
      }),
    });
    const { event } = (await create.json()) as { event: { id: string } };

    const ok = await SELF.fetch(`${BASE}/api/events/${event.id}/timetable`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        items: [
          {
            title: "LT",
            durationMin: 10,
            materialUrl: "https://speakerdeck.com/x/y",
          },
        ],
      }),
    });
    expect(ok.status).toBe(200);
    const got = (await (
      await SELF.fetch(`${BASE}/api/events/${event.id}/timetable`, {
        headers: { cookie },
      })
    ).json()) as { items: { materialUrl: string }[] };
    expect(got.items[0].materialUrl).toBe("https://speakerdeck.com/x/y");

    const bad = await SELF.fetch(`${BASE}/api/events/${event.id}/timetable`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        items: [
          { title: "LT", durationMin: 10, materialUrl: "javascript:alert(1)" },
        ],
      }),
    });
    expect(bad.status).toBe(400);
  });
});

/** 資料URLの自己編集 PATCH を投げる */
function patchMaterial(
  eventId: string,
  itemId: string,
  cookie: string | null,
  materialUrl: string,
): Promise<Response> {
  return SELF.fetch(
    `${BASE}/api/events/${eventId}/timetable/${itemId}/material`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({ materialUrl }),
    },
  );
}

describe("登壇資料の自己編集 (#148)", () => {
  /** イベント＋登壇者リンク付きのコマを用意し、コマIDを返す */
  async function setupWithSpeaker(): Promise<{
    admin: string;
    eventId: string;
    speaker: { userId: string; cookie: string };
    itemId: string;
  }> {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const speaker = await makeMember(eventId, "participant");
    const saved = await putTimetable(eventId, admin, [
      { title: "オープニング", durationMin: 10 },
      {
        title: "登壇セッション",
        durationMin: 30,
        speakerUserId: speaker.userId,
      },
    ]);
    expect(saved.status).toBe(200);
    const { items } = (await saved.json()) as { items: ScheduleItem[] };
    return { admin, eventId, speaker, itemId: items[1].id };
  }

  it("リンクされた登壇者本人が自分のコマの資料URLを設定・クリアできる", async () => {
    const { eventId, speaker, itemId } = await setupWithSpeaker();

    // 127.0.0.1 はOG取得ガードで弾かれるのでテストが外部ネットワークに出ない
    const res = await patchMaterial(
      eventId,
      itemId,
      speaker.cookie,
      "https://127.0.0.1/my-deck",
    );
    expect(res.status).toBe(200);
    const { item } = (await res.json()) as { item: ScheduleItem };
    expect(item.materialUrl).toBe("https://127.0.0.1/my-deck");
    expect(item.materialOgImage).toBe("");

    // GET でも反映されている（materialOgImage フィールド付き）
    const got = (await (await getTimetable(eventId)).json()) as {
      items: ScheduleItem[];
    };
    expect(got.items[1].materialUrl).toBe("https://127.0.0.1/my-deck");
    expect(got.items[1].materialOgImage).toBe("");

    // 空文字でクリアできる
    const cleared = await patchMaterial(eventId, itemId, speaker.cookie, "");
    expect(cleared.status).toBe(200);
    const clearedBody = (await cleared.json()) as { item: ScheduleItem };
    expect(clearedBody.item.materialUrl).toBe("");
  });

  it("他の非staffメンバーは403、staffは誰のコマでも更新できる、未ログインは401", async () => {
    const { eventId, itemId } = await setupWithSpeaker();
    const other = await makeMember(eventId, "participant");
    const staff = await makeMember(eventId, "staff");

    expect(
      (
        await patchMaterial(
          eventId,
          itemId,
          other.cookie,
          "https://127.0.0.1/steal",
        )
      ).status,
    ).toBe(403);

    const byStaff = await patchMaterial(
      eventId,
      itemId,
      staff.cookie,
      "https://127.0.0.1/staff-set",
    );
    expect(byStaff.status).toBe(200);
    const { item } = (await byStaff.json()) as { item: ScheduleItem };
    expect(item.materialUrl).toBe("https://127.0.0.1/staff-set");

    expect(
      (await patchMaterial(eventId, itemId, null, "https://127.0.0.1/x"))
        .status,
    ).toBe(401);
  });

  it("不正URLは400、別イベントのコマは404", async () => {
    const { admin, eventId, speaker, itemId } = await setupWithSpeaker();

    expect(
      (
        await patchMaterial(
          eventId,
          itemId,
          speaker.cookie,
          "javascript:alert(1)",
        )
      ).status,
    ).toBe(400);

    // 別イベントの ID を経由すると 404（イベント跨ぎ防止）
    const otherEventId = await setupEvent(admin);
    expect(
      (
        await patchMaterial(
          otherEventId,
          itemId,
          speaker.cookie,
          "https://127.0.0.1/x",
        )
      ).status,
    ).toBe(404);

    // 存在しないコマも 404
    expect(
      (
        await patchMaterial(
          eventId,
          crypto.randomUUID(),
          speaker.cookie,
          "https://127.0.0.1/x",
        )
      ).status,
    ).toBe(404);
  });
});

describe("資料OGメタの取得 (#149)", () => {
  it("parseOgImage: og:image を属性順の違い込みで抽出できる", () => {
    expect(
      parseOgImage(
        '<html><head><meta property="og:image" content="https://cdn.example.com/a.png"></head></html>',
      ),
    ).toBe("https://cdn.example.com/a.png");
    // content が先に来る形式
    expect(
      parseOgImage(
        '<meta content="https://cdn.example.com/b.jpg" property="og:image" />',
      ),
    ).toBe("https://cdn.example.com/b.jpg");
    // シングルクォート・追加属性あり
    expect(
      parseOgImage(
        "<meta name='x' property='og:image' data-x='1' content='https://c.example.com/c.png'/>",
      ),
    ).toBe("https://c.example.com/c.png");
    // og:image が無ければ secure_url にフォールバック
    expect(
      parseOgImage(
        '<meta property="og:image:secure_url" content="https://cdn.example.com/s.png">',
      ),
    ).toBe("https://cdn.example.com/s.png");
    // og:image:width 等を og:image と誤認しない
    expect(
      parseOgImage('<meta property="og:image:width" content="1200">'),
    ).toBeNull();
    expect(parseOgImage("<html><body>no og</body></html>")).toBeNull();
  });

  it("isPrivateHost: ローカル/プライベート帯を弾き、公開ホストは通す", () => {
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("10.0.0.5")).toBe(true);
    expect(isPrivateHost("192.168.1.1")).toBe(true);
    expect(isPrivateHost("172.16.0.1")).toBe(true);
    expect(isPrivateHost("172.31.255.255")).toBe(true);
    expect(isPrivateHost("169.254.1.1")).toBe(true);
    expect(isPrivateHost("printer.local")).toBe(true);
    expect(isPrivateHost("[::1]")).toBe(true);
    expect(isPrivateHost("::1")).toBe(true);

    expect(isPrivateHost("speakerdeck.com")).toBe(false);
    expect(isPrivateHost("docs.google.com")).toBe(false);
    expect(isPrivateHost("172.32.0.1")).toBe(false);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
  });
});

describe("資料編集の権限とSSRFガード強化（レビュー対応）", () => {
  it("キャンセル済みの元メンバーは自分のコマでも編集不可", async () => {
    const cookie = await loginDev();
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        title: "キャンセル者編集不可E2E",
        venueType: "online",
        startsAt: Date.now() + 3600_000,
        endsAt: Date.now() + 7200_000,
      }),
    });
    const { event } = (await create.json()) as { event: { id: string } };
    // 一般ユーザーをキャンセル済みメンバーとして直挿入し、そのコマの担当にする
    const uid = crypto.randomUUID();
    const sid = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, 'テスト', NULL, ?)",
    )
      .bind(uid, `nostr:${uid}`, `u_${uid.slice(0, 6)}`, Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
    )
      .bind(sid, uid, Date.now() + 86400000)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at, canceled_at, canceled_scheduling) VALUES (?, ?, ?, 'participant', NULL, 'canceled', 0, ?, ?, 0)",
    )
      .bind(crypto.randomUUID(), event.id, uid, Date.now(), Date.now())
      .run();
    const itemId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event_schedule_item (id, event_id, title, description, duration_min, starts_at, speaker_user_id, speaker_name, material_url, sort_order, created_at) VALUES (?, ?, 'LT', '', 10, NULL, ?, '', '', 0, ?)",
    )
      .bind(itemId, event.id, uid, Date.now())
      .run();

    const res = await SELF.fetch(
      `${BASE}/api/events/${event.id}/timetable/${itemId}/material`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: `eventer_session=${sid}`,
        },
        body: JSON.stringify({ materialUrl: "https://example.com/deck" }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("isPrivateHost: IPv4射影・リンクローカルv6は拒否、fc2.com等の通常ホストは許可", async () => {
    const { isPrivateHost } = await import("../src/lib/urlGuard.js");
    expect(isPrivateHost("[::ffff:7f00:1]")).toBe(true); // ::ffff:127.0.0.1
    expect(isPrivateHost("[::ffff:a9fe:a9fe]")).toBe(true); // 169.254.169.254
    expect(isPrivateHost("[fe81::1]")).toBe(true);
    expect(isPrivateHost("fc2.com")).toBe(false);
    expect(isPrivateHost("fcbarcelona.com")).toBe(false);
    expect(isPrivateHost("speakerdeck.com")).toBe(false);
  });
});
