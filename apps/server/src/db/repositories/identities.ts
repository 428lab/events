import { batch, many, one, run } from "../client.js";

export interface LinkedIdentity {
  provider: string;
  providerUserId: string;
  email: string | null;
}

interface IdentityRow {
  user_id: string;
  provider: string;
  provider_user_id: string;
  email: string | null;
}

export const identitiesRepo = {
  /** provider 識別子から user_id を引く */
  async findUserId(
    provider: string,
    providerUserId: string,
  ): Promise<string | null> {
    const row = await one<{ user_id: string }>(
      "SELECT user_id FROM identity WHERE provider = ? AND provider_user_id = ?",
      provider,
      providerUserId,
    );
    return row?.user_id ?? null;
  },

  async listByUser(userId: string): Promise<LinkedIdentity[]> {
    const rows = await many<IdentityRow>(
      "SELECT provider, provider_user_id, email FROM identity WHERE user_id = ? ORDER BY created_at ASC",
      userId,
    );
    return rows.map((r) => ({
      provider: r.provider,
      providerUserId: r.provider_user_id,
      email: r.email,
    }));
  },

  async countByUser(userId: string): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM identity WHERE user_id = ?",
      userId,
    );
    return row?.n ?? 0;
  },

  async link(
    userId: string,
    provider: string,
    providerUserId: string,
    email: string | null,
  ): Promise<void> {
    await run(
      `INSERT INTO identity (id, user_id, provider, provider_user_id, email, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, provider_user_id) DO UPDATE SET email = excluded.email`,
      crypto.randomUUID(),
      userId,
      provider,
      providerUserId,
      email,
      Date.now(),
    );
  },

  async unlink(userId: string, provider: string): Promise<void> {
    await run(
      "DELETE FROM identity WHERE user_id = ? AND provider = ?",
      userId,
      provider,
    );
  },

  /** fromUserId のアカウントを toUserId へ統合し、from を削除する。
   * 一意制約に当たる行は UPDATE OR IGNORE で残し、from 削除時に CASCADE で消す。 */
  async mergeInto(fromUserId: string, toUserId: string): Promise<void> {
    await batch([
      { sql: "UPDATE identity SET user_id = ? WHERE user_id = ?", args: [toUserId, fromUserId] },
      { sql: "UPDATE OR IGNORE event_member SET user_id = ? WHERE user_id = ?", args: [toUserId, fromUserId] },
      { sql: "UPDATE OR IGNORE entry_member SET user_id = ? WHERE user_id = ?", args: [toUserId, fromUserId] },
      { sql: "UPDATE OR IGNORE score SET judge_user_id = ? WHERE judge_user_id = ?", args: [toUserId, fromUserId] },
      { sql: "UPDATE event SET created_by = ? WHERE created_by = ?", args: [toUserId, fromUserId] },
      { sql: "UPDATE event_request SET created_by = ? WHERE created_by = ?", args: [toUserId, fromUserId] },
      { sql: "UPDATE OR IGNORE event_request_reaction SET user_id = ? WHERE user_id = ?", args: [toUserId, fromUserId] },
      { sql: "DELETE FROM user WHERE id = ?", args: [fromUserId] },
    ]);
  },
};
