import { Hono } from "hono";
import { updateNotificationPrefsInput, updateUsernameInput } from "@eventer/shared";
import type {
  UpdateNotificationPrefsInput,
  UpdateUsernameInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { usersRepo } from "../db/repositories/users.js";
import { communitiesRepo } from "../db/repositories/communities.js";
import { followsRepo } from "../db/repositories/follows.js";
import { notificationPrefsRepo } from "../db/repositories/notificationPrefs.js";

export const meRoutes = new Hono<AppEnv>();

meRoutes.use("*", requireAuth);

/** マイページ: 自分が所属する全コミュニティ（参加歴含む・ロール付き） */
meRoutes.get("/communities", async (c) => {
  return c.json({
    communities: await communitiesRepo.listForUser(c.get("user").id),
  });
});

/** マイページ: フォロー中のユーザー（本人のみ・一覧は非公開） */
meRoutes.get("/following", async (c) => {
  return c.json({
    following: await followsRepo.listFollowing(c.get("user").id),
  });
});

/** 通知設定の取得/更新 (#21 PR3) */
meRoutes.get("/notification-prefs", async (c) => {
  return c.json({
    prefs: await notificationPrefsRepo.get(c.get("user").id),
  });
});

meRoutes.put(
  "/notification-prefs",
  zValidator("json", updateNotificationPrefsInput),
  async (c) => {
    const prefs = await notificationPrefsRepo.update(
      c.get("user").id,
      valid<UpdateNotificationPrefsInput>(c, "json"),
    );
    return c.json({ prefs });
  },
);

/** マイページ: 開催中 / 過去参加イベント */
meRoutes.get("/events", async (c) => {
  const user = c.get("user");
  const now = Date.now();
  const all = await eventMembersRepo.listEventsForUser(user.id);
  // 日程調整中（endsAt未確定=0）は常に「開催予定」側
  const ongoing = all.filter((e) => e.scheduling || e.endsAt >= now);
  // 過去参加。出席チェックモードで未出席の参加者は「参加した」に含めない
  const past = all.filter(
    (e) =>
      !e.scheduling &&
      e.endsAt < now &&
      !(e.attendanceCheck && e.myRole === "participant" && !e.attended),
  );
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
