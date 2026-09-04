import { ApiError } from "../api/client.js";

/**
 * チャットAPIの失敗の読み方 (#283 / #332)。
 *
 * 判定を1か所に置くのは、同じ error 名を別のエンドポイントが別のステータスで
 * 返し始めたときに、無関係な失敗を画面に吸い込ませないため。
 */

/** サーバーが返した error 名（その status のときだけ見る） */
export function chatErrorIs(
  err: unknown,
  status: number,
  code: string,
): boolean {
  return (
    err instanceof ApiError &&
    err.status === status &&
    (err.body as { error?: string } | null)?.error === code
  );
}

/** 「チャットに繋がせない状態」(#283) のサーバー応答か。
 * 許可リストの取得 (chat-members) と参加ボタン (chat-key) の両方が同じ 403 を
 * 返すので、判定はここ1箇所に寄せる */
export function isChatUnavailable(err: unknown): boolean {
  return chatErrorIs(err, 403, "chat_unavailable");
}

/** 参加に失敗したときに出しうる文言（翻訳キーは型で縛る #352） */
export type ChatJoinErrorKey =
  | "eventSocial.chatJoinKeyTaken"
  | "eventSocial.chatJoinFailedRetry"
  | "eventSocial.chatUnavailable"
  | "eventSocial.chatJoinKeyNotLinked"
  | "eventSocial.chatJoinTooManyKeys"
  | "eventSocial.chatJoinNotConfirmed"
  | "eventSocial.chatJoinFailed";

/** 部屋の開設に失敗したときに出しうる文言 */
export type ChatChannelErrorKey =
  | "eventSocial.chatChannelCreateNoServiceKey"
  | "eventSocial.chatChannelCreateRejected"
  | "eventSocial.chatChannelCreateFailed";

/**
 * 参加に失敗したときに出す文言のキー。
 *
 * **error 名で見る**: 同じ 409 でも「鍵が使用中」と「鍵の数の上限」で
 * 利用者のすることが違うので、status だけで束ねると片方が的外れになる。
 *
 * @param useNip07 実際に本人の鍵で参加しようとしたか（選択ではなく実行結果）
 */
export function chatJoinErrorKey(
  err: unknown,
  useNip07: boolean,
): ChatJoinErrorKey {
  if (chatErrorIs(err, 409, "pubkey_taken")) {
    // 一時鍵の経路でも起こりうる（サーバーが作った鍵の衝突）が、その場合
    // 利用者は鍵を選んでいないので「別の鍵を」とは言えない
    return useNip07
      ? "eventSocial.chatJoinKeyTaken"
      : "eventSocial.chatJoinFailedRetry";
  }
  if (isChatUnavailable(err)) {
    // 締め出し (#283)。締め出された人は**参加が確定している**ので、
    // 「参加が確定しているメンバーのみ」に落とすと事実と違う説明になる。
    // 理由は書かないが嘘も書かない、で一覧側の表示と同じ文言に揃える
    return "eventSocial.chatUnavailable";
  }
  if (chatErrorIs(err, 403, "key_not_linked")) {
    // その鍵の持ち主であることは証明できたが、鍵がこのアカウントのものとして
    // 登録されていないケース (#332)。何をすれば発言できるかまで書く
    return "eventSocial.chatJoinKeyNotLinked";
  }
  if (chatErrorIs(err, 409, "too_many_keys")) {
    // このイベントで登録できる鍵の数の上限に達した (#332)
    return "eventSocial.chatJoinTooManyKeys";
  }
  if (err instanceof ApiError && err.status === 403) {
    return "eventSocial.chatJoinNotConfirmed";
  }
  return "eventSocial.chatJoinFailed";
}

/** 部屋の開設に失敗したときに出す文言のキー (#199) */
export function chatChannelErrorKey(err: unknown): ChatChannelErrorKey {
  if (err instanceof ApiError && err.status === 503) {
    return "eventSocial.chatChannelCreateNoServiceKey";
  }
  if (err instanceof ApiError && err.status === 502) {
    return "eventSocial.chatChannelCreateRejected";
  }
  return "eventSocial.chatChannelCreateFailed";
}
