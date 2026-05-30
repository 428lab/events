import type { Entry, Submission } from "@eventer/shared";
import { randomUUID } from "node:crypto";
import { db } from "../client.js";

interface EntryRow {
  id: string;
  event_id: string;
  kind: string;
  name: string;
  team_id: string | null;
  presentation_order: number | null;
  created_at: number;
}

interface SubmissionRow {
  presentation_url: string | null;
  source_code_url: string | null;
  updated_at: number;
}

function toSubmission(row: SubmissionRow | undefined): Submission | null {
  if (!row) return null;
  return {
    presentationUrl: row.presentation_url,
    sourceCodeUrl: row.source_code_url,
    updatedAt: row.updated_at,
  };
}

function memberUserIds(entryId: string): string[] {
  const rows = db
    .prepare("SELECT user_id FROM entry_member WHERE entry_id = ?")
    .all(entryId) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

function submissionFor(entryId: string): Submission | null {
  const row = db
    .prepare(
      "SELECT presentation_url, source_code_url, updated_at FROM submission WHERE entry_id = ?",
    )
    .get(entryId) as SubmissionRow | undefined;
  return toSubmission(row);
}

function toEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    eventId: row.event_id,
    kind: row.kind,
    name: row.name,
    teamId: row.team_id,
    presentationOrder: row.presentation_order,
    createdAt: row.created_at,
    memberUserIds: memberUserIds(row.id),
    submission: submissionFor(row.id),
  };
}

export const entriesRepo = {
  findById(id: string): Entry | null {
    const row = db.prepare("SELECT * FROM entry WHERE id = ?").get(id) as
      | EntryRow
      | undefined;
    return row ? toEntry(row) : null;
  },

  listByEvent(eventId: string): Entry[] {
    const rows = db
      .prepare(
        `SELECT * FROM entry WHERE event_id = ?
         ORDER BY COALESCE(presentation_order, 1e9), created_at ASC`,
      )
      .all(eventId) as EntryRow[];
    return rows.map(toEntry);
  },

  /** 個人参加: そのユーザーの Entry を返す（無ければ null） */
  findIndividualEntry(eventId: string, userId: string): Entry | null {
    const row = db
      .prepare(
        `SELECT e.* FROM entry e
         JOIN entry_member em ON em.entry_id = e.id
         WHERE e.event_id = ? AND e.kind = 'individual' AND em.user_id = ?
         LIMIT 1`,
      )
      .get(eventId, userId) as EntryRow | undefined;
    return row ? toEntry(row) : null;
  },

  /** 個人 Entry を作成（参加登録時）。既にあればそれを返す */
  createIndividual(eventId: string, userId: string, name: string): Entry {
    const existing = this.findIndividualEntry(eventId, userId);
    if (existing) return existing;
    const id = randomUUID();
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO entry (id, event_id, kind, name, created_at)
         VALUES (?, ?, 'individual', ?, ?)`,
      ).run(id, eventId, name, Date.now());
      db.prepare(
        `INSERT INTO entry_member (id, entry_id, user_id, is_leader)
         VALUES (?, ?, ?, 1)`,
      ).run(randomUUID(), id, userId);
    });
    tx();
    return this.findById(id)!;
  },

  /** 個人参加解除: そのユーザーの個人 Entry を削除 */
  removeIndividualEntry(eventId: string, userId: string): void {
    const entry = this.findIndividualEntry(eventId, userId);
    if (entry) db.prepare("DELETE FROM entry WHERE id = ?").run(entry.id);
  },

  isMember(entryId: string, userId: string): boolean {
    const row = db
      .prepare(
        "SELECT 1 FROM entry_member WHERE entry_id = ? AND user_id = ?",
      )
      .get(entryId, userId);
    return Boolean(row);
  },

  upsertSubmission(
    entryId: string,
    presentationUrl: string | null,
    sourceCodeUrl: string | null,
  ): Submission {
    const existing = db
      .prepare("SELECT id FROM submission WHERE entry_id = ?")
      .get(entryId) as { id: string } | undefined;
    if (existing) {
      db.prepare(
        `UPDATE submission SET presentation_url = ?, source_code_url = ?, updated_at = ?
         WHERE entry_id = ?`,
      ).run(presentationUrl, sourceCodeUrl, Date.now(), entryId);
    } else {
      db.prepare(
        `INSERT INTO submission (id, entry_id, presentation_url, source_code_url, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(randomUUID(), entryId, presentationUrl, sourceCodeUrl, Date.now());
    }
    return submissionFor(entryId)!;
  },
};
