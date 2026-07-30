import { Hono } from "hono";
import type { Context } from "hono";
import { EVENT_COMMENT_LIMIT, createEventCommentInput } from "@eventer/shared";
import type { CreateEventCommentInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth, currentUser } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventCommentsRepo } from "../db/repositories/eventComments.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";

const MEMBER_ROLES = ["participant", "staff", "judge", "observer"] as const;

/** コメントを閲覧できるか。公開イベントは誰でも、下書きはメンバー/管理者のみ */
async function canViewComments(eventId: string, c: Context): Promise<boolean> {
  const event = await eventsRepo.findById(eventId);
  if (!event) return false;
  if (event.status === "published") return true;
  const user = await currentUser(c);
  if (!user) return false;
  if (isAppAdmin(user)) return true;
  return Boolean(await eventMembersRepo.find(eventId, user.id));
}

/* ===== 公開ハンドラ（未ログイン可。worker.ts で eventRoutes より先に登録） ===== */

/** コメント一覧（閲覧できる人は誰でも） */
export async function getEventComments(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  if (!(await canViewComments(eventId, c))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json({ comments: await eventCommentsRepo.listByEvent(eventId) });
}

/* ===== 書き込み（要認証。投稿・削除はメンバーのみ） ===== */

export const eventCommentRoutes = new Hono<AppEnv>();
eventCommentRoutes.use("*", requireAuth);

/** コメント投稿（参加確定メンバーのみ） */
eventCommentRoutes.post(
  "/:id/comments",
  requireEventRole([...MEMBER_ROLES]),
  zValidator("json", createEventCommentInput),
  async (c) => {
    const eventId = c.req.param("id");
    // requireEventRole はロールのみ見るため、確定済み（status=confirmed）を追加チェック
    // （メンバー行がない=appAdmin/コミュニティ管理者バイパスはそのまま許可）
    const member = await eventMembersRepo.find(eventId, c.get("user").id);
    if (member && member.status !== "confirmed") {
      return c.json({ error: "forbidden" }, 403);
    }
    if ((await eventCommentsRepo.countByEvent(eventId)) >= EVENT_COMMENT_LIMIT) {
      return c.json({ error: "comment_limit", limit: EVENT_COMMENT_LIMIT }, 409);
    }
    const comment = await eventCommentsRepo.create(
      eventId,
      c.get("user").id,
      valid<CreateEventCommentInput>(c, "json").body,
    );
    return c.json({ comment }, 201);
  },
);

/** コメント削除（本人 or staff/管理者） */
eventCommentRoutes.delete(
  "/:id/comments/:commentId",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const eventId = c.req.param("id");
    const user = c.get("user");
    const comment = await eventCommentsRepo.findById(c.req.param("commentId"));
    if (!comment || comment.eventId !== eventId) {
      return c.json({ error: "not_found" }, 404);
    }
    if (comment.userId !== user.id && !isAppAdmin(user)) {
      const member = await eventMembersRepo.find(eventId, user.id);
      if (member?.role !== "staff") return c.json({ error: "forbidden" }, 403);
    }
    await eventCommentsRepo.delete(comment.id);
    return c.json({ ok: true });
  },
);
