import { Hono } from "hono";
import type { Context } from "hono";
import { valid, zValidator } from "../lib/validator.js";
import {
  createSlotInput,
  setMemberSlotStatusInput,
  updateSlotInput,
} from "@eventer/shared";
import type {
  CreateSlotInput,
  ParticipationSlot,
  SetMemberSlotStatusInput,
  UpdateSlotInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireEventRole } from "../auth/roles.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { entriesRepo } from "../db/repositories/entries.js";
import { participationSlotsRepo } from "../db/repositories/participationSlots.js";
import { usersRepo } from "../db/repositories/users.js";
import { notificationsRepo } from "../db/repositories/notifications.js";

/** 参加枠の定義・抽選・当落（すべて staff のみ）。一覧の GET は `eventsPublic.ts` */
export const eventSlotRoutes = new Hono<AppEnv>();

/**
 * `:slotId` の参加枠を読む。**そのイベントの枠であることを必ず確かめる**。
 *
 * 子リソースは親の所有を検証する、というこのプロジェクトの決まりの一例。
 * `requireEventRole` が見ているのは `:id` のイベントに対する権限だけなので、
 * ここを省くと **自分が staff のイベントの ID に他人のイベントの `slotId` を
 * 付けるだけで、他人の枠を書き換え・削除・抽選できる**。
 *
 * 見つからないのと他人の枠なのを区別せず 404 にするのは意図（存在を漏らさない）。
 */
async function loadSlot(
  c: Context<AppEnv, "/:id/slots/:slotId">,
): Promise<ParticipationSlot | null> {
  const slot = await participationSlotsRepo.findById(c.req.param("slotId"));
  return slot && slot.eventId === c.req.param("id") ? slot : null;
}

/** 当選の通知。文面は経路で違う（抽選の結果／運営が手で確定）ので呼び出し側が渡す */
async function notifyLotteryWon(
  userId: string,
  eventId: string,
  title: string,
  body: string,
): Promise<void> {
  await notificationsRepo.create(
    userId,
    "lottery_won",
    title,
    body,
    `/events/${eventId}`,
  );
}

/** 落選の通知。抽選の実行と手動の当落で**文面まで同じ**なのでここに1本だけ持つ */
async function notifyLotteryLost(
  userId: string,
  eventId: string,
  eventTitle: string,
): Promise<void> {
  await notificationsRepo.create(
    userId,
    "lottery_lost",
    "抽選結果のお知らせ",
    `「${eventTitle}」は今回は落選となりました`,
    `/events/${eventId}`,
  );
}

/** 参加枠の作成（staff のみ） */
eventSlotRoutes.post(
  "/:id/slots",
  requireEventRole(["staff"]),
  zValidator("json", createSlotInput),
  async (c) => {
    const slot = await participationSlotsRepo.create(
      c.req.param("id"),
      valid<CreateSlotInput>(c, "json"),
    );
    return c.json({ slot }, 201);
  },
);

/** 参加枠の更新（staff のみ） */
eventSlotRoutes.patch(
  "/:id/slots/:slotId",
  requireEventRole(["staff"]),
  zValidator("json", updateSlotInput),
  async (c) => {
    if (!(await loadSlot(c))) return c.json({ error: "not_found" }, 404);
    const slot = await participationSlotsRepo.update(
      c.req.param("slotId"),
      valid<UpdateSlotInput>(c, "json"),
    );
    if (!slot) return c.json({ error: "not_found" }, 404);
    return c.json({ slot });
  },
);

/** 参加枠の削除（staff のみ） */
eventSlotRoutes.delete(
  "/:id/slots/:slotId",
  requireEventRole(["staff"]),
  async (c) => {
    if (!(await loadSlot(c))) return c.json({ error: "not_found" }, 404);
    await participationSlotsRepo.delete(c.req.param("slotId"));
    return c.json({ ok: true });
  },
);

