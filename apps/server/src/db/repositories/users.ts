import type { User } from "@eventer/shared";
import { many, one, run } from "../client.js";

interface UserRow {
  id: string;
  discord_id: string;
  username: string;
  global_name: string | null;
  avatar_url: string | null;
  created_at: number;
  /** プロフィールカードPNG（OG画像キャッシュ）の更新時刻 (#193) */
  card_image_updated_at: number | null;
  card_image_key: string | null;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    discordId: row.discord_id,
    username: row.username,
    globalName: row.global_name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    cardImageUpdatedAt: row.card_image_updated_at ?? null,
    cardImageKey: row.card_image_key ?? null,
  };
}

export interface UpsertUserInput {
  discordId: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
}

export const usersRepo = {
  async findById(id: string): Promise<User | null> {
    const row = await one<UserRow>("SELECT * FROM user WHERE id = ?", id);
    return row ? toUser(row) : null;
  },

  async findByDiscordId(discordId: string): Promise<User | null> {
    const row = await one<UserRow>(
      "SELECT * FROM user WHERE discord_id = ?",
      discordId,
    );
    return row ? toUser(row) : null;
  },

  /** プロフィールURLのハンドル解決（username、大文字小文字を無視） */
  async findByUsername(username: string): Promise<User | null> {
    const row = await one<UserRow>(
      "SELECT * FROM user WHERE username = ? COLLATE NOCASE LIMIT 1",
      username,
    );
    return row ? toUser(row) : null;
  },

  /** ADMIN_DISCORD_IDS に該当するユーザーの id 一覧（運営宛て通知用） */
  async listIdsByDiscordIds(discordIds: string[]): Promise<string[]> {
    if (discordIds.length === 0) return [];
    const placeholders = discordIds.map(() => "?").join(", ");
    const rows = await many<{ id: string }>(
      `SELECT id FROM user WHERE discord_id IN (${placeholders})`,
      ...discordIds,
    );
    return rows.map((r) => r.id);
  },

  /** ハンドル(username)の重複を避けた利用可能な username を返す。
   * 既に他ユーザーが使っていれば末尾に数字を付ける（exceptUserId は自分自身として除外）。 */
  async availableUsername(desired: string, exceptUserId?: string): Promise<string> {
    let candidate = desired;
    for (let n = 2; ; n += 1) {
      const row = await one<{ id: string }>(
        "SELECT id FROM user WHERE username = ? COLLATE NOCASE LIMIT 1",
        candidate,
      );
      if (!row || row.id === exceptUserId) return candidate;
      candidate = `${desired}${n}`;
    }
  },

  async upsertByDiscordId(input: UpsertUserInput): Promise<User> {
    const existing = await this.findByDiscordId(input.discordId);
    if (existing) {
      // ハンドル(username)が他ユーザーと被る変更は据え置く（URL衝突防止）
      let username = input.username;
      if (username.toLowerCase() !== existing.username.toLowerCase()) {
        const taken = await this.findByUsername(username);
        if (taken && taken.id !== existing.id) username = existing.username;
      }
      await run(
        `UPDATE user SET username = ?, global_name = ?, avatar_url = ?
         WHERE discord_id = ?`,
        username,
        input.globalName,
        input.avatarUrl,
        input.discordId,
      );
      return (await this.findByDiscordId(input.discordId))!;
    }
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      input.discordId,
      await this.availableUsername(input.username),
      input.globalName,
      input.avatarUrl,
      Date.now(),
    );
    return (await this.findById(id))!;
  },

  /** OAuthプロフィールから新規ユーザーを作成。
   * discord_id は NOT NULL UNIQUE のため、非Discordは "provider:id" の合成値を入れる
   * （ADMIN_DISCORD_IDS には決して一致しない＝管理者にならない）。 */
  async createFromProfile(
    provider: string,
    profile: {
      providerUserId: string;
      username: string;
      globalName: string | null;
      avatarUrl: string | null;
    },
  ): Promise<User> {
    const id = crypto.randomUUID();
    const discordId =
      provider === "discord"
        ? profile.providerUserId
        : `${provider}:${profile.providerUserId}`;
    await run(
      `INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      discordId,
      await this.availableUsername(profile.username),
      profile.globalName,
      profile.avatarUrl,
      Date.now(),
    );
    return (await this.findById(id))!;
  },

  /** Discord 連携時に discord_id を実IDへ更新（管理者判定を効かせる） */
  async setDiscordId(userId: string, discordId: string): Promise<void> {
    await run("UPDATE user SET discord_id = ? WHERE id = ?", discordId, userId);
  },

  /** プロフィールカードPNG（OG画像キャッシュ）の更新時刻と選択中の組み合わせを記録 (#193, #201) */
  async setCardImage(userId: string, ts: number, key: string): Promise<void> {
    await run(
      "UPDATE user SET card_image_updated_at = ?, card_image_key = ? WHERE id = ?",
      ts,
      key,
      userId,
    );
  },

  /** ユーザー名（ハンドル）を変更 */
  async setUsername(userId: string, username: string): Promise<void> {
    await run("UPDATE user SET username = ? WHERE id = ?", username, userId);
  },

  /** 表示名/アイコンが未設定の場合のみ補完（Nostrプロフィール等の反映用） */
  async fillProfile(
    userId: string,
    globalName: string | null,
    avatarUrl: string | null,
  ): Promise<void> {
    await run(
      `UPDATE user SET
         global_name = CASE
           WHEN (global_name IS NULL OR global_name = '') AND ? IS NOT NULL THEN ?
           ELSE global_name END,
         avatar_url = CASE
           WHEN (avatar_url IS NULL OR avatar_url = '') AND ? IS NOT NULL THEN ?
           ELSE avatar_url END
       WHERE id = ?`,
      globalName,
      globalName,
      avatarUrl,
      avatarUrl,
      userId,
    );
  },
};
