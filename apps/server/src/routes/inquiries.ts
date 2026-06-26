import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import {
  createInquiryInput,
  postInquiryMessageInput,
} from "@eventer/shared";
import type {
  CreateInquiryInput,
  PostInquiryMessageInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";
import { env } from "../env.js";
import { valid, zValidator } from "../lib/validator.js";
import { inquiriesRepo } from "../db/repositories/inquiries.js";
import { notificationsRepo } from "../db/repositories/notifications.js";
import { usersRepo } from "../db/repositories/users.js";

/** 新規問い合わせ/返信を運営管理者のベルへ通知（投稿者本人は除く） */
async function notifyAdminsOfInquiry(
  inquiryId: string,
  subject: string,
  authorUserId: string,
) {
  const adminIds = (
    await usersRepo.listIdsByDiscordIds(env.adminDiscordIds)
  ).filter((id) => id !== authorUserId);
  await notificationsRepo.createForMany(
    adminIds,
    "inquiry_new",
    "新しいお問い合わせがあります",
    subject ? `「${subject}」` : "",
    `/admin/inquiries/${inquiryId}`,
  );
}

const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isAppAdmin(c.get("user"))) return c.json({ error: "forbidden" }, 403);
  await next();
};

/** ユーザー向け: /api/inquiries */
export const inquiryRoutes = new Hono<AppEnv>();
inquiryRoutes.use("*", requireAuth);

inquiryRoutes.get("/unread-count", async (c) => {
  return c.json({ count: await inquiriesRepo.userUnreadCount(c.get("user").id) });
});

inquiryRoutes.get("/", async (c) => {
  return c.json({ inquiries: await inquiriesRepo.listByUser(c.get("user").id) });
});

inquiryRoutes.post("/", zValidator("json", createInquiryInput), async (c) => {
  const input = valid<CreateInquiryInput>(c, "json");
  const id = await inquiriesRepo.create(
    c.get("user").id,
    input.subject,
    input.body,
  );
  await notifyAdminsOfInquiry(id, input.subject, c.get("user").id);
  return c.json({ id }, 201);
});

inquiryRoutes.get("/:id", async (c) => {
  const detail = await inquiriesRepo.getForUser(
    c.req.param("id"),
    c.get("user").id,
  );
  if (!detail) return c.json({ error: "not_found" }, 404);
  return c.json(detail);
});

inquiryRoutes.post(
  "/:id/messages",
  zValidator("json", postInquiryMessageInput),
  async (c) => {
    const id = c.req.param("id");
    const result = await inquiriesRepo.addUserMessage(
      id,
      c.get("user").id,
      valid<PostInquiryMessageInput>(c, "json").body,
    );
    if (!result) return c.json({ error: "not_found" }, 404);
    await notifyAdminsOfInquiry(id, result.subject, c.get("user").id);
    return c.json({ ok: true });
  },
);

/** 運営向け: /api/admin/inquiries */
export const adminInquiryRoutes = new Hono<AppEnv>();
adminInquiryRoutes.use("*", requireAuth, requireAdmin);

adminInquiryRoutes.get("/unread-count", async (c) => {
  return c.json({ count: await inquiriesRepo.adminUnreadCount() });
});

adminInquiryRoutes.get("/", async (c) => {
  return c.json({ inquiries: await inquiriesRepo.listAll() });
});

adminInquiryRoutes.get("/:id", async (c) => {
  const detail = await inquiriesRepo.getForAdmin(c.req.param("id"));
  if (!detail) return c.json({ error: "not_found" }, 404);
  return c.json(detail);
});

adminInquiryRoutes.post(
  "/:id/messages",
  zValidator("json", postInquiryMessageInput),
  async (c) => {
    const id = c.req.param("id");
    const owner = await inquiriesRepo.addAdminMessage(
      id,
      valid<PostInquiryMessageInput>(c, "json").body,
    );
    if (!owner) return c.json({ error: "not_found" }, 404);
    await notificationsRepo.create(
      owner.userId,
      "inquiry_reply",
      "お問い合わせに返信がありました",
      owner.subject ? `「${owner.subject}」` : "",
      `/inquiries/${id}`,
    );
    return c.json({ ok: true });
  },
);
