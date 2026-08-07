import { z } from "zod";

/**
 * 参加者への一斉連絡 (#172)。
 *
 * スタッフが区分を選んで、そのイベントの関係者へまとめて連絡する。
 * アプリ内通知は送信時にまとめて作る（確実に届く）。メールは1リクエストで
 * 送れる件数に上限があるため送信待ちを積み、定期実行で順次消化する。
 */

/** 送信先の区分。SQL の条件は server 側 eventBroadcasts リポジトリに対応する */
export const BROADCAST_SEGMENTS = [
  "all",
  "confirmed",
  "waitlist",
  "lottery_won",
  "lottery_lost",
  "staff",
  "judge",
  "observer",
  "attended",
  "not_attended",
] as const;
export type BroadcastSegment = (typeof BROADCAST_SEGMENTS)[number];

export const BROADCAST_SEGMENT_LABELS: Record<BroadcastSegment, string> = {
  all: "全員",
  confirmed: "確定",
  waitlist: "キャンセル待ち",
  lottery_won: "抽選の当選者",
  lottery_lost: "抽選の落選者",
  staff: "スタッフ",
  judge: "審査員",
  // 既存のロール表示 (roleLabel) に合わせる。イベント内では「観覧者」で統一されている
  observer: "観覧者",
  attended: "出席した人",
  not_attended: "出席しなかった人",
};

/** 区分が誰を指すかの補足。送信前の確認で「思っていた相手と違う」を防ぐためのもの */
export const BROADCAST_SEGMENT_NOTES: Record<BroadcastSegment, string> = {
  all: "参加を取り消した人を除く、このイベントの関係者すべて（スタッフ・審査員・観覧者を含む）",
  confirmed: "参加が確定している参加者。スタッフ・審査員・観覧者は含みません",
  waitlist: "先着枠が満員でキャンセル待ちになっている参加者",
  lottery_won: "抽選枠で当選している参加者",
  lottery_lost: "抽選枠で落選した参加者",
  staff: "このイベントのスタッフ",
  judge: "このイベントの審査員",
  observer: "このイベントの観覧者",
  attended: "受付で出席が記録された人",
  not_attended:
    "参加が確定していたのに出席の記録がない参加者。受付を使っていないイベントでは全員がここに入ります",
};

/** 件名の最大文字数。そのままメールの件名になるので1行で収まる長さに */
export const BROADCAST_TITLE_MAX = 100;
/** 本文の最大文字数。チャット本文 (2000) と揃える */
export const BROADCAST_BODY_MAX = 2000;

/** 1イベントあたり直近24時間の送信回数の上限。
 * 一斉連絡は取り消せず全員に届くので、乗っ取られたときの被害を時間で頭打ちにする */
export const BROADCAST_MAX_PER_DAY = 10;
/** 1イベントあたりの通算送信回数の上限。長期間かけた連投を止める */
export const BROADCAST_MAX_PER_EVENT = 100;

/**
 * 表示を壊す・件名に化ける不可視文字かどうか。除外する範囲は表示名の判定 (#232)
 * と同じ（C0制御・DEL・ゼロ幅スペース・bidi制御）。
 *
 * 正規表現の文字クラスではなくコードポイントで判定しているのは、ソースに生の
 * 制御文字を書かないため（エディタや diff で消えて条件が黙って変わるのを防ぐ）。
 * allowNewline のときは改行とタブだけ通す（本文は複数行を許す）。
 */
export function hasControlChars(s: string, allowNewline: boolean): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (allowNewline && (c === 0x0a || c === 0x09)) continue;
    if (c <= 0x1f || c === 0x7f) return true; // C0 制御・DEL
    if (c === 0x200b) return true; // ゼロ幅スペース（見た目が空の本文）
    if (c === 0x200e || c === 0x200f) return true; // bidi マーク
    if (c >= 0x202a && c <= 0x202e) return true; // bidi 埋め込み・上書き
    if (c >= 0x2066 && c <= 0x2069) return true; // bidi 分離
  }
  return false;
}

const CONTROL_CHAR_MESSAGE = "使用できない文字（制御文字等）が含まれています";

/**
 * 本文の改行を整える。CRLF/CR を LF に寄せ、3行以上の空行は2つ分（＝空行1つ）にする。
 * 空行を大量に入れて通知一覧やメールを引き伸ばす投稿を弾くのが目的。
 * 検証の前に通すので、改行を詰めた結果が文字数上限の判定に使われる。
 */
export function normalizeBroadcastBody(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 件名の改行・前後の空白を落とす（件名は1行のみ） */
export function normalizeBroadcastTitle(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export const createBroadcastInput = z.object({
  segment: z.enum(BROADCAST_SEGMENTS),
  title: z
    .string()
    .transform(normalizeBroadcastTitle)
    .pipe(
      z
        .string()
        .min(1)
        .max(BROADCAST_TITLE_MAX)
        .refine((v) => !hasControlChars(v, false), CONTROL_CHAR_MESSAGE),
    ),
  body: z
    .string()
    .transform(normalizeBroadcastBody)
    .pipe(
      z
        .string()
        .min(1)
        .max(BROADCAST_BODY_MAX)
        .refine((v) => !hasControlChars(v, true), CONTROL_CHAR_MESSAGE),
    ),
});
export type CreateBroadcastInput = z.infer<typeof createBroadcastInput>;

/** メールの送信状況。合計 = pending + sent + failed + skipped */
export const broadcastEmailStatsSchema = z.object({
  /** 送信待ち */
  pending: z.number(),
  /** 送信済み */
  sent: z.number(),
  /** 規定回数ためして送れなかったもの */
  failed: z.number(),
  /** 送信までの間にメール通知をオフにした等で対象外になったもの */
  skipped: z.number(),
});
export type BroadcastEmailStats = z.infer<typeof broadcastEmailStatsSchema>;

export const eventBroadcastSchema = z.object({
  id: z.string(),
  segment: z.string(),
  title: z.string(),
  body: z.string(),
  /** 送信した人の表示名（退会等で消えていたら null） */
  senderName: z.string().nullable(),
  /** アプリ内通知を作った人数（送信時点の区分の人数） */
  recipientCount: z.number(),
  email: broadcastEmailStatsSchema,
  createdAt: z.number(),
});
export type EventBroadcast = z.infer<typeof eventBroadcastSchema>;

/** GET /events/:id/broadcasts のレスポンス（そのイベントのスタッフのみ） */
export interface EventBroadcastsPayload {
  broadcasts: EventBroadcast[];
  /** 区分ごとの現在の人数 */
  counts: Record<BroadcastSegment, number>;
  /** 直近24時間であと何回送れるか */
  remainingToday: number;
  /** 通算であと何回送れるか */
  remainingTotal: number;
}
