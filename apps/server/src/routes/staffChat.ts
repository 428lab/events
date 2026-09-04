import { Hono } from "hono";
import type { Context } from "hono";
import type { StaffChatPayload } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { isConfirmedEventStaff } from "../auth/roles.js";
import { generateChatKey } from "../lib/nostrSign.js";
import { staffChatRepo } from "../db/repositories/staffChat.js";
import { getChatRelays } from "../db/repositories/appSettings.js";

/** イベントスタッフ用のチャットルーム (#382)。設計は docs/staff-chat.md。
 *
 * 本文はブラウザ⇔リレー直通（kind 9807 の NIP-44 暗号文）で、ここでは
 * roomId・グループ共通鍵・発言用一時鍵の配布だけを行う（pull 型。設計 7.2）。
 *
 * ゲートは **isConfirmedEventStaff だけ**（appAdmin・コミュニティ管理者は
 * 通らない #275。公開状態はゲートに現れない＝公開前から使える）。
 * eventChat.ts には足さない：あちらは参加確定メンバー向けで、権限の段が違う。
 *
 * **staff 以外には部屋の存在ごと見せない**（要件3）。403 は部屋の有無・
 * イベントの状態によらず一律 `forbidden` で、roomId・鍵・signer・メンバーの
 * どれも staff 以外に返る経路が無い（test/staff-chat.test.ts が両側から守る） */
export const staffChatRoutes = new Hono<AppEnv>();
// 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)

/** staff ゲート。通らない相手には**常に同じ 403** を返す（存在の秘匿）。
 * イベントが無い場合もメンバー行が無い＝この 403 に落ちる */
async function staffOnly(c: Context<AppEnv>): Promise<Response | null> {
  const ok = await isConfirmedEventStaff(c.req.param("id")!, c.get("user").id);
  return ok ? null : c.json({ error: "forbidden" }, 403);
}

/** GET/POST 共通のペイロード。部屋が無ければ null。
 * myKey は本人の signer が現役のときだけ（未発行・失効中は null → POST で発行/再有効化） */
async function payloadFor(
  eventId: string,
  userId: string,
): Promise<StaffChatPayload | null> {
  const roomId = await staffChatRepo.roomIdFor(eventId);
  if (!roomId) return null;
  const signer = await staffChatRepo.signerFor(eventId, userId);
  return {
    roomId,
    keys: await staffChatRepo.listKeys(eventId),
    myKey:
      signer && signer.revokedAt === null
        ? { pubkey: signer.pubkey, secret: signer.secret }
        : null,
    members: await staffChatRepo.listMembers(eventId),
    relays: await getChatRelays(),
  };
}

/** 部屋の鍵一式（roomId・全世代の共通鍵・自分の signer・表示許可リスト）。
 * 部屋が未開設なら 404（クライアントは POST で開設する） */
staffChatRoutes.get("/:id/staff-chat", async (c) => {
  const denied = await staffOnly(c);
  if (denied) return denied;
  c.header("Cache-Control", "no-store");
  const payload = await payloadFor(c.req.param("id"), c.get("user").id);
  if (!payload) return c.json({ error: "not_found" }, 404);
  return c.json(payload);
});

/** 部屋・v1 鍵・自分の signer を無ければ作る（先勝ち・冪等。設計 7.1）。
 * 招待を承諾して戻った人 (#339) はここで signer が再有効化され、
 * 全 version を受け取る（承諾フロー側に配布処理は差し込まない。設計 4） */
staffChatRoutes.post("/:id/staff-chat", async (c) => {
  const denied = await staffOnly(c);
  if (denied) return denied;
  const eventId = c.req.param("id");
  const userId = c.get("user").id;
  c.header("Cache-Control", "no-store");
  await staffChatRepo.ensureRoom(eventId);
  const existing = await staffChatRepo.signerFor(eventId, userId);
  if (existing) {
    // 失効中なら再有効化（設計 7.3。現役ならそのまま＝何度呼んでも同じ鍵）
    if (existing.revokedAt !== null) {
      await staffChatRepo.reactivateSigner(eventId, userId);
    }
  } else {
    const { secret, pubkey } = generateChatKey();
    // 生成した鍵がこの部屋で使用済みなら登録しない（乱数256bitなので現実には
    // 起きないが、衝突したまま載ると過去の発言が別人のものとして表示される #332）
    const taken = await staffChatRepo.pubkeyOwner(eventId, pubkey);
    if (taken && taken !== userId) return c.json({ error: "conflict" }, 409);
    // 先勝ち: 同時発行のレースでは先着の鍵が残る（下の payloadFor が読み直す）
    await staffChatRepo.addSigner(eventId, userId, pubkey, secret);
  }
  const payload = await payloadFor(eventId, userId);
  if (!payload || !payload.myKey) return c.json({ error: "conflict" }, 409);
  return c.json(payload);
});
