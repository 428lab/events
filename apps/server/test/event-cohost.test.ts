import { SELF, env } from "cloudflare:test";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { CommunityCohost, Event, EventCohost } from "@eventer/shared";
import { emailRepo } from "../src/db/repositories/email.js";

/**
 * イベントの共催コミュニティ (#625)。docs/event-cohost.md
 *
 * 主眼は「共催は表示と一覧掲載だけで、権限を渡さない」こと。共催先の owner/admin が
 * 承認して初めて成立し、成立してもそのイベントを編集できないことを固定する。
 * あわせて、申請・承認・却下の権限、エラー、上限、通知の宛先、主催の付け替え・
 * 複製・削除との関係を見る。
 */

const BASE = "https://example.com";
const DAY = 86400000;

interface TestUser {
  userId: string;
  cookie: string;
}

/** アプリ運営管理者ではない一般ユーザー（roles.ts のバイパスに引っかからない） */
async function makeUser(): Promise<TestUser> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `t:${uid}`, `u_${uid.slice(0, 8)}`, `表示_${uid.slice(0, 4)}`, Date.now())
    .run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sid, uid, Date.now() + DAY)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

async function addMember(communityId: string, userId: string, role: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), communityId, userId, role, Date.now())
    .run();
}

async function makeCommunity(ownerId: string): Promise<{ id: string; slug: string; name: string }> {
  const id = crypto.randomUUID();
  const slug = `c-${id.slice(0, 8)}`;
  const name = `community_${id.slice(0, 4)}`;
  await env.DB.prepare(
    "INSERT INTO community (id, slug, name, description, owner_id, created_at) VALUES (?, ?, ?, '', ?, ?)",
  )
    .bind(id, slug, name, ownerId, Date.now())
    .run();
  await addMember(id, ownerId, "owner");
  return { id, slug, name };
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function call(path: string, user: TestUser | null, method = "GET", body?: unknown): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(user ? { cookie: user.cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** 主催コミュニティ付きのイベントを作る（作成者は staff）。publish で公開まで進める */
async function createEvent(
  owner: TestUser,
  communityId: string | null,
  opts: { publish?: boolean } = {},
): Promise<string> {
  const res = await call("/api/events", owner, "POST", {
    title: "共催の検証",
    venueType: "online",
    venueOnline: "https://example.com/meet",
    startsAt: Date.now() + DAY,
    endsAt: Date.now() + DAY + 3600000,
    communityId,
  });
  expect(res.status).toBe(201);
  const id = (await json<{ event: Event }>(res)).event.id;
  if (opts.publish) {
    expect((await call(`/api/events/${id}/publish`, owner, "POST")).status).toBe(200);
  }
  return id;
}

const request = (eventId: string, by: TestUser, slug: string) =>
  call(`/api/events/${eventId}/cohosts`, by, "POST", { slug });
const accept = (communityId: string, eventId: string, by: TestUser) =>
  call(`/api/communities/${communityId}/cohosts/${eventId}/accept`, by, "POST");

async function detailCohosts(eventId: string, viewer: TestUser | null) {
  const res = await call(`/api/events/${eventId}`, viewer);
  expect(res.status).toBe(200);
  return (await json<{ cohosts: { id: string; slug: string; name: string; iconUrl: string | null }[] }>(res))
    .cohosts;
}

async function communityPageEventIds(slug: string, viewer: TestUser | null): Promise<string[]> {
  const page = await json<{ upcomingEvents: Event[]; pastEvents: Event[] }>(
    await call(`/api/public/communities/${slug}`, viewer),
  );
  return [...page.upcomingEvents, ...page.pastEvents].map((e) => e.id);
}

async function searchEventIds(slug: string, viewer: TestUser | null): Promise<string[]> {
  const page = await json<{ events: Event[] }>(await call(`/api/public/communities/${slug}/events`, viewer));
  return page.events.map((e) => e.id);
}

async function cohostRows(eventId: string): Promise<{ community_id: string; status: string }[]> {
  const { results } = await env.DB.prepare(
    "SELECT community_id, status FROM event_cohost WHERE event_id = ? ORDER BY community_id",
  )
    .bind(eventId)
    .all<{ community_id: string; status: string }>();
  return results;
}

/** 主催 A（owner = host）と共催先 B（owner = cohostOwner, admin = cohostAdmin）の組 */
async function fixture(opts: { publish?: boolean } = { publish: true }) {
  const host = await makeUser();
  const cohostOwner = await makeUser();
  const cohostAdmin = await makeUser();
  const a = await makeCommunity(host.userId);
  const b = await makeCommunity(cohostOwner.userId);
  await addMember(b.id, cohostAdmin.userId, "admin");
  const eventId = await createEvent(host, a.id, opts);
  return { host, cohostOwner, cohostAdmin, a, b, eventId };
}

describe("共催の申請と承認 (#625)", () => {
  it("申請しただけでは詳細に出ず、承認すると主催と同じ形で詳細に出る", async () => {
    const { host, cohostAdmin, b, eventId } = await fixture();

    const res = await request(eventId, host, b.slug);
    expect(res.status).toBe(201);
    const { cohosts } = await json<{ cohosts: EventCohost[] }>(res);
    expect(cohosts).toHaveLength(1);
    expect(cohosts[0]).toMatchObject({ communityId: b.id, slug: b.slug, name: b.name, status: "pending" });
    expect(await detailCohosts(eventId, null)).toEqual([]);

    expect((await accept(b.id, eventId, cohostAdmin)).status).toBe(200);
    expect(await detailCohosts(eventId, null)).toEqual([
      { id: b.id, slug: b.slug, name: b.name, iconUrl: null },
    ]);
    const list = await json<{ cohosts: EventCohost[] }>(await call(`/api/events/${eventId}/cohosts`, host));
    expect(list.cohosts[0]?.status).toBe("accepted");
    expect(list.cohosts[0]?.respondedAt).toEqual(expect.any(Number));
  });

  it("URL の形（https://…/c/<slug>/）でも申請できる", async () => {
    const { host, b, eventId } = await fixture();
    expect((await request(eventId, host, `https://example.com/c/${b.slug}/`)).status).toBe(201);
    expect(await cohostRows(eventId)).toEqual([{ community_id: b.id, status: "pending" }]);
  });

  it("共催先には依頼中として見え、承認すると共催中になる。主催コミュニティ名も返す", async () => {
    const { host, cohostOwner, a, b, eventId } = await fixture();
    await request(eventId, host, b.slug);
    const before = await json<{ cohosts: CommunityCohost[] }>(
      await call(`/api/communities/${b.id}/cohosts`, cohostOwner),
    );
    expect(before.cohosts).toEqual([
      expect.objectContaining({
        eventId,
        eventTitle: "共催の検証",
        eventStatus: "published",
        eventVisibility: "public",
        hostCommunityName: a.name,
        status: "pending",
      }),
    ]);
    const after = await json<{ cohosts: CommunityCohost[] }>(await accept(b.id, eventId, cohostOwner));
    expect(after.cohosts[0]?.status).toBe("accepted");
  });

  it("承認順に並び、承認待ちはその後ろに申請順で並ぶ", async () => {
    const { host, eventId } = await fixture();
    const owners = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const cs = [];
    for (const owner of owners) cs.push(await makeCommunity(owner.userId));
    for (const c of cs) expect((await request(eventId, host, c.slug)).status).toBe(201);
    // 2番目 → 1番目の順に承認、3番目は承認待ち
    await accept(cs[1]!.id, eventId, owners[1]!);
    await accept(cs[0]!.id, eventId, owners[0]!);
    const list = await json<{ cohosts: EventCohost[] }>(await call(`/api/events/${eventId}/cohosts`, host));
    expect(list.cohosts.map((x) => x.communityId)).toEqual([cs[1]!.id, cs[0]!.id, cs[2]!.id]);
    expect((await detailCohosts(eventId, null)).map((x) => x.id)).toEqual([cs[1]!.id, cs[0]!.id]);
  });
});

describe("共催側コミュニティページの一覧 (#625)", () => {
  it("承認後だけ共催側の一覧・検索に出る。開催数（eventCount）には数えない", async () => {
    const { host, cohostOwner, a, b, eventId } = await fixture();
    await request(eventId, host, b.slug);
    expect(await communityPageEventIds(b.slug, null)).not.toContain(eventId);
    expect(await searchEventIds(b.slug, null)).not.toContain(eventId);
    // 主催側の一覧・検索には従来どおり出る
    expect(await communityPageEventIds(a.slug, null)).toContain(eventId);
    expect(await searchEventIds(a.slug, null)).toContain(eventId);

    await accept(b.id, eventId, cohostOwner);
    expect(await communityPageEventIds(b.slug, null)).toContain(eventId);
    expect(await searchEventIds(b.slug, null)).toContain(eventId);
    expect(await searchEventIds(a.slug, null)).toContain(eventId);
    const page = await json<{ eventCount: number }>(await call(`/api/public/communities/${b.slug}`, null));
    expect(page.eventCount).toBe(0);
  });

  it("非公開イベントは共催側の一覧でも閲覧資格のある人にだけ出る（共催先の owner には出ない）", async () => {
    const { host, cohostOwner, a, b } = await fixture();
    const invitee = await makeUser();
    const outsider = await makeUser();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event(id,title,community_id,created_by,created_at,starts_at,ends_at,venue_type,status,visibility) VALUES(?,?,?,?,1,?,?,'online','published','private')",
    )
      .bind(id, "非公開の共催", a.id, host.userId, Date.now() + DAY, Date.now() + DAY + 3600000)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_access_invite(id,event_id,user_id,status,source,created_at) VALUES(?,?,?,'accepted','invite',1)",
    )
      .bind(crypto.randomUUID(), id, invitee.userId)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_cohost(event_id,community_id,status,created_at,responded_at) VALUES(?,?,'accepted',1,2)",
    )
      .bind(id, b.id)
      .run();

    expect(await communityPageEventIds(b.slug, invitee)).toContain(id);
    expect(await searchEventIds(b.slug, invitee)).toContain(id);
    for (const viewer of [null, outsider, cohostOwner]) {
      expect(await communityPageEventIds(b.slug, viewer)).not.toContain(id);
      expect(await searchEventIds(b.slug, viewer)).not.toContain(id);
    }
  });
});

