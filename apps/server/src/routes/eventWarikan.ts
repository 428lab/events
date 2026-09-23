import { Hono } from "hono";
import type { Context } from "hono";
import type { ExpenseInput, PaymentInput, UpsertPayoutMethodsInput } from "@eventer/shared";
import {
  WARIKAN_PAYMENT_MAX,
  expenseInput,
  paymentInput,
  upsertPayoutMethodsInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { isConfirmedEventStaff } from "../auth/roles.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { eventWarikanRepo, type WarikanViewer } from "../db/repositories/eventWarikan.js";

/**
 * 割り勘 (#556)。設計は docs/warikan.md。すべて要認証。
 *
 * このアプリは送金も金銭の預託も換算もしない。持つのは帳簿と受け取り先の掲示だけ（§3.1）。
 *
 * - イベントの閲覧権は前段の requireEventAccess（worker.ts）が見る。
 *   帳簿を見られる人（確定メンバー ∪ 帳簿の当事者）の判定はリポジトリの
 *   LEDGER_AUDIENCE_SQL の1か所で、通らない相手は 404
 * - 「staff」は常に isConfirmedEventStaff（そのイベントの confirmed staff）。
 *   コミュニティ管理者・アプリ管理者は含めない（#275）
 * - 子リソース（expenseId / paymentId / methodId）は eventId の一致を確かめ、不一致は 404
 */
export const eventWarikanRoutes = new Hono<AppEnv>();
// 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)

const notFound = (c: Context<AppEnv>) => c.json({ error: "not_found" }, 404);
const forbidden = (c: Context<AppEnv>) => c.json({ error: "forbidden" }, 403);
const invalidParty = (c: Context<AppEnv>) => c.json({ error: "invalid_party" }, 400);

/** 帳簿を読む人の立場。帳簿を見られない相手は null（呼び出し側が 404 にする） */
async function loadViewer(c: Context<AppEnv>): Promise<WarikanViewer | null> {
  const eventId = c.req.param("id")!;
  const userId = c.get("user").id;
  if (!(await eventWarikanRepo.isAudience(eventId, userId))) return null;
  const member = await eventMembersRepo.find(eventId, userId);
  const isConfirmed = member?.status === "confirmed";
  return {
    userId,
    isStaff: await isConfirmedEventStaff(eventId, userId),
    isConfirmed,
    canAddExpense: isConfirmed && member?.role !== "observer",
  };
}

/** 帳簿（立替0件でも 200 の空の帳簿） */
eventWarikanRoutes.get("/:id/warikan", async (c) => {
  const viewer = await loadViewer(c);
  if (!viewer) return notFound(c);
  return c.json(await eventWarikanRepo.ledger(c.req.param("id"), viewer));
});

/** 立替の追加（確定メンバーのうち observer 以外） */
eventWarikanRoutes.post(
  "/:id/warikan/expenses",
  zValidator("json", expenseInput),
  async (c) => {
    const viewer = await loadViewer(c);
    if (!viewer) return notFound(c);
    if (!viewer.canAddExpense) return forbidden(c);
    const eventId = c.req.param("id");
    const input = valid<ExpenseInput>(c, "json");
    // 立替者と負担者は全員、新しく指定できる人でなければならない（§3.7.3）
    const parties = [input.payerUserId, ...input.shares.map((s) => s.userId)];
    const selectable = await eventWarikanRepo.selectableUserIds(eventId, parties);
    if (parties.some((id) => !selectable.has(id))) return invalidParty(c);

    const id = await eventWarikanRepo.createExpense(eventId, viewer.userId, input, {
      eventId,
      actorId: viewer.userId,
      permission: "member",
    });
    if (!id) return c.json({ error: "too_many_expenses" }, 409);
    const expense = await eventWarikanRepo.expenseView(id, viewer);
    if (!expense) return notFound(c);
    return c.json({ expense }, 201);
  },
);

/** 立替の編集（入力者本人 / staff）。全項目送りで負担行ごと置換。
 * 新しく加わる人だけを検証する（既存の負担者・立替者は取消した人・退会済みでも残せる。§3.7.3） */
eventWarikanRoutes.patch(
  "/:id/warikan/expenses/:expenseId",
  zValidator("json", expenseInput),
  async (c) => {
    const viewer = await loadViewer(c);
    if (!viewer) return notFound(c);
    const eventId = c.req.param("id");
    const existing = await eventWarikanRepo.findExpense(c.req.param("expenseId"));
    if (!existing || existing.eventId !== eventId) return notFound(c);
    const asOwner = !viewer.isStaff;
    if (asOwner && !(viewer.isConfirmed && existing.createdBy === viewer.userId)) {
      return forbidden(c);
    }

    const input = valid<ExpenseInput>(c, "json");
    const known = new Set(existing.shareUserIds);
    const added = input.shares.map((s) => s.userId).filter((id) => !known.has(id));
    if (input.payerUserId !== existing.payerUserId) added.push(input.payerUserId);
    const selectable = await eventWarikanRepo.selectableUserIds(eventId, added);
    if (added.some((id) => !selectable.has(id))) return invalidParty(c);

    const updated = await eventWarikanRepo.updateExpense(
      existing.id,
      eventId,
      input,
      asOwner ? viewer.userId : null,
      { eventId, actorId: viewer.userId, permission: asOwner ? "member" : "staff" },
    );
    if (!updated) return notFound(c);
    const expense = await eventWarikanRepo.expenseView(existing.id, viewer);
    if (!expense) return notFound(c);
    return c.json({ expense });
  },
);

/** 立替の削除（入力者本人 / staff。負担行は CASCADE） */
eventWarikanRoutes.delete("/:id/warikan/expenses/:expenseId", async (c) => {
  const viewer = await loadViewer(c);
  if (!viewer) return notFound(c);
  const eventId = c.req.param("id");
  const existing = await eventWarikanRepo.findExpense(c.req.param("expenseId"));
  if (!existing || existing.eventId !== eventId) return notFound(c);
  const asOwner = !viewer.isStaff;
  if (asOwner && !(viewer.isConfirmed && existing.createdBy === viewer.userId)) {
    return forbidden(c);
  }
  const deleted = await eventWarikanRepo.deleteExpense(
    existing.id,
    eventId,
    asOwner ? viewer.userId : null,
    { eventId, actorId: viewer.userId, permission: asOwner ? "member" : "staff" },
  );
  if (!deleted) return notFound(c);
  return c.json({ ok: true });
});

/** 支払いの記録（当事者本人 / staff）。記録は自己申告で、アプリは確かめない（§3.1） */
eventWarikanRoutes.post(
  "/:id/warikan/payments",
  zValidator("json", paymentInput),
  async (c) => {
    const viewer = await loadViewer(c);
    if (!viewer) return notFound(c);
    const eventId = c.req.param("id");
    const input = valid<PaymentInput>(c, "json");
    const asParty = !viewer.isStaff;
    // 第三者どうしの記録は staff だけ
    if (asParty && input.fromUserId !== viewer.userId && input.toUserId !== viewer.userId) {
      return forbidden(c);
    }
    // from・to の双方が帳簿を見られる人でなければならない
    for (const party of [input.fromUserId, input.toUserId]) {
      if (!(await eventWarikanRepo.isAudience(eventId, party))) return invalidParty(c);
    }

    const id = await eventWarikanRepo.createPayment(
      eventId,
      viewer.userId,
      input,
      asParty ? viewer.userId : null,
      { eventId, actorId: viewer.userId, permission: asParty ? "view" : "staff" },
    );
    if (!id) {
      // 1文の INSERT が入らなかった理由を区別する（上限か、当事者が門の外に出たか）
      if ((await eventWarikanRepo.countPayments(eventId)) >= WARIKAN_PAYMENT_MAX) {
        return c.json({ error: "too_many_payments" }, 409);
      }
      return invalidParty(c);
    }
    const payment = await eventWarikanRepo.paymentView(id, viewer);
    if (!payment) return notFound(c);
    return c.json({ payment }, 201);
  },
);

/** 支払記録の取り消し（記録者・from・to のどれか / staff。虚偽の記録を受け取り側も消せる） */
eventWarikanRoutes.delete("/:id/warikan/payments/:paymentId", async (c) => {
  const viewer = await loadViewer(c);
  if (!viewer) return notFound(c);
  const eventId = c.req.param("id");
  const existing = await eventWarikanRepo.findPayment(c.req.param("paymentId"));
  if (!existing || existing.eventId !== eventId) return notFound(c);
  const asParty = !viewer.isStaff;
  if (
    asParty &&
    ![existing.recordedBy, existing.fromUserId, existing.toUserId].includes(viewer.userId)
  ) {
    return forbidden(c);
  }
  const deleted = await eventWarikanRepo.deletePayment(
    existing.id,
    eventId,
    asParty ? viewer.userId : null,
    { eventId, actorId: viewer.userId, permission: asParty ? "view" : "staff" },
  );
  if (!deleted) return notFound(c);
  return c.json({ ok: true });
});

/** 自分の受け取り先を置換する（本人だけ。他人の userId はパスにも body にも無い） */
eventWarikanRoutes.put(
  "/:id/warikan/payout-methods",
  zValidator("json", upsertPayoutMethodsInput),
  async (c) => {
    const viewer = await loadViewer(c);
    if (!viewer) return notFound(c);
    const eventId = c.req.param("id");
    const input = valid<UpsertPayoutMethodsInput>(c, "json");
    await eventWarikanRepo.replacePayoutMethods(eventId, viewer.userId, input.methods, {
      eventId,
      actorId: viewer.userId,
      permission: "view",
    });
    return c.json({
      payoutMethods: await eventWarikanRepo.payoutMethodsOf(eventId, viewer.userId, viewer),
    });
  },
);

/** 受け取り先の削除（本人 / staff。staff は削除のみで編集はできない） */
eventWarikanRoutes.delete("/:id/warikan/payout-methods/:methodId", async (c) => {
  const viewer = await loadViewer(c);
  if (!viewer) return notFound(c);
  const eventId = c.req.param("id");
  const existing = await eventWarikanRepo.findPayoutMethod(c.req.param("methodId"));
  if (!existing || existing.eventId !== eventId) return notFound(c);
  const asOwner = existing.userId === viewer.userId;
  if (!asOwner && !viewer.isStaff) return forbidden(c);
  const deleted = await eventWarikanRepo.deletePayoutMethod(
    existing.id,
    eventId,
    asOwner ? viewer.userId : null,
    { eventId, actorId: viewer.userId, permission: asOwner ? "view" : "staff" },
  );
  if (!deleted) return notFound(c);
  return c.json({ ok: true });
});
