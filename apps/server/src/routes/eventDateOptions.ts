import { Hono } from "hono";
import { valid, zValidator } from "../lib/validator.js";
import {
  addDateOptionInput,
  finalizeDateInput,
  voteInput,
} from "@eventer/shared";
import type {
  AddDateOptionInput,
  FinalizeDateInput,
  VoteInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireEventRole } from "../auth/roles.js";
import { eventsRepo } from "../db/repositories/events.js";
import { schedulingRepo } from "../db/repositories/scheduling.js";
import { notificationsRepo } from "../db/repositories/notifications.js";
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
    );
    return c.json({ id }, 201);
  },
);

/** 候補日の削除（staff） */
eventDateOptionRoutes.delete(
  "/:id/date-options/:optionId",
  requireEventRole(["staff"]),
  async (c) => {
    await schedulingRepo.deleteOption(
      c.req.param("id"),
      c.req.param("optionId"),
    );
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
    await schedulingRepo.vote(
      optionId,
      c.get("user").id,
      valid<VoteInput>(c, "json").choice,
    );
    return c.json({ ok: true });
  },
);

/** 日程を確定（staff）。候補の日時をイベント開催日時に設定し調整完了 */
eventDateOptionRoutes.post(
  "/:id/finalize-date",
  requireEventRole(["staff"]),
  zValidator("json", finalizeDateInput),
  async (c) => {
    const eventId = c.req.param("id");
    const opt = await schedulingRepo.getOption(
      eventId,
      valid<FinalizeDateInput>(c, "json").optionId,
    );
    if (!opt) return c.json({ error: "not_found" }, 404);
    const current = await eventsRepo.findById(eventId);
    if (!current) return c.json({ error: "not_found" }, 404);
    // 確定で開催日時が動くので、確定後の状態で締切の不変条件を見る (#269)。
    // 候補日の追加は締切ありなら弾いているが、「候補日あり → PATCH で日程確定＋
    // 締切設定 → 古い候補で finalize」の経路が残るため、確定側にも置く
    const violation = checkRegistrationDeadline({
      deadline: current.registrationDeadline,
      scheduling: false,
      startsAt: opt.startsAt,
    });
    if (violation) return c.json({ error: violation }, 400);
    const event = await eventsRepo.finalizeDate(
      eventId,
      opt.startsAt,
      opt.endsAt,
    );
    // 日程調整の回答者へ確定を通知（確定操作をした本人は除く）
    if (event) {
      const me = c.get("user").id;
      const when = formatDateRangeJa(opt.startsAt, opt.endsAt);
      for (const userId of await schedulingRepo.listVoterIds(eventId)) {
        if (userId === me) continue;
        await notificationsRepo.create(
          userId,
          "schedule_finalized",
          "日程が確定しました",
          `「${event.title}」の開催日時が ${when} に決定しました`,
          `/events/${eventId}`,
        );
      }
    }
    return c.json({ event });
  },
);