describe("共催の権限 (#625)", () => {
  it("一般ユーザー・共催先の admin はイベント側 API で 403", async () => {
    const { host, cohostAdmin, b, eventId } = await fixture();
    const stranger = await makeUser();
    await request(eventId, host, b.slug);
    for (const user of [stranger, cohostAdmin]) {
      expect((await call(`/api/events/${eventId}/cohosts`, user)).status).toBe(403);
      expect((await request(eventId, user, b.slug)).status).toBe(403);
      expect((await call(`/api/events/${eventId}/cohosts/${b.id}`, user, "DELETE")).status).toBe(403);
    }
    expect(await cohostRows(eventId)).toHaveLength(1);
  });

  it("主催側の管理者はコミュニティ側 API で 403", async () => {
    const { host, b, eventId } = await fixture();
    await request(eventId, host, b.slug);
    expect((await call(`/api/communities/${b.id}/cohosts`, host)).status).toBe(403);
    expect((await accept(b.id, eventId, host)).status).toBe(403);
    expect((await call(`/api/communities/${b.id}/cohosts/${eventId}`, host, "DELETE")).status).toBe(403);
    expect(await cohostRows(eventId)).toEqual([{ community_id: b.id, status: "pending" }]);
  });

  it("共催先の一般メンバーもコミュニティ側 API で 403", async () => {
    const { host, b, eventId } = await fixture();
    const member = await makeUser();
    await addMember(b.id, member.userId, "member");
    await request(eventId, host, b.slug);
    expect((await call(`/api/communities/${b.id}/cohosts`, member)).status).toBe(403);
    expect((await accept(b.id, eventId, member)).status).toBe(403);
  });

  it("承認後も共催先の owner/admin はイベントを編集できない（権限を渡さない）", async () => {
    const { host, cohostOwner, cohostAdmin, b, eventId } = await fixture();
    await request(eventId, host, b.slug);
    await accept(b.id, eventId, cohostAdmin);
    for (const user of [cohostOwner, cohostAdmin]) {
      expect((await call(`/api/events/${eventId}`, user, "PATCH", { title: "乗っ取り" })).status).toBe(403);
      expect((await call(`/api/events/${eventId}/cohosts`, user)).status).toBe(403);
    }
  });

  it("下書きのイベントは共催を承認しても共催先の owner/admin から見えない（閲覧資格にも効かない）", async () => {
    const { host, cohostOwner, cohostAdmin, b, eventId } = await fixture({ publish: false });
    await request(eventId, host, b.slug);
    await accept(b.id, eventId, cohostAdmin);
    for (const user of [cohostOwner, cohostAdmin]) {
      expect((await call(`/api/events/${eventId}`, user)).status).toBe(404);
      expect((await call(`/api/events/${eventId}`, user, "PATCH", { title: "乗っ取り" })).status).toBe(404);
    }
  });
});

