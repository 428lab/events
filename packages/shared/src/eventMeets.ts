import { z } from "zod";

/** 出会った記録 (#189)。プロフィールQRの読み合いでお互いにXPが入る */

/** 出会った相手（同じイベントの確定メンバー）を指定する入力 */
export const recordMeetInput = z.object({
  /** 相手のユーザーID */
  userId: z.string().min(1),
});
export type RecordMeetInput = z.infer<typeof recordMeetInput>;

/** いま「出会った」を記録できる共通イベント（両者が対象メンバーの開催中イベント） */
export const meetableEventSchema = z.object({
  id: z.string(),
  title: z.string(),
});
export type MeetableEvent = z.infer<typeof meetableEventSchema>;

/** ---- 読み取ったその場で確定する出会い (#330) ---- */

/** GET /api/meet/token のレスポンス。QRに載せる使い切りトークン。
 * `?current=<token>` を付けて呼ぶと、まだ読まれていなければ同じものが返る */
export interface MeetToken {
  /** `mt1.<userId>.<exp>.<nonce>.<sig>` 形式。QRの飛び先 `/m/<token>` に埋める */
  token: string;
  /** 有効期限（epoch ミリ秒）。表示側はこれを過ぎたQRを描かない */
  expiresAt: number;
  /** 渡した current が読み取り済みだったか。true ならQRを描き替える合図 */
  consumed: boolean;
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
}

/**
 * 読み取りが成立しなかった理由。利用者に何が起きたか伝えるために区別する。
 * サーバーが返すのは以下。web 側はこれに通信断・セッション切れ等を足して案内する。
 * - expired: QRの有効期限切れ（読み取り直せば成功する）
 * - used: 既に読み取られたQR（使い切りなので2回目は通らない）
 * - invalid: 壊れた・改竄されたトークン
 * - self: 自分のQRを自分で読んだ
 * - no_shared_event: 共通の参加イベントがない
 * - outside_window: 共通イベントはあるが開催時間帯の外
 * - not_confirmed_me: 共通イベントはあるが自分の参加が確定していない
 * - not_confirmed_target: 共通イベントはあるが相手の参加が確定していない
 */
export type MeetScanFailure =
  | "expired"
  | "used"
  | "invalid"
  | "self"
  | "no_shared_event"
  | "outside_window"
  | "not_confirmed_me"
  | "not_confirmed_target";

/** POST /api/meet/undo の入力（scan のレスポンスをそのまま渡せる形） */
export const meetUndoInput = z.object({
  /** QRの持ち主のユーザーID */
  userId: z.string().min(1),
  events: z
    .array(
      z.object({
        eventId: z.string().min(1),
        /** 読み取りで自分に付いた出席を外す */
        revokeMyAttendance: z.boolean().default(false),
        /** 読み取りで相手に付いた出席を外す */
        revokeTargetAttendance: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(10),
});
export type MeetUndoInput = z.infer<typeof meetUndoInput>;
