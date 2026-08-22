/**
 * スタッフチャット (#382) の受信バッファ（純粋関数）。
 *
 * roomId は公開値（購読フィルタに使う値）なので、第三者が同じ部屋に
 * ゴミ投稿を流し込める。復号も表示もされない（許可リスト外＋復号不能）が、
 * 「古い側から捨てる」だけのバッファだと、ゴミを上限＋1件流すだけで
 * **本物の履歴が画面から押し出される**。そこであふれたときは
 * **許可リスト外の投稿から先に捨てる**（レビュー指摘への対応）。
 *
 * あふれるまでは許可リスト外も捨てない: 参加したての staff の発言は、
 * 表示許可リストの次のポーリング（〜5秒）まで pubkey が引けない。
 * 受信時に捨てるとその発言が失われる（リレーは再送しない）ので、
 * 判定は表示側（描画時のフィルタ）に任せ、バッファは満杯時の
 * 捨てる順序だけを変える。
 */

interface BufferedMessage {
  id: string;
  pubkey: string;
  created_at: number;
}

/** 状態に貯めておくメッセージの上限（EventChat と同じ値。#215 の判断を引き継ぐ） */
export const MESSAGE_BUFFER_MAX = 500;

/** 受信・送信したメッセージを時刻順に足す。IDで重複排除。
 * あふれたら許可リスト外 → 古い順、の順序で捨てる */
export function appendStaffChatMessage<T extends BufferedMessage>(
  prev: T[],
  ev: T,
  isAllowed: (pubkey: string) => boolean,
  max: number = MESSAGE_BUFFER_MAX,
): T[] {
  if (prev.some((m) => m.id === ev.id)) return prev;
  let next = [...prev, ev].sort((a, b) => a.created_at - b.created_at);
  if (next.length <= max) return next;
  // 許可リスト外を古い順に、あふれた数だけ捨てる
  const overflow = next.length - max;
  const dropIds = new Set<string>();
  for (const m of next) {
    if (dropIds.size >= overflow) break;
    if (!isAllowed(m.pubkey)) dropIds.add(m.id);
  }
  if (dropIds.size > 0) next = next.filter((m) => !dropIds.has(m.id));
  // それでも超えていたら（全員が許可リスト内）従来どおり古い側から
  return next.length > max ? next.slice(next.length - max) : next;
}
