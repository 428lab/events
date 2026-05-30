import { randomUUID } from "node:crypto";
import { db } from "../client.js";

export interface Session {
  id: string;
  userId: string;
  expiresAt: number;
}

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: number;
}

function toSession(row: SessionRow): Session {
  return { id: row.id, userId: row.user_id, expiresAt: row.expires_at };
}

const TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export const sessionsRepo = {
  create(userId: string): Session {
    const id = randomUUID();
    const expiresAt = Date.now() + TTL_MS;
    db.prepare(
      "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
    ).run(id, userId, expiresAt);
    return { id, userId, expiresAt };
  },

  find(id: string): Session | null {
    const row = db.prepare("SELECT * FROM session WHERE id = ?").get(id) as
      | SessionRow
      | undefined;
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      this.delete(id);
      return null;
    }
    return toSession(row);
  },

  delete(id: string): void {
    db.prepare("DELETE FROM session WHERE id = ?").run(id);
  },
};
