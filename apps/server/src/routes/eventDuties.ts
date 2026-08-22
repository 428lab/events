import { Hono } from "hono";
import {
  DUTY_ASSIGNEES_PER_SLOT,
  DUTY_REQUIRED_MAX,
  DUTY_SLOTS_PER_ITEM,
  EVENT_DUTY_LIMIT,
  addDutyAssigneeInput,
  createDutyInput,
  putItemSlotsInput,
  renameDutyInput,
  reorderDutiesInput,
  type AddDutyAssigneeInput,
  type CreateDutyInput,
  type EventStaffingPayload,
  type PutItemSlotsInput,
  type RenameDutyInput,
  type ReorderDutiesInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventDutiesRepo } from "../db/repositories/eventDuties.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";

/**
 * スタッフの役割タグと持ち場 (#384)。**参加者向けの経路は1本も無い。**
 *
 * 権限は `requireEventRole(["staff"])`。#383 の「裏方が見える人」・#393 の TODO と
 * 同じ基準にそろえる。当日の裏方と同じ運営情報なので、「タイムラインは見えるのに
 * 持ち場は見えない人」を作らない（`isConfirmedEventStaff` にしない理由も同じ）。
 *
 * 代償の注記も #393 6.1 と同じ: コミュニティの owner/admin とアプリ運営管理者は
 * `event_member` 行を持たないことがあり、**その人たちは見えて編集もできるが、
 * 割り当ての対象にはならない**（担当は「そのイベントの確定スタッフ」に限る）。
 * 意図した非対称。
 *
 * タイムテーブルの版番号 (#340) には乗せない。持ち場は「チップを1つ付ける」
 * 「1人割り当てる」の単発操作が主で、乗せるとチップ1つに全項目を送り返すことになる。
 * 同時編集は行単位の後勝ち。タイムテーブル側の保存が項目を消せば持ち場は
 * CASCADE で消える（セッションを消したのに持ち場だけ残る状態を作らない）。
 */
export const eventDutyRoutes = new Hono<AppEnv>();
eventDutyRoutes.use("*", requireAuth);
// 一覧（/:id/staffing）と、その配下すべてに同じ権限をかける
// （eventBroadcast.ts / eventTodos.ts と同じ形。片方を落とすと配下が素通しになる）
eventDutyRoutes.use("/:id/staffing", requireEventRole(["staff"]));
eventDutyRoutes.use("/:id/staffing/*", requireEventRole(["staff"]));

eventDutyRoutes.get("/:id/staffing", async (c) => {
  const eventId = c.req.param("id");
  const payload: EventStaffingPayload = {
    duties: await eventDutiesRepo.listDuties(eventId),
    slots: await eventDutiesRepo.listSlots(eventId),
    // 「担当に指定できる人」の契約は eventMembers.ts の1本（TODO #393 と共用）
    assignable: await eventMembersRepo.assignableStaff(eventId),
  };
  return c.json(payload);
});

/* ── 役割の定義 ─────────────────────────────────────── */

eventDutyRoutes.post(
  "/:id/staffing/duties",
  zValidator("json", createDutyInput),
  async (c) => {
    const eventId = c.req.param("id");
    const input = valid<CreateDutyInput>(c, "json");
    if ((await eventDutiesRepo.countDuties(eventId)) >= EVENT_DUTY_LIMIT) {
      return c.json({ error: "duty_limit", limit: EVENT_DUTY_LIMIT }, 400);
    }
    // UNIQUE (event_id, name) 違反は 400 で返す（500 にしない）
    if (await eventDutiesRepo.findDutyByName(eventId, input.name)) {
      return c.json({ error: "duty_name_taken" }, 400);
    }
    const id = await eventDutiesRepo.createDuty(eventId, input.name);
    return c.json({ id }, 201);
  },
);

eventDutyRoutes.patch(
  "/:id/staffing/duties/:dutyId",
  zValidator("json", renameDutyInput),
  async (c) => {
    const eventId = c.req.param("id");
    const dutyId = c.req.param("dutyId");
    // 他イベントの id は **403 ではなく 404**（存在を教えない）
    const current = await eventDutiesRepo.findDutyInEvent(dutyId, eventId);
    if (!current) return c.json({ error: "not_found" }, 404);
    const input = valid<RenameDutyInput>(c, "json");
    const taken = await eventDutiesRepo.findDutyByName(eventId, input.name);
    if (taken && taken.id !== dutyId) {
      return c.json({ error: "duty_name_taken" }, 400);
    }
    await eventDutiesRepo.renameDuty(dutyId, input.name);
    return c.json({ ok: true });
  },
);

