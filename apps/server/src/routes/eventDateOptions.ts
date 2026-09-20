import { Hono } from "hono";
import { valid, zValidator } from "../lib/validator.js";
import {
  addDateOptionInput,
  finalizeDateInput,
  reopenSchedulingInput,
  voteInput,
} from "@eventer/shared";
import type {
  AddDateOptionInput,
  FinalizeDateInput,
  ReopenSchedulingInput,
  VoteInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireEventRole } from "../auth/roles.js";
import { eventsRepo } from "../db/repositories/events.js";
import { schedulingRepo } from "../db/repositories/scheduling.js";
import { scheduleRegistrationRepo } from "../db/repositories/scheduleRegistration.js";
import { reopenSchedulingRepo } from "../db/repositories/reopenScheduling.js";
import { activeManagerSql, adminIds } from "../db/repositories/eventAccessInvites.js";
import { one, many } from "../db/client.js";
import { deferBackground } from "../runtime.js";
import { sendNotificationEmailIfOptedIn } from "../lib/email.js";
import { formatDateRangeJa } from "../lib/dateFormat.js";
import { checkRegistrationDeadline } from "../lib/registrationDeadline.js";

/**
 * 日程調整の候補日 (#69)。候補の出し入れは staff、回答はログインユーザー誰でも。
 *
 * 集計の GET は未ログインでも読めるので `eventsPublic.ts` にある。
 * タイムテーブル (#116) は別物で `eventSchedule.ts`。
 */
export const eventDateOptionRoutes = new Hono<AppEnv>();

/** 候補日の追加（staff） */
eventDateOptionRoutes.post(
  "/:id/date-options",
  requireEventRole(["staff"]),
  zValidator("json", addDateOptionInput),
  async (c) => {
    const input = valid<AddDateOptionInput>(c, "json");
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    // 候補日を足すのは「日程調整を続ける」操作なので、締切ありなら通せない (#269)。
    // 通すと finalize-date で開催日時が動き、締切 > 開始日時 を作れてしまう。
    // 締切を外してから日程を選び直す、という順番に倒す
    const violation = checkRegistrationDeadline({
      deadline: event.registrationDeadline,
      scheduling: true,
      startsAt: event.startsAt,
    });
    if (violation) return c.json({ error: violation }, 400);
    const id = await schedulingRepo.addOption(
      eventId,
      input.startsAt,
      input.endsAt,
      c.get("user").id,
    );
    if (!id) return c.json({ error: "access_changed" }, 409);
    return c.json({ id }, 201);
  },
);

/** 候補日の削除（staff） */
eventDateOptionRoutes.delete(
  "/:id/date-options/:optionId",
  requireEventRole(["staff"]),
  async (c) => {
    const changed = await schedulingRepo.deleteOption(
      c.req.param("id"),
      c.req.param("optionId"),
      c.get("user").id,
    );
    if (!changed) return c.json({ error: "access_changed" }, 409);
    return c.json({ ok: true });
  },
);

