import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { usersRepo } from "../db/repositories/users.js";
import { followsRepo } from "../db/repositories/follows.js";
import { eventsRepo } from "../db/repositories/events.js";
import { notificationsRepo } from "../db/repositories/notifications.js";

/** イベント公開時: 作成者のフォロワーへ通知（1イベント1回。再公開では再通知しない） */
export async function notifyFollowersOnPublish(event: {
  id: string;
  title: string;
  createdBy: string;
  status: string;
}): Promise<void> {
  try {
    if (event.status !== "published") return;
    // 原子的に「未通知→通知済み」へ。並行publishでも1回だけ
    if (!(await eventsRepo.claimFollowersNotify(event.id))) return;
    const followers = await followsRepo.followerIdsWanting(
      event.createdBy,
      "followee_created",
    );
    if (followers.length === 0) return;
    const creator = await usersRepo.findById(event.createdBy);
    const name = creator
      ? (creator.globalName ?? creator.username)
      : "フォロー中のユーザー";
    await notificationsRepo.createForMany(
      followers.filter((id) => id !== event.createdBy),
      "followee_created_event",
      `${name} さんがイベントを公開しました`,
      `「${event.title}」`,
      `/events/${event.id}`,
    );
  } catch (err) {
    // 通知失敗で公開自体を失敗させない
    console.error("notifyFollowersOnPublish failed", err);
  }
}

/** イベント参加確定時: 参加者のフォロワーへ通知（公開イベントのみ） */
export async function notifyFollowersOnJoin(
  event: { id: string; title: string; status: string },
  userId: string,
): Promise<void> {
  try {
    if (event.status !== "published") return;
    const followers = await followsRepo.followerIdsWanting(
      userId,
      "followee_joined",
    );
    if (followers.length === 0) return;
    const joiner = await usersRepo.findById(userId);
    const name = joiner
      ? (joiner.globalName ?? joiner.username)
      : "フォロー中のユーザー";
    await notificationsRepo.createForMany(
      followers.filter((id) => id !== userId),
      "followee_joined_event",
      `${name} さんがイベントに参加しました`,
      `「${event.title}」`,
      `/events/${event.id}`,
    );
  } catch (err) {
    // 通知失敗で参加自体を失敗させない
    console.error("notifyFollowersOnJoin failed", err);
  }
}

/** ユーザーフォロー (#21)。/api/users/:handle/follow */
export const followRoutes = new Hono<AppEnv>();
followRoutes.use("*", requireAuth);

/** handle(username) または UUID からユーザーを解決 */
async function resolveUser(handle: string) {
  return (
    (await usersRepo.findByUsername(handle)) ?? (await usersRepo.findById(handle))
  );
}

followRoutes.post("/:handle/follow", async (c) => {
  const target = await resolveUser(c.req.param("handle"));
  if (!target) return c.json({ error: "not_found" }, 404);
  const me = c.get("user");
  if (target.id === me.id) return c.json({ error: "cannot_follow_self" }, 400);
  await followsRepo.follow(me.id, target.id);
  return c.json({
    isFollowing: true,
    followerCount: await followsRepo.followerCount(target.id),
  });
});

followRoutes.delete("/:handle/follow", async (c) => {
  const target = await resolveUser(c.req.param("handle"));
  if (!target) return c.json({ error: "not_found" }, 404);
  const me = c.get("user");
  await followsRepo.unfollow(me.id, target.id);
  return c.json({
    isFollowing: false,
    followerCount: await followsRepo.followerCount(target.id),
  });
});
