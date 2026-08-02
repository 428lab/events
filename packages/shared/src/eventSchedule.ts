import { z } from "zod";

/** タイムテーブルの担当者（イベントメンバーから解決したユーザー情報） */
export const scheduleSpeakerSchema = z.object({
  id: z.string(),
  username: z.string(),
  globalName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type ScheduleSpeaker = z.infer<typeof scheduleSpeakerSchema>;

/** タイムテーブルの1項目（サーバーが返す形。担当者はユーザー情報に解決済み） */
export const scheduleItemSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  title: z.string(),
  description: z.string(),
  /** 所要時間（分） */
  durationMin: z.number(),
  /** 明示的な開始時刻（epoch ms）。null なら前の項目の終わりから自動計算 */
  startsAt: z.number().nullable(),
  /** リンクされた担当者（イベントメンバー）。フリーテキストのみなら null */
  speaker: scheduleSpeakerSchema.nullable(),
  /** フリーテキストの担当者名（リンクなし） */
  speakerName: z.string(),
  sortOrder: z.number(),
});
export type ScheduleItem = z.infer<typeof scheduleItemSchema>;

/** タイムテーブルの保存入力（1項目）。並び順は配列順で決まる */
export const saveScheduleItemInput = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().max(1000).default(""),
  durationMin: z.number().int().min(0).max(1440),
  startsAt: z.number().nullable().default(null),
  speakerUserId: z.string().nullable().default(null),
  speakerName: z.string().max(100).default(""),
});
export type SaveScheduleItemInput = z.infer<typeof saveScheduleItemInput>;

/** タイムテーブルの保存入力（全項目の一括置き換え） */
export const saveScheduleInput = z.object({
  items: z.array(saveScheduleItemInput).max(100),
});
export type SaveScheduleInput = z.infer<typeof saveScheduleInput>;

/** 各項目の開始時刻（epoch ms）を計算する。
 * 先頭はイベント開始時刻から。明示的な startsAt があればそこから後続が連鎖する。
 * 基準が無い（開催日時未定かつ明示指定なし）間は null。 */
export function computeScheduleTimes(
  items: Array<{ durationMin: number; startsAt: number | null }>,
  eventStartsAt: number | null,
): Array<number | null> {
  const out: Array<number | null> = [];
  let cursor: number | null =
    eventStartsAt && eventStartsAt > 0 ? eventStartsAt : null;
  for (const it of items) {
    const start = it.startsAt ?? cursor;
    out.push(start);
    cursor = start === null ? null : start + it.durationMin * 60_000;
  }
  return out;
}

/** 編集時のデフォルト所要時間（分） */
export const SCHEDULE_DEFAULT_DURATION_MIN = 20;

export interface ScheduleTemplateItem {
  title: string;
  durationMin: number;
  description: string;
}

export interface ScheduleTemplate {
  key: string;
  name: string;
  items: ScheduleTemplateItem[];
}

/** タイムテーブルのテンプレート（編集画面のたたき台） */
export const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  {
    key: "lt",
    name: "LT会",
    items: [
      { title: "開場・受付", durationMin: 15, description: "" },
      { title: "オープニング", durationMin: 5, description: "趣旨説明・諸注意" },
      { title: "LT 1", durationMin: 10, description: "発表5分＋入れ替え" },
      { title: "LT 2", durationMin: 10, description: "発表5分＋入れ替え" },
      { title: "LT 3", durationMin: 10, description: "発表5分＋入れ替え" },
      { title: "休憩", durationMin: 10, description: "" },
      { title: "LT 4", durationMin: 10, description: "発表5分＋入れ替え" },
      { title: "LT 5", durationMin: 10, description: "発表5分＋入れ替え" },
      { title: "クロージング", durationMin: 5, description: "" },
    ],
  },
  {
    key: "study",
    name: "勉強会",
    items: [
      { title: "開場・受付", durationMin: 15, description: "" },
      { title: "オープニング", durationMin: 5, description: "趣旨説明・諸注意" },
      { title: "セッション 1", durationMin: 40, description: "" },
      { title: "休憩", durationMin: 10, description: "" },
      { title: "セッション 2", durationMin: 40, description: "" },
      { title: "質疑応答・ディスカッション", durationMin: 15, description: "" },
      { title: "クロージング", durationMin: 5, description: "" },
    ],
  },
  {
    key: "hackathon",
    name: "ハッカソン",
    items: [
      { title: "開場・受付", durationMin: 15, description: "" },
      { title: "オープニング", durationMin: 15, description: "趣旨説明・ルール説明" },
      { title: "アイデア出し・チームビルディング", durationMin: 30, description: "" },
      { title: "開発タイム", durationMin: 240, description: "" },
      { title: "成果発表", durationMin: 30, description: "" },
      { title: "審査・表彰", durationMin: 20, description: "" },
      { title: "クロージング", durationMin: 10, description: "" },
    ],
  },
  {
    key: "study-party",
    name: "懇親会つき勉強会",
    items: [
      { title: "開場・受付", durationMin: 15, description: "" },
      { title: "オープニング", durationMin: 5, description: "趣旨説明・諸注意" },
      { title: "セッション 1", durationMin: 40, description: "" },
      { title: "休憩", durationMin: 10, description: "" },
      { title: "セッション 2", durationMin: 40, description: "" },
      { title: "クロージング", durationMin: 5, description: "" },
      { title: "懇親会", durationMin: 60, description: "" },
      { title: "撤収", durationMin: 15, description: "" },
    ],
  },
];
