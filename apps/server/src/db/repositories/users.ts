import type { User } from "@eventer/shared";
import { many, one, run } from "../client.js";

interface UserRow {
  id: string;
  discord_id: string;
  username: string;
  global_name: string | null;
  avatar_url: string | null;
  created_at: number;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    discordId: row.discord_id,
    username: row.username,
    globalName: row.global_name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
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

  async upsertByDiscordId(input: UpsertUserInput): Promise<User> {
    const existing = await this.findByDiscordId(input.discordId);
    if (existing) {
      await run(
        `UPDATE user SET username = ?, global_name = ?, avatar_url = ?
         WHERE discord_id = ?`,
        input.username,
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
      input.username,
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
      profile.username,
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
};
