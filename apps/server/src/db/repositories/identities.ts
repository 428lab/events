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
      { sql: "UPDATE venue SET owner_id = ? WHERE owner_id = ?", args: [toUserId, fromUserId] },
      { sql: "UPDATE OR IGNORE event_request_reaction SET user_id = ? WHERE user_id = ?", args: [toUserId, fromUserId] },
      // 通知設定の引き継ぎ（to に行があれば to 優先、無ければ from を引き継ぐ）
      { sql: "UPDATE OR IGNORE notification_pref SET user_id = ? WHERE user_id = ?", args: [toUserId, fromUserId] },
      // フォロー関係の引き継ぎ。from⇔to の相互行は先に消す（自己フォロー行が生まれるのを防ぐ）
      { sql: "DELETE FROM user_follow WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)", args: [fromUserId, toUserId, toUserId, fromUserId] },
      { sql: "UPDATE OR IGNORE user_follow SET follower_id = ? WHERE follower_id = ?", args: [toUserId, fromUserId] },
      { sql: "UPDATE OR IGNORE user_follow SET followee_id = ? WHERE followee_id = ?", args: [toUserId, fromUserId] },
      { sql: "DELETE FROM user WHERE id = ?", args: [fromUserId] },
    ]);
  },
};
