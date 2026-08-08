import { AVATAR_IMAGE } from "@eventer/shared";
import { getBucket } from "../runtime.js";
import { normalizeImageMime } from "./imageMime.js";
import { usersRepo } from "../db/repositories/users.js";

/** アイコン本体の R2 キー。1ユーザー1枚（更新は上書き） (#312)。
 * 世代を分けないのは、退会時の後始末 (purgeDeleted.ts) を1キーで済ませるため。
 * 「古い画像を掴み続ける」問題は配信URLの ?v= と ETag（更新時刻）で解いている */
export const avatarKey = (userId: string) => `avatars/${userId}`;

/** 自ドメインの配信URL。相対パスなのは、環境（本番/staging/ローカル）や
 * 将来のドメイン変更で DB に焼き付いた絶対URLが古くなるのを避けるため。
 * Web は同一オリジンで /api を叩いており、名札PNGの書き出しも fetch で解決できる */
export const avatarUrlFor = (userId: string, updatedAt: number) =>
  `/api/users/${userId}/avatar?v=${updatedAt}`;

/** 取得のタイムアウト。連携先が無反応でもログインを待たせない */
const FETCH_TIMEOUT_MS = 5000;

/** 上限バイト数まで読み、超えたら null を返す。
 * arrayBuffer() で一気に読むと Content-Length を詐称された巨大レスポンスを
 * そのままメモリに載せてしまうため、チャンク単位で積算して打ち切る */
async function readCapped(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 連携先のアイコンURLを取り込んで R2 へ保管し、user.avatar_url を自ドメインの
 * URLへ差し替える (#312)。ログインのたびに呼ぶ。
 *
 * **失敗しても投げない**。連携先が落ちている・URLが既に404・大きすぎる・
 * 画像でない、のいずれでもログインは成功させ、既存の avatar_url を残す
 * （新規ユーザーなら連携先のURLがそのまま残る＝これまでと同じ見え方）。
 *
 * 中身が前回と同じなら R2 も D1 も書かない。毎ログインで ?v= が変わると
 * 同じ画像を毎回ダウンロードさせることになるため。
 *
 * @param sourceUrl 連携先のアイコンURL（null/空なら何もしない）
 * @returns 保管して差し替えたら true */
export async function syncAvatarFromSource(
  userId: string,
  sourceUrl: string | null | undefined,
): Promise<boolean> {
  if (!sourceUrl) return false;
  // Nostr の kind:0 は本人が中身を書けるため、取得先は https に限る。
  // http はサイトが https である以上どのみちブラウザがブロックするので実害もない
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "image/*" },
    });
    if (!res.ok || !res.body) return false;

    // 連携先が返す MIME をそのまま信用せず、アップロードと同じ許可リストに通す
    // （SVG は script を持てるため配信対象にしない）
    const mime = normalizeImageMime(res.headers.get("content-type") ?? undefined);
    if (!mime) return false;

    // Content-Length は見ない（詐称されうるし、読みながら打ち切るので上限は守れる）
    const bytes = await readCapped(res.body, AVATAR_IMAGE.maxBytes);
    if (!bytes || bytes.byteLength === 0) return false;

    const hash = toHex(await crypto.subtle.digest("SHA-256", bytes));
    const current = await usersRepo.findAvatarImage(userId);
    if (current && current.hash === hash && current.mime === mime) return false;

    const updatedAt = Date.now();
    await getBucket().put(avatarKey(userId), bytes, {
      httpMetadata: { contentType: mime },
    });
    // R2 に入れてから D1 を更新する。逆にすると、間で失敗したときに
    // 「URL は自ドメインを指すのに実体が無い」＝アイコンが消えた状態になる
    await usersRepo.setAvatarImage(
      userId,
      avatarUrlFor(userId, updatedAt),
      updatedAt,
      mime,
      hash,
    );
    return true;
  } catch (e) {
    console.warn(`[avatar] sync failed for user=${userId}`, e);
    return false;
  }
}
