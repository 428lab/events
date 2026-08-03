import { Hono } from "hono";
import type { Event, RecordMeetInput } from "@eventer/shared";
import { recordMeetInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import {
  eventMeetsRepo,
  MEET_WINDOW_AFTER_MS,
  MEET_WINDOW_BEFORE_MS,
} from "../db/repositories/eventMeets.js";
import { notificationsRepo } from "../db/repositories/notifications.js";

/** 出会った記録 (#189)。プロフィールQRの読み合いで両者にXPが入る。要認証 */

/** 開催時間帯（開始30分前〜終了2時間後）に入っているか */
function inMeetWindow(event: Event, now: number): boolean {
  return (
    !event.scheduling &&
    event.startsAt > 0 &&
    event.endsAt > 0 &&
    now >= event.startsAt - MEET_WINDOW_BEFORE_MS &&
    now <= event.endsAt + MEET_WINDOW_AFTER_MS
  );
}

/** /api/users 配下: いま出会いを記録できる共通イベントの取得 */
export const meetUserRoutes = new Hono<AppEnv>();
meetUserRoutes.use("*", requireAuth);

/** 閲覧者と対象ユーザー(:id=ユーザーID)が両方参加中のイベント一覧。自分自身なら空 */
meetUserRoutes.get("/:id/meetable", async (c) => {
  const targetId = c.req.param("id");
  const me = c.get("user");
  if (targetId === me.id) return c.json({ events: [] });
  const events = await eventMeetsRepo.meetableEventsBetween(
    me.id,
    targetId,
    Date.now(),
  );
  return c.json({ events });
});

/** /api/events 配下: 出会いの記録 */
export const meetEventRoutes = new Hono<AppEnv>();
meetEventRoutes.use("*", requireAuth);

/** 出会い数ランキング（スタッフのみ・景品配布などの運営用） */
meetEventRoutes.get(
  "/:id/meets/ranking",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    if (!(await eventsRepo.findById(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ ranking: await eventMeetsRepo.rankingForEvent(eventId) });
  },
);

/** 出会いを記録する。ペアごとに1イベント1回（2回目以降は created=false で冪等） */
meetEventRoutes.post(
  "/:id/meet",
  zValidator("json", recordMeetInput),
  async (c) => {
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    const me = c.get("user");
    const { userId: targetId } = valid<RecordMeetInput>(c, "json");

    // 自分と出会うことはできない
    if (targetId === me.id) return c.json({ error: "self_meet" }, 400);

    // 両者とも確定メンバーであること（管理者バイパスなし）
    const mine = await eventMembersRepo.find(eventId, me.id);
    if (mine?.status !== "confirmed") return c.json({ error: "forbidden" }, 403);
    const target = await eventMembersRepo.find(eventId, targetId);
    if (target?.status !== "confirmed") {
      return c.json({ error: "target_not_member" }, 403);
    }
    // 出席チェックONのイベントは両者とも出席済みであること
    if (event.attendanceCheck && !(mine.attended && target.attended)) {
      return c.json({ error: "not_attended" }, 403);
    }

    // 公開イベントの開催時間帯（前30分〜後2時間）のみ受け付ける
    if (event.status !== "published") {
      return c.json({ error: "not_published" }, 409);
    }
    if (!inMeetWindow(event, Date.now())) {
      return c.json({ error: "outside_window" }, 409);
    }

    const { created } = await eventMeetsRepo.recordMeet(eventId, me.id, targetId);
    if (created) {
      // 相手にも通知（両者にXPが入るため）。失敗しても記録自体は成功扱い
      const name = me.globalName ?? me.username;
      try {
        await notificationsRepo.create(
          targetId,
          "meet",
          `${name} さんと出会いました`,
          `「${event.title}」`,
          `/users/${encodeURIComponent(me.username)}`,
          { actorName: name, actorPath: `/users/${encodeURIComponent(me.username)}` },
        );
      } catch (err) {
        console.error("meet notification failed", err);
      }
    }
    return c.json({
      created,
      meets: await eventMeetsRepo.countedMeetsForUser(eventId, me.id),
    });
  },
);