describe("共催の申請のエラー (#625)", () => {
  it("コミュニティなし 404 / 主催と同じ 400 / 既にある 409 / 上限 400", async () => {
    const { host, a, b, eventId } = await fixture();

    const missing = await request(eventId, host, "no-such-community");
    expect(missing.status).toBe(404);
    expect(await json<{ error: string }>(missing)).toEqual({ error: "community_not_found" });

    const self = await request(eventId, host, a.slug);
    expect(self.status).toBe(400);
    expect(await json<{ error: string }>(self)).toEqual({ error: "host_community" });

    expect((await request(eventId, host, b.slug)).status).toBe(201);
    const dup = await request(eventId, host, b.slug);
    expect(dup.status).toBe(409);
    expect(await json<{ error: string }>(dup)).toEqual({ error: "already_cohost" });
  });

  it("承認待ちを含めて 5 件まで。6 件目は cohost_limit", async () => {
    const { host, b, eventId } = await fixture();
    expect((await request(eventId, host, b.slug)).status).toBe(201);
    for (let i = 0; i < 4; i++) {
      const c = await makeCommunity((await makeUser()).userId);
      expect((await request(eventId, host, c.slug)).status).toBe(201);
    }
    const sixth = await makeCommunity((await makeUser()).userId);
    const res = await request(eventId, host, sixth.slug);
    expect(res.status).toBe(400);
    expect(await json<{ error: string }>(res)).toEqual({ error: "cohost_limit" });
    expect(await cohostRows(eventId)).toHaveLength(5);
  });
});

