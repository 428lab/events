import { Hono } from "hono";
import {
  createEventRequestInput,
  reactEventRequestInput,
  type CreateEventRequestInput,
  type EventRequest,
  type ReactEventRequestInput,
} from "@eventer/shared";
import { z } from "zod";
import type { AppEnv } from "../types.js";
import { currentUser, requireAuth } from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventRequestsRepo } from "../db/repositories/eventRequests.js";
import { communitiesRepo } from "../db/repositories/communities.js";
import { eventsRepo } from "../db/repositories/events.js";
import { usersRepo } from "../db/repositories/users.js";
import { notificationsRepo } from "../db/repositories/notifications.js";
import type { User } from "@eventer/shared";

/** イベントのたまご（あったらいいなリクエスト）#29 */

const PAGE_LIMIT = 20;

/** メンバー限定リクエストを閲覧できるか（メンバー・投稿者・アプリ管理者） */
async function canView(
  req: EventRequest,
  user: User | null,
): Promise<boolean> {
  if (!req.membersOnly || !req.communityId) return true;
  if (!user) return false;
  if (req.createdBy === user.id || isAppAdmin(user)) return true;
  const role = await communitiesRepo.memberRole(req.communityId, user.id);
  return role != null;
}

/** ---- 公開（未ログイン可）: /api/public 配下 ---- */
export const publicEventRequestRoutes = new Hono<AppEnv>();

/** 全体のたまご一覧（メンバー限定は除く。コミュニティ公開ぶんは含む）。
 * q=キーワード（タイトル・説明）、sort=new(新着・既定)|popular(参加したい数) */
publicEventRequestRoutes.get("/", async (c) => {
  const status = c.req.query("status") === "closed" ? "closed" : "open";
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const q = c.req.query("q")?.trim() || undefined;
  const sort = c.req.query("sort") === "popular" ? "popular" : "new";
  const requests = await eventRequestsRepo.listPublic(
    { status, q, sort },
    PAGE_LIMIT,
    (page - 1) * PAGE_LIMIT,
  );
  const total = await eventRequestsRepo.countPublic({ status, q });
  return c.json({ requests, total, limit: PAGE_LIMIT });
});

/** たまご詳細（賛同状態・投稿者・リンク済みイベント付き） */
publicEventRequestRoutes.get("/:id", async (c) => {
  const req = await eventRequestsRepo.findById(c.req.param("id"));
  if (!req) return c.json({ error: "not_found" }, 404);
  const user = await currentUser(c);
  if (!(await canView(req, user))) return c.json({ error: "not_found" }, 404);

  const creator = await usersRepo.findById(req.createdBy);
  const eventIds = await eventRequestsRepo.linkedEventIds(req.id);
  const events = (
    await Promise.all(eventIds.map((id) => eventsRepo.findById(id)))
  ).filter((e): e is NonNullable<typeof e> => e != null && e.status === "published");
  const community = req.communityId
    ? await communitiesRepo.findById(req.communityId)
    : null;
  return c.json({
    request: req,
    creator: creator
      ? {
          id: creator.id,
          username: creator.username,
          globalName: creator.globalName,
          avatarUrl: creator.avatarUrl,
        }
      : null,
    community: community
      ? { id: community.id, name: community.name, slug: community.slug }
      : null,
    events,
    myReactions: user
      ? await eventRequestsRepo.myReactions(req.id, user.id)
      : [],
    isMine: user ? req.createdBy === user.id : false,
  });
});

/** イベントの「生まれ元」たまご一覧（メンバー限定は閲覧権限のある人にだけ返す） */
export async function listViewableRequestsForEvent(
  eventId: string,
  user: User | null,
): Promise<EventRequest[]> {
  const requests = await eventRequestsRepo.requestsForEvent(eventId);
  const results: EventRequest[] = [];
  for (const req of requests) {
    if (await canView(req, user)) results.push(req);
  }
  return results;
}

/** コミュニティのたまご一覧（メンバーならメンバー限定も見える） */
export async function listCommunityRequests(
  communityId: string,
  user: User | null,
): Promise<EventRequest[]> {
  const includeMembersOnly = user
    ? isAppAdmin(user) ||
      (await communitiesRepo.memberRole(communityId, user.id)) != null
    : false;
  return eventRequestsRepo.listByCommunity(communityId, includeMembersOnly, "open");
}

/** ---- 要ログイン: /api/event-requests 配下 ---- */
export const eventRequestRoutes = new Hono<AppEnv>();
eventRequestRoutes.use("*", requireAuth);

/** 投稿。コミュニティ内リクエストはメンバーのみ */
eventRequestRoutes.post(
  "/",
  zValidator("json", createEventRequestInput),
  async (c) => {
    const input = valid<CreateEventRequestInput>(c, "json");
    const user = c.get("user");
    if (input.communityId) {
      const community = await communitiesRepo.findById(input.communityId);
      if (!community) return c.json({ error: "community_not_found" }, 404);
      const role = await communitiesRepo.memberRole(input.communityId, user.id);
      if (!role) return c.json({ error: "not_member" }, 403);
    }
    const request = await eventRequestsRepo.create(input, user.id);
    return c.json({ request }, 201);
  },
);

