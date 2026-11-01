import { profileLinkFor, type ProfileLink } from "@eventer/shared";
import { many, one, run, runCount } from "../client.js";

export interface LinkedIdentity {
  provider: string;
  providerUserId: string;
  email: string | null;
  /** 公開プロフィールに出すか（本人のオプトイン。既定 false） */
  profilePublic: boolean;
  /** 連携先のユーザー名（表示とリンク用。識別子ではない） */
  publicHandle: string | null;
}

interface IdentityRow {
  user_id: string;
  provider: string;
  provider_user_id: string;
  email: string | null;
  profile_public: number;
  public_handle: string | null;
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
      "SELECT provider, provider_user_id, email, profile_public, public_handle FROM identity WHERE user_id = ? ORDER BY created_at ASC",
      userId,
    );
    return rows.map((r) => ({
      provider: r.provider,
      providerUserId: r.provider_user_id,
      email: r.email,
      profilePublic: r.profile_public === 1,
      publicHandle: r.public_handle,
    }));
  },

  /** 公開プロフィールに載せるリンク (docs/profile-social-links.md)。
   * **本人がオンにした連携だけ**を SQL の段階で絞る。オフの連携の ID・メールは
   * ここから先へ一切出さない。リンクを作れない連携（名前が分からない等）は落とす */
  async publicLinksForUser(userId: string): Promise<ProfileLink[]> {
    const rows = await many<Pick<IdentityRow, "provider" | "provider_user_id" | "public_handle">>(
      `SELECT provider, provider_user_id, public_handle FROM identity
        WHERE user_id = ? AND profile_public = 1 ORDER BY created_at ASC`,
      userId,
    );
    return rows
      .map((r) => profileLinkFor(r.provider, r.provider_user_id, r.public_handle))
      .filter((l): l is ProfileLink => l !== null);
  },

  /** 本人の連携1件の公開/非公開を切り替える。本人の行が無ければ false */
  async setProfilePublic(userId: string, provider: string, profilePublic: boolean): Promise<boolean> {
    const changed = await runCount(
      "UPDATE identity SET profile_public = ? WHERE user_id = ? AND provider = ?",
      profilePublic ? 1 : 0,
      userId,
      provider,
    );
    return changed > 0;
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

  /** ログインのたびに連携先のユーザー名を取り直す（名前を変えても追いつく）。
   * 連携の成立・既存ログインのどちらでも呼ぶ。値が無い方式では呼ばない。
   * 公開/非公開（profile_public）は触らない — オプトインの選択はログインで変わらない */
  async refreshPublicHandle(provider: string, providerUserId: string, publicHandle: string): Promise<void> {
    await run(
      "UPDATE identity SET public_handle = ? WHERE provider = ? AND provider_user_id = ?",
      publicHandle,
      provider,
      providerUserId,
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
