import { useQuery } from "@tanstack/react-query";
import type { EventNameCardsPayload } from "@eventer/shared";
import { api } from "./client.js";

/** 名札の一括印刷 (#304)。参加確定メンバー全員分のカードデータ。
 * 印刷用の静的な一覧なので、他の画面のような定期ポーリングはしない */
export function useEventNameCards(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["eventNameCards", eventId],
    enabled: Boolean(eventId) && enabled,
    queryFn: () =>
      api.get<EventNameCardsPayload>(`/events/${eventId}/name-cards`),
  });
}