describe("共催の取り下げ・辞退 (#625)", () => {
  it("主催側は承認待ちも共催中も取り下げられる", async () => {
    const { host, cohostOwner, b, eventId } = await fixture();
    await request(eventId, host, b.slug);
    expect((await call(`/api/events/${eventId}/cohosts/${b.id}`, host, "DELETE")).status).toBe(200);
    expect(await cohostRows(eventId)).toEqual([]);

    await request(eventId, host, b.slug);
    await accept(b.id, eventId, cohostOwner);
    expect((await call(`/api/events/${eventId}/cohosts/${b.id}`, host, "DELETE")).status).toBe(200);
    expect(await cohostRows(eventId)).toEqual([]);
    expect((await call(`/api/events/${eventId}/cohosts/${b.id}`, host, "DELETE")).status).toBe(404);
  });

  it("共催側は辞退（承認待ち）も共催をやめる（共催中）もできる", async () => {
    const { host, cohostAdmin, b, eventId } = await fixture();
    await request(eventId, host, b.slug);
    expect((await call(`/api/communities/${b.id}/cohosts/${eventId}`, cohostAdmin, "DELETE")).status).toBe(200);
    expect(await cohostRows(eventId)).toEqual([]);

    await request(eventId, host, b.slug);
    await accept(b.id, eventId, cohostAdmin);
    expect((await call(`/api/communities/${b.id}/cohosts/${eventId}`, cohostAdmin, "DELETE")).status).toBe(200);
    expect(await cohostRows(eventId)).toEqual([]);
    expect(await detailCohosts(eventId, null)).toEqual([]);
  });

  it("承認済みのものはもう一度承認できない", async () => {
    const { host, cohostOwner, b, eventId } = await fixture();
    await request(eventId, host, b.slug);
    expect((await accept(b.id, eventId, cohostOwner)).status).toBe(200);
    expect((await accept(b.id, eventId, cohostOwner)).status).toBe(404);
  });
});

