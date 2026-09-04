/**
 * チャットの受信バッファ（純粋関数）。イベントチャット (#199) と
 * スタッフチャット (#382) が共有する。
 *
 * 上限の値と「あふれたときに何から捨てるか」は**両方の画面で同じ契約**なので、
 * ここ1か所だけに置く（以前は 500 と 200 が EventChat.tsx / StaffChat.tsx /
 * このファイルに散っていて、片方だけ直す事故が起こりうる状態だった #335）。
 *
 * 購読フィルタに使う ID（NIP-28 のチャンネルID、スタッフ部屋の roomId）は
 * どちらも公開値なので、第三者が同じ部屋にゴミ投稿を流し込める。表示はされない
 * （許可リスト外は描画時に落ちる）が、「古い側から捨てる」だけのバッファだと
 * ゴミを上限＋1件流すだけで**本物の履歴が画面から押し出される**。
 * そこであふれたときは**許可リスト外の投稿から先に捨てる**。
 *
 * あふれるまでは許可リスト外も捨てない: 参加したての人の発言は、表示許可リストの
 * 次のポーリング（〜5秒）まで pubkey が引けない。受信時に捨てるとその発言が
 * 失われる（リレーは再送しない）ので、判定は表示側（描画時のフィルタ）に任せ、
 * バッファは満杯時の捨てる順序だけを変える。
 */

interface BufferedMessage {
  id: string;
  pubkey: string;
  created_at: number;
}

/** 状態に貯めておくメッセージの上限 (#215)。投影用画面は何時間もつけっぱなしに
 * するので、際限なく増やすと配列とDOMがそのまま伸びる。表示対象を選ぶ前の
 * 生の受信ぶんなので、表示上限より少し多めに持つ */
export const MESSAGE_BUFFER_MAX = 500;

/** 実際に描画する件数の上限 (#215)。古い方から捨てて末尾だけを出す */
export const MESSAGE_DISPLAY_MAX = 200;

/** 受信・送信したメッセージを時刻順に足す。IDで重複排除。
 * あふれたら許可リスト外 → 古い順、の順序で捨てる */
export function appendChatMessage<T extends BufferedMessage>(
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

/** 描画する分だけに丸める。末尾（新しい側）を残す */
export function clampToDisplayMax<T>(
  kept: T[],
  max: number = MESSAGE_DISPLAY_MAX,
): T[] {
  return kept.length > max ? kept.slice(kept.length - max) : kept;
}

/**
 * イベントチャット (#199) で実際に描く分を選ぶ。
 *
 * 許可リスト外（第三者が同じチャンネルに流し込んだもの）・スタッフが非表示に
 * したもの・外部クライアント経由の巨大投稿（UIを壊す）を落としたうえで、
 * 末尾 MESSAGE_DISPLAY_MAX 件に丸める。
 */
export function selectVisibleChatMessages<
  T extends { id: string; pubkey: string; content: string },
>(
  messages: T[],
  {
    members,
    hidden,
    maxLength,
  }: { members: Set<string>; hidden: Set<string>; maxLength: number },
): T[] {
  return clampToDisplayMax(
    messages.filter(
      (m) =>
        members.has(m.pubkey) &&
        !hidden.has(m.id) &&
        m.content.length <= maxLength,
    ),
  );
}
