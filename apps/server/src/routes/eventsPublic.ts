import { gateEvent, isEventManager } from "../auth/eventAccess.js";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { Event, EventMember, User } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { currentUser } from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";
import { eventsRepo, type EventAccessRow } from "../db/repositories/events.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { entriesRepo } from "../db/repositories/entries.js";
import { participationSlotsRepo } from "../db/repositories/participationSlots.js";
import { communitiesRepo } from "../db/repositories/communities.js";
import { schedulingRepo } from "../db/repositories/scheduling.js";
import { listViewableRequestsForEvent } from "./eventRequests.js";

/**
 * イベント配下の **未ログインでも読める GET**。
 *
 * `events.ts` の合成で `requireAuth` より **前** に並べること。順番が振る舞いそのもの
 * （後ろに置くと公開イベントの詳細が 401 になる）。
 */

/** 読み込んだイベントと閲覧者をハンドラへ渡す。閲覧者は未ログインなら null。
 * `event` は共通門 (requireEventAccess) が読んだ軽い行で、参加者数を持たない */
type PublicEventEnv = {
  Variables: AppEnv["Variables"] & { event: EventAccessRow; viewer: User | null };
};

export const eventPublicRoutes = new Hono<PublicEventEnv>();

/**
 * 共通門 (requireEventAccess) が読んで閲覧を確かめたイベントと、閲覧者を置く。
 *
 * 6本の GET が同じ前口上を持っていたのでここに1本化した。閲覧の判定（下書き・
 * 非公開を 404 で隠す #526）は worker.ts の共通門が済ませている。ここで
 * イベントを読み直したり canViewEvent を重ねたりしない (D-POLL-MIN S2)。
 * 参加者数を返す詳細 GET だけが、件数付きの findById を読む。
 */
function viewableEvent(): MiddlewareHandler<PublicEventEnv, "/:id"> {
  return async (c, next) => {
    c.set("event", gateEvent(c));
    c.set("viewer", await currentUser(c));
    await next();
  };
}

/**
 * 参加者限定の文章 (`members_note`) を返してよい相手か。
 *
 * 確定メンバー / staff / 作成者 / アプリ管理者に加え、コミュニティ管理者
 * （staff 相当で PATCH が通る）にも見せる。見えないと EditEventPage の保存で
 * `members_note` を空文字で消してしまう。
 */
async function canSeeMembersNote(
  event: Event,
  user: User | null,
  member: EventMember | null,
): Promise<boolean> {
  if (member && (member.status === "confirmed" || member.role === "staff")) {
    return true;
  }
  if (!user) return false;
  if (event.createdBy === user.id || isAppAdmin(user)) return true;
  return Boolean(
    event.communityId &&
      (await communitiesRepo.isManager(event.communityId, user.id)),
  );
}

/** イベント詳細（公開イベントは未ログインでも閲覧可） */
eventPublicRoutes.get("/:id", viewableEvent(), async (c) => {
  // 応答に参加者数・出席者数・定員を含むので、ここだけ件数付きで読む
  const event = await eventsRepo.findById(c.get("event").id);
  if (!event) return c.json({ error: "not_found" }, 404);
  const user = c.get("viewer");
  const member = user ? await eventMembersRepo.find(event.id, user.id) : null;
  const canManageSchedule = user ? await isEventManager(event.id, user) : false;
  const community = event.communityId
    ? await communitiesRepo.findById(event.communityId)
    : null;
  return c.json({
    event,
    // 参加者限定の文章は見せてよい相手にだけ返す（それ以外はキー自体を含めない）
    ...((await canSeeMembersNote(event, user, member))
      ? { membersNote: await eventsRepo.membersNoteFor(event.id) }
      : {}),
    myRole: member?.role ?? null,
    canManageSchedule,
    nonpublicEligible: await eventsRepo.nonpublicEligible(event.id),
    ...(event.visibility === "private" ? { canManageAccess: canManageSchedule } : {}),
    community: community
      ? {
          id: community.id,
          slug: community.slug,
          name: community.name,
          iconUrl: community.iconUrl,
        }
      : null,
    // 生まれ元のたまご（メンバー限定たまごは閲覧権限のある人にだけ返す）
    fromRequests: await listViewableRequestsForEvent(event.id, user),
  });
});

/** Entry 一覧（公開イベントは未ログインでも閲覧可） */
eventPublicRoutes.get("/:id/entries", viewableEvent(), async (c) => {
  return c.json({ entries: await entriesRepo.listByEvent(c.get("event").id) });
});

/** 成果物集約（公開イベントは未ログインでも閲覧可。提出済みのみ） */
eventPublicRoutes.get("/:id/submissions", viewableEvent(), async (c) => {
  const entries = (await entriesRepo.listByEvent(c.get("event").id)).filter(
    (e) => e.submission,
  );
  return c.json({ entries });
});

/** 参加者一覧（公開イベントは未ログインでも閲覧可） */
eventPublicRoutes.get("/:id/members", viewableEvent(), async (c) => {
  return c.json({
    members: await eventMembersRepo.listWithUsers(c.get("event").id),
  });
});

/** 参加枠一覧（公開イベントは未ログインでも閲覧可） */
eventPublicRoutes.get("/:id/slots", viewableEvent(), async (c) => {
  return c.json({
    slots: await participationSlotsRepo.listByEvent(c.get("event").id),
  });
});

/** 日程調整（候補日と集計。公開イベントは未ログイン可。ログイン時は自分の回答付き） */
eventPublicRoutes.get("/:id/schedule", viewableEvent(), async (c) => {
  const event = c.get("event");
  const user = c.get("viewer");
  const options = await schedulingRepo.listOptions(event.id);
  const myVotes = user ? await schedulingRepo.myVotes(event.id, user.id) : {};
  // 匿名設定時は回答者情報をサーバー側で落とす（クライアントから覗けない）
  const anonymous = event.scheduleAnonymous;
  return c.json({
    options: anonymous ? options.map((o) => ({ ...o, voters: [] })) : options,
    myVotes,
    anonymous,
  });
});
