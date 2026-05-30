import type { User } from "@eventer/shared";
import { env } from "../env.js";

/** アプリ運営管理者（ADMIN_DISCORD_IDS に Discord ID が含まれるユーザー）か */
export function isAppAdmin(user: User): boolean {
  return env.adminDiscordIds.includes(user.discordId);
}