/** 賛同（参加したい / 開催してもいい）のオンオフ */
eventRequestRoutes.post(
  "/:id/react",
  zValidator("json", reactEventRequestInput),
  async (c) => {
    const req = await eventRequestsRepo.findById(c.req.param("id"));
    if (!req) return c.json({ error: "not_found" }, 404);
    const user = c.get("user");
    if (!(await canView(req, user))) return c.json({ error: "not_found" }, 404);
    if (req.status !== "open") return c.json({ error: "closed" }, 409);
    // コミュニティ内リクエストへの賛同はメンバーのみ（公開閲覧でも投票は不可）
    if (req.communityId && !isAppAdmin(user)) {
      const role = await communitiesRepo.memberRole(req.communityId, user.id);
      if (!role) return c.json({ error: "not_member" }, 403);
    }
    const input = valid<ReactEventRequestInput>(c, "json");
    await eventRequestsRepo.setReaction(req.id, user.id, input.kind, input.on);
    const updated = await eventRequestsRepo.findById(req.id);
    return c.json({
      request: updated,
      myReactions: await eventRequestsRepo.myReactions(req.id, user.id),
    });
  },
);

/** クローズ / 再オープン（投稿者かアプリ管理者） */
eventRequestRoutes.post(
  "/:id/status",
  zValidator("json", z.object({ status: z.enum(["open", "closed"]) })),
  async (c) => {
    const req = await eventRequestsRepo.findById(c.req.param("id"));
    if (!req) return c.json({ error: "not_found" }, 404);
    const user = c.get("user");
    if (req.createdBy !== user.id && !isAppAdmin(user)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const { status } = valid<{ status: "open" | "closed" }>(c, "json");
    await eventRequestsRepo.setStatus(req.id, status);
    return c.json({ request: await eventRequestsRepo.findById(req.id) });
  },
);

/** 削除（投稿者かアプリ管理者） */
eventRequestRoutes.delete("/:id", async (c) => {
  const req = await eventRequestsRepo.findById(c.req.param("id"));
  if (!req) return c.json({ error: "not_found" }, 404);
  const user = c.get("user");
  if (req.createdBy !== user.id && !isAppAdmin(user)) {
    return c.json({ error: "forbidden" }, 403);
  }
  await eventRequestsRepo.delete(req.id);
  return c.json({ ok: true });
});

/** 開催宣言: 作成したイベントをリンク。イベントが公開済みならその場で通知、
 * 下書きなら公開時（notifyRequestsOnPublish）に通知する */
eventRequestRoutes.post(
  "/:id/link-event",
  zValidator("json", z.object({ eventId: z.string() })),
  async (c) => {
    const req = await eventRequestsRepo.findById(c.req.param("id"));
    if (!req) return c.json({ error: "not_found" }, 404);
    const user = c.get("user");
    if (!(await canView(req, user))) return c.json({ error: "not_found" }, 404);
    if (req.status !== "open") return c.json({ error: "closed" }, 409);
    const { eventId } = valid<{ eventId: string }>(c, "json");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "event_not_found" }, 404);
    // リンクできるのはそのイベントの作成者のみ（他人のイベントを勝手に紐付けない）
    if (event.createdBy !== user.id && !isAppAdmin(user)) {
      return c.json({ error: "forbidden" }, 403);
    }
    await eventRequestsRepo.linkEvent(req.id, eventId);
    if (event.status === "published") {
      // 未通知のときだけ（同一リンクの再POSTで通知が重複しないように）
      const unnotified = await eventRequestsRepo.unnotifiedRequestIdsForEvent(
        event.id,
      );
      if (unnotified.includes(req.id)) {
        await notifyRequestLinked(req, event);
      }
    }
    return c.json({ ok: true });
  },
);

/** たまごの投稿者＋賛同者へ「イベントが生まれた」通知（イベント作成者は除く。1リンク1回） */
async function notifyRequestLinked(
  req: EventRequest,
  event: { id: string; title: string; createdBy: string },
): Promise<void> {
  const targets = new Set(await eventRequestsRepo.reactorUserIds(req.id));
  targets.add(req.createdBy);
  targets.delete(event.createdBy);
  await notificationsRepo.createForMany(
    [...targets],
    "request_event_created",
    "たまごからイベントが生まれました🐣",
    `「${req.title}」に応えるイベント「${event.title}」が作られました`,
    `/events/${event.id}`,
  );
  await eventRequestsRepo.markNotified(req.id, event.id);
}

/** イベント公開時に、リンク済みで未通知のたまごへ通知を発火（publish/PATCH の両経路から呼ぶ） */
export async function notifyRequestsOnPublish(event: {
  id: string;
  title: string;
  createdBy: string;
  status: string;
}): Promise<void> {
  if (event.status !== "published") return;
  const requestIds = await eventRequestsRepo.unnotifiedRequestIdsForEvent(
    event.id,
  );
  for (const requestId of requestIds) {
    const req = await eventRequestsRepo.findById(requestId);
    if (req) await notifyRequestLinked(req, event);
  }
}
