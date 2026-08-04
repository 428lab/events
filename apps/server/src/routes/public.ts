import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { currentUser } from "../auth/session.js";
import { eventsRepo } from "../db/repositories/events.js";
import { usersRepo } from "../db/repositories/users.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { communitiesRepo } from "../db/repositories/communities.js";
import { decksRepo } from "../db/repositories/decks.js";
import { awardsRepo } from "../db/repositories/awards.js";
import { eventPhotosRepo } from "../db/repositories/eventPhotos.js";
import { listCommunityRequests } from "./eventRequests.js";
import { followsRepo } from "../db/repositories/follows.js";
import { eventLikesRepo } from "../db/repositories/eventLikes.js";
import { gamificationRepo } from "../db/repositories/gamification.js";
import { gamificationFromStats } from "@eventer/shared";

export const publicRoutes = new Hono<AppEnv>();

/** 公開: スライドデッキの閲覧（未ログイン可） */
publicRoutes.get("/decks/:slug", async (c) => {
  const deck = await decksRepo.findBySlug(c.req.param("slug"));
  if (!deck) return c.json({ error: "not_found" }, 404);
  return c.json(deck);
});

/** 公開コミュニティ一覧（未ログイン可） */
publicRoutes.get("/communities", async (c) => {
  return c.json({ communities: await communitiesRepo.list() });
});

/** 公開コミュニティ詳細（未ログイン可。ログイン時は所属/オーナー判定付き） */
publicRoutes.get("/communities/:slug", async (c) => {
  const community = await communitiesRepo.findBySlug(c.req.param("slug"));
  if (!community) return c.json({ error: "not_found" }, 404);
  const user = await currentUser(c);
  const role = user
    ? await communitiesRepo.memberRole(community.id, user.id)
    : null;
  const events = await eventsRepo.listByCommunity(community.id);
  const now = Date.now();
  return c.json({
    ...community,
    isOwner: user ? community.ownerId === user.id : false,
    isMember: Boolean(role),
    myRole: role,
    // 日程調整中（endsAt未確定=0）は常に「開催予定」側
    upcomingEvents: events.filter((e) => e.scheduling || e.endsAt >= now),
    pastEvents: events.filter((e) => !e.scheduling && e.endsAt < now),
    // イベントのたまご（メンバーならメンバー限定も見える）
    requests: await listCommunityRequests(community.id, user),
    // イベント参加者からもらったいいね合計 (#155)
    likesReceived: await eventLikesRepo.receivedCountForCommunity(community.id),
  });
});

/** 公開コミュニティのメンバー一覧 */
publicRoutes.get("/communities/:slug/members", async (c) => {
  const community = await communitiesRepo.findBySlug(c.req.param("slug"));
  if (!community) return c.json({ error: "not_found" }, 404);
  return c.json({ members: await communitiesRepo.listMembers(community.id) });
});

/** 公開ユーザープロフィール（未ログイン可）。アイコン・表示名・公開イベント実績 */
publicRoutes.get("/users/:handle", async (c) => {
  const handle = c.req.param("handle");
  // ハンドル(username)優先、UUID直指定も後方互換で許可
  const user =
    (await usersRepo.findByUsername(handle)) ??
    (await usersRepo.findById(handle));
  if (!user) return c.json({ error: "not_found" }, 404);
  const events = await eventMembersRepo.listPublicEventsForUser(user.id);
  const communities = await communitiesRepo.listForUser(user.id);
  const awards = await awardsRepo.listPublicAwardsForUser(user.id, Date.now());
  const viewer = await currentUser(c);
  return c.json({
    id: user.id,
    handle: user.username,
    name: user.globalName ?? user.username,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    events,
    communities,
    awards,
    participation: {
      ...(await eventMembersRepo.participationStats(user.id, Date.now())),
      // 主催・スタッフとしてもらったいいね合計 (#155)。SQLはいいねリポジトリに集約
      likesReceived: await eventLikesRepo.receivedCountForUser(user.id),
    },
    // XP・レベル・バッジ (#14)。有効イベント（公開・終了済み・確定4人以上）のみから導出
    gamification: gamificationFromStats(
      await gamificationRepo.statsForUser(user.id, Date.now()),
    ),
    followerCount: await followsRepo.followerCount(user.id),
    followingCount: await followsRepo.followingCount(user.id),
    isFollowing: viewer
      ? await followsRepo.isFollowing(viewer.id, user.id)
      : false,
    isMe: viewer?.id === user.id,
    // プロフィールカードPNG（OG画像）の更新時刻。未生成は null (#193)
    cardImageUpdatedAt: user.cardImageUpdatedAt,
  });
});