describe("共催の通知 (#625)", () => {
  async function notices(type: string, eventTitle: string) {
    const { results } = await env.DB.prepare(
      "SELECT user_id, event_id, actor_id, link, title FROM notification WHERE type = ? AND title LIKE ? ORDER BY user_id",
    )
      .bind(type, `%${eventTitle}%`)
      .all<{ user_id: string; event_id: string | null; actor_id: string | null; link: string; title: string }>();
    return results;
  }

  /** 依頼の通知（宛先と種別で引く） */
  async function requestNotices(userIds: string[]) {
    const { results } = await env.DB.prepare(
      `SELECT user_id, title, body, link FROM notification
       WHERE type = 'cohost_request' AND user_id IN (SELECT value FROM json_each(?)) ORDER BY user_id`,
    )
      .bind(JSON.stringify(userIds))
      .all<{ user_id: string; title: string; body: string; link: string }>();
    return results;
  }

  it("依頼は共催先の owner/admin 全員に eventId なしで、結果は作成者に eventId 付きで届く", async () => {
    const { host, cohostOwner, cohostAdmin, a, b, eventId } = await fixture();
    const member = await makeUser();
    await addMember(b.id, member.userId, "member");
    const title = `共催通知_${eventId.slice(0, 8)}`;
    expect((await call(`/api/events/${eventId}`, host, "PATCH", { title })).status).toBe(200);

    await request(eventId, host, b.slug);
    const requested = await notices("cohost_request", title);
    expect(requested.map((n) => n.user_id).sort()).toEqual([cohostOwner.userId, cohostAdmin.userId].sort());
    for (const n of requested) {
      expect(n.event_id).toBeNull();
      expect(n.actor_id).toBeNull();
      expect(n.link).toBe(`/c/${b.slug}/edit#cohosts`);
      // 公開済みの公開イベントは題名を出す
      expect(n.title).toBe(`「${title}」の共催の依頼が届きました`);
    }
    expect((await requestNotices([cohostOwner.userId]))[0]?.body).toBe(
      `${a.name} から ${b.name} への共催の依頼です。`,
    );

    await accept(b.id, eventId, cohostAdmin);
    const accepted = await notices("cohost_result", title);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      user_id: host.userId,
      event_id: eventId,
      link: `/events/${eventId}/manage#cohosts`,
      title: `「${title}」の共催が承諾されました`,
    });

    // 共催をやめたときは知らせない
    await call(`/api/communities/${b.id}/cohosts/${eventId}`, cohostAdmin, "DELETE");
    expect(await notices("cohost_result", title)).toHaveLength(1);

    // 辞退は知らせる
    await request(eventId, host, b.slug);
    await call(`/api/communities/${b.id}/cohosts/${eventId}`, cohostAdmin, "DELETE");
    const results = await notices("cohost_result", title);
    expect(results.map((n) => n.title).sort()).toEqual(
      [`「${title}」の共催が承諾されました`, `「${title}」の共催が辞退されました`].sort(),
    );

    // 主催側の取り下げは知らせない
    const before = (await notices("cohost_request", title)).length;
    await call(`/api/events/${eventId}/cohosts/${b.id}`, host, "DELETE");
    expect((await notices("cohost_result", title)).length).toBe(2);
    expect((await notices("cohost_request", title)).length).toBe(before);
  });
});