/** 並べ替え。`reorderDuties` が `event_id` も条件に入れるので、
 * 他イベントの id が混ざっても他所の行は動かない */
eventDutyRoutes.put(
  "/:id/staffing/duties/order",
  zValidator("json", reorderDutiesInput),
  async (c) => {
    const eventId = c.req.param("id");
    const input = valid<ReorderDutiesInput>(c, "json");
    await eventDutiesRepo.reorderDuties(eventId, input.ids);
    return c.json({ ok: true });
  },
);

/** 役割を消す。持ち場・割り当ては FK CASCADE で消える
 * （画面は使用数を出して確認を取る） */
eventDutyRoutes.delete("/:id/staffing/duties/:dutyId", async (c) => {
  const eventId = c.req.param("id");
  const dutyId = c.req.param("dutyId");
  if (!(await eventDutiesRepo.findDutyInEvent(dutyId, eventId))) {
    return c.json({ error: "not_found" }, 404);
  }
  await eventDutiesRepo.removeDuty(dutyId);
  return c.json({ ok: true });
});

/* ── 持ち場（時間帯 × 役割 × 人数） ─────────────────── */

/** その項目の持ち場一式。**宣言型**（送られた集合に合わせる。設計 6.2）。
 * 残る持ち場の割り当て行は保持する（人数だけ変えても人は外れない） */
eventDutyRoutes.put(
  "/:id/staffing/items/:itemId",
  zValidator("json", putItemSlotsInput),
  async (c) => {
    const eventId = c.req.param("id");
    const itemId = c.req.param("itemId");
    // **子リソースの所有チェック**（itemId → event）。他イベントは 404
    if (!(await eventDutiesRepo.itemInEvent(itemId, eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const input = valid<PutItemSlotsInput>(c, "json");
    if (input.slots.length > DUTY_SLOTS_PER_ITEM) {
      return c.json({ error: "duty_slot_limit", limit: DUTY_SLOTS_PER_ITEM }, 400);
    }
    for (const s of input.slots) {
      if (s.required < 1 || s.required > DUTY_REQUIRED_MAX) {
        return c.json(
          { error: "duty_required_range", max: DUTY_REQUIRED_MAX },
          400,
        );
      }
      // dutyId の所有チェック（他イベントの役割をぶら下げさせない）
      if (!(await eventDutiesRepo.findDutyInEvent(s.dutyId, eventId))) {
        return c.json({ error: "not_found" }, 404);
      }
    }
    await eventDutiesRepo.setSlotsForItem(itemId, input.slots);
    return c.json({ ok: true });
  },
);

/* ── 割り当て（持ち場 × スタッフ） ──────────────────── */

eventDutyRoutes.post(
  "/:id/staffing/slots/:slotId/assignees",
  zValidator("json", addDutyAssigneeInput),
  async (c) => {
    const eventId = c.req.param("id");
    const slotId = c.req.param("slotId");
    // **子リソースの所有チェック**（slotId → item → event）
    if (!(await eventDutiesRepo.findSlotInEvent(slotId, eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const input = valid<AddDutyAssigneeInput>(c, "json");
    // 割り当てられるのは confirmed staff・非退会だけ。
    // **選択肢（assignable）と同じ述語**（別々に書くと、選べるのに弾かれる）
    const staff = await eventMembersRepo.assignableStaff(eventId);
    if (!staff.some((s) => s.id === input.userId)) {
      return c.json({ error: "duty_assignee_not_staff" }, 400);
    }
    // UNIQUE (slot_id, user_id) 違反は 400 で返す
    if (await eventDutiesRepo.hasAssignee(slotId, input.userId)) {
      return c.json({ error: "duty_assignee_dup" }, 400);
    }
    if ((await eventDutiesRepo.countAssignees(slotId)) >= DUTY_ASSIGNEES_PER_SLOT) {
      return c.json(
        { error: "duty_assignee_limit", limit: DUTY_ASSIGNEES_PER_SLOT },
        400,
      );
    }
    const id = await eventDutiesRepo.addAssignee(slotId, input.userId);
    return c.json({ id }, 201);
  },
);

/** 割り当てを外す。行の id で指す（`"left"` では user を返していないため。
 * 設計 3.6）。所有チェックは assignee → slot → item → event の1本で辿る */
eventDutyRoutes.delete(
  "/:id/staffing/slots/:slotId/assignees/:assigneeId",
  async (c) => {
    const eventId = c.req.param("id");
    const slotId = c.req.param("slotId");
    const assigneeId = c.req.param("assigneeId");
    if (!(await eventDutiesRepo.assigneeInSlot(assigneeId, slotId, eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    await eventDutiesRepo.removeAssignee(assigneeId);
    return c.json({ ok: true });
  },
);
