import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { Event } from "@eventer/shared";

const BASE = "https://example.com";
const DAY = 86400000;

/** イベントをコミュニティに紐づける権限 (#264)。
 * 紐づけたイベントはそのコミュニティの一覧とKPI（開催数・不発率・新規流入・
 * 重複度）にそのまま入るため、第三者が勝手にぶら下げられてはいけない。 */

async function makeUser(
  opts: { admin?: boolean } = {},
): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, NULL, NULL, ?)",
  )
    .bind(uid, opts.admin ? "dev-user" : `t:${uid}`, `u_${uid.slice(0, 8)}`, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + DAY)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

async function makeCommunity(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO community (id, slug, name, description, owner_id, created_at) VALUES (?, ?, ?, '', ?, ?)",
  )
    .bind(id, `c-${id.slice(0, 8)}`, `community_${id.slice(0, 4)}`, ownerId, Date.now())
    .run();
  await addMember(id, ownerId, "owner");
  return id;
}

async function addMember(
  communityId: string,
  userId: string,
  role: string,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), communityId, userId, role, Date.now())
    .run();
}

async function createEvent(
  cookie: string,
  communityId: string | null,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "テストイベント",
      venueType: "online",
      venueOnline: "https://example.com/meet",
      startsAt: Date.now() + DAY,
      endsAt: Date.now() + DAY + 3600000,
      communityId,
    }),
  });
}

async function createdEventId(
  cookie: string,
  communityId: string | null,
): Promise<string> {
  const res = await createEvent(cookie, communityId);
  expect(res.status).toBe(201);
  return ((await res.json()) as { event: Event }).event.id;
}

async function patchEvent(
  eventId: string,
  cookie: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

async function communityIdOf(eventId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT community_id FROM event WHERE id = ?",
  )
    .bind(eventId)
    .first<{ community_id: string | null }>();
  return row?.community_id ?? null;
}

describe("POST /api/events のコミュニティ紐付け (#264)", () => {
  it("コミュニティのオーナーは自分のコミュニティに紐づけて作れる", async () => {
    const owner = await makeUser();
    const cid = await makeCommunity(owner.userId);
    const id = await createdEventId(owner.cookie, cid);
    expect(await communityIdOf(id)).toBe(cid);
  });

  it("コミュニティ管理者 (admin) も紐づけられる", async () => {
    const owner = await makeUser();
    const manager = await makeUser();
    const cid = await makeCommunity(owner.userId);
    await addMember(cid, manager.userId, "admin");
    const id = await createdEventId(manager.cookie, cid);
    expect(await communityIdOf(id)).toBe(cid);
  });

  it("非メンバーは 403。イベント自体も作られない", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const cid = await makeCommunity(owner.userId);

    const res = await createEvent(stranger.cookie, cid);
    expect(res.status).toBe(403);

    const count = await env.DB.prepare(
      "SELECT COUNT(1) AS n FROM event WHERE community_id = ?",
    )
      .bind(cid)
      .first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("一般メンバーも 403（コミュニティ参加は誰でもできるため）", async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const cid = await makeCommunity(owner.userId);
    // 本番と同じ経路で自分から参加する
    const join = await SELF.fetch(`${BASE}/api/communities/${cid}/membership`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: member.cookie },
      body: "{}",
    });
    expect(join.status).toBe(200);

    expect((await createEvent(member.cookie, cid)).status).toBe(403);
  });

  it("存在しないコミュニティIDも 403", async () => {
    const user = await makeUser();
    expect((await createEvent(user.cookie, crypto.randomUUID())).status).toBe(403);
  });

  it("コミュニティ無し (null) は誰でも作れる", async () => {
    const user = await makeUser();
    const id = await createdEventId(user.cookie, null);
    expect(await communityIdOf(id)).toBeNull();
  });

  it("運営管理者は非メンバーでも紐づけられる", async () => {
    const owner = await makeUser();
    const admin = await makeUser({ admin: true });
    const cid = await makeCommunity(owner.userId);
    const id = await createdEventId(admin.cookie, cid);
    expect(await communityIdOf(id)).toBe(cid);
  });
});