describe("共催の依頼の通知で題名を伏せる (#625)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function requestNotices(userIds: string[]) {
    const { results } = await env.DB.prepare(
      `SELECT user_id, event_id, title, body, link FROM notification
       WHERE type = 'cohost_request' AND user_id IN (SELECT value FROM json_each(?)) ORDER BY user_id`,
    )
      .bind(JSON.stringify(userIds))
      .all<{ user_id: string; event_id: string | null; title: string; body: string; link: string }>();
    return results;
  }

  it("下書きのイベントへの依頼は題名を含まない汎用の文面で届き、通知一覧にも出る", async () => {
    const { host, cohostOwner, cohostAdmin, a, b, eventId } = await fixture({ publish: false });
    const title = `下書き共催_${eventId.slice(0, 8)}`;
    expect((await call(`/api/events/${eventId}`, host, "PATCH", { title })).status).toBe(200);
    await request(eventId, host, b.slug);

    const rows = await requestNotices([cohostOwner.userId, cohostAdmin.userId]);
    expect(rows).toHaveLength(2);
    for (const n of rows) {
      expect(n).toMatchObject({ event_id: null, title: "イベントの更新があります", body: "", link: `/c/${b.slug}/edit#cohosts` });
      expect(n.title + n.body).not.toContain(title);
      expect(n.body).not.toContain(a.name);
    }
    const inbox = await json<{ notifications: { type: string; title: string; body: string }[] }>(
      await call("/api/notifications", cohostAdmin),
    );
    const got = inbox.notifications.filter((n) => n.type === "cohost_request");
    expect(got).toHaveLength(1);
    expect(got[0]!.title + got[0]!.body).not.toContain(title);
  });

  it("非公開（公開済み）のイベントへの依頼も題名を含まない汎用の文面で届く", async () => {
    const { host, cohostOwner, b, eventId } = await fixture();
    const title = `非公開共催_${eventId.slice(0, 8)}`;
    await env.DB.prepare("UPDATE event SET title = ?, visibility = 'private' WHERE id = ?").bind(title, eventId).run();
    await request(eventId, host, b.slug);

    const rows = await requestNotices([cohostOwner.userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "イベントの更新があります", body: "", link: `/c/${b.slug}/edit#cohosts` });
  });

  it("限定公開（公開済み）のイベントへの依頼は題名を出す", async () => {
    const { host, cohostOwner, b, eventId } = await fixture();
    const title = `限定公開共催_${eventId.slice(0, 8)}`;
    await env.DB.prepare("UPDATE event SET title = ?, visibility = 'unlisted' WHERE id = ?").bind(title, eventId).run();
    await request(eventId, host, b.slug);
    expect((await requestNotices([cohostOwner.userId]))[0]?.title).toBe(`「${title}」の共催の依頼が届きました`);
  });

  it("依頼はメールを送らない（取り下げ→再依頼で再送されないように）。アプリ内通知は届く", async () => {
    const { host, cohostOwner, cohostAdmin, b, eventId } = await fixture();
    const spy = vi.spyOn(emailRepo, "findRecipientsAmong");
    await request(eventId, host, b.slug);
    await call(`/api/events/${eventId}/cohosts/${b.id}`, host, "DELETE");
    await request(eventId, host, b.slug);
    expect(spy).not.toHaveBeenCalled();
    expect(await requestNotices([cohostOwner.userId, cohostAdmin.userId])).toHaveLength(4);
  });
});

