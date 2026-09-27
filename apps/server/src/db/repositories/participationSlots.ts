import type {
  CreateSlotInput,
  ParticipationSlot,
  SelectionType,
  UpdateSlotInput,
} from "@eventer/shared";
import { activeManagerSql, adminIds } from "./eventAccessInvites.js";
import { many, one, runCount } from "../client.js";

interface SlotRow {
  id: string;
  event_id: string;
  name: string;
  capacity: number;
  selection_type: string;
  sort_order: number;
  draw_at: number | null;
  confirmed_count: number;
  waitlist_count: number;
  applied_count: number;
}

function toSlot(row: SlotRow): ParticipationSlot {
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    capacity: row.capacity,
    selectionType: row.selection_type as SelectionType,
    sortOrder: row.sort_order,
    drawAt: row.draw_at,
    confirmedCount: row.confirmed_count,
    waitlistCount: row.waitlist_count,
    appliedCount: row.applied_count,
  };
}

/** 枠の在籍数。退会申請中 (#250) のメンバーもそのまま数える。
 * 猶予期間中に席を明け渡すと、復帰したときに枠が埋まっていて戻れなくなるため
 * （復帰の余地を優先。抽選・繰り上げの「当選対象」からは除外している）。
 * 完全削除されれば event_member ごと消えて数も戻る */
const SELECT_SLOT = `SELECT s.*,
  (SELECT COUNT(1) FROM event_member m WHERE m.slot_id = s.id AND m.status = 'confirmed') AS confirmed_count,
  (SELECT COUNT(1) FROM event_member m WHERE m.slot_id = s.id AND m.status = 'waitlist') AS waitlist_count,
  (SELECT COUNT(1) FROM event_member m WHERE m.slot_id = s.id AND m.status = 'applied') AS applied_count
  FROM participation_slot s`;

export const participationSlotsRepo = {
  async listByEvent(eventId: string): Promise<ParticipationSlot[]> {
    const rows = await many<SlotRow>(
      `${SELECT_SLOT} WHERE s.event_id = ? ORDER BY s.sort_order ASC, s.rowid ASC`,
      eventId,
    );
    return rows.map(toSlot);
  },

  async findById(id: string): Promise<ParticipationSlot | null> {
    const row = await one<SlotRow>(`${SELECT_SLOT} WHERE s.id = ?`, id);
    return row ? toSlot(row) : null;
  },

  async create(
    eventId: string,
    input: CreateSlotInput,
    actorId: string,
  ): Promise<ParticipationSlot | null> {
    const id = crypto.randomUUID();
    const r = await one<{ n: number }>(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM participation_slot WHERE event_id = ?",
      eventId,
    );
    const next = r?.n ?? 0;
    const changed = await runCount(
      `INSERT INTO participation_slot (id, event_id, name, capacity, selection_type, sort_order, draw_at, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? FROM event e WHERE e.id=? AND ${activeManagerSql("e", "?")}`,
      id,
      eventId,
      input.name,
      input.capacity,
      input.selectionType,
      next,
      input.drawAt ?? null,
      Date.now(), eventId, actorId, adminIds(),
    );
    return changed ? this.findById(id) : null;
  },

  async update(
    id: string,
    input: UpdateSlotInput,
    eventId: string, actorId: string,
  ): Promise<ParticipationSlot | null> {
    const current = await this.findById(id);
    if (!current) return null;
    const next = { ...current, ...input };
    const changed = await runCount(
      `UPDATE participation_slot SET name = ?, capacity = ?, selection_type = ?, sort_order = ?, draw_at = ?
       WHERE id = ? AND event_id=? AND EXISTS(SELECT 1 FROM event e WHERE e.id=event_id AND ${activeManagerSql("e", "?")})`,
      next.name,
      next.capacity,
      next.selectionType,
      next.sortOrder,
      next.drawAt ?? null,
      id, eventId, actorId, adminIds(),
    );
    return changed ? this.findById(id) : null;
  },

  async delete(id: string, eventId: string, actorId: string): Promise<boolean> {
    return (await runCount(`DELETE FROM participation_slot WHERE id = ? AND event_id=?
      AND EXISTS(SELECT 1 FROM event e WHERE e.id=event_id AND ${activeManagerSql("e", "?")})`, id,eventId,actorId,adminIds())) > 0;
  },
};
