import { Hono } from "hono";
import type { Context } from "hono";
import type { ExpenseInput, SettlementDoneInput, UpsertPayoutMethodsInput } from "@eventer/shared";
import {
  WARIKAN_WEIGHT_MAX,
  expenseInput,
  settlementDoneInput,
  upsertPayoutMethodsInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { isConfirmedEventStaff } from "../auth/roles.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import {
  eventWarikanRepo,
  type ExpenseEditScope,
  type ExpenseMeta,
  type WarikanViewer,
} from "../db/repositories/eventWarikan.js";
import type { EventWriter } from "../db/repositories/eventWriteGuard.js";

/**
 * 割り勘 (#556)。設計は docs/warikan.md。すべて要認証。
 *
 * このアプリは送金も金銭の預託も換算もしない。支払いの確認もしない。持つのは帳簿・
 * 当事者が付けた「済み」・受け取り先の掲示だけ（§3.1）。
 *
 * - イベントの閲覧権は前段の requireEventAccess（worker.ts）が見る。
 *   帳簿を見られる人（確定メンバー ∪ 帳簿の当事者）の判定はリポジトリの
 *   LEDGER_AUDIENCE_SQL の1か所で、通らない相手は 404
 * - 「staff」は常に isConfirmedEventStaff（そのイベントの confirmed staff）。
 *   コミュニティ管理者・アプリ管理者は含めない（#275）
 * - 子リソース（expenseId / methodId）は eventId の一致を確かめ、不一致は 404
 */
export const eventWarikanRoutes = new Hono<AppEnv>();
// 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)

const notFound = (c: Context<AppEnv>) => c.json({ error: "not_found" }, 404);
const forbidden = (c: Context<AppEnv>) => c.json({ error: "forbidden" }, 403);
const invalidParty = (c: Context<AppEnv>) => c.json({ error: "invalid_party" }, 400);
const invalidWeight = (c: Context<AppEnv>) => c.json({ error: "invalid_weight" }, 400);

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

/**
 * 立替の編集・削除を誰の資格で行うか（§3.7.2）。できなければ null（呼び出し側が 403 にする）。
 * staff → 入力者本人（確定メンバーの間）→ 立替者本人（参加状態を問わない）の順に見る
 */
