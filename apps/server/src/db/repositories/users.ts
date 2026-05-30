import type { User } from "@eventer/shared";
import { randomUUID } from "node:crypto";
import { db } from "../client.js";

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
  findById(id: string): User | null {
    const row = db.prepare("SELECT * FROM user WHERE id = ?").get(id) as
      | UserRow
      | undefined;
    return row ? toUser(row) : null;
  },

  findByDiscordId(discordId: string): User | null {
    const row = db
      .prepare("SELECT * FROM user WHERE discord_id = ?")
      .get(discordId) as UserRow | undefined;
    return row ? toUser(row) : null;
  },

  upsertByDiscordId(input: UpsertUserInput): User {
    const existing = this.findByDiscordId(input.discordId);
    if (existing) {
      db.prepare(
        `UPDATE user SET username = ?, global_name = ?, avatar_url = ?
         WHERE discord_id = ?`,
      ).run(input.username, input.globalName, input.avatarUrl, input.discordId);
      return this.findByDiscordId(input.discordId)!;
    }
    const id = randomUUID();
    db.prepare(
      `INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.discordId,
      input.username,
      input.globalName,
      input.avatarUrl,
      Date.now(),
    );
    return this.findById(id)!;
  },
};