describe("共催先の一覧で閲覧できないイベントを伏せる (#625)", () => {
  const listFor = async (communityId: string, user: TestUser) =>
    (await json<{ cohosts: CommunityCohost[] }>(await call(`/api/communities/${communityId}/cohosts`, user))).cohosts;

  it("承認後に非公開にしたイベントは、題名・日時・主催名を null にし、eventId と状態は残す", async () => {
    const { host, cohostOwner, b, eventId } = await fixture();
    await request(eventId, host, b.slug);
    await accept(b.id, eventId, cohostOwner);
    await env.DB.prepare("UPDATE event SET visibility = 'private' WHERE id = ?").bind(eventId).run();

    const [row] = await listFor(b.id, cohostOwner);
    expect(row).toMatchObject({
      eventId,
      eventTitle: null,
      eventStartsAt: null,
      hostCommunityName: null,
      eventStatus: "published",
      eventVisibility: "private",
      status: "accepted",
    });
    expect(row!.createdAt).toEqual(expect.any(Number));
    expect(row!.respondedAt).toEqual(expect.any(Number));
    // 伏せた行でも共催をやめられる
    expect((await call(`/api/communities/${b.id}/cohosts/${eventId}`, cohostOwner, "DELETE")).status).toBe(200);
  });

  it("依頼中の下書きも伏せ、承諾できる", async () => {
    const { host, cohostOwner, b, eventId } = await fixture({ publish: false });
    await request(eventId, host, b.slug);
    const [row] = await listFor(b.id, cohostOwner);
    expect(row).toMatchObject({ eventId, eventTitle: null, eventStartsAt: null, eventStatus: "draft", status: "pending" });
    expect((await accept(b.id, eventId, cohostOwner)).status).toBe(200);
  });

  it("閲覧できる人（非公開イベントに招待済み）には題名・日時が出る", async () => {
    const { host, cohostOwner, a, b, eventId } = await fixture();
    await request(eventId, host, b.slug);
    await env.DB.prepare("UPDATE event SET visibility = 'private' WHERE id = ?").bind(eventId).run();
    await env.DB.prepare(
      "INSERT INTO event_access_invite(id,event_id,user_id,status,source,created_at) VALUES(?,?,?,'accepted','invite',1)",
    )
      .bind(crypto.randomUUID(), eventId, cohostOwner.userId)
      .run();
    const [row] = await listFor(b.id, cohostOwner);
    expect(row).toMatchObject({ eventId, eventTitle: "共催の検証", hostCommunityName: a.name });
    expect(row!.eventStartsAt).toEqual(expect.any(Number));
  });
});

describe("主催の付け替え・複製・削除 (#625)", () => {
  it("共催にいたコミュニティを主催に付け替えると、その共催は消える", async () => {
    const { host, cohostOwner, b, eventId } = await fixture();
    await request(eventId, host, b.slug);
    await accept(b.id, eventId, cohostOwner);
    // 付け替えには新しい主催の owner/admin であることが要る (#264)
    await addMember(b.id, host.userId, "admin");
    expect((await call(`/api/events/${eventId}`, host, "PATCH", { communityId: b.id })).status).toBe(200);
    expect(await cohostRows(eventId)).toEqual([]);
  });

  it("共催にいないコミュニティへの付け替えでは共催は残る", async () => {
    const { host, cohostOwner, b, eventId } = await fixture();
    await request(eventId, host, b.slug);
    await accept(b.id, eventId, cohostOwner);
    const c = await makeCommunity(host.userId);
    expect((await call(`/api/events/${eventId}`, host, "PATCH", { communityId: c.id })).status).toBe(200);
    expect(await cohostRows(eventId)).toEqual([{ community_id: b.id, status: "accepted" }]);
  });

  it("複製では共催を引き継がない", async () => {
    const { host, cohostOwner, b, eventId } = await fixture();
    await request(eventId, host, b.slug);
    await accept(b.id, eventId, cohostOwner);
    const dup = await call(`/api/events/${eventId}/duplicate`, host, "POST");
    expect(dup.status).toBe(201);
    const copy = (await json<{ event: Event }>(dup)).event.id;
    expect(await cohostRows(copy)).toEqual([]);
    expect(await cohostRows(eventId)).toHaveLength(1);
  });

  it("共催先コミュニティを削除すると共催の行も消える", async () => {
    const { host, cohostOwner, b, eventId } = await fixture();
    await request(eventId, host, b.slug);
    await accept(b.id, eventId, cohostOwner);
    expect((await call(`/api/communities/${b.id}`, cohostOwner, "DELETE")).status).toBe(200);
    expect(await cohostRows(eventId)).toEqual([]);
  });

  it("イベントを削除すると共催の行も消える", async () => {
    const { host, cohostOwner, b, eventId } = await fixture();
    await request(eventId, host, b.slug);
    await accept(b.id, eventId, cohostOwner);
    expect((await call(`/api/events/${eventId}`, host, "DELETE")).status).toBe(200);
    expect(await cohostRows(eventId)).toEqual([]);
  });
});

