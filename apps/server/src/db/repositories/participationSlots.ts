import type {
  CreateSlotInput,
  ParticipationSlot,
  SelectionType,
  UpdateSlotInput,
} from "@eventer/shared";
import { many, one, run } from "../client.js";

interface SlotRow {
  id: string;
  event_id: string;
  name: string;
  capacity: number;
  selection_type: string;
  sort_order: number;
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
    confirmedCount: row.confirmed_count,
    waitlistCount: row.waitlist_count,
    appliedCount: row.applied_count,
  };
}

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
  ): Promise<ParticipationSlot> {
    const id = crypto.randomUUID();
    const r = await one<{ n: number }>(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM participation_slot WHERE event_id = ?",
      eventId,
    );
    const next = r?.n ?? 0;
    await run(
      `INSERT INTO participation_slot (id, event_id, name, capacity, selection_type, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      eventId,
      input.name,
      input.capacity,
      input.selectionType,
      next,
      Date.now(),
    );
    return (await this.findById(id))!;
  },

  async update(
    id: string,
    input: UpdateSlotInput,
  ): Promise<ParticipationSlot | null> {
    const current = await this.findById(id);
    if (!current) return null;
    const next = { ...current, ...input };
    await run(
      `UPDATE participation_slot SET name = ?, capacity = ?, selection_type = ?, sort_order = ?
       WHERE id = ?`,
      next.name,
      next.capacity,
      next.selectionType,
      next.sortOrder,
      id,
    );
    return this.findById(id);
  },

  async delete(id: string): Promise<void> {
    await run("DELETE FROM participation_slot WHERE id = ?", id);
  },
};