/** 候補日への回答（ログインユーザー誰でも。確定後は不可） */
eventDateOptionRoutes.put(
  "/:id/date-options/:optionId/vote",
  zValidator("json", voteInput),
  async (c) => {
    const eventId = c.req.param("id");
    const optionId = c.req.param("optionId");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    if (!event.scheduling) return c.json({ error: "schedule_finalized" }, 409);
    // 候補日が本当にこのイベントのものかを確かめる（親の所有の確認）
    if (!(await schedulingRepo.getOption(eventId, optionId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const changed = await schedulingRepo.vote(
      eventId,
      optionId,
      c.get("user").id,
      valid<VoteInput>(c, "json").choice,
    );
    if (!changed) return c.json({ error: "access_changed" }, 409);
    return c.json({ ok: true });
  },
);

eventDateOptionRoutes.get("/:id/schedule-registration", requireEventRole(["staff"]), async c => {
  return c.json({ results: await scheduleRegistrationRepo.results(c.req.param("id")) });
});

eventDateOptionRoutes.post("/:id/reopen-scheduling", requireEventRole(["staff"]),
  zValidator("json", reopenSchedulingInput), async c => {
    const eventId = c.req.param("id");
    const result = await reopenSchedulingRepo.reopen(eventId, c.get("user").id, valid<ReopenSchedulingInput>(c, "json"));
    if (result.error) return c.json({ error: result.error }, 409);
    if (result.token) await deferBackground((async () => {
      const notices = await many<{ user_id: string; title: string; body: string; link: string }>(
        "SELECT user_id,title,body,link FROM notification WHERE event_id=? AND substr(id,1,36)=? ORDER BY id LIMIT 50", eventId, result.token);
      for (const n of notices) await sendNotificationEmailIfOptedIn(n.user_id,n.title,n.body,n.link, { authorizationEventId: eventId });
    })().catch(() => console.error("schedule reopening email delivery failed")));
    return c.json({ event: await eventsRepo.findById(eventId) });
  });

/** 日程と参加登録とアプリ通知を同じトランザクションで確定 */
eventDateOptionRoutes.post(
  "/:id/finalize-date",
  requireEventRole(["staff"]),
  zValidator("json", finalizeDateInput),
  async (c) => {
    const eventId = c.req.param("id");
    const { optionId, expectedAccessRevision } = valid<FinalizeDateInput>(c, "json");
    const opt = await schedulingRepo.getOption(eventId, optionId);
    if (!opt) return c.json({ error: "not_found" }, 404);
    const current = await eventsRepo.findById(eventId);
    if (!current) return c.json({ error: "not_found" }, 404);
    if (current.scheduling ? current.accessRevision !== expectedAccessRevision
      : current.accessRevision !== expectedAccessRevision + 1 || (await scheduleRegistrationRepo.receipt(eventId))?.option_id !== optionId) {
      return c.json({ error: "schedule_changed" }, 409);
    }
    // Reopening clears deadlines; still validate the resulting date here and
    // in the transaction so finalization cannot break the deadline invariant.
    const violation = checkRegistrationDeadline({
      deadline: current.registrationDeadline,
      scheduling: false,
      startsAt: opt.startsAt,
    });
    if (violation) return c.json({ error: violation }, 400);
    const changed = await scheduleRegistrationRepo.finalize(eventId, optionId, c.get("user").id,
      `「${current.title}」の開催日時が ${formatDateRangeJa(opt.startsAt, opt.endsAt)} に決定しました`, expectedAccessRevision);
    const event = await eventsRepo.findById(eventId);
    if (!changed && (event?.scheduling || event?.accessRevision !== expectedAccessRevision + 1
      || (await scheduleRegistrationRepo.receipt(eventId))?.option_id !== optionId
      || !await one(`SELECT 1 FROM event e WHERE e.id=? AND ${activeManagerSql("e", "?")}`, eventId, c.get("user").id, adminIds()))) {
      return c.json({ error: "schedule_changed" }, 409);
    }
    // App notifications are already committed. Email is best-effort, bounded
    // like the existing bulk notifier, and never re-sent by a finalize retry.
    if (changed) await deferBackground((async () => {
      const notices = await many<{ user_id: string; title: string; body: string; link: string }>(
        `SELECT n.user_id,n.title,n.body,n.link FROM notification n
         JOIN event_schedule_finalization f ON f.created_at=n.created_at
         WHERE f.event_id=? AND n.link=? AND n.type='schedule_finalized' ORDER BY n.id LIMIT 50`,
        eventId, `/events/${eventId}`);
      for (const n of notices) await sendNotificationEmailIfOptedIn(n.user_id,n.title,n.body,n.link, { authorizationEventId: eventId });
    })().catch(() => console.error("schedule finalization email delivery failed")));
    return c.json({ event, results: await scheduleRegistrationRepo.results(eventId) });
  },
);