describe("自分が管理するコミュニティへの共催はすぐ成立する", () => {
  /** そのイベントに関わる共催の通知（依頼・結果）を、宛先を問わず全部引く */
  async function cohostNotices(eventId: string, communitySlug: string) {
    const { results } = await env.DB.prepare(
      `SELECT user_id, type FROM notification
       WHERE (type = 'cohost_result' AND event_id = ?)
          OR (type = 'cohost_request' AND link = ?)`,
    )
      .bind(eventId, `/c/${communitySlug}/edit#cohosts`)
      .all<{ user_id: string; type: string }>();
    return results;
  }

  it("依頼者が共催先の owner なら承認なしで共催中になり、依頼・結果の通知を出さない", async () => {
    const { host, cohostAdmin, eventId } = await fixture();
    const own = await makeCommunity(host.userId);
    await addMember(own.id, cohostAdmin.userId, "admin");

    const res = await request(eventId, host, own.slug);
    expect(res.status).toBe(201);
    const body = await json<{ status: string; cohosts: EventCohost[] }>(res);
    expect(body.status).toBe("accepted");
    expect(body.cohosts).toEqual([
      expect.objectContaining({ communityId: own.id, status: "accepted", respondedAt: expect.any(Number) }),
    ]);
    expect(await detailCohosts(eventId, null)).toEqual([
      { id: own.id, slug: own.slug, name: own.name, iconUrl: null },
    ]);
    expect(await communityPageEventIds(own.slug, null)).toContain(eventId);
    // 共催先のほかの admin にも、作成者にも何も届かない
    expect(await cohostNotices(eventId, own.slug)).toEqual([]);
  });

  it("共催先の admin（owner でない）でも同じくすぐ共催中になる", async () => {
    const { host, b, eventId } = await fixture();
    await addMember(b.id, host.userId, "admin");
    const res = await request(eventId, host, b.slug);
    expect(res.status).toBe(201);
    expect((await json<{ status: string }>(res)).status).toBe("accepted");
    expect(await cohostRows(eventId)).toEqual([{ community_id: b.id, status: "accepted" }]);
    expect(await cohostNotices(eventId, b.slug)).toEqual([]);
  });

  it("共催先の一般メンバーや部外者の依頼は従来どおり承認待ちで、依頼の通知が届く", async () => {
    const { host, cohostOwner, cohostAdmin, b, eventId } = await fixture();
    await addMember(b.id, host.userId, "member");
    const res = await request(eventId, host, b.slug);
    expect(res.status).toBe(201);
    expect((await json<{ status: string }>(res)).status).toBe("pending");
    expect(await cohostRows(eventId)).toEqual([{ community_id: b.id, status: "pending" }]);
    expect((await cohostNotices(eventId, b.slug)).map((n) => n.user_id).sort()).toEqual(
      [cohostOwner.userId, cohostAdmin.userId].sort(),
    );
  });

  it("自分のコミュニティでも主催と同じなら 400、既にあれば 409、上限（承認待ちを含めて 5）は効く", async () => {
    const { host, a, eventId } = await fixture();
    const self = await request(eventId, host, a.slug);
    expect(self.status).toBe(400);
    expect(await json<{ error: string }>(self)).toEqual({ error: "host_community" });

    const own = await makeCommunity(host.userId);
    expect((await request(eventId, host, own.slug)).status).toBe(201);
    const dup = await request(eventId, host, own.slug);
    expect(dup.status).toBe(409);
    expect(await json<{ error: string }>(dup)).toEqual({ error: "already_cohost" });

    // 他人のコミュニティ 4 件（承認待ち）で 5 件に達したら、自分のコミュニティでも追加できない
    for (let i = 0; i < 4; i++) {
      const c = await makeCommunity((await makeUser()).userId);
      expect((await request(eventId, host, c.slug)).status).toBe(201);
    }
    const another = await makeCommunity(host.userId);
    const res = await request(eventId, host, another.slug);
    expect(res.status).toBe(400);
    expect(await json<{ error: string }>(res)).toEqual({ error: "cohost_limit" });
    expect(await cohostRows(eventId)).toHaveLength(5);
  });
});
