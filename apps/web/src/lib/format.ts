import type { EventRole, VenueType } from "@eventer/shared";

export function formatDateRange(startsAt: number, endsAt: number): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const sameDay =
    s.getFullYear() === e.getFullYear() &&
    s.getMonth() === e.getMonth() &&
    s.getDate() === e.getDate();
  const sameYear = s.getFullYear() === e.getFullYear();

  // 開始は常に年つき
  const start = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(s);

  // 終了は重複を避けて簡潔に（同日→時刻のみ / 同年→月日＋時刻 / 別年→年つき）
  const end = new Intl.DateTimeFormat(
    "ja-JP",
    sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : sameYear
        ? { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }
        : {
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          },
  ).format(e);

  return `${start} 〜 ${end}`;
}

/** 単一日時を日本語表記（年つき） */
export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

/** epoch ms → datetime-local の value（ローカル時刻 "YYYY-MM-DDTHH:mm"） */
export function toDateTimeLocal(ms: number | null | undefined): string {
  if (!ms) return "";
  const off = new Date(ms).getTimezoneOffset();
  return new Date(ms - off * 60000).toISOString().slice(0, 16);
}

/** datetime-local の value → epoch ms（空なら null） */
export function fromDateTimeLocal(s: string): number | null {
  if (!s) return null;
  const ms = new Date(s).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export const roleLabel: Record<EventRole, string> = {
  participant: "参加者",
  staff: "スタッフ",
  judge: "審査員",
  observer: "観覧者",
};

export const venueLabel: Record<VenueType, string> = {
  offline: "オフライン",
  online: "オンライン",
  hybrid: "ハイブリッド",
};
