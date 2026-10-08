/** グループチャット: スタッフチャット (#382) と参加者の暗号化チャット (#582)。
 *
 * 独自 kind ＋ NIP-44 v2（グループ共通鍵）＋ サーバーによる鍵の生成・pull 配布。
 * 本文はブラウザ⇔リレー直通で、サーバーは鍵の保管と配布だけを行う
 * （暗号化・復号はブラウザだけが行う）。設計は docs/staff-chat.md と
 * docs/participant-encrypted-chat.md。
 *
 * 部屋は audience で分かれる: 'staff'（スタッフだけ）/ 'members'（参加確定メンバー）。
 */

import type { ChatWriteWindow } from "./eventChat.js";
import type { EventSignalConfig } from "./eventSignal.js";

/** 部屋の対象範囲。表の audience 列と同じ値 */
export type GroupChatAudience = "staff" | "members";

/** グループチャットの独自 kind。regular（1000–9999 = リレーが保存する）範囲で、
 * 既知の NIP・慣用 kind（9000–9030: NIP-29、9041/9734/9735: zap、9321: NIP-61、
 * 9802: highlight）と重ならない値（設計 3.3）。
 * 本文は NIP-44 v2 の暗号文なので、他クライアントに拾われても中身は読めない */
export const GROUP_CHAT_KIND = 9807;

/** メッセージの鍵バージョンを載せるタグ名。どの世代の鍵で復号するかは
 * 復号前に分かる必要があるため平文で載せる（バージョン番号自体は秘密ではない） */
export const GROUP_CHAT_VERSION_TAG = "v";

/** グループ共通鍵の1世代。secret は NIP-44 の conversation key（乱数32バイトのhex） */
export interface GroupChatKey {
  version: number;
  secret: string;
}

/** 表示許可リストの1人分。revokedAt が付いた人は資格を失った人で、
 * それより後に作られたメッセージは描画しない（過去の発言の名前解決のために返す） */
export interface GroupChatMember {
  pubkey: string;
  userId: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  /** 部屋の資格（スタッフ / 参加確定）を失った時刻（ms）。現役なら null */
  revokedAt: number | null;
}

/** GET/POST /events/:id/staff-chat のレスポンス（参加者向けは EncryptedChatPayload）。
 * このペイロードが返る経路は staff ゲートの中にしか無い（設計 8） */
export interface GroupChatPayload {
  /** サーバー採番の乱数64hex。リレー上の e タグとしてだけ使い、
   * イベントとの対応はサーバー内にしか無い */
  roomId: string;
  /** 全世代。復号は v タグの version で引く。新規発言は最新 version で暗号化 */
  keys: GroupChatKey[];
  /** 自分の発言用一時鍵（サーバー生成・保管）。未発行・失効中は null（POST で発行） */
  myKey: { pubkey: string; secret: string } | null;
  /** 表示許可リスト。revoked_at 付きの人も返す（過去の発言の名前解決のため） */
  members: GroupChatMember[];
  /** 読み書きに使うリレー（既存の運用設定 getChatRelays() を共用） */
  relays: string[];
}

/** 参加者の暗号化チャット (#582) の表示許可リストの1人分 */
export interface EncryptedChatMember extends GroupChatMember {
  /** イベントでのロール（staff の発言の色分け #228）。行が無ければ null */
  role: string | null;
}

/** GET/POST /events/:id/encrypted-chat のレスポンス（設計 2.3）。
 * このペイロードが返る経路は参加確定メンバーのゲートの中にしか無い */
export interface EncryptedChatPayload {
  roomId: string;
  /** 全世代。新規発言は最新 version で暗号化する */
  keys: GroupChatKey[];
  /** 自分の発言用一時鍵（サーバー生成・保管）。未発行・失効中は null（POST で発行） */
  myKey: { pubkey: string; secret: string } | null;
  /** revokedAt 付きの人も返す（過去の発言の名前解決のため） */
  members: EncryptedChatMember[];
  /** スタッフ・運営の非表示 (#278)。note id は平文・暗号文で共通の表 */
  hiddenNoteIds: string[];
  /** 非表示・解除の即時の合図（ChatMembersPayload.hiddenSignal と同じ。未設定なら null） */
  hiddenSignal: EventSignalConfig | null;
  /** 平文の過去ログのチャンネル（公開イベントのみ。非公開では常に null） */
  plaintextChannelId: string | null;
  /** この時刻（ms）より後の平文の発言は表示しない（暗号化をオンにした時刻） */
  encryptedAt: number;
  relays: string[];
  /** 書き込める期間 (#578)。入力欄の判定用で、表示の絞り込みには使わない */
  writeWindow: ChatWriteWindow;
}
