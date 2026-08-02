import { Hono } from "hono";
import type { Event } from "@eventer/shared";
import { setEventLikeInput } from "@eventer/shared";
import type { SetEventLikeInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventLikesRepo } from "../db/repositories/eventLikes.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";

/** いいね (#155)。参加確定メンバーのみ（集計に自分の状態 mine を含むため公開しない） */
export const eventLikeRoutes = new Hono<AppEnv>();
eventLikeRoutes.use("*", requireAuth);

/** 参加確定メンバーか（管理者バイパスなし。イベント配下UIと同じく本人のロールのみ見る） */
async function isConfirmedMember(
  eventId: string,
  userId: string,
): Promise<boolean> {
  const member = await eventMembersRepo.find(eventId, userId);
  return member?.status === "confirmed";
}

/** いいねを押せる期間か。開催日時が確定し、開始済みであること（終了後もOK） */
function hasStarted(event: Event): boolean {
  return !event.scheduling && event.startsAt > 0 && event.startsAt <= Date.now();
}

/** いいね集計の取得（参加確定メンバーのみ） */
eventLikeRoutes.get("/:id/likes", async (c) => {
  const eventId = c.req.param("id");
  const event = await eventsRepo.findById(eventId);
  if (!event) return c.json({ error: "not_found" }, 404);
  const user = c.get("user");
  if (!(await isConfirmedMember(eventId, user.id))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json({
    summary: await eventLikesRepo.summaryForEvent(eventId, user.id),
  });
});

/** いいねのON/OFF切替（参加確定メンバー・開始済みイベントのみ） */
eventLikeRoutes.put(
  "/:id/likes",
  zValidator("json", setEventLikeInput),
  async (c) => {
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    const user = c.get("user");
    if (!(await isConfirmedMember(eventId, user.id))) {
      return c.json({ error: "forbidden" }, 403);
    }
    // 日程調整中・開始前はまだ押せない（お礼のフィードバックなので開始後から）
    if (!hasStarted(event)) return c.json({ error: "not_started" }, 409);
    // 公開イベントのみ（下書きへのいいねは実績集計と食い違うため受け付けない）
    if (event.status !== "published") {
      return c.json({ error: "not_published" }, 409);
    }

    const { kind, targetKey, on } = valid<SetEventLikeInput>(c, "json");

    // 対象の妥当性チェック。OFF（取り消し）は自分の行の削除なので、
    // スタッフ離脱やコミュニティ変更で対象が無効になった後でも常に許可する
    if (on && kind === "event") {
      if (targetKey !== "") return c.json({ error: "invalid_target" }, 400);
    } else if (on && kind === "host") {
      if (targetKey !== event.createdBy) {
        return c.json({ error: "invalid_target" }, 400);
      }
    } else if (on && kind === "staff") {
      // 現役スタッフのみ。主催者本人は host 対象なので staff 対象にはできない
      const target = await eventMembersRepo.find(eventId, targetKey);
      if (
        !target ||
        target.role !== "staff" ||
        target.status !== "confirmed" ||
        targetKey === event.createdBy
      ) {
        return c.json({ error: "invalid_target" }, 400);
      }
    } else if (on && kind === "community") {
      if (!event.communityId || targetKey !== event.communityId) {
        return c.json({ error: "invalid_target" }, 400);
      }
    }

    // 自分自身へのいいねは不可（主催者→自分の主催者行、スタッフ→自分のスタッフ行）
    if ((kind === "host" || kind === "staff") && targetKey === user.id) {
      return c.json({ error: "self_like" }, 403);
    }

    await eventLikesRepo.setLike(eventId, user.id, kind, targetKey, on);
    return c.json({
      summary: await eventLikesRepo.summaryForEvent(eventId, user.id),
    });
  },
);
