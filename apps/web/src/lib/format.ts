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
