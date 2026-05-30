import type {
  CreateSlotInput,
  ParticipationSlot,
  SelectionType,
  UpdateSlotInput,
} from "@eventer/shared";
import { randomUUID } from "node:crypto";
import { db } from "../client.js";

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
  listByEvent(eventId: string): ParticipationSlot[] {
    const rows = db
      .prepare(
        `${SELECT_SLOT} WHERE s.event_id = ? ORDER BY s.sort_order ASC, s.rowid ASC`,
      )
      .all(eventId) as SlotRow[];
    return rows.map(toSlot);
  },

  findById(id: string): ParticipationSlot | null {
    const row = db.prepare(`${SELECT_SLOT} WHERE s.id = ?`).get(id) as
      | SlotRow
      | undefined;
    return row ? toSlot(row) : null;
  },

  create(eventId: string, input: CreateSlotInput): ParticipationSlot {
    const id = randomUUID();
    const next = (db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM participation_slot WHERE event_id = ?",
      )
      .get(eventId) as { n: number }).n;
    db.prepare(
      `INSERT INTO participation_slot (id, event_id, name, capacity, selection_type, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, eventId, input.name, input.capacity, input.selectionType, next, Date.now());
    return this.findById(id)!;
  },

  update(id: string, input: UpdateSlotInput): ParticipationSlot | null {
    const current = this.findById(id);
    if (!current) return null;
    const next = { ...current, ...input };
    db.prepare(
      `UPDATE participation_slot SET name = ?, capacity = ?, selection_type = ?, sort_order = ?
       WHERE id = ?`,
    ).run(next.name, next.capacity, next.selectionType, next.sortOrder, id);
    return this.findById(id);
  },

  delete(id: string): void {
    db.prepare("DELETE FROM participation_slot WHERE id = ?").run(id);
  },
};
