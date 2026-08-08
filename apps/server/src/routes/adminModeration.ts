import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { chatAuthorBlockInput, moderationActionInput } from "@eventer/shared";
import type {
  ChatAuthorBlockInput,
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
  const [items, channelId, hidden, relays, members, blocked] =
    await Promise.all([
      adminModerationRepo.listContent(eventId),
      eventChatRepo.channelIdFor(eventId),
      eventChatRepo.listHiddenDetail(eventId),
      getChatRelays(),
      // 締め出し中 (#283) も含める。誰を締め出したのか、その人が何を書いたのかを
      // 見たうえでないと解除の判断ができない
      eventChatRepo.listMembersWithBlocked(eventId),
      eventChatRepo.listBlocked(eventId),
    ]);
  const payload: ModerationContentPayload = {
    event,
    items,
    // チャット本文はサーバーに無い。ブラウザが channelId と relays を使って
    // 直接取りに行き、hidden に載っているものを非表示として表示する
    chat: { channelId, relays, members, hidden, blocked },
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

/** 監査ログの detail。
 *
 * チャットは発言者を target に残せない（サーバーが本文も pubkey も持たない）。
 * target が空なだけだと「記録し忘れ」と区別が付かないので、
 * **記録できなかったこと自体** を detail に残す */
function auditDetail(
  eventId: string,
  kind: ModerationActionInput["kind"],
  id: string,
): Record<string, unknown> {
  const base = { eventId, kind, contentId: id };
  if (kind !== "chat_message") return base;
  return {
    ...base,
    // 発言者が空欄なのは記録漏れではない、と後から読み取れるようにする
    authorUnrecorded: true,
    authorUnrecordedReason:
      "チャットの発言はリレー上にあり、サーバーに発言者の記録が無いため特定できない",
  };
}

/** hide / restore に共通の入口チェック。
 * チャットは行が無くても INSERT できてしまうので、note の形式とイベントの存在を
 * ここで確かめる。**hide と restore で同じ検証を通す**（片方だけ緩いと、
 * 復元の経路から存在しないイベントに対する操作が素通りする） */
async function rejectBadTarget(
  c: Context<AppEnv>,
  eventId: string,
  kind: ModerationActionInput["kind"],
  id: string,
): Promise<Response | null> {
  if (kind !== "chat_message") return null;
  if (!/^[0-9a-f]{64}$/.test(id)) {
    return c.json({ error: "invalid_note_id" }, 400);
  }
  if (!(await adminModerationRepo.findEvent(eventId))) {
    return c.json({ error: "not_found" }, 404);
  }
  return null;
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
    const bad = await rejectBadTarget(c, eventId, kind, id);
    if (bad) return bad;
    // 監査ログ用の投稿者は **非表示にする前** に引く（対象を特定できるうちに）
    const target = await findAuthor(eventId, kind, id);

    let changed = 0;
    if (kind === "chat_message") {
      // 既に運営が対処済みなら 0。最初に対処した人の記録を上書きしない
      changed = await eventChatRepo.adminHideNote(eventId, id, me.id, now);
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
        detail: auditDetail(eventId, kind, id),
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
    const bad = await rejectBadTarget(c, eventId, kind, id);
    if (bad) return bad;

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
        detail: auditDetail(eventId, kind, id),
      });
    }
    return c.json({ ok: true, changed: changed > 0 });
  },
);

/** 発言者単位の締め出し (#283)。
 *
 * 1件ずつの非表示だと、1人が大量に投稿したときに手数が足りない。チャットの表示は
 * 発言者の鍵の許可リストで絞っているので、鍵を1つ落とせばその人のこれまでの発言が
 * **このアプリの表示から** まとめて消え、**このアプリからは投稿できなくなる**
 * （判定の中身は routes/eventChat.ts の notBlocked を参照）。
 * リレーへの書き込みそのものを止めるものではない。
 *
 * **発言は消さない**。許可リストからも行を消さず、別テーブルに締め出しを持つだけなので、
 * 解除すればそのまま元に戻る。誤操作は必ず起きるので、一覧と解除は同じ画面に置く。
 *
 * 限界（承知のうえ）: 締め出された人が別の鍵で入り直すことは防げない。
 * **その場の荒らしを止める**ための道具であって、恒久的な追放ではない。 */
async function actOnChatAuthor(
  c: Context<AppEnv>,
  action: "block" | "unblock",
): Promise<Response> {
  const eventId = c.req.param("eventId")!;
  const { pubkey } = valid<ChatAuthorBlockInput>(c, "json");
  if (!(await adminModerationRepo.findEvent(eventId))) {
    return c.json({ error: "not_found" }, 404);
  }
  const me = c.get("user");
  // 当事者は締め出す **前** に引く（許可リストの行は残るので後でも引けるが、
  // hide 側と手順を揃えておく）
  const target = await eventChatRepo.blockedAuthorOf(eventId, pubkey);
  const changed =
    action === "block"
      ? await eventChatRepo.blockAuthor(eventId, pubkey, me.id, Date.now())
      : await eventChatRepo.unblockAuthor(eventId, pubkey);
  // 実際に状態を変えたときだけ記録する（冪等な再送で2件目を残さない）
  if (changed > 0) {
    await recordAudit({
      action: action === "block" ? "chat_author_block" : "chat_author_unblock",
      actor: { id: me.id, handle: me.username },
      target,
      // 対象の鍵は残す（公開情報。本文や連絡先は入れない #248）
      detail: { eventId, kind: "chat_author", pubkey },
    });
  }
  return c.json({ ok: true, changed: changed > 0 });
}

adminModerationRoutes.post(
  "/events/:eventId/chat-authors/block",
  zValidator("json", chatAuthorBlockInput),
  (c) => actOnChatAuthor(c, "block"),
);

adminModerationRoutes.post(
  "/events/:eventId/chat-authors/unblock",
  zValidator("json", chatAuthorBlockInput),
  (c) => actOnChatAuthor(c, "unblock"),
);