function editAuthority(
  viewer: WarikanViewer,
  existing: ExpenseMeta,
  eventId: string,
): { scope: ExpenseEditScope | null; writer: EventWriter } | null {
  const writer = (permission: EventWriter["permission"]): EventWriter => ({
    eventId,
    actorId: viewer.userId,
    permission,
  });
  if (viewer.isStaff) return { scope: null, writer: writer("staff") };
  if (viewer.isConfirmed && existing.createdBy === viewer.userId) {
    return { scope: { by: "creator", userId: viewer.userId }, writer: writer("member") };
  }
  if (existing.payerUserId === viewer.userId) {
    return { scope: { by: "payer", userId: viewer.userId }, writer: writer("view") };
  }
  return null;
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
    // 重みの 100 上限は新規の share 全部に掛ける（zod は統合の合算でも越えない絶対上限だけ。§3.3）
    if (input.shares.some((s) => s.weight > WARIKAN_WEIGHT_MAX)) return invalidWeight(c);
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

/** 立替の編集（入力者本人 / 立替者本人 / staff）。全項目送りで負担行ごと置換。
 * 新しく加わる人だけを検証する（既存の負担者・立替者は取消した人・退会済みでも残せる。§3.7.3）。
 * 重みの 100 上限も、新しく加わる／値が変わった share にだけ掛ける（§3.3） */
eventWarikanRoutes.patch(
  "/:id/warikan/expenses/:expenseId",
  zValidator("json", expenseInput),
  async (c) => {
    const viewer = await loadViewer(c);
    if (!viewer) return notFound(c);
    const eventId = c.req.param("id");
    const existing = await eventWarikanRepo.findExpense(c.req.param("expenseId"));
    if (!existing || existing.eventId !== eventId) return notFound(c);
    const authority = editAuthority(viewer, existing, eventId);
    if (!authority) return forbidden(c);

    const input = valid<ExpenseInput>(c, "json");
    const weightOf = new Map(existing.shares.map((s) => [s.userId, s.weight]));
    if (input.shares.some((s) => weightOf.get(s.userId) !== s.weight && s.weight > WARIKAN_WEIGHT_MAX)) {
      return invalidWeight(c);
    }
    const known = new Set(weightOf.keys());
    const added = input.shares.map((s) => s.userId).filter((id) => !known.has(id));
    if (input.payerUserId !== existing.payerUserId) added.push(input.payerUserId);
    const selectable = await eventWarikanRepo.selectableUserIds(eventId, added);
    if (added.some((id) => !selectable.has(id))) return invalidParty(c);

    const updated = await eventWarikanRepo.updateExpense(
      existing.id,
      eventId,
      input,
      authority.scope,
      authority.writer,
    );
    if (!updated) return notFound(c);
    const expense = await eventWarikanRepo.expenseView(existing.id, viewer);
    if (!expense) return notFound(c);
    return c.json({ expense });
  },
);

/** 立替の削除（入力者本人 / 立替者本人 / staff。負担行は CASCADE） */
eventWarikanRoutes.delete("/:id/warikan/expenses/:expenseId", async (c) => {
  const viewer = await loadViewer(c);
  if (!viewer) return notFound(c);
  const eventId = c.req.param("id");
  const existing = await eventWarikanRepo.findExpense(c.req.param("expenseId"));
  if (!existing || existing.eventId !== eventId) return notFound(c);
  const authority = editAuthority(viewer, existing, eventId);
  if (!authority) return forbidden(c);
  const deleted = await eventWarikanRepo.deleteExpense(
    existing.id,
    eventId,
    authority.scope,
    authority.writer,
  );
  if (!deleted) return notFound(c);
  return c.json({ ok: true });
});

/**
 * 精算の行 (from → to) に「済み」を付ける（§3.5.1）。付け外しできるのは行の当事者だけで、
 * staff でも第三者は 403。画面で見た額を送り、いまの精算額と違えば 409 amount_changed。
 * (3) の突き合わせと (4) の書き込みの間に額が変わっても、stale な記録が残るだけ（読むときに効かない）
 */
eventWarikanRoutes.put(
  "/:id/warikan/settlements/:fromUserId/:toUserId/done",
  zValidator("json", settlementDoneInput),
  async (c) => {
    const viewer = await loadViewer(c);
    if (!viewer) return notFound(c);
    const eventId = c.req.param("id");
    const fromUserId = c.req.param("fromUserId");
    const toUserId = c.req.param("toUserId");
    if (viewer.userId !== fromUserId && viewer.userId !== toUserId) return forbidden(c);
    const input = valid<SettlementDoneInput>(c, "json");
    const current = await eventWarikanRepo.currentSettlement(eventId, fromUserId, toUserId);
    if (!current) return notFound(c);
    if (current.amount !== input.amount) return c.json({ error: "amount_changed" }, 409);
    const done = await eventWarikanRepo.markDone(
      eventId,
      fromUserId,
      toUserId,
      input.amount,
      viewer.userId,
      { eventId, actorId: viewer.userId, permission: "view" },
    );
    if (!done) return notFound(c);
    return c.json({ done });
  },
);

/** 精算の行の「済み」を外す（行の当事者だけ。記録が無くても 200） */
eventWarikanRoutes.delete("/:id/warikan/settlements/:fromUserId/:toUserId/done", async (c) => {
  const viewer = await loadViewer(c);
  if (!viewer) return notFound(c);
  const eventId = c.req.param("id");
  const fromUserId = c.req.param("fromUserId");
  const toUserId = c.req.param("toUserId");
  if (viewer.userId !== fromUserId && viewer.userId !== toUserId) return forbidden(c);
  await eventWarikanRepo.unmarkDone(eventId, fromUserId, toUserId, viewer.userId, {
    eventId,
    actorId: viewer.userId,
    permission: "view",
  });
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