/** 公開: ユーザーが公開設定イベントに投稿した写真ギャラリー（未ログイン可） */
publicRoutes.get("/users/:handle/photos", async (c) => {
  const handle = c.req.param("handle");
  const user =
    (await usersRepo.findByUsername(handle)) ??
    (await usersRepo.findById(handle));
  if (!user) return c.json({ error: "not_found" }, 404);
  return c.json({ photos: await eventPhotosRepo.listPublicByUser(user.id) });
});

/** 公開イベント検索（キーワード/期間/コミュニティ/並び替え・ページング） */
publicRoutes.get("/events/search", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 12) || 12));
  const offset = (page - 1) * limit;
  const sortParam = c.req.query("sort");
  const opts = {
    q: c.req.query("q")?.trim() || undefined,
    from: c.req.query("from") ? Number(c.req.query("from")) : undefined,
    to: c.req.query("to") ? Number(c.req.query("to")) : undefined,
    after: c.req.query("after") ? Number(c.req.query("after")) : undefined,
    communityId: c.req.query("communityId") || undefined,
    phase:
      c.req.query("phase") === "upcoming" ||
      c.req.query("phase") === "scheduling" ||
      c.req.query("phase") === "past"
        ? (c.req.query("phase") as "upcoming" | "scheduling" | "past")
        : undefined,
    sort:
      sortParam === "recent" || sortParam === "new" ? sortParam : "soon",
    limit,
    offset,
  } as const;
  const total = await eventsRepo.countSearchPublished(opts);
  const events = await eventsRepo.searchPublished(opts);
  return c.json({
    events,
    total,
    page,
    limit,
    hasMore: offset + events.length < total,
  });
});

/** 日程調整中の公開イベント一覧（未ログイン可・新着順・ページング） */
publicRoutes.get("/events/scheduling", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 12) || 12));
  const offset = (page - 1) * limit;
  const total = await eventsRepo.countSchedulingPublished();
  const events = await eventsRepo.listSchedulingPublished(limit, offset);
  return c.json({
    events,
    total,
    page,
    limit,
    hasMore: offset + events.length < total,
  });
});

/** 短いシェアURLの解決（未ログイン可）。公開イベントのみ */
publicRoutes.get("/events/by-slug/:slug", async (c) => {
  const event = await eventsRepo.findBySlug(c.req.param("slug"));
  if (!event || event.status !== "published") {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({ id: event.id });
});

/** 開催前の公開イベント一覧（未ログイン可・開催直前順・ページング） */
publicRoutes.get("/events", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 12) || 12));
  const offset = (page - 1) * limit;
  const now = Date.now();
  const total = await eventsRepo.countUpcomingPublished(now);
  const events = await eventsRepo.listUpcomingPublished(now, limit, offset);
  return c.json({
    events,
    total,
    page,
    limit,
    hasMore: offset + events.length < total,
  });
});

/** 開催済みの公開イベント一覧（未ログイン可・終了が新しい順・ページング） */
publicRoutes.get("/events/past", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 12) || 12));
  const offset = (page - 1) * limit;
  const now = Date.now();
  const total = await eventsRepo.countPastPublished(now);
  const events = await eventsRepo.listPastPublished(now, limit, offset);
  return c.json({
    events,
    total,
    page,
    limit,
    hasMore: offset + events.length < total,
  });
});
