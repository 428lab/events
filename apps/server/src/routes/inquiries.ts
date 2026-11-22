import { Hono } from "hono";
import { localized } from "../lib/noticeText.js";
import type { MiddlewareHandler } from "hono";
import type { Context } from "hono";
import {
  EVENT_INQUIRY_OPEN_LIMIT,
  createEventInquiryInput,
  createInquiryInput,
  createStaffContactInput,
  postInquiryMessageInput,
} from "@eventer/shared";
import type {
  CreateEventInquiryInput,
  CreateInquiryInput,
  CreateStaffContactInput,
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
import { notifyWebhooks } from "../lib/webhooks.js";

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
 * 非公開イベントでは notificationsRepo の挿入が中立の文言とイベントのページへのリンクに置き換える。
 *
 * メール（オーナー決定 2026-11-22。それまでの「ベル通知だけ」（決定3）を変更）:
 * - 本人が始めた問い合わせ: 確定スタッフ全員（メール通知をオンにしている人）に送る
 * - 運営から始めた連絡への返信: **連絡を始めたスタッフだけ**に送る。ほかのスタッフはベルと Webhook で気づける。
 *   始めたスタッフがもう確定スタッフでない（外れた・退会した）ときは、返事を取りこぼさないよう全員に送る */
async function notifyEventStaffOfInquiry(
  event: InquiryEvent,
  inquiryId: string,
  subject: string,
  authorUserId: string,
  /** 運営から始めた連絡への返信なら、その連絡を始めたスタッフ（退会などで分からなければ null） */
  staffContact: { starterId: string | null } | null = null,
) {
  const staffIds = (await eventMembersRepo.assignableStaff(event.id))
    .map((s) => s.id)
    .filter((id) => id !== authorUserId);
  const starterId = staffContact?.starterId ?? null;
  const title = staffContact
    ? localized("staffContactReplyTitle", { event: event.title })
    : localized("eventInquiryNewTitle", { event: event.title });
  const body = subject ? localized("quoted", { text: subject }) : "";
  const link = `/events/${event.id}/inquiries/${inquiryId}`;
  const emailTo = starterId && staffIds.includes(starterId) ? [starterId] : staffIds;
  const bellOnly = staffIds.filter((id) => !emailTo.includes(id));
  await notificationsRepo.createForMany(emailTo, "event_inquiry_new", title, body, link, undefined, { eventId: event.id });
  if (bellOnly.length > 0) {
    await notificationsRepo.createForMany(bellOnly, "event_inquiry_new", title, body, link, undefined, {
      eventId: event.id,
      skipEmail: true,
    });
  }
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
    if (result.event) {
      // 運営から始めた連絡への返信なら、メールは始めたスタッフへ（notifyEventStaffOfInquiry）
      const starter = await inquiriesRepo.starterOf(id);
      await notifyEventStaffOfInquiry(
        result.event,
        id,
        result.subject,
        c.get("user").id,
        starter.startedByStaff ? { starterId: starter.starterId } : null,
      );
      // Discord / Slack 通知（docs/webhooks.md）。問い合わせた本人の追記・運営からの連絡への返信も全文で送る
      const me = c.get("user");
      await notifyWebhooks({
        topic: "inquiry",
        eventId: result.event.id,
        eventTitle: result.event.title,
        inquiryId: id,
        user: { name: me.globalName ?? me.username, handle: me.username },
        subject: result.subject,
        body: valid<PostInquiryMessageInput>(c, "json").body,
        followUp: true,
        replyToStaffContact: starter.startedByStaff,
      });
    } else await notifyAdminsOfInquiry(id, result.subject, c.get("user").id);
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
      localized("inquiryReplyTitle"),
      owner.subject ? localized("quoted", { text: owner.subject }) : "",
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
    // Discord / Slack 通知（docs/webhooks.md）。本文は全文
    await notifyWebhooks({
      topic: "inquiry",
      eventId: event.id,
      eventTitle: event.title,
      inquiryId: id,
      user: { name: me.globalName ?? me.username, handle: me.username },
      subject,
      body: input.body,
      followUp: false,
    });
    return c.json({ id }, 201);
  },
);

/** 運営からメンバー1人へ個別に連絡する（オーナー決定 2026-11-22）。確定スタッフだけ。
 * 相手はそのイベントのメンバー（キャンセル以外の全ロール・全状態）で、自分以外。件数の上限は無い。
 * 相手にはベル通知と、メール通知をオンにしていればメール（相手の言語）。Webhook には流さない
 * （運営が書いた中身で、個人あてのため）。相手の返信は上の /api/inquiries/:id/messages が受ける */
eventInquiryRoutes.post(
  "/:id/inquiries/staff-contact",
  zValidator("json", createStaffContactInput),
  async (c) => {
    const denied = await eventStaffOnly(c);
    if (denied) return denied;
    const event = gateEvent(c);
    const input = valid<CreateStaffContactInput>(c, "json");
    const subject = input.subject.trim();
    const id = await inquiriesRepo.createStaffContact(
      { eventId: event.id, actorId: c.get("user").id },
      input.userId,
      subject,
      input.body,
    );
    // 自分あて・メンバーでない・退会した・いまイベントを見られない人には送らない
    if (!id) return c.json({ error: "not_member" }, 404);
    await notificationsRepo.create(
      input.userId,
      "event_inquiry_reply",
      localized("staffContactTitle", { event: event.title }),
      subject ? localized("quoted", { text: subject }) : "",
      `/inquiries/${id}`,
      undefined,
      { eventId: event.id },
    );
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
    // 非公開イベントでは、問い合わせた人がいまも見られるときだけ届き、文言は中立になる。
    // メール通知をオンにしている人にはメールも送る（オーナー決定 2026-11-22。それまではベルだけ）
    await notificationsRepo.create(
      owner.userId,
      "event_inquiry_reply",
      localized("eventInquiryReplyTitle"),
      localized("quoted", { text: owner.subject || event.title }),
      `/inquiries/${id}`,
      undefined,
      { eventId: event.id },
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
