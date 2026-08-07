import { Hono } from "hono";
import type { Context } from "hono";
import {
  CHAT_CHANNEL_ABOUT,
  hideChatNoteInput,
  registerChatChannelInput,
  registerChatPubkeyInput,
} from "@eventer/shared";
import type {
  ChatMembersPayload,
  HideChatNoteInput,
  RegisterChatChannelInput,
  RegisterChatPubkeyInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { isConfirmedEventStaff, requireEventRole } from "../auth/roles.js";
import {
  verifyChatKeyProof,
  verifyEventSignature,
} from "../auth/nostr.js";
import {
  generateChatKey,
  serviceKeyConfigured,
  servicePubkey,
  signWithServiceKey,
} from "../lib/nostrSign.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventChatRepo } from "../db/repositories/eventChat.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { getChatRelays } from "../db/repositories/appSettings.js";
import { recordAudit } from "../db/repositories/auditLogs.js";

const MEMBER_ROLES = ["participant", "staff", "judge", "observer"] as const;

/** Nostrイベントチャット (#199)。チャット本文はブラウザ⇔リレー直通で、
 * ここでは鍵の紐付け・チャンネルID・非表示リストのみ扱う。すべて要認証。
 *
 * 権限は2段階に分けてある:
 * - 読む・参加する: 参加確定メンバー（＋appAdmin / コミュニティ管理者）
 * - 部屋の開設・作り直し・メッセージの非表示: **そのイベントの staff メンバーだけ**
 *   （eventStaffOnly）。web も myRole === "staff" でしか操作UIを出さない (#275) */
export const eventChatRoutes = new Hono<AppEnv>();
eventChatRoutes.use("*", requireAuth);

/** requireEventRole はロールのみ見るため、確定済み（status=confirmed）を追加チェック。
 * （メンバー行がない=appAdmin/コミュニティ管理者バイパスはそのまま許可。
 * eventQa.ts の同名ヘルパーと同じ判定）。
 * 読み出し・参加で使う（スタッフ操作は eventStaffOnly でさらに絞る） */
async function confirmedOnly(c: Context<AppEnv>): Promise<Response | null> {
  const member = await eventMembersRepo.find(
    c.req.param("id")!,
    c.get("user").id,
  );
  if (member && member.status !== "confirmed") {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

/** スタッフ操作（部屋の開設・作り直し・メッセージの非表示）の入口。
 * requireEventRole(["staff"]) の後ろに置き、運営管理者・コミュニティ管理者の
 * バイパスをここで閉じる（判定の中身は isConfirmedEventStaff を参照）。
 * Q&A (eventQa.ts) の eventStaffOnly と同じ形。 */
async function eventStaffOnly(c: Context<AppEnv>): Promise<Response | null> {
  if (!(await isConfirmedEventStaff(c.req.param("id")!, c.get("user").id))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

/** サーバー管理の一時鍵 (#223)。複数端末で同じ発言者鍵を使えるよう、
 * イベント用一時鍵はサーバーが生成・保管し、本人のセッションにだけ配布する。
 * GET: 既存の一時鍵を返す（NIP-07登録・未登録は 404） */
eventChatRoutes.get(
  "/:id/chat-key/ephemeral",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const denied = await confirmedOnly(c);
    if (denied) return denied;
    const key = await eventChatRepo.ephemeralFor(
      c.req.param("id"),
      c.get("user").id,
    );
    c.header("Cache-Control", "no-store");
    if (!key) return c.json({ error: "not_found" }, 404);
    return c.json(key);
  },
);

/** POST: 一時鍵を発行して発言鍵として登録する（既にあれば同じ鍵を返す）。
 * NIP-07 で登録済みの場合は一時鍵に置き換える（再登録で置き換えの従来仕様） */
eventChatRoutes.post(
  "/:id/chat-key/ephemeral",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const denied = await confirmedOnly(c);
    if (denied) return denied;
    const eventId = c.req.param("id");
    const userId = c.get("user").id;
    c.header("Cache-Control", "no-store");
    const existing = await eventChatRepo.ephemeralFor(eventId, userId);
    if (existing) return c.json(existing);
    const { secret, pubkey } = generateChatKey();
    // 先勝ちupsert: 同時発行のレースでは先着の鍵が残るので、確定値を読み直して返す
    await eventChatRepo.setEphemeral(eventId, userId, pubkey, secret);
    const settled = await eventChatRepo.ephemeralFor(eventId, userId);
    return c.json(settled ?? { secret, pubkey });
  },
);

/** 発言用の公開鍵を登録（確定メンバーのみ。再登録で置き換え） */
eventChatRoutes.post(
  "/:id/chat-key",
  requireEventRole([...MEMBER_ROLES]),
  zValidator("json", registerChatPubkeyInput),
  async (c) => {
    const denied = await confirmedOnly(c);
    if (denied) return denied;
    const eventId = c.req.param("id");
    const { proof } = valid<RegisterChatPubkeyInput>(c, "json");
    // 所有証明: このpubkeyの秘密鍵で署名できることを検証（他人のnpub紐付けによる
    // 発言のなりすまし表示を防ぐ）
    const pubkey = await verifyChatKeyProof(proof, eventId);
    if (!pubkey) return c.json({ error: "invalid_proof" }, 400);
    // 同一イベント内で他ユーザーが既に使っている鍵は拒否
    const owner = await eventChatRepo.pubkeyOwner(eventId, pubkey);
    if (owner && owner !== c.get("user").id) {
      return c.json({ error: "pubkey_taken" }, 409);
    }
    await eventChatRepo.setPubkey(eventId, c.get("user").id, pubkey);
    return c.json({ ok: true });
  },
);

/** 表示許可リスト＋チャンネルID＋非表示リスト（確定メンバーのみ） */
eventChatRoutes.get(
  "/:id/chat-members",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const denied = await confirmedOnly(c);
    if (denied) return denied;
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    const payload: ChatMembersPayload = {
      members: await eventChatRepo.listMembers(eventId),
      channelId: await eventChatRepo.channelIdFor(eventId),
      chatEnabled: event.chatEnabled,
      hiddenNoteIds: await eventChatRepo.listHidden(eventId),
      relays: await getChatRelays(),
    };
    return c.json(payload);
  },
);

/** 公式サービス鍵で署名した kind:40（チャンネル作成）を発行する (#199)。
 * 主催者が NIP-07 で自ら署名するケース以外はこの鍵でチャンネルを作る
 * （参加者個人の鍵にチャンネルを紐付けない）。
 * 部屋を開設するかどうかはスタッフが決める (#221) ため、そのイベントの staff 限定。
 * ここでは登録しない: クライアントがリレーへの受理を確認してから
 * POST /:id/chat-channel で先勝ち登録する */
eventChatRoutes.post(
  "/:id/chat-channel/official",
  requireEventRole(["staff"]),
  async (c) => {
    const denied = await eventStaffOnly(c);
    if (denied) return denied;
    if (!serviceKeyConfigured()) {
      return c.json({ error: "service_key_unset" }, 503);
    }
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    // 公式鍵の署名オラクル化防止: チャット有効な公開イベントに限定 (#221)
    if (!event.chatEnabled || event.status !== "published") {
      return c.json({ error: "chat_disabled" }, 409);
    }
    const channelEvent = signWithServiceKey({
      kind: 40,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({
        name: event.title,
        about: CHAT_CHANNEL_ABOUT,
      }),
    });
    // 発行した id をイベントに控え、登録時に一致を要求する（別イベント向け・
    // 過去発行分の kind:40 持ち込み防止。再発行で上書き）
    await eventChatRepo.setPendingChannel(eventId, channelEvent.id);
    return c.json({ channelEvent });
  },
);

/** NIP-28 チャンネル（kind:40）の登録。先勝ちで1回だけ設定され、
 * 2件目以降は既存のチャンネルIDをそのまま返す。
 * 開設はそのイベントのスタッフの操作でのみ行う (#221) */
eventChatRoutes.post(
  "/:id/chat-channel",
  requireEventRole(["staff"]),
  zValidator("json", registerChatChannelInput),
  async (c) => {
    const denied = await eventStaffOnly(c);
    if (denied) return denied;
    const eventId = c.req.param("id");
    const { channelEvent } = valid<RegisterChatChannelInput>(c, "json");
    // 先勝ち: 既に設定済みなら検証せず既存IDを返す（後着は無視）
    const existing = await eventChatRepo.channelIdFor(eventId);
    if (existing) return c.json({ channelId: existing });
    // 署名済みの kind:40 のみ（無関係な既存チャンネルの紐付け防止）
    if (!verifyEventSignature(channelEvent) || channelEvent.kind !== 40) {
      return c.json({ error: "invalid_channel_event" }, 400);
    }
    // 署名者は「公式サービス鍵」または「主催者(createdBy)が登録済みの鍵」のみ (#199)。
    // 参加者個人の鍵で作ったチャンネルは受け付けない（鍵の持ち主が消えると
    // チャンネルの管理者が不在になるため、公式鍵/主催者鍵に限定する）
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    const isServiceSigned = channelEvent.pubkey === servicePubkey();
    if (isServiceSigned) {
      // 公式鍵署名は「このイベント向けに /official が発行した id」のみ受理 (#221)
      const pending = await eventChatRepo.pendingChannelFor(eventId);
      if (!pending || pending !== channelEvent.id) {
        return c.json({ error: "invalid_channel_event" }, 400);
      }
    } else {
      const bound = await eventChatRepo.pubkeyOwner(
        eventId,
        channelEvent.pubkey,
      );
      if (!bound || bound !== event.createdBy) {
        return c.json({ error: "invalid_channel_event" }, 400);
      }
    }
    const settled = await eventChatRepo.setChannelOnce(
      eventId,
      channelEvent.id,
    );
    return c.json({ channelId: settled });
  },
);

/** チャンネルIDをリセットする（そのイベントの staff のみ）。
 * NIP-70時代にリレーへ保存されなかった kind:40 を参照し続けるケース等の復旧用。
 * リセット後、次にチャットを開いたメンバーが新しいチャンネルを作成する */
eventChatRoutes.delete(
  "/:id/chat-channel",
  requireEventRole(["staff"]),
  async (c) => {
    const denied = await eventStaffOnly(c);
    if (denied) return denied;
    const eventId = c.req.param("id");
    await eventChatRepo.clearChannel(eventId);
    // 監査ログ (#248)。参加者から見ると履歴が消えたように見える操作なので記録する
    const me = c.get("user");
    await recordAudit({
      action: "chat_channel_reset",
      actor: { id: me.id, handle: me.username },
      detail: { eventId },
    });
    return c.json({ ok: true });
  },
);

/** メッセージをアプリ側で非表示にする（そのイベントの staff のみ） */
eventChatRoutes.post(
  "/:id/chat-hidden",
  requireEventRole(["staff"]),
  zValidator("json", hideChatNoteInput),
  async (c) => {
    const denied = await eventStaffOnly(c);
    if (denied) return denied;
    const { noteId } = valid<HideChatNoteInput>(c, "json");
    await eventChatRepo.hideNote(c.req.param("id"), noteId);
    return c.json({ ok: true });
  },
);

/** 非表示を解除する（そのイベントの staff のみ） */
eventChatRoutes.delete(
  "/:id/chat-hidden/:noteId",
  requireEventRole(["staff"]),
  async (c) => {
    const denied = await eventStaffOnly(c);
    if (denied) return denied;
    const noteId = c.req.param("noteId");
    if (!/^[0-9a-f]{64}$/.test(noteId)) {
      return c.json({ error: "invalid_note_id" }, 400);
    }
    await eventChatRepo.unhideNote(c.req.param("id"), noteId);
    return c.json({ ok: true });
  },
);