/** 抽選実行（staff のみ）。applied から定員までを当選=confirmed、残りを落選=lost に */
eventSlotRoutes.post(
  "/:id/slots/:slotId/draw",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    const slot = await loadSlot(c);
    if (!slot) return c.json({ error: "not_found" }, 404);
    if (slot.selectionType !== "lottery") {
      return c.json({ error: "not_lottery" }, 400);
    }
    // membersBySlotStatus は退会申請中 (#250) を除くので、猶予期間中の申込者は
    // 抽選対象にも落選通知の対象にもならない（枠を無駄に消費させない）。
    // 参加者以外（staff/judge/observer）も除く (#277)：運営側は枠を消費しないし、
    // 落選にすると操作UIは出るのにサーバーが403を返す状態になる
    const applied = await eventMembersRepo.membersBySlotStatus(
      slot.id,
      "applied",
    );
    const shuffled = [...applied].sort(() => Math.random() - 0.5);
    const winners = shuffled.slice(0, slot.capacity);
    const winnerIds = new Set(winners.map((w) => w.id));
    const event = await eventsRepo.findById(eventId);
    const title = event?.title ?? "イベント";

    for (const m of applied) {
      if (winnerIds.has(m.id)) {
        await eventMembersRepo.setStatus(m.id, "confirmed");
        const u = await usersRepo.findById(m.userId);
        if (u) {
          await entriesRepo.createIndividual(
            eventId,
            m.userId,
            u.globalName ?? u.username,
          );
        }
        await notifyLotteryWon(
          m.userId,
          eventId,
          "抽選に当選しました",
          `「${title}」の抽選に当選しました。参加が確定です`,
        );
      } else {
        await eventMembersRepo.setStatus(m.id, "lost");
        await notifyLotteryLost(m.userId, eventId, title);
      }
    }
    return c.json({
      drawn: applied.length,
      confirmed: winners.length,
      lost: applied.length - winners.length,
    });
  },
);

/** 申込者の参加状態を手動設定（staff のみ）。status を更新し、Entry を同期。
 *
 * 抽選枠の当落だけでなく、先着枠のキャンセル待ちを当日その場で確定にする
 * （繰り上げ）経路でもある (#286)。先着枠では定員超過を拒否しない：当日
 * キャンセルが出た・その場で1人増やすといった運営判断を塞ぐほうが困る。
 * 超過は画面側に見えるようにしてある。
 *
 * 参加確定でない状態にすると、出席の記録も一緒に落ちる（setStatus 参照）。 */
eventSlotRoutes.patch(
  "/:id/slots/:slotId/members/:userId/status",
  requireEventRole(["staff"]),
  zValidator("json", setMemberSlotStatusInput),
  async (c) => {
    const eventId = c.req.param("id");
    const userId = c.req.param("userId");
    const member = await eventMembersRepo.find(eventId, userId);
    // その枠の申込者であることを確かめる（親の所有の確認）
    if (!member || member.slotId !== c.req.param("slotId")) {
      return c.json({ error: "not_found" }, 404);
    }
    // 当落は参加者に対する操作 (#281)。参加者以外（staff/judge/observer）は枠を
    // 消費しないので当落の対象にしない。0061 より前の「枠を持ったままの確定
    // スタッフ」がこの画面に並ぶことがあり、落選にすると #277 の状態が復活する
    if (member.role !== "participant") {
      return c.json({ error: "not_participant" }, 409);
    }
    // 退会申請中 (#250) は一覧にも出ないので操作対象にしない（当選させても
    // 参加できず枠だけ消費する。findById は猶予期間中を null にする）
    const target = await usersRepo.findById(userId);
    if (!target) return c.json({ error: "not_found" }, 404);
    const status = valid<SetMemberSlotStatusInput>(c, "json").status;
    await eventMembersRepo.setStatus(member.id, status);
    // Entry 同期: 確定なら個人Entry作成、それ以外は削除
    if (status === "confirmed") {
      await entriesRepo.createIndividual(
        eventId,
        userId,
        target.globalName ?? target.username,
      );
    } else {
      await entriesRepo.removeIndividualEntry(eventId, userId);
    }
    // 確定/落選はユーザーへ通知
    if (status === "confirmed" || status === "lost") {
      const event = await eventsRepo.findById(eventId);
      const title = event?.title ?? "イベント";
      if (status === "confirmed") {
        await notifyLotteryWon(
          userId,
          eventId,
          "参加が確定しました",
          `「${title}」への参加が確定しました`,
        );
      } else {
        await notifyLotteryLost(userId, eventId, title);
      }
    }
    return c.json({ ok: true });
  },
);
