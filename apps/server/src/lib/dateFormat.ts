/** 通知文などサーバー生成テキスト用の日時表記（日本時間固定） */

const JST = "Asia/Tokyo";

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
