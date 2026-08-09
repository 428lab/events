import { z } from "zod";

/**
 * 出会った記録 (#189)。イベント中に参加者どうしがQRを読み合うとお互いにXPが入る。
 *
 * 記録できるのは #330 以降、使い捨てトークン付きQRの読み取り（/api/meet/scan）だけ。
 * 「相手を選んでボタンを押す」経路は廃止した。対面の裏付けが無い書き込み経路が
 * 残っていると、開催時間帯に確定メンバーの一覧から相手を選ぶだけで出会いを
 * 量産できてしまうため（XPは相手にも入る）。
 */

/** 出会いを記録できる共通イベント（両者が確定メンバーの開催中イベント） */
export const meetableEventSchema = z.object({
  id: z.string(),
  title: z.string(),
});
export type MeetableEvent = z.infer<typeof meetableEventSchema>;

/** ---- 読み取ったその場で確定する出会い (#330) ---- */

/** GET /api/meet/token のレスポンス。QRに載せる短寿命の使い捨てトークン */
export interface MeetToken {
  /** `mt1.<userId>.<exp>.<sig>` 形式。QRの飛び先 `/m/<token>` に埋める */
  token: string;
  /** 有効期限（epoch ミリ秒）。表示側はこれを過ぎたQRを描かない */
  expiresAt: number;
}

/** POST /api/meet/scan の入力 */
export const meetScanInput = z.object({
  token: z.string().min(10).max(512),
});
export type MeetScanInput = z.infer<typeof meetScanInput>;

/** 読み取りで1イベントぶんに起きたこと */
export interface MeetScanEventResult {
  eventId: string;
  title: string;
  /** この読み取りで新しく出会いが記録されたか（false は記録済みだった） */
  meetCreated: boolean;
  /** この読み取りで読み取った側が出席になったか（元から出席なら false） */
  attendedMe: boolean;
  /** この読み取りでQRの持ち主が出席になったか（元から出席なら false） */
  attendedTarget: boolean;
}

/** 読み取ったQRの持ち主（表示に必要な最小限） */
export interface MeetScanUser {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
}

/** POST /api/meet/scan のレスポンス（成功時） */
export interface MeetScanResult {
  target: MeetScanUser;
  events: MeetScanEventResult[];
  /**
   * この読み取りを取り消すための署名付きトークン (#330)。
   * 取り消せる範囲を「この読み取りが実際に書いた行」に閉じるためのもので、
   * 発行者本人・短時間しか使えない。undo にはこれ以外の入力を受け付けない。
   */
  undoToken: string;
}

/**
 * 読み取りが成立しなかった理由。利用者に何が起きたか伝えるために区別する。
 * サーバーが返すのは以下。web 側はこれに通信断・セッション切れ等を足して案内する。
 * - expired: QRの有効期限切れ（読み取り直せば成功する）
 * - invalid: 壊れた・改竄されたトークン
 * - self: 自分のQRを自分で読んだ
 * - no_shared_event: 共通の参加イベントがない
 * - outside_window: 共通イベントはあるが開催時間帯の外
 * - not_confirmed_me: 共通イベントはあるが自分の参加が確定していない
 * - not_confirmed_target: 共通イベントはあるが相手の参加が確定していない
 */
export type MeetScanFailure =
  | "expired"
  | "invalid"
  | "self"
  | "no_shared_event"
  | "outside_window"
  | "not_confirmed_me"
  | "not_confirmed_target";

/** POST /api/meet/undo の入力。scan が返したトークンだけを受け取る */
export const meetUndoInput = z.object({
  undoToken: z.string().min(10).max(4096),
});
export type MeetUndoInput = z.infer<typeof meetUndoInput>;
