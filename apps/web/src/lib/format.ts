import type { EventRole, VenueType } from "@eventer/shared";

export function formatDateRange(startsAt: number, endsAt: number): string {
  const fmt = new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${fmt.format(startsAt)} 〜 ${fmt.format(endsAt)}`;
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
