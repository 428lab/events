/**
 * 数字ビンゴ (#436)。設計は docs/bingo.md。
 *
 * カード・判定の**契約はこのファイルの1か所**に置き、server（正の判定）と
 * web（表示）が同じ関数を使う。達成テーブルは持たず、
 * 「公開済みの番号列 × カード配置」からすべて導出する。
 */

/** 列ごとの数字範囲（標準ルール）。B:1-15 / I:16-30 / N:31-45 / G:46-60 / O:61-75 */
export const BINGO_COLUMN_RANGES: ReadonlyArray<readonly [number, number]> = [
  [1, 15],
  [16, 30],
  [31, 45],
  [46, 60],
  [61, 75],
];

/** 列見出し（表示用） */
export const BINGO_COLUMNS = ["B", "I", "N", "G", "O"] as const;

/** 抽選で引ける番号の総数 */
export const BINGO_MAX_NUMBER = 75;

/** ゲームの状態。setup=受付中（カード発行可・抽選前）/ running / ended */
export const BINGO_STATUSES = ["setup", "running", "ended"] as const;
export type BingoGameStatus = (typeof BINGO_STATUSES)[number];

/** 参加者・投影がポーリングする間隔（出会いランキング #418 と同じ5秒） */
export { MEET_RANKING_POLL_MS as BINGO_POLL_MS } from "./eventMeets.js";

/**
 * カードは24個の数字の配列で持つ（5x5・中央FREEを除く・**列優先**）。
 * 添字: 列 c(0..4) × 行 r(0..4) を c*5+r で数え、中央 (c=2,r=2)=12 を飛ばして詰める。
 * セル添字(0..24) → 配列添字は cellToCardIndex で引く（FREE は null）。
 */
export const BINGO_FREE_CELL = 12;

/** セル添字(0..24・列優先) → カード配列の添字（FREE は null） */
export function cellToCardIndex(cell: number): number | null {
  if (cell === BINGO_FREE_CELL) return null;
  return cell < BINGO_FREE_CELL ? cell : cell - 1;
}

/** 役物の12ライン（縦5・横5・斜め2）。値はセル添字（列優先 c*5+r） */
export const BINGO_LINES: ReadonlyArray<ReadonlyArray<number>> = (() => {
  const lines: number[][] = [];
  for (let c = 0; c < 5; c++) lines.push([0, 1, 2, 3, 4].map((r) => c * 5 + r));
  for (let r = 0; r < 5; r++) lines.push([0, 1, 2, 3, 4].map((c) => c * 5 + r));
  lines.push([0, 1, 2, 3, 4].map((i) => i * 5 + i));
  lines.push([0, 1, 2, 3, 4].map((i) => i * 5 + (4 - i)));
  return lines;
})();

/** カード1枚の導出結果 */
export interface BingoDerived {
  /** セルごと（0..24・列優先）にマーク済みか。FREE は常に true */
  marked: boolean[];
  /** いずれかのラインが完成しているか */
  bingo: boolean;
  /** 完成ラインは無いが、あと1マスのラインがあるか */
  reach: boolean;
  /** 最初にラインが完成した抽選手番（1始まり）。未完成は null。
   * 達成順はこの値の昇順・競技順位（同じ手番で完成した人は同順位） */
  completedAtSeq: number | null;
}

/**
 * カード×公開済み番号列から判定を導出する（達成は保存しない。docs/bingo.md §3.5）。
 * @param numbers カードの24個（列優先・FREE抜き）
 * @param drawn   公開済みの番号（引いた順。添字+1 が手番）
 */
export function deriveBingoCard(
  numbers: ReadonlyArray<number>,
  drawn: ReadonlyArray<number>,
): BingoDerived {
  // 番号 → 手番（1始まり）。FREE は手番0（最初から埋まっている）
  const seqOf = new Map<number, number>();
  drawn.forEach((n, i) => seqOf.set(n, i + 1));

  const cellSeq: number[] = []; // セルごとの「埋まった手番」。未マークは Infinity
  const marked: boolean[] = [];
  for (let cell = 0; cell < 25; cell++) {
    const idx = cellToCardIndex(cell);
    const seq = idx === null ? 0 : (seqOf.get(numbers[idx]!) ?? Infinity);
    cellSeq.push(seq);
    marked.push(seq !== Infinity);
  }

  let completedAtSeq: number | null = null;
  let reach = false;
  for (const line of BINGO_LINES) {
    const seqs = line.map((cell) => cellSeq[cell]!);
    const unmarkedCount = seqs.filter((s) => s === Infinity).length;
    if (unmarkedCount === 0) {
      // ラインの完成手番 = ライン内で最後に埋まったセルの手番
      const at = Math.max(...seqs);
      if (completedAtSeq === null || at < completedAtSeq) completedAtSeq = at;
    } else if (unmarkedCount === 1) {
      reach = true;
    }
  }
  return {
    marked,
    bingo: completedAtSeq !== null,
    reach: completedAtSeq === null && reach,
    completedAtSeq,
  };
}

/** GET /api/events/:id/bingo のレスポンス（参加者向け）。
 * 他人由来の値は人数（counts）だけ。"none" は staff にだけ返る（ゲーム作成前） */
export interface BingoState {
  status: "none" | BingoGameStatus;
  /** 公開済みの番号（引いた順）。setup では空 */
  drawnNumbers: number[];
  /** 発行済みカード数・ビンゴ人数・リーチ人数 */
  counts: { cards: number; bingo: number; reach: number };
  /** 自分のカード（未発行は null） */
  card: number[] | null;
  /** 自分の判定（カードが無ければ null）。rank は競技順位（ビンゴ時のみ） */
  me: { bingo: boolean; reach: boolean; rank: number | null } | null;
}

/** staff 用: カード保有者1人ぶんの導出行（読み上げ・デスク用） */
export interface BingoStatusRow {
  userId: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  bingo: boolean;
  reach: boolean;
  completedAtSeq: number | null;
  /** ビンゴ達成者のみ。競技順位（同じ手番は同順位） */
  rank: number | null;
}

/** GET /api/events/:id/bingo/status のレスポンス（staff のみ） */
export interface BingoStatus {
  status: "none" | BingoGameStatus;
  drawnNumbers: number[];
  counts: { cards: number; bingo: number; reach: number };
  /** 全カード保有者。ビンゴ（rank順）→ リーチ → その他の順 */
  rows: BingoStatusRow[];
}
