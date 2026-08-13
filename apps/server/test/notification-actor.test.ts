import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

/**
 * 通知の主語を列として持つ (#380)。
 *
 * 退会 (#250) したとき、その人が「した側」として生まれた通知を他の利用者の
 * 一覧から消している。以前この判定は種別ごとに link / title からの推定に
 * 分かれており、
 *   - `followee_joined_event` は title の日本語の綴りに依存していた
 *   - link / title は「**現在の** username・表示名」なので改名で外れた
 *   - 同じ表示名の別人が同席していると、その人の通知まで消していた
 * のいずれでも破れていた。いまは `notification.actor_id` 一本で判定する。
 *
 * このファイルが守るのは **i18n 第3段階（通知を種別＋値に作り直す）の前提**。
 * 通知の文言を差し替えても退会で消えること、つまり削除条件が文面に
 * 依存していないことを、実際の経路で作った通知に対して確かめる。
 * 生 INSERT で通知行を手作りすると「作る側が actor_id を入れ忘れた」も
 * 「文言に依存していない」も証明できないので、原則として経路を通す。
 */

const BASE = "https://example.com";
const HOUR = 3600_000;

/** 退会申請で消える通知の種別。
 * `db/repositories/notifications.ts` の ACTOR_ERASED_TYPES と対。
 * 片方だけ増やさないこと（増やすなら 9.4 の「消さない種別」も見直す） */
const ERASED_TYPES: readonly string[] = [
  "meet",
  "followee_created_event",
  "followee_joined_event",
];

interface TestUser {
  userId: string;
  username: string;
  cookie: string;
}

/** アプリ運営管理者ではない一般ユーザー（セッション付き）。
 * 表示名は通知タイトルに焼き込まれるので、通知を作る**前**に決めておく */
async function makeUser(displayName: string | null = null): Promise<TestUser> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `a_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, username, displayName, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 24 * HOUR)
    .run();
  return { userId: uid, username, cookie: `eventer_session=${sid}` };
}

async function follow(follower: TestUser, targetUsername: string): Promise<void> {
  const res = await SELF.fetch(`${BASE}/api/users/${targetUsername}/follow`, {
    method: "POST",
    headers: { cookie: follower.cookie },
  });
  expect(res.status).toBe(200);
}

/** 下書きイベントを作る（作成者は自動で staff になる）。
 * 公開通知は draft→published の遷移でしか飛ばないので、必ず下書きから始める */
async function createDraftEvent(owner: TestUser, title: string): Promise<string> {
  const startsAt = Date.now() + 24 * HOUR;
  const res = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: owner.cookie },
    body: JSON.stringify({
      title: `${title}_${crypto.randomUUID().slice(0, 6)}`,
      venueType: "online",
      startsAt,
      endsAt: startsAt + 4 * HOUR,
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { event: { id: string } }).event.id;
}

async function publishEvent(owner: TestUser, eventId: string): Promise<void> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: owner.cookie },
    body: JSON.stringify({ status: "published" }),
  });
  expect(res.status).toBe(200);
}

/** 参加枠なしのイベントに参加する（＝その場で confirmed になり参加通知が飛ぶ） */
async function joinEvent(user: TestUser, eventId: string): Promise<void> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: user.cookie },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(201);
}

/** いま開催中の公開イベントを直接入れる（QR読み取りの下ごしらえ）。
 * 出会いは「開催時間帯に共通イベントの確定参加者どうし」でしか記録できず、
 * API で作るイベント（未来の日時）では窓に入らない。ここで作るのは前提の
 * 状態だけで、通知そのものは /api/meet/scan に作らせる */
async function insertOngoingEvent(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, attendance_check, scheduling, created_by, created_at)
     VALUES (?, ?, ?, ?, 'offline', 'published', 1, 0, ?, ?)`,
  )
    .bind(id, `出会い_${id.slice(0, 6)}`, now - HOUR, now + HOUR, ownerId, now)
    .run();
  return id;
}

async function addMember(eventId: string, userId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, 'participant', NULL, 'confirmed', 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, Date.now())
    .run();
}

async function issueMeetToken(cookie: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/meet/token`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

/** QRを読み取る。通知は「読まれた側」に届き、actor は読み取った側 */
async function scanMeet(cookie: string, token: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/meet/scan`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ token }),
  });
}

