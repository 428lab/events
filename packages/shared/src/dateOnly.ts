/**
 * 「日」だけの日付 `'YYYY-MM-DD'` の計算。**時刻もタイムゾーンも持たない。**
 *
 * KPI の推移 (#266) と準備 TODO (#393) の両方がこの形の日付を使う。
 * 同じ加減算を2か所に書くと必ず片方だけ直る（`addDays` が実際に2つ生えかけた）ので、
 * **実装はここ1つだけ**にして、意味づけ（KPI は JST の日、TODO は
 * 「誰のカレンダーでもない日」）は呼び出す側が持つ。
 *
 * 計算は UTC に固定しているので、実行環境のタイムゾーンで結果が変わらない。
 */

export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 'YYYY-MM-DD' → UTC の epoch ms（**内部計算専用**。外に出さない） */
function toUtcMs(date: string): number {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
}

/**
 * 実在する日付か。形だけでなく**暦として在るか**まで見る。
 * `2026-02-31` は形を満たすが実在しない。素通しすると `addDays` が黙って
 * 3/3 を返し、ガントの帯が入力と別の場所に出る。
 */
export function isDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7));
  const d = Number(value.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** 日を足す（負数で引く）。`addDays('2028-02-28', 1) === '2028-02-29'`（閏年） */
export function addDays(day: string, delta: number): string {
  const dt = new Date(toUtcMs(day) + delta * DAY_MS);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** `to - from` の日数。同じ日なら 0、翌日なら 1 */
export function diffDays(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** 曜日（0=日曜〜6=土曜）。ガントの週末の網掛けに使う */
export function dayOfWeek(day: string): number {
  return new Date(toUtcMs(day)).getUTCDay();
}

/**
 * 見ている人の「今日」を 'YYYY-MM-DD' で。**ローカル時刻から作る。**
 *
 * 準備 TODO の遅れの判定は見ている人の今日で行う (#393 設計 3.7)。
 * サーバーの時計とタイムゾーンを1つ決めると「日だけを持つ」決定と矛盾する。
 */
export function todayDateOnly(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}