describe("PATCH /api/events/:id のコミュニティ紐付け (#264)", () => {
  it("イベントstaffでもコミュニティ管理者でなければ紐付け先を変えられない", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const cid = await makeCommunity(owner.userId);
    // 自分のイベント（コミュニティ無し）を他人のコミュニティに付け替えようとする
    const id = await createdEventId(stranger.cookie, null);

    const res = await patchEvent(id, stranger.cookie, { communityId: cid });
    expect(res.status).toBe(403);
    expect(await communityIdOf(id)).toBeNull();
  });

  it("コミュニティ管理者は紐付け先を変えられる", async () => {
    const owner = await makeUser();
    const cid = await makeCommunity(owner.userId);
    const id = await createdEventId(owner.cookie, null);

    const res = await patchEvent(id, owner.cookie, { communityId: cid });
    expect(res.status).toBe(200);
    expect(await communityIdOf(id)).toBe(cid);
  });

  it("別のコミュニティへの付け替えも権限を見る", async () => {
    const owner = await makeUser();
    const otherOwner = await makeUser();
    const mine = await makeCommunity(owner.userId);
    const theirs = await makeCommunity(otherOwner.userId);
    const id = await createdEventId(owner.cookie, mine);

    expect((await patchEvent(id, owner.cookie, { communityId: theirs })).status).toBe(403);
    expect(await communityIdOf(id)).toBe(mine);
  });

  it("紐付けを外す (null) のは staff なら誰でもできる", async () => {
    const owner = await makeUser();
    const staff = await makeUser();
    const cid = await makeCommunity(owner.userId);
    const id = await createdEventId(owner.cookie, cid);
    await env.DB.prepare(
      "INSERT INTO event_member (id, event_id, user_id, role, status, attended, created_at) VALUES (?, ?, ?, 'staff', 'confirmed', 0, ?)",
    )
      .bind(crypto.randomUUID(), id, staff.userId, Date.now())
      .run();

    const res = await patchEvent(id, staff.cookie, { communityId: null });
    expect(res.status).toBe(200);
    expect(await communityIdOf(id)).toBeNull();
  });

  it("コミュニティ管理者でないstaffでも、現在値をそのまま送る保存は通る", async () => {
    // 編集フォームは communityId を常に送り返すため、変更が無いのに 403 にすると
    // コミュニティ管理者以外のstaffがイベントを編集できなくなる
    const owner = await makeUser();
    const staff = await makeUser();
    const cid = await makeCommunity(owner.userId);
    const id = await createdEventId(owner.cookie, cid);
    await env.DB.prepare(
      "INSERT INTO event_member (id, event_id, user_id, role, status, attended, created_at) VALUES (?, ?, ?, 'staff', 'confirmed', 0, ?)",
    )
      .bind(crypto.randomUUID(), id, staff.userId, Date.now())
      .run();

    const res = await patchEvent(id, staff.cookie, {
      title: "タイトル変更",
      communityId: cid,
    });
    expect(res.status).toBe(200);
    expect(await communityIdOf(id)).toBe(cid);
    const ev = (await res.json()) as { event: Event };
    expect(ev.event.title).toBe("タイトル変更");
  });

  it("communityId を送らない保存はこれまでどおり通る", async () => {
    const owner = await makeUser();
    const staff = await makeUser();
    const cid = await makeCommunity(owner.userId);
    const id = await createdEventId(owner.cookie, cid);
    await env.DB.prepare(
      "INSERT INTO event_member (id, event_id, user_id, role, status, attended, created_at) VALUES (?, ?, ?, 'staff', 'confirmed', 0, ?)",
    )
      .bind(crypto.randomUUID(), id, staff.userId, Date.now())
      .run();

    const res = await patchEvent(id, staff.cookie, { title: "タイトルだけ" });
    expect(res.status).toBe(200);
    expect(await communityIdOf(id)).toBe(cid);
  });
});
