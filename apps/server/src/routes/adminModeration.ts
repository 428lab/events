import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { moderationActionInput } from "@eventer/shared";
import type {
  ModerationActionInput,
  ModerationContentPayload,
  ModerationEventsPayload,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";
import { getBucket } from "../runtime.js";
import { valid, zValidator } from "../lib/validator.js";
import { safeServeMime } from "../lib/imageMime.js";
import { adminModerationRepo } from "../db/repositories/adminModeration.js";
import type { RowKind } from "../db/repositories/adminModeration.js";
import { eventChatRepo } from "../db/repositories/eventChat.js";
import { eventQaRepo } from "../db/repositories/eventQa.js";
import { getChatRelays } from "../db/repositories/appSettings.js";
import { recordAudit } from "../db/repositories/auditLogs.js";
import { photoR2Key } from "./eventPhotos.js";

/** 運営によるイベント内コンテンツの非表示 (#278)。app admin のみ。
 *
 * イベント内コンテンツの削除は「そのイベントのスタッフだけ」に絞ってある (#275)。
 * 終了済みイベントには参加登録もスタッフ追加もできないため、終了後に違反コンテンツが
 * 投稿されてスタッフが動かない（あるいはスタッフ自身が投稿者）場合に手段が無くなる。
 * ここはその穴を埋めるための **別系統** の経路で、スタッフの削除操作は何も変えない。
 *
 * 消さずに非表示にする。誤って対処しても戻せることと、通報対応の証跡が残ることを
 * 優先している。対処・復元はどちらも監査ログ (#248) に残す。 */
const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isAppAdmin(c.get("user"))) return c.json({ error: "forbidden" }, 403);
  await next();
};

export const adminModerationRoutes = new Hono<AppEnv>();
adminModerationRoutes.use("*", requireAuth, requireAdmin);

/** 対処するイベントを探す。userId は要確認リスト (#259) からの導線 */
adminModerationRoutes.get("/events", async (c) => {
  const userId = (c.req.query("userId") ?? "").trim() || undefined;
  const q = (c.req.query("q") ?? "").trim() || undefined;
  if (!userId && !q) {
    const empty: ModerationEventsPayload = { events: [], truncated: false };
    return c.json(empty);
  }
  const payload: ModerationEventsPayload =
    await adminModerationRepo.searchEvents({ userId, q });
  return c.json(payload);
});

/** イベント内のコンテンツ一式。非表示にしたものも含めて返す
 * （中身が見えないと復元してよいか判断できない） */
adminModerationRoutes.get("/events/:eventId", async (c) => {
  const eventId = c.req.param("eventId");
  const event = await adminModerationRepo.findEvent(eventId);
  if (!event) return c.json({ error: "not_found" }, 404);
  const [items, channelId, hidden, relays, members] = await Promise.all([
    adminModerationRepo.listContent(eventId),
    eventChatRepo.channelIdFor(eventId),
    eventChatRepo.listHiddenDetail(eventId),
    getChatRelays(),
    eventChatRepo.listMembers(eventId),
  ]);
  const payload: ModerationContentPayload = {
    event,
    items,
    // チャット本文はサーバーに無い。ブラウザが channelId と relays を使って
    // 直接取りに行き、hidden に載っているものを非表示として表示する
    chat: { channelId, relays, members, hidden },
  };
  return c.json(payload);
});

/** 非表示にした写真も含めて画像を返す（管理画面で中身を見て判断するため）。
 * 通常の配信 (/api/events/:id/photos/:photoId/image) は非表示のものを 404 にする */
adminModerationRoutes.get(
  "/events/:eventId/photos/:photoId/image",
  async (c) => {
    const photo = await adminModerationRepo.findPhotoForAdmin(
      c.req.param("eventId"),
      c.req.param("photoId"),
    );
    if (!photo) return c.json({ error: "not_found" }, 404);
    const obj = await getBucket().get(photoR2Key(photo.eventId, photo.id));
    if (!obj) return c.json({ error: "not_found" }, 404);
    return new Response(obj.body as unknown as ReadableStream, {
      headers: {
        "Content-Type": safeServeMime(obj.httpMetadata?.contentType),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=60",
      },
    });
  },
);

/** 監査ログの当事者に入れる投稿者。
 * チャットは本文も投稿者もサーバーに無いので null（誰の発言かは記録できない） */
function findAuthor(
  eventId: string,
  kind: ModerationActionInput["kind"],
  id: string,
): Promise<{ id: string; handle: string } | null> {
  if (kind === "chat_message") return Promise.resolve(null);
  return adminModerationRepo.findRowAuthor(kind as RowKind, id, eventId);
}

/** 非表示にする */
adminModerationRoutes.post(
  "/events/:eventId/hide",
  zValidator("json", moderationActionInput),
  async (c) => {
    const eventId = c.req.param("eventId");
    const { kind, id } = valid<ModerationActionInput>(c, "json");
    const me = c.get("user");
    const now = Date.now();
    // 監査ログ用の投稿者は **非表示にする前** に引く（対象を特定できるうちに）
    const target = await findAuthor(eventId, kind, id);

    let changed = 0;
    if (kind === "chat_message") {
      if (!/^[0-9a-f]{64}$/.test(id)) {
        return c.json({ error: "invalid_note_id" }, 400);
      }
      if (!(await adminModerationRepo.findEvent(eventId))) {
        return c.json({ error: "not_found" }, 404);
      }
      await eventChatRepo.adminHideNote(eventId, id, me.id, now);
      changed = 1;
    } else {
      changed = await adminModerationRepo.hide(
        kind as RowKind,
        id,
        eventId,
        me.id,
        now,
      );
      // 非表示にした質問がピックアップ中なら解除する
      // （投影画面に「非表示のはずの質問」が出続けないように。
      // スタッフの非表示 eventQa.ts と同じ後始末）
      if (kind === "question" && changed > 0) {
        await eventQaRepo.clearPickedIf(eventId, id);
      }
    }
    // 既に非表示だった場合も 200（画面の再読込で揃う）。記録は実際に変えたときだけ
    if (changed > 0) {
      await recordAudit({
        action: "content_hide",
        actor: { id: me.id, handle: me.username },
        target,
        // 本文は入れない（監査ログに個人情報を持たない方針 #248）
        detail: { eventId, kind, contentId: id },
      });
    }
    return c.json({ ok: true, changed: changed > 0 });
  },
);

/** 復元する（誤って対処したときに戻す） */
adminModerationRoutes.post(
  "/events/:eventId/restore",
  zValidator("json", moderationActionInput),
  async (c) => {
    const eventId = c.req.param("eventId");
    const { kind, id } = valid<ModerationActionInput>(c, "json");
    const me = c.get("user");

    let changed = 0;
    if (kind === "chat_message") {
      changed = await eventChatRepo.adminUnhideNote(eventId, id);
    } else {
      changed = await adminModerationRepo.restore(kind as RowKind, id, eventId);
    }
    if (changed > 0) {
      await recordAudit({
        action: "content_restore",
        actor: { id: me.id, handle: me.username },
        target: await findAuthor(eventId, kind, id),
        detail: { eventId, kind, contentId: id },
      });
    }
    return c.json({ ok: true, changed: changed > 0 });
  },
);