async function requestDelete(cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/me`, {
    method: "DELETE",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ confirm: true }),
  });
}

interface NotifRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  actor_id: string | null;
}

/** 指定した受信者たちの通知を全部取る（消えたことは件数ではなく行で見る） */
async function notificationsOf(...userIds: string[]): Promise<NotifRow[]> {
  const res = await env.DB.prepare(
    `SELECT id, user_id, type, title, actor_id FROM notification
      WHERE user_id IN (${userIds.map(() => "?").join(", ")})`,
  )
    .bind(...userIds)
    .all<NotifRow>();
  return res.results;
}

/** 通知の文面を全く別の文字列に置き換える。
 * i18n 第3段階（種別＋値への作り直し）の先取り。ここで消えなくなる実装は、
 * 文言を差し替えた瞬間に「退会しても名前が残る」不具合になる */
async function scrambleWording(...userIds: string[]): Promise<void> {
  await env.DB.prepare(
    `UPDATE notification SET title = 'XXXX', body = 'XXXX'
      WHERE user_id IN (${userIds.map(() => "?").join(", ")})`,
  )
    .bind(...userIds)
    .run();
}

/** 退会で消えるべき3種別を、すべて実際の経路で作る。
 *
 * - followee_created_event: フォロワーが actor をフォロー → actor がイベントを公開
 * - followee_joined_event : actor が他人の公開イベントに参加（枠なし＝即 confirmed）
 * - meet                  : actor が peer のQRを読み取る
 *
 * 作られたことと actor_id が埋まっていることをここで確認するので、
 * 「作る側が actor_id を入れ忘れた」もこの helper で検出できる。 */
async function makeErasableNotifications(
  actor: TestUser,
): Promise<{ follower: TestUser; peer: TestUser }> {
  const follower = await makeUser();
  const host = await makeUser("主催者");
  const peer = await makeUser("同席者");
  await follow(follower, actor.username);

  // (1) 公開通知。1イベント1回だけなので下書きから公開へ遷移させる
  await publishEvent(actor, await createDraftEvent(actor, "公開通知"));

  // (2) 参加通知。公開イベントでないと飛ばない
  const hosted = await createDraftEvent(host, "参加通知");
  await publishEvent(host, hosted);
  await joinEvent(actor, hosted);

  // (3) 出会いの通知。開催中の共通イベントの確定参加者どうしで読み取る
  const ongoing = await insertOngoingEvent(host.userId);
  await addMember(ongoing, actor.userId);
  await addMember(ongoing, peer.userId);
  expect(
    (await scanMeet(actor.cookie, await issueMeetToken(peer.cookie))).status,
  ).toBe(200);

  // 退会前に3種別とも実在し、actor_id が actor で埋まっている
  const rows = await notificationsOf(follower.userId, peer.userId);
  for (const type of ERASED_TYPES) {
    const found = rows.filter((r) => r.type === type);
    expect(found).toHaveLength(1);
    expect(found[0].actor_id).toBe(actor.userId);
  }
  return { follower, peer };
}

describe("通知の actor (#380)", () => {
  it("通知の文面を書き替えても、退会でフォロワー・同席者の一覧から消える", async () => {
    // 本命。削除条件が文言に依存していれば、i18n 第3段階で必ず壊れる
    const actor = await makeUser("退会するひと");
    const { follower, peer } = await makeErasableNotifications(actor);

    // 通知が出来たあとで文面を別物にする（第3段階の先取り）
    await scrambleWording(follower.userId, peer.userId);

    expect((await requestDelete(actor.cookie)).status).toBe(200);

    const left = await notificationsOf(follower.userId, peer.userId);
    expect(left.filter((r) => ERASED_TYPES.includes(r.type))).toEqual([]);
  });

  it("同じ表示名の別のフォロイーが同じイベントに居ても、退会した側の通知だけ消える", async () => {
    // 旧実装は title LIKE '{表示名} さんが%' で消していたため、同じ表示名の
    // 別人が同席していると、その人の通知まで巻き添えで消していた
    const sameName = "同じ表示名";
    const a = await makeUser(sameName);
    const b = await makeUser(sameName);
    const follower = await makeUser();
    const host = await makeUser("主催者");
    await follow(follower, a.username);
    await follow(follower, b.username);

    const eventId = await createDraftEvent(host, "同姓同名");
    await publishEvent(host, eventId);
    await joinEvent(a, eventId);
    await joinEvent(b, eventId);

    const joined = (await notificationsOf(follower.userId)).filter(
      (r) => r.type === "followee_joined_event",
    );
    expect(joined.map((r) => r.actor_id).sort()).toEqual(
      [a.userId, b.userId].sort(),
    );
    // 2件のタイトルは1文字も違わない（＝文面では区別できない状態）
    expect(new Set(joined.map((r) => r.title)).size).toBe(1);

    expect((await requestDelete(a.cookie)).status).toBe(200);

    const after = (await notificationsOf(follower.userId)).filter(
      (r) => r.type === "followee_joined_event",
    );
    expect(after.map((r) => r.actor_id)).toEqual([b.userId]);
  });

  it("出会い・参加のあとに改名しても、退会で3種別とも消える", async () => {
    // link / title は「現在の username・表示名」だったので、旧実装は
    // 通知のあとに改名した人の通知を取りこぼしていた
    const actor = await makeUser("最初の表示名");
    const { follower, peer } = await makeErasableNotifications(actor);

    const renamed = `r_${crypto.randomUUID().slice(0, 8)}`;
    const handle = await SELF.fetch(`${BASE}/api/me/username`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: actor.cookie },
      body: JSON.stringify({ username: renamed }),
    });
    expect(handle.status).toBe(200);
    const display = await SELF.fetch(`${BASE}/api/me/display-name`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: actor.cookie },
      body: JSON.stringify({ displayName: "あとから変えた表示名" }),
    });
    expect(display.status).toBe(200);

    expect((await requestDelete(actor.cookie)).status).toBe(200);

    const left = await notificationsOf(follower.userId, peer.userId);
    expect(left.filter((r) => ERASED_TYPES.includes(r.type))).toEqual([]);
  });

  it("actor が居ない通知と、退会で消さない種別の通知は巻き込まない", async () => {
    // actor_id を埋める範囲（文面に名前が出る通知すべて）と、退会で消す範囲
    // （3種別だけ）はわざと一致させていない。広い方に引きずられないこと
    const actor = await makeUser("巻き込み検証");
    const { follower, peer } = await makeErasableNotifications(actor);

    // 主語が人ではない通知（actor_id IS NULL）。ここは経路ではなく
    // 「actor が居ない行」を作ること自体が目的なので直接入れる
    const insertActorless = async (userId: string, type: string) => {
      await env.DB.prepare(
        "INSERT INTO notification (id, user_id, type, title, body, link, read_at, created_at) VALUES (?, ?, ?, ?, '', '', 0, ?)",
      )
        .bind(crypto.randomUUID(), userId, type, `${type} の知らせ`, Date.now())
        .run();
    };
    await insertActorless(follower.userId, "event_broadcast");
    await insertActorless(peer.userId, "lottery_won");

    // actor_id は埋めるが ACTOR_ERASED_TYPES には入れない種別（招待は退会で
    // 黙って消さない）。こちらは実際の招待経路で作る
    const draft = await createDraftEvent(actor, "運営招待");
    const invited = await SELF.fetch(
      `${BASE}/api/events/${draft}/staff-invites`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: actor.cookie },
        body: JSON.stringify({ handle: peer.username }),
      },
    );
    expect(invited.status).toBe(201);
    const inviteBefore = (await notificationsOf(peer.userId)).filter(
      (r) => r.type === "staff_invite",
    );
    expect(inviteBefore).toHaveLength(1);
    expect(inviteBefore[0].actor_id).toBe(actor.userId);

    expect((await requestDelete(actor.cookie)).status).toBe(200);

    const after = await notificationsOf(follower.userId, peer.userId);
    // 消えたのは3種別だけ
    expect(after.filter((r) => ERASED_TYPES.includes(r.type))).toEqual([]);
    // actor の居ない通知は1件も減っていない
    expect(
      after
        .filter((r) => r.actor_id === null)
        .map((r) => r.type)
        .sort(),
    ).toEqual(["event_broadcast", "lottery_won"]);
    // 削除対象外の種別は actor_id が入っていても残る
    const inviteAfter = after.filter((r) => r.type === "staff_invite");
    expect(inviteAfter).toHaveLength(1);
    expect(inviteAfter[0].actor_id).toBe(actor.userId);
  });
});
