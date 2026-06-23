import type { User } from "@eventer/shared";
import { one, run } from "../client.js";

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
};
