import { one, run } from "../client.js";

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
  async create(userId: string): Promise<Session> {
    const id = crypto.randomUUID();
    const expiresAt = Date.now() + TTL_MS;
    await run(
      "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
      id,
      userId,
      expiresAt,
    );
    return { id, userId, expiresAt };
  },

  async find(id: string): Promise<Session | null> {
    const row = await one<SessionRow>("SELECT * FROM session WHERE id = ?", id);
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      await this.delete(id);
      return null;
    }
    return toSession(row);
  },

  async delete(id: string): Promise<void> {
    await run("DELETE FROM session WHERE id = ?", id);
  },
};
