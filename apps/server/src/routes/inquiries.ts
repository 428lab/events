import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { Context } from "hono";
import {
  EVENT_INQUIRY_OPEN_LIMIT,
  createEventInquiryInput,
  createInquiryInput,
  postInquiryMessageInput,
} from "@eventer/shared";
import type {
  CreateEventInquiryInput,
  CreateInquiryInput,
  InquiryEvent,
  PostInquiryMessageInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";
import { env } from "../env.js";
import { valid, zValidator } from "../lib/validator.js";
import { isConfirmedEventStaff } from "../auth/roles.js";
import { gateEvent } from "../auth/eventAccess.js";
import { inquiriesRepo } from "../db/repositories/inquiries.js";
import { notificationsRepo } from "../db/repositories/notifications.js";
import { usersRepo } from "../db/repositories/users.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";

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

/** イベントの主催者あての問い合わせ・返事を、そのイベントの確定スタッフ全員のベルへ
 * (D-EVENT-CONTACT)。書いた本人（スタッフが自分のイベントに問い合わせた場合）は除く。
 * 非公開イベントでは notificationsRepo の挿入が中立の文言とイベントのページへのリンクに置き換える */
async function notifyEventStaffOfInquiry(
  event: InquiryEvent,
  inquiryId: string,
  subject: string,
  authorUserId: string,
) {
  const staffIds = (await eventMembersRepo.assignableStaff(event.id))
    .map((s) => s.id)
    .filter((id) => id !== authorUserId);
  await notificationsRepo.createForMany(
    staffIds,
    "event_inquiry_new",
    `「${event.title}」に問い合わせが届きました`,
    subject ? `「${subject}」` : "",
    `/events/${event.id}/inquiries/${inquiryId}`,
    undefined,
    // ベル通知だけ（決定3）。メールは送らない
    { eventId: event.id, skipEmail: true },
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
    // イベントの主催者あては、そのイベントの確定スタッフへ。運営（管理者）には知らせない
    if (result.event) await notifyEventStaffOfInquiry(result.event, id, result.subject, c.get("user").id);
    else await notifyAdminsOfInquiry(id, result.subject, c.get("user").id);
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

/**
 * イベントの主催者あての問い合わせ (D-EVENT-CONTACT): /api/events/:id/inquiries…
 *
 * - 送る口（POST /:id/inquiries）: ログインしていて、そのイベントを見られる人なら誰でも
 *   （参加していなくてよい）。見られるかは /api/events/:id/* の門（requireEventAccess）が
 *   確かめ、見られない人には存在しないイベントと同じ 404 を返す。
 * - 主催者側の口（GET 一覧・未読数・詳細、POST 返信・完了）: **そのイベントの確定スタッフだけ**。
 *   アプリ運営管理者もコミュニティ管理者も、スタッフでなければ通さない（Q&A・スタッフ用チャットと
 *   同じく、イベント配下はイベント内の役割だけで判定する）。
 * - 問い合わせた人の詳細と返信は /api/inquiries/:id（上の inquiryRoutes）をそのまま使う。
 *
 * 定期の取り直しはしない。送ったとき・通知を開いたとき・タブに戻ったときに読む（D-POLL-MIN）。
 * 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)
 */
export const eventInquiryRoutes = new Hono<AppEnv>();

/** 主催者側の門。通らない相手には一律に同じ 403 を返す */
async function eventStaffOnly(c: Context<AppEnv>): Promise<Response | null> {
  const ok = await isConfirmedEventStaff(c.req.param("id")!, c.get("user").id);
  return ok ? null : c.json({ error: "forbidden" }, 403);
}

eventInquiryRoutes.post(
  "/:id/inquiries",
  zValidator("json", createEventInquiryInput),
  async (c) => {
    const event = gateEvent(c);
    const me = c.get("user");
    const input = valid<CreateEventInquiryInput>(c, "json");
    // 1人が1つのイベントに出せる未完了の問い合わせは3件まで（決定5）
    if ((await inquiriesRepo.countOpenForEvent(event.id, me.id)) >= EVENT_INQUIRY_OPEN_LIMIT) {
      return c.json({ error: "event_inquiry_limit", limit: EVENT_INQUIRY_OPEN_LIMIT }, 429);
    }
    const subject = input.subject.trim();
    const id = await inquiriesRepo.createForEvent(event.id, me.id, subject, input.body);
    await notifyEventStaffOfInquiry({ id: event.id, title: event.title }, id, subject, me.id);
    return c.json({ id }, 201);
  },
);

eventInquiryRoutes.get("/:id/inquiries/unread-count", async (c) => {
  const denied = await eventStaffOnly(c);
  if (denied) return denied;
  return c.json({ count: await inquiriesRepo.eventUnreadCount(c.req.param("id")!) });
});

eventInquiryRoutes.get("/:id/inquiries", async (c) => {
  const denied = await eventStaffOnly(c);
  if (denied) return denied;
  return c.json({ inquiries: await inquiriesRepo.listForEvent(c.req.param("id")!) });
});

eventInquiryRoutes.get("/:id/inquiries/:inquiryId", async (c) => {
  const denied = await eventStaffOnly(c);
  if (denied) return denied;
  const detail = await inquiriesRepo.getForEvent(c.req.param("id")!, c.req.param("inquiryId"));
  if (!detail) return c.json({ error: "not_found" }, 404);
  return c.json(detail);
});

eventInquiryRoutes.post(
  "/:id/inquiries/:inquiryId/messages",
  zValidator("json", postInquiryMessageInput),
  async (c) => {
    const denied = await eventStaffOnly(c);
    if (denied) return denied;
    const event = gateEvent(c);
    const id = c.req.param("inquiryId");
    const owner = await inquiriesRepo.addStaffMessage(
      { eventId: event.id, actorId: c.get("user").id },
      id,
      valid<PostInquiryMessageInput>(c, "json").body,
    );
    if (!owner) return c.json({ error: "not_found" }, 404);
    // 非公開イベントでは、問い合わせた人がいまも見られるときだけ届き、文言は中立になる
    // ベル通知だけ（決定3）。create はメール通知ONの人へメールも送るので、送らない形で作る
    await notificationsRepo.createForMany(
      [owner.userId],
      "event_inquiry_reply",
      "主催者から返信がありました",
      `「${owner.subject || event.title}」`,
      `/inquiries/${id}`,
      undefined,
      { eventId: event.id, skipEmail: true },
    );
    return c.json({ ok: true });
  },
);

eventInquiryRoutes.post("/:id/inquiries/:inquiryId/close", async (c) => {
  const denied = await eventStaffOnly(c);
  if (denied) return denied;
  const closed = await inquiriesRepo.closeForEvent(
    { eventId: c.req.param("id")!, actorId: c.get("user").id },
    c.req.param("inquiryId"),
  );
  if (!closed) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
