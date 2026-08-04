import { many, one, run } from "../client.js";

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

};
