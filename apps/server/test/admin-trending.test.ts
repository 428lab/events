import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import {
  TRENDING_MIN_RISING_SCORE,
  TRENDING_USER_WEIGHTS,
  type KpiPayload,
  type TrendingPayload,
  type TrendingUserItem,
} from "@eventer/shared";

const BASE = "https://example.com";
const DAY = 86400000;

/** ユーザーを1人作る（セッション付き）。admin=true で ADMIN_DISCORD_IDS に一致させる */
async function makeUser(
  opts: { admin?: boolean; deletedAt?: number | null } = {},
): Promise<{ userId: string; cookie: string; handle: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const handle = `u_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at, deleted_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)",
  )
    .bind(
      uid,
      opts.admin ? "dev-user" : `t:${uid}`,
      handle,
      Date.now(),
      opts.deletedAt ?? null,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + DAY)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}`, handle };
}

/** 開催完了イベントを1件作る。本番と同じく作成者の staff メンバー行も作る
 * （POST /events が必ず作るため。作らないと「主催しただけの人」が参加に
 * 数えられるバグを検出できない） */
async function makeEvent(opts: {
  createdBy: string;
  endsAt?: number;
  status?: string;
  attendanceCheck?: boolean;
  communityId?: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  const endsAt = opts.endsAt ?? Date.now() - DAY;
  await env.DB.prepare(
    `INSERT INTO event (id, title, description, starts_at, ends_at, venue_type,
       status, created_by, created_at, attendance_check, scheduling, community_id)
     VALUES (?, ?, '', ?, ?, 'online', ?, ?, ?, ?, 0, ?)`,
  )
    .bind(
      id,
      `e_${id.slice(0, 8)}`,
      endsAt - 3600000,
      endsAt,
      opts.status ?? "published",
      opts.createdBy,
      endsAt - DAY,
      opts.attendanceCheck ? 1 : 0,
      opts.communityId ?? null,
    )
    .run();
  await join({ eventId: id, userId: opts.createdBy, role: "staff" });
  return id;
}

async function join(opts: {
  eventId: string;
  userId: string;
  role?: string;
  status?: string;
  attended?: boolean;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO event_member (id, event_id, user_id, role, created_at, status, attended)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      opts.eventId,
      opts.userId,
      opts.role ?? "participant",
      Date.now(),
      opts.status ?? "confirmed",
      opts.attended ? 1 : 0,
    )
    .run();
}

/** いいね。kind='host'/'staff'/'participant' は target_key が対象ユーザー、
 * kind='community' は target_key がコミュニティID */
async function like(opts: {
  eventId: string;
  byUserId: string;
  kind: string;
  targetKey: string;
  createdAt?: number;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO event_like (id, event_id, user_id, kind, target_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      opts.eventId,
      opts.byUserId,
      opts.kind,
      opts.targetKey,
      opts.createdAt ?? Date.now(),
    )
    .run();
}

async function meet(eventId: string, a: string, b: string): Promise<void> {
  const [low, high] = a < b ? [a, b] : [b, a];
  await env.DB.prepare(
    "INSERT INTO event_meet (id, event_id, user_low, user_high, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), eventId, low, high, Date.now())
    .run();
}

async function egg(createdBy: string, createdAt = Date.now()): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO event_request (id, title, description, status, created_by, created_at)
     VALUES (?, 'たまご', '', 'open', ?, ?)`,
  )
    .bind(id, createdBy, createdAt)
    .run();
  return id;
}

async function eggReaction(
  requestId: string,
  userId: string,
  kind = "attend",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_request_reaction (request_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(requestId, userId, kind, Date.now())
    .run();
}

async function follow(followerId: string, followeeId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO user_follow (follower_id, followee_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(followerId, followeeId, Date.now())
    .run();
}

async function makeCommunity(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO community (id, slug, name, description, icon_url, owner_id, created_at)
     VALUES (?, ?, ?, '', NULL, ?, ?)`,
  )
    .bind(id, `c_${id.slice(0, 8)}`, `com_${id.slice(0, 8)}`, ownerId, Date.now())
    .run();
  return id;
}

async function addCommunityMember(
  communityId: string,
  userId: string,
  createdAt = Date.now(),
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)",
  )
    .bind(crypto.randomUUID(), communityId, userId, createdAt)
    .run();
}

