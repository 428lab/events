/** 通知文などサーバー生成テキスト用の日時表記（日本時間固定） */

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

export function formatDateRangeJa(startsAt: number, endsAt: number): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: JST,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).format(d);
  const sameDay = dayKey(s) === dayKey(e);

  const start = new Intl.DateTimeFormat("ja-JP", {
    timeZone: JST,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(s);
  const end = new Intl.DateTimeFormat(
    "ja-JP",
    sameDay
      ? { timeZone: JST, hour: "2-digit", minute: "2-digit" }
      : {
          timeZone: JST,
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        },
  ).format(e);
  return `${start} 〜 ${end}`;
}
