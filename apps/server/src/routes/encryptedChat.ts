import { Hono } from "hono";
import type { Context } from "hono";
import type { EncryptedChatPayload } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { generateChatKey } from "../lib/nostrSign.js";
import { groupChatRepo } from "../db/repositories/groupChat.js";
import { eventChatRepo } from "../db/repositories/eventChat.js";
import { eventsRepo } from "../db/repositories/events.js";
import { getChatRelays } from "../db/repositories/appSettings.js";

/** 参加者のみ（暗号化）の参加者チャット (#582)。設計は docs/participant-encrypted-chat.md。
 *
 * スタッフチャット (#382) と同じ仕組み（kind 9807・NIP-44・グループ共通鍵の pull 配布）を
 * audience='members' の部屋で使う。本文はブラウザ⇔リレー直通で、ここでは roomId・
 * 共通鍵の全世代・発言用一時鍵の配布だけを行う。
 *
 * ゲート（設計 2.4）は「参加確定の participant / staff / judge / observer・退会申請中でない・
 * 締め出し中でない」と「暗号化オン・チャット有効・公開済み・日程確定」。
 * appAdmin・コミュニティ管理者のバイパスは**通さない**（運営は 4.5 の別経路）。
 * 閲覧の門（canViewEvent）は worker.ts の requireEventAccess が先に見ている。
 *
 * 資格を失った人の鍵は、ここで**取得のたびに**照合して回す（遅延ローテーション 3.2）。
 * 暗号化に使う最新の鍵はこの照合を通ったレスポンスからしか手に入らない。 */
export const encryptedChatRoutes = new Hono<AppEnv>();
// 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)

/** ゲート。通らない相手には一律 403 `chat_unavailable`（参加者チャットの停止応答に揃える。
 * 理由は返さない #283）。部屋の存在は秘密ではない（chatEncrypted は Event に載っている） */
async function eligibleOnly(c: Context<AppEnv>): Promise<Response | null> {
  const ok = await groupChatRepo.isEncryptedChatEligible(
    c.req.param("id")!,
    c.get("user").id,
  );
  return ok ? null : c.json({ error: "chat_unavailable" }, 403);
}

/** GET/POST 共通のペイロード。部屋が無ければ null */
async function payloadFor(
  eventId: string,
  userId: string,
): Promise<EncryptedChatPayload | null> {
  const roomId = await groupChatRepo.roomIdFor(eventId, "members");
  if (!roomId) return null;
  const event = await eventsRepo.findById(eventId);
  if (!event) return null;
  const signer = await groupChatRepo.signerFor(eventId, "members", userId);
  return {
    roomId,
    keys: await groupChatRepo.listKeys(eventId, "members"),
    myKey:
      signer && signer.revokedAt === null
        ? { pubkey: signer.pubkey, secret: signer.secret }
        : null,
    members: await groupChatRepo.listMembersWithRole(eventId),
    hiddenNoteIds: await eventChatRepo.listHidden(eventId),
    // 平文の過去ログは公開イベントだけ。非公開・限定公開では平文の経路を一切開かない
    plaintextChannelId:
      event.visibility === "public"
        ? await eventChatRepo.channelIdFor(eventId)
        : null,
    encryptedAt: (await eventsRepo.chatEncryptedAtFor(eventId)) ?? 0,
    relays: await getChatRelays(),
  };
}

/** 鍵一式。先に遅延ローテーションを行う。部屋が未開設なら 404（POST で開設する） */
encryptedChatRoutes.get("/:id/encrypted-chat", async (c) => {
  const denied = await eligibleOnly(c);
  if (denied) return denied;
  const eventId = c.req.param("id");
  c.header("Cache-Control", "no-store");
  await groupChatRepo.reconcileMembers(eventId);
  const payload = await payloadFor(eventId, c.get("user").id);
  if (!payload) return c.json({ error: "not_found" }, 404);
  return c.json(payload);
});

/** 部屋・v1 鍵・自分の signer を無ければ作る（先勝ち・冪等。staff と同じ）。
 * 失効中の signer は再有効化する（資格を取り戻した人は全世代を受け取る 3.2） */
encryptedChatRoutes.post("/:id/encrypted-chat", async (c) => {
  const denied = await eligibleOnly(c);
  if (denied) return denied;
  const eventId = c.req.param("id");
  const userId = c.get("user").id;
  const writer = { eventId, actorId: userId, permission: "chat-member" } as const;
  c.header("Cache-Control", "no-store");
  await groupChatRepo.reconcileMembers(eventId);
  await groupChatRepo.ensureRoom(eventId, "members", writer);
  const existing = await groupChatRepo.signerFor(eventId, "members", userId);
  if (existing) {
    if (existing.revokedAt !== null) {
      await groupChatRepo.reactivateSigner(eventId, "members", userId);
    }
  } else {
    const { secret, pubkey } = generateChatKey();
    // 乱数衝突の保険（#332 と同じ。衝突したまま載ると過去の発言が別人のものになる）
    const taken = await groupChatRepo.pubkeyOwner(eventId, "members", pubkey);
    if (taken && taken !== userId) return c.json({ error: "conflict" }, 409);
    await groupChatRepo.addSigner(eventId, "members", userId, pubkey, secret, writer);
  }
  const payload = await payloadFor(eventId, userId);
  if (!payload || !payload.myKey) return c.json({ error: "conflict" }, 409);
  return c.json(payload);
});
