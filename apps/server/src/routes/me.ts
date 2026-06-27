import { Hono } from "hono";
import { updateUsernameInput } from "@eventer/shared";
import type { UpdateUsernameInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { usersRepo } from "../db/repositories/users.js";
import { communitiesRepo } from "../db/repositories/communities.js";

export const meRoutes = new Hono<AppEnv>();

meRoutes.use("*", requireAuth);

/** マイページ: 自分が所属する全コミュニティ（参加歴含む・ロール付き） */
meRoutes.get("/communities", async (c) => {
  return c.json({
    communities: await communitiesRepo.listForUser(c.get("user").id),
  });
});

/** マイページ: 開催中 / 過去参加イベント */
meRoutes.get("/events", async (c) => {
  const user = c.get("user");
  const now = Date.now();
  const all = await eventMembersRepo.listEventsForUser(user.id);
  const ongoing = all.filter((e) => e.endsAt >= now);
  const past = all.filter((e) => e.endsAt < now);
  return c.json({ ongoing, past });
});

/** ユーザー名（プロフィールURLのハンドル）を変更。他ユーザーと被る場合は 409 */
meRoutes.put(
  "/username",
  zValidator("json", updateUsernameInput),
  async (c) => {
    const me = c.get("user");
    const username = valid<UpdateUsernameInput>(c, "json").username.trim();
    const taken = await usersRepo.findByUsername(username);
    if (taken && taken.id !== me.id) {
      return c.json({ error: "taken" }, 409);
    }
    await usersRepo.setUsername(me.id, username);
    return c.json({ ok: true, username });
  },
);
