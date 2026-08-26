import { z } from "zod";

/**
 * 出会った記録 (#189)。イベント中に参加者どうしがQRを読み合うとお互いにXPが入る。
 *
 * 記録できるのは #330 以降、使い切りトークン付きQRの読み取り（/api/meet/scan）だけ。
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

/** POST /api/meet/undo の入力。scan が返したトークンだけを受け取る */
export const meetUndoInput = z.object({
  undoToken: z.string().min(10).max(4096),
});
export type MeetUndoInput = z.infer<typeof meetUndoInput>;

/** ---- 出会いランキングの投影 (#418) ---- */

/**
 * 出会いランキングの表示設定（イベントごと）。
 * - off: 出さない。参加者向けAPIは404（イベント不存在と同一応答）で存在ごと隠す
 * - anonymous: 件数のみ（個人を特定できる値はサーバー応答に載せない）
 * - named: 名前・アバター入り（会場に大写しになる前提の設定）
 */
export const MEET_RANKING_MODES = ["off", "anonymous", "named"] as const;
export type MeetRankingMode = (typeof MEET_RANKING_MODES)[number];

/** 投影ページ・詳細パネルがランキングをポーリングする間隔。
 * live-state の1秒（配信のシーン切替）に乗せないのは、ランキングはQRを
 * 読み合う人間の速度でしか変わらず、参加者全員が手元でも開きうるため */
export const MEET_RANKING_POLL_MS = 5_000;

/** ランキングに出す行数。プロジェクターで読める限界に合わせて固定 */
export const MEET_RANKING_TOP_N = 10;

/** named モードの1行。rank は競技順位（同数は同順位、次は人数分飛ぶ） */
export interface MeetRankingNamedRow {
  rank: number;
  userId: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  count: number;
}

/** anonymous モードの1行。件数ごとに集約する（個人を指す値を持たない） */
export interface MeetRankingAnonymousRow {
  rank: number;
  /** 出会った人数 */
  count: number;
  /** その件数の人が何人いるか */
  people: number;
}

/** 呼び出した本人の順位。本人自身の値なので匿名モードでも返す */
export interface MeetRankingMe {
  rank: number;
  count: number;
}

/** GET /api/events/:id/meets/ranking/live のレスポンス。
 * mode により行の形が変わる（匿名で名前入りの行を返さないのはサーバー側の保証） */
export type MeetRankingLive =
  | {
      mode: "named";
      ranking: MeetRankingNamedRow[];
      totalRanked: number;
      me: MeetRankingMe | null;
    }
  | {
      mode: "anonymous";
      ranking: MeetRankingAnonymousRow[];
      totalRanked: number;
      me: MeetRankingMe | null;
    };
