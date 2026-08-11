import { z } from "zod";

/** タイムテーブルの担当者（イベントメンバーから解決したユーザー情報） */
export const scheduleSpeakerSchema = z.object({
  id: z.string(),
  username: z.string(),
  globalName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type ScheduleSpeaker = z.infer<typeof scheduleSpeakerSchema>;

/** セッションの配置状態 (#338)。
 * - `unassigned` 未割り当て（ネタ出し中）。時刻を持たず、参加者には見せない
 * - `all` 全トラック共通（開会・基調講演・休憩など）。全列をまたぐ
 * - `tracks` 特定のトラック（1つ以上）
 *
 * `unassigned` と `all` はどちらも対応表が空になるため、この値でしか区別できない。
 * `tracks` なのにトラックが空、という状態は作らない（`unassigned` に落とす） */
export const schedulePlacementSchema = z.enum(["unassigned", "all", "tracks"]);
export type SchedulePlacement = z.infer<typeof schedulePlacementSchema>;

/** イベント内のトラック（並行して走る枠）。名前（ラベル）でしかなく会場の部屋とは無関係 */
export const eventTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number(),
});
export type EventTrack = z.infer<typeof eventTrackSchema>;

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
  /** リンクされた担当者（イベントメンバー）。フリーテキストのみなら null。
   * 退会申請中 (#250) は表示名を伏せるためここも null になる */
  speaker: scheduleSpeakerSchema.nullable(),
  /** 生の担当者ユーザーID（表示用ではなく編集・権限判定用）。
   * speaker が null でもリンク自体は残っているのでこちらには値が入る (#250)。
   * 編集画面がこの値を持ち回らないと、猶予期間中の保存でリンクが消えて
   * 復帰しても登壇者が戻らなくなる。IDのみで表示名・ハンドルは含まない */
  speakerUserId: z.string().nullable(),
  /** フリーテキストの担当者名（リンクなし） */
  speakerName: z.string(),
  /** 登壇資料URL（Speaker Deck・Googleスライド・events labのデッキ等）。空文字=なし */
  materialUrl: z.string(),
  /** 資料URLのOG画像（サーバーが取得してキャッシュ）。空文字=なし (#149) */
  materialOgImage: z.string(),
  sortOrder: z.number(),
  /** 配置状態 (#338)。トラックを使っていないイベントは全項目 `all` */
  placement: schedulePlacementSchema,
  /** 割り当てられたトラックの ID。`placement` が `tracks` のときだけ非空 */
  trackIds: z.array(z.string()),
});
export type ScheduleItem = z.infer<typeof scheduleItemSchema>;

/** 登壇資料URLの入力（http/https のみ許可。空文字=なし/クリア） */
const materialUrlInput = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\//.test(v), "URLはhttp/httpsのみ")
  .default("");

/** タイムテーブルの保存入力（1項目）。並び順は配列順で決まる */
export const saveScheduleItemInput = z.object({
  /** 既存項目の ID。null / 未指定なら新規追加。
   * 送られた ID が既存項目と一致する間は保存をまたいで ID が変わらない (#340)。
   * サーバーは自分のイベントの既存 ID のみ採用し、それ以外は新規として
   * 採番し直すので、この値をそのまま主キーにはしない */
  id: z.string().max(64).nullable().default(null),
  title: z.string().trim().min(1).max(100),
  description: z.string().max(1000).default(""),
  durationMin: z.number().int().min(0).max(1440),
  startsAt: z.number().int().min(0).nullable().default(null),
  speakerUserId: z.string().nullable().default(null),
  speakerName: z.string().max(100).default(""),
  /** 登壇資料URL。http/https のみ許可（空文字=なし） */
  materialUrl: materialUrlInput,
  /** 配置状態 (#338)。既定は `all`（＝いまと同じ見え方）。
   * `tracks` なのに `trackIndexes` が空ならサーバーが `unassigned` に落とす */
  placement: schedulePlacementSchema.default("all"),
  /** 割り当て先を **同じ保存に入っている tracks 配列の添字** で指す。
   * 新規追加したトラックはまだ ID が無い（サーバーが採番する）ので、
   * クライアントが ID をでっち上げずに済むようにここは添字で受ける。
   * 範囲外・重複は無視する */
  trackIndexes: z.array(z.number().int().min(0).max(99)).max(50).default([]),
});
export type SaveScheduleItemInput = z.infer<typeof saveScheduleItemInput>;

/** トラックの保存入力（1件）。並び順は配列順で決まる */
export const saveScheduleTrackInput = z.object({
  /** 既存トラックの ID。null / 未指定なら新規追加。
   * 項目と同じく、サーバーは自分のイベントの既存 ID のみ採用する */
  id: z.string().max(64).nullable().default(null),
  name: z.string().trim().min(1).max(50),
});
export type SaveScheduleTrackInput = z.infer<typeof saveScheduleTrackInput>;

/** 登壇者本人による資料URLの更新入力 (#148) */
export const updateScheduleMaterialInput = z.object({
  materialUrl: materialUrlInput,
});
export type UpdateScheduleMaterialInput = z.infer<
  typeof updateScheduleMaterialInput
>;