async function getTrending(
  cookie: string,
  days?: number,
): Promise<TrendingPayload> {
  const res = await SELF.fetch(
    `${BASE}/api/admin/trending${days ? `?days=${days}` : ""}`,
    { headers: { cookie } },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as TrendingPayload;
}

/** リストから特定ユーザーを探す（存在しなければ undefined） */
function find(
  list: TrendingUserItem[],
  userId: string,
): TrendingUserItem | undefined {
  return list.find((u) => u.id === userId);
}

describe("GET /api/admin/trending 認可", () => {
  it("未ログインは 401", async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/trending`);
    expect(res.status).toBe(401);
  });

  it("運営管理者でないユーザーは 403", async () => {
    const u = await makeUser();
    const res = await SELF.fetch(`${BASE}/api/admin/trending`, {
      headers: { cookie: u.cookie },
    });
    expect(res.status).toBe(403);
  });

  it("運営管理者は 200", async () => {
    const admin = await makeUser({ admin: true });
    const res = await SELF.fetch(`${BASE}/api/admin/trending`, {
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(200);
  });
});

describe("注目: データが無いとき", () => {
  it("ゼロ除算せず 200・空リストで返る", async () => {
    const admin = await makeUser({ admin: true });
    const t = await getTrending(admin.cookie, 30);

    expect(t.days).toBe(30);
    expect(t.users.active).toEqual([]);
    expect(t.users.rising).toEqual([]);
    expect(t.communities.active).toEqual([]);
    expect(t.communities.rising).toEqual([]);

    // NaN / Infinity が混ざっていないこと（JSON では null になる）
    const flat = JSON.stringify(t);
    expect(flat).not.toContain("NaN");
    expect(flat).not.toContain("Infinity");
  });
});

describe("注目: ユーザーのスコア", () => {
  it("主催・スタッフ・参加・いいね・出会い・たまご・フォロワーを重み付けで足す", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const staff = await makeUser();
    const p1 = await makeUser();
    const judge = await makeUser();
    const observer = await makeUser();
    const liker = await makeUser();
    const follower = await makeUser();

    const ev = await makeEvent({ createdBy: host.userId });
    await join({ eventId: ev, userId: staff.userId, role: "staff" });
    await join({ eventId: ev, userId: p1.userId });
    await join({ eventId: ev, userId: judge.userId, role: "judge" });
    await join({ eventId: ev, userId: observer.userId, role: "observer" });
    // 主催者がいいねを1つもらう
    await like({
      eventId: ev,
      byUserId: liker.userId,
      kind: "host",
      targetKey: host.userId,
    });
    // p1 と judge が出会う（1件の記録は両者に加算される）
    await meet(ev, p1.userId, judge.userId);
    // p1 がたまごを投稿し、judge が賛同
    const eggId = await egg(p1.userId);
    await eggReaction(eggId, judge.userId);
    // 主催者にフォロワーが1人増える
    await follow(follower.userId, host.userId);

    const t = await getTrending(admin.cookie, 30);
    const W = TRENDING_USER_WEIGHTS;

    // 主催1 + もらったいいね1 + フォロワー1 = 100 + 5 + 3 = 108
    const h = find(t.users.active, host.userId);
    expect(h?.score).toBe(W.hosted + W.likeReceived + W.followerGained);
    expect(h?.score).toBe(108);
    expect(h?.breakdown).toEqual({
      hosted: 1,
      staffed: 0,
      joined: 0,
      likesReceived: 1,
      meets: 0,
      eggsPosted: 0,
      eggReactions: 0,
      followersGained: 1,
    });
    expect(h?.handle).toBe(host.handle);

    // スタッフ参加1 = 50。主催者の staff 行は本人の主催なので staffed に数えない
    expect(find(t.users.active, staff.userId)?.score).toBe(W.staffed);
    expect(find(t.users.active, staff.userId)?.score).toBe(50);
    expect(find(t.users.active, staff.userId)?.breakdown.joined).toBe(0);

    // 参加1 + 出会い1 + たまご投稿1 = 10 + 5 + 10 = 25
    expect(find(t.users.active, p1.userId)?.score).toBe(
      W.joined + W.meet + W.eggPosted,
    );
    expect(find(t.users.active, p1.userId)?.score).toBe(25);

    // 審査員も「参加」。参加1 + 出会い1 + 賛同1 = 10 + 5 + 2 = 17
    expect(find(t.users.active, judge.userId)?.score).toBe(
      W.joined + W.meet + W.eggReaction,
    );
    expect(find(t.users.active, judge.userId)?.score).toBe(17);

    // 観覧者も「参加」= 10
    expect(find(t.users.active, observer.userId)?.score).toBe(W.joined);

    // 何もしていない人（いいねを押しただけ・フォローしただけ）は載らない
    expect(find(t.users.active, liker.userId)).toBeUndefined();
    expect(find(t.users.active, follower.userId)).toBeUndefined();
    expect(find(t.users.active, admin.userId)).toBeUndefined();

    // 活動量上位はスコアの降順
    const scores = t.users.active.map((u) => u.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));

    // 活動量上位のリストは前期間比を持たない（急上昇リストだけの情報）
    expect(t.users.active.every((u) => u.ratio === null)).toBe(true);
  });

  it("出席チェック実施イベントは出席した人だけを参加として数える", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const came = await makeUser();
    const noShow = await makeUser();

    const ev = await makeEvent({ createdBy: host.userId, attendanceCheck: true });
    await join({ eventId: ev, userId: came.userId, attended: true });
    await join({ eventId: ev, userId: noShow.userId, attended: false });

    const t = await getTrending(admin.cookie, 30);
    expect(find(t.users.active, came.userId)?.score).toBe(
      TRENDING_USER_WEIGHTS.joined,
    );
    expect(find(t.users.active, noShow.userId)).toBeUndefined();
  });

  it("下書きイベントと未開催イベントは数えない", async () => {
    const admin = await makeUser({ admin: true });
    const draftHost = await makeUser();
    const futureHost = await makeUser();

    await makeEvent({ createdBy: draftHost.userId, status: "draft" });
    await makeEvent({ createdBy: futureHost.userId, endsAt: Date.now() + DAY });

    const t = await getTrending(admin.cookie, 30);
    expect(find(t.users.active, draftHost.userId)).toBeUndefined();
    expect(find(t.users.active, futureHost.userId)).toBeUndefined();
  });
});

describe("注目: 退会申請中の除外", () => {
  it("退会申請中のユーザーはどちらのリストにも出ない", async () => {
    const admin = await makeUser({ admin: true });
    const gone = await makeUser({ deletedAt: Date.now() });
    const alive = await makeUser();

    await makeEvent({ createdBy: gone.userId });
    await makeEvent({ createdBy: alive.userId });

    const t = await getTrending(admin.cookie, 30);
    expect(find(t.users.active, gone.userId)).toBeUndefined();
    expect(find(t.users.rising, gone.userId)).toBeUndefined();
    expect(find(t.users.active, alive.userId)?.score).toBe(
      TRENDING_USER_WEIGHTS.hosted,
    );
  });
});

describe("注目: 急上昇", () => {
  it("前期間ありは倍率順・前期間0は新規として先頭・足切り未満は出ない", async () => {
    const admin = await makeUser({ admin: true });
    const grown = await makeUser(); // 前期間1件 → 今期間2件（倍率2.0）
    const doubled = await makeUser(); // 前期間1件 → 今期間3件（倍率3.0）
    const fresh = await makeUser(); // 前期間0件 → 今期間1件（新規）
    const small = await makeUser(); // 今期間の参加2回だけ（足切り未満）

    const now = Date.now();
    const cur = now - 2 * DAY; // 今期間（7日）の中
    const prev = now - 10 * DAY; // 前の7日間の中

    await makeEvent({ createdBy: grown.userId, endsAt: prev });
    await makeEvent({ createdBy: grown.userId, endsAt: cur });
    await makeEvent({ createdBy: grown.userId, endsAt: cur - 3600000 });

    await makeEvent({ createdBy: doubled.userId, endsAt: prev });
    for (let i = 0; i < 3; i++) {
      await makeEvent({ createdBy: doubled.userId, endsAt: cur - i * 3600000 });
    }

    const freshEvent = await makeEvent({ createdBy: fresh.userId, endsAt: cur });

    // small: 参加2回 = 20点。足切り (user: 30) 未満
    await join({ eventId: freshEvent, userId: small.userId });
    const another = await makeEvent({ createdBy: fresh.userId, endsAt: cur });
    await join({ eventId: another, userId: small.userId });

    const t = await getTrending(admin.cookie, 7);
    const W = TRENDING_USER_WEIGHTS;

    // 期待値: grown 200/100 = 2.0、doubled 300/100 = 3.0
    const g = find(t.users.rising, grown.userId);
    expect(g?.score).toBe(2 * W.hosted);
    expect(g?.previousScore).toBe(W.hosted);
    expect(g?.ratio).toBe(2);
    expect(g?.isNew).toBe(false);

    const d = find(t.users.rising, doubled.userId);
    expect(d?.ratio).toBe(3);

    // 新規（前期間0）は倍率を持たず、リストの先頭側に並ぶ
    const f = find(t.users.rising, fresh.userId);
    expect(f?.isNew).toBe(true);
    expect(f?.ratio).toBeNull();
    expect(f?.previousScore).toBe(0);
    const ids = t.users.rising.map((u) => u.id);
    expect(ids.indexOf(fresh.userId)).toBeLessThan(ids.indexOf(grown.userId));
    expect(ids.indexOf(fresh.userId)).toBeLessThan(ids.indexOf(doubled.userId));

    // 新規のあとは倍率の降順
    expect(ids.indexOf(doubled.userId)).toBeLessThan(ids.indexOf(grown.userId));

    // 足切り未満は急上昇に出ない（活動量上位には出る）
    expect(find(t.users.rising, small.userId)).toBeUndefined();
    expect(find(t.users.active, small.userId)?.score).toBe(2 * W.joined);
    expect(2 * W.joined).toBeLessThan(TRENDING_MIN_RISING_SCORE.user);

    // 倍率に NaN / Infinity が出ない
    const flat = JSON.stringify(t);
    expect(flat).not.toContain("NaN");
    expect(flat).not.toContain("Infinity");
  });

  it("前期間より下がった人も倍率つきで返る（1未満）", async () => {
    const admin = await makeUser({ admin: true });
    const down = await makeUser();
    const now = Date.now();

    await makeEvent({ createdBy: down.userId, endsAt: now - 10 * DAY });
    await makeEvent({ createdBy: down.userId, endsAt: now - 11 * DAY });
    await makeEvent({ createdBy: down.userId, endsAt: now - 2 * DAY });

    const t = await getTrending(admin.cookie, 7);
    const d = find(t.users.rising, down.userId);
    expect(d?.score).toBe(TRENDING_USER_WEIGHTS.hosted);
    expect(d?.previousScore).toBe(2 * TRENDING_USER_WEIGHTS.hosted);
    expect(d?.ratio).toBe(0.5);
  });

  it("前期間より前の活動は前期間にも今期間にも入らない", async () => {
    const admin = await makeUser({ admin: true });
    const old = await makeUser();
    // 7日指定なら前期間は 7〜14日前。20日前は範囲外
    await makeEvent({ createdBy: old.userId, endsAt: Date.now() - 20 * DAY });

    const t = await getTrending(admin.cookie, 7);
    expect(find(t.users.active, old.userId)).toBeUndefined();
  });
});

describe("注目: KPI との整合", () => {
  it("参加のカウントが KPI の参加者数（JOINED）と一致する", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const staff = await makeUser();
    const p1 = await makeUser();
    const p2 = await makeUser();
    const judge = await makeUser();
    const observer = await makeUser();
    const canceled = await makeUser();
    const gone = await makeUser({ deletedAt: Date.now() });

    const ev = await makeEvent({ createdBy: host.userId });
    await join({ eventId: ev, userId: staff.userId, role: "staff" });
    await join({ eventId: ev, userId: p1.userId });
    await join({ eventId: ev, userId: p2.userId });
    await join({ eventId: ev, userId: judge.userId, role: "judge" });
    await join({ eventId: ev, userId: observer.userId, role: "observer" });
    await join({ eventId: ev, userId: canceled.userId, status: "canceled" });
    await join({ eventId: ev, userId: gone.userId });

    const t = await getTrending(admin.cookie, 30);
    const kpiRes = await SELF.fetch(`${BASE}/api/admin/kpi?days=30`, {
      headers: { cookie: admin.cookie },
    });
    const kpi = (await kpiRes.json()) as KpiPayload;

    const joinedTotal = t.users.active.reduce(
      (sum, u) => sum + u.breakdown.joined,
      0,
    );
    // p1 / p2 / judge / observer の4人。主催・スタッフ・取消・退会申請中は数えない
    expect(joinedTotal).toBe(4);
    expect(joinedTotal).toBe(kpi.northStar.heldParticipants);
  });
});

describe("注目: コミュニティ", () => {
  it("開催数・延べ参加者・新規メンバー・もらったいいねを重み付けで足す", async () => {
    const admin = await makeUser({ admin: true });
    const owner = await makeUser();
    const p1 = await makeUser();
    const p2 = await makeUser();
    const liker = await makeUser();

    const cid = await makeCommunity(owner.userId);
    const ev = await makeEvent({ createdBy: owner.userId, communityId: cid });
    await join({ eventId: ev, userId: p1.userId });
    await join({ eventId: ev, userId: p2.userId });
    await addCommunityMember(cid, p1.userId);
    await like({
      eventId: ev,
      byUserId: liker.userId,
      kind: "community",
      targetKey: cid,
    });

    const t = await getTrending(admin.cookie, 30);
    const c = t.communities.active.find((x) => x.id === cid);
    // 開催1 (100) + 延べ参加者2 (5x2) + 新規メンバー1 (10) + いいね1 (5) = 125
    expect(c?.score).toBe(125);
    expect(c?.breakdown).toEqual({
      heldEvents: 1,
      participations: 2,
      newMembers: 1,
      likesReceived: 1,
    });
    expect(c?.slug).toBeTruthy();
    expect(c?.isNew).toBe(true);
  });

  it("コミュニティの急上昇も前期間比で並ぶ", async () => {
    const admin = await makeUser({ admin: true });
    const owner = await makeUser();
    const cid = await makeCommunity(owner.userId);
    const now = Date.now();

    await makeEvent({
      createdBy: owner.userId,
      communityId: cid,
      endsAt: now - 10 * DAY,
    });
    await makeEvent({
      createdBy: owner.userId,
      communityId: cid,
      endsAt: now - 2 * DAY,
    });
    await makeEvent({
      createdBy: owner.userId,
      communityId: cid,
      endsAt: now - 3 * DAY,
    });

    const t = await getTrending(admin.cookie, 7);
    const c = t.communities.rising.find((x) => x.id === cid);
    expect(c?.score).toBe(200);
    expect(c?.previousScore).toBe(100);
    expect(c?.ratio).toBe(2);
    expect(c?.isNew).toBe(false);
  });

  it("コミュニティに属さないイベントはコミュニティのスコアにならない", async () => {
    const admin = await makeUser({ admin: true });
    const owner = await makeUser();
    await makeEvent({ createdBy: owner.userId });

    const t = await getTrending(admin.cookie, 30);
    expect(t.communities.active).toEqual([]);
  });
});

describe("注目: 期間パラメータ", () => {
  it("未指定は既定日数・不正値も既定日数にフォールバックする", async () => {
    const admin = await makeUser({ admin: true });
    expect((await getTrending(admin.cookie)).days).toBe(30);

    const res = await SELF.fetch(`${BASE}/api/admin/trending?days=abc`, {
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as TrendingPayload).days).toBe(30);
  });

  it("巨大な days でも 500 にならない（クランプされる）", async () => {
    const admin = await makeUser({ admin: true });
    const res = await SELF.fetch(`${BASE}/api/admin/trending?days=1e9`, {
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(200);
    const t = (await res.json()) as TrendingPayload;
    expect(t.days).toBe(3650);
    expect(t.sinceDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(t.previousSinceDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
