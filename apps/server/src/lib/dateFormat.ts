/** 通知文などサーバー生成テキスト用の日時表記（日本時間固定） */
import { DATE_LOCALES, type AppLanguage } from "@eventer/shared/i18n";

const JST = "Asia/Tokyo";

const JST_OFFSET_MS = 9 * 3600_000;
const DAY_MS = 24 * 3600_000;

/**
 * JST の暦日境界 (#411)。`now` が属する JST の日の 0:00 から
 * `deltaDays` 日後の境界を epoch ms で返す（0=今日の0:00、1=明日の0:00）。
 *
 * リマインダーの「明日/本日」判定はすべてこの境界から導く。
 * JST は夏時間が無いので固定オフセットで計算してよい。
 */
export function jstDayStart(now: number, deltaDays = 0): number {
  const dayIndex = Math.floor((now + JST_OFFSET_MS) / DAY_MS);
  return (dayIndex + deltaDays) * DAY_MS - JST_OFFSET_MS;
}

/** 開催日時の範囲（日本時間）。並びは受け取る人の言語 (#352)。省くと日本語 */
export function formatDateRange(startsAt: number, endsAt: number, lang: AppLanguage = "ja"): string {
  const locale = DATE_LOCALES[lang];
  // 英語も24時間表記（日本時間の表記なので、会場の掲示と同じ並びにする）。日本語は既定のまま
  const clock = lang === "ja" ? {} : { hourCycle: "h23" as const };
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: JST,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).format(d);
  const sameDay = dayKey(s) === dayKey(e);

  const start = new Intl.DateTimeFormat(locale, {
    timeZone: JST,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...clock,
  }).format(s);
  const end = new Intl.DateTimeFormat(
    locale,
    sameDay
      ? { timeZone: JST, hour: "2-digit", minute: "2-digit", ...clock }
      : {
          timeZone: JST,
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          ...clock,
        },
  ).format(e);
  // 英語の範囲は en dash（「〜」は日本語の記号）
  return lang === "ja" ? `${start} 〜 ${end}` : `${start} – ${end}`;
}