/** タイムテーブルの保存入力（全項目を送り、サーバーが差分で反映する #340）。
 * 送られなかった既存項目は削除、ID 一致は更新、ID 無しは追加。
 * 並び順は配列順（送った全項目に 0 から振り直す） */
export const saveScheduleInput = z.object({
  items: z.array(saveScheduleItemInput).max(100),
  /** トラックの定義（配列順が並び順）。項目と同じ差分の規則で反映する。
   *
   * **未指定はトラックを知らないクライアントからの保存**とみなし、
   * トラックの定義・割り当て・配置状態を一切触らない。空配列は
   * 「トラックを全部消す」なので、意味がまったく違う */
  tracks: z.array(saveScheduleTrackInput).max(20).optional(),
});
export type SaveScheduleInput = z.infer<typeof saveScheduleInput>;

/** computeScheduleTimes が見る項目。placement を省いた呼び出しは
 * 全項目 `all`（＝トラックを使っていないイベント）として扱う */
export interface ScheduleTimeItem {
  durationMin: number;
  startsAt: number | null;
  placement?: SchedulePlacement;
  trackIds?: string[];
}

/** 各項目の開始時刻（epoch ms）を計算する。
 * 先頭はイベント開始時刻から。明示的な startsAt があればそこから後続が連鎖する。
 * 基準が無い（開催日時未定かつ明示指定なし）間は null。
 *
 * 連鎖は **トラックごと** (#338)。並行して走る枠は互いに時刻を押し出さない。
 * - 未割り当て … 時刻を持たない (null)。どのトラックのカーソルも進めないので、
 *   ネタ出し中のセッションが後続を全部ずらすことがなくなる
 * - 全トラック共通 … 全トラックのカーソルの中でいちばん後ろから始まり、
 *   **全トラックのカーソルを進める**（開会・休憩が全列をまたぐため）
 * - 特定のトラック … そのトラックのカーソルだけを見て、そのトラックだけ進める
 *
 * trackIds を渡さない（＝トラック未設定の）イベントは列が1本しか無いのと同じで、
 * これまでどおりの直列の連鎖になる。 */
export function computeScheduleTimes(
  items: ScheduleTimeItem[],
  eventStartsAt: number | null,
  trackIds: string[] = [],
): Array<number | null> {
  const base: number | null =
    eventStartsAt && eventStartsAt > 0 ? eventStartsAt : null;
  // トラックが無いイベントは "" の1本だけを使う（＝従来の直列の連鎖）
  const columns = trackIds.length > 0 ? trackIds : [""];
  const cursors = new Map<string, number | null>(
    columns.map((id) => [id, base]),
  );

  /** その項目が占める列。未知のトラック ID もそのまま列として扱う */
  const columnsOf = (it: ScheduleTimeItem): string[] => {
    if ((it.placement ?? "all") === "all") return columns;
    const ids = (it.trackIds ?? []).filter((id) => id !== "");
    return ids.length > 0 ? ids : columns;
  };

  const out: Array<number | null> = [];
  for (const it of items) {
    if (it.placement === "unassigned") {
      out.push(null);
      continue;
    }
    const cols = columnsOf(it);
    // null は「基準が無い（未知）」なので制約として数えない。
    // 1つでも分かっている列があればそれに合わせる
    const known = cols
      .map((id) => cursors.get(id) ?? base)
      .filter((v): v is number => v !== null);
    const start = it.startsAt ?? (known.length > 0 ? Math.max(...known) : null);
    out.push(start);
    const next = start === null ? null : start + it.durationMin * 60_000;
    for (const id of cols) cursors.set(id, next);
  }
  return out;
}

/** 同じトラック内で時刻が重なっている組み合わせ (#338)。
 * 重なりは弾かない（保存は止めない）が、タイムテーブルの枠が潰れて読みにくく
 * なるので編集画面で警告するために使う。
 * 未割り当ては時刻を持たないので対象外。全トラック共通は全列を占める。 */
export function findTrackOverlaps<T extends ScheduleTimeItem>(
  items: T[],
  times: Array<number | null>,
  tracks: EventTrack[],
): Array<{ trackName: string; a: T; b: T }> {
  const out: Array<{ trackName: string; a: T; b: T }> = [];
  for (const track of tracks) {
    const placed: Array<{ it: T; start: number }> = [];
    items.forEach((it, i) => {
      const start = times[i];
      if (start === null || start === undefined) return;
      if (it.placement === "unassigned") return;
      if (it.placement !== "all" && !(it.trackIds ?? []).includes(track.id)) {
        return;
      }
      placed.push({ it, start });
    });
    placed.sort((x, y) => x.start - y.start);
    // 総当たり。長い枠が2つ先の枠と重なる場合があるので隣どうしだけでは足りない
    for (let i = 0; i < placed.length; i++) {
      const a = placed[i]!;
      const end = a.start + a.it.durationMin * 60_000;
      for (let j = i + 1; j < placed.length; j++) {
        const b = placed[j]!;
        // 端が接するだけ（前の終わり＝次の始まり）は重なりではない
        if (b.start >= end) break;
        out.push({ trackName: track.name, a: a.it, b: b.it });
      }
    }
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
