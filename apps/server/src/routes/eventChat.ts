import { Hono } from "hono";
import type { Context } from "hono";
import {
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
import { requireEventRole } from "../auth/roles.js";
import {
  verifyChatKeyProof,
  verifyEventSignature,
} from "../auth/nostr.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventChatRepo } from "../db/repositories/eventChat.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { getChatRelays } from "../db/repositories/appSettings.js";

const MEMBER_ROLES = ["participant", "staff", "judge", "observer"] as const;

/** Nostrイベントチャット (#199)。チャット本文はブラウザ⇔リレー直通で、
 * ここでは鍵の紐付け・チャンネルID・非表示リストのみ扱う。すべて要認証。 */
export const eventChatRoutes = new Hono<AppEnv>();
eventChatRoutes.use("*", requireAuth);

/** requireEventRole はロールのみ見るため、確定済み（status=confirmed）を追加チェック。
 * （メンバー行がない=appAdmin/コミュニティ管理者バイパスはそのまま許可） */
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

/** NIP-28 チャンネル（kind:40）の登録。先勝ちで1回だけ設定され、
 * 2件目以降は既存のチャンネルIDをそのまま返す */
eventChatRoutes.post(
  "/:id/chat-channel",
  requireEventRole([...MEMBER_ROLES]),
  zValidator("json", registerChatChannelInput),
  async (c) => {
    const denied = await confirmedOnly(c);
    if (denied) return denied;
    const eventId = c.req.param("id");
    const { channelEvent } = valid<RegisterChatChannelInput>(c, "json");
    // 無関係な既存チャンネルの紐付けを防ぐ: 署名済み kind:40 で、
    // 本人がこのイベントに登録済みの鍵で作られたものだけ受け付ける
    if (!verifyEventSignature(channelEvent) || channelEvent.kind !== 40) {
      return c.json({ error: "invalid_channel_event" }, 400);
    }
    const bound = await eventChatRepo.pubkeyOwner(eventId, channelEvent.pubkey);
    if (bound !== c.get("user").id) {
      return c.json({ error: "invalid_channel_event" }, 400);
    }
    const settled = await eventChatRepo.setChannelOnce(
      eventId,
      channelEvent.id,
    );
    return c.json({ channelId: settled });
  },
);

/** メッセージをアプリ側で非表示にする（staff のみ） */
eventChatRoutes.post(
  "/:id/chat-hidden",
  requireEventRole(["staff"]),
  zValidator("json", hideChatNoteInput),
  async (c) => {
    const { noteId } = valid<HideChatNoteInput>(c, "json");
    await eventChatRepo.hideNote(c.req.param("id"), noteId);
    return c.json({ ok: true });
  },
);

/** 非表示を解除する（staff のみ） */
eventChatRoutes.delete(
  "/:id/chat-hidden/:noteId",
  requireEventRole(["staff"]),
  async (c) => {
    const noteId = c.req.param("noteId");
    if (!/^[0-9a-f]{64}$/.test(noteId)) {
      return c.json({ error: "invalid_note_id" }, 400);
    }
    await eventChatRepo.unhideNote(c.req.param("id"), noteId);
    return c.json({ ok: true });
  },
);
