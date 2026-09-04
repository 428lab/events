import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import {
  BROADCAST_MAX_PER_DAY,
  BROADCAST_MAX_PER_EVENT,
  createBroadcastInput,
  type CreateBroadcastInput,
  type EventBroadcastsPayload,
  type SendBroadcastResult,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { isConfirmedEventStaff } from "../auth/roles.js";
import { valid, zValidator } from "../lib/validator.js";
import { drainBroadcastEmails, sendBroadcast } from "../lib/broadcast.js";
import { eventBroadcastsRepo } from "../db/repositories/eventBroadcasts.js";
import { deferBackground } from "../runtime.js";

/**
 * 参加者への一斉連絡 (#172)。送信も履歴閲覧も**そのイベントのスタッフだけ**。
 *
 * requireEventRole(["staff"]) はアプリ運営管理者とコミュニティの owner/admin も
 * 通してしまうので使わない。一斉連絡は取り消せず全員に届く操作なので、
 * イベント内コンテンツのモデレーション (#275) と同じく isConfirmedEventStaff で
 * 「そのイベントの確定スタッフ」に絞る。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const requireBroadcastStaff: MiddlewareHandler<AppEnv> = async (c, next) => {
  const eventId = c.req.param("id");
  if (!eventId) return c.json({ error: "event_id_required" }, 400);
  if (!(await isConfirmedEventStaff(eventId, c.get("user").id))) {
    return c.json({ error: "forbidden" }, 403);
  }
  await next();
};

export const eventBroadcastRoutes = new Hono<AppEnv>();
// 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)
// 一覧・送信（/:id/broadcasts）と、その配下すべてに同じ権限をかける
eventBroadcastRoutes.use("/:id/broadcasts", requireBroadcastStaff);
eventBroadcastRoutes.use("/:id/broadcasts/*", requireBroadcastStaff);

/** 残りの送信可能回数（直近24時間 / 通算） */
async function remaining(
  eventId: string,
): Promise<{ today: number; total: number }> {
  const today = await eventBroadcastsRepo.countSince(
    eventId,
    Date.now() - DAY_MS,
  );
  const total = await eventBroadcastsRepo.countSince(eventId, 0);
  return {
    today: Math.max(0, BROADCAST_MAX_PER_DAY - today),
    total: Math.max(0, BROADCAST_MAX_PER_EVENT - total),
  };
}

/** 送信履歴と、区分ごとの現在の人数・残り送信回数 */
eventBroadcastRoutes.get("/:id/broadcasts", async (c) => {
  const eventId = c.req.param("id");
  const left = await remaining(eventId);
  const payload: EventBroadcastsPayload = {
    broadcasts: await eventBroadcastsRepo.listByEvent(eventId),
    counts: await eventBroadcastsRepo.countsBySegment(eventId, c.get("user").id),
    remainingToday: left.today,
    remainingTotal: left.total,
  };
  return c.json(payload);
});

/** 送信。送信前の確認は画面側で行うが、人数はここで数え直す
 * （確認を出してから宛先が増減していても、実際に送った人数を記録する） */
eventBroadcastRoutes.post(
  "/:id/broadcasts",
  zValidator("json", createBroadcastInput),
  async (c) => {
    const eventId = c.req.param("id");
    const input = valid<CreateBroadcastInput>(c, "json");
    const left = await remaining(eventId);
    if (left.total <= 0) {
      return c.json(
        { error: "broadcast_limit_total", limit: BROADCAST_MAX_PER_EVENT },
        409,
      );
    }
    if (left.today <= 0) {
      return c.json(
        { error: "broadcast_limit_day", limit: BROADCAST_MAX_PER_DAY },
        409,
      );
    }
    const result = await sendBroadcast({
      eventId,
      actorUserId: c.get("user").id,
      segment: input.segment,
      title: input.title,
      body: input.body,
    });
    const payload: SendBroadcastResult = {
      id: result.broadcastId,
      recipientCount: result.recipientCount,
      emailQueued: result.emailQueued,
      incomplete: result.incomplete,
      truncatedFrom: result.truncatedFrom,
    };
    return c.json(payload);
  },
);

/** 失敗したメールを送信待ちに戻す。
 * 送信そのものは作り直さないので、送信回数の上限は消費しない
 * （届かなかった人へ届けるだけで、届いた人にもう1通増えることはない） */
eventBroadcastRoutes.post(
  "/:id/broadcasts/:broadcastId/retry-emails",
  async (c) => {
    const eventId = c.req.param("id");
    const broadcastId = c.req.param("broadcastId");
    if (!(await eventBroadcastsRepo.existsInEvent(broadcastId, eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const requeued = await eventBroadcastsRepo.requeueFailedEmails(broadcastId);
    // 戻したぶんはその場で送れるだけ送る（残りは定期実行が拾う）
    if (requeued > 0) await deferBackground(drainBroadcastEmails());
    return c.json({ requeued });
  },
);
