import { useQuery } from "@tanstack/react-query";
import { api } from "./client.js";
import type {
  CheckinResult,
  CheckinTicket,
  MemberLookupResult,
} from "@eventer/shared";

/** QR受付（入場チェックイン） (#154) */

/** 自分の入場チケット。60秒ごとに再取得して QR を常に新鮮に保つ（有効期限は3分） */
export function useMyTicket(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "my-ticket"],
    enabled,
    queryFn: () => api.get<CheckinTicket>(`/events/${eventId}/my-ticket`),
    refetchInterval: 60_000,
    // 閉じて開き直したときに古いチケットを見せない
    gcTime: 0,
    staleTime: 0,
  });
}

/** 入場チケットの検証＋出席記録（staff） */
export function postCheckin(
  eventId: string,
  token: string,
): Promise<CheckinResult> {
  return api.post<CheckinResult>(`/events/${eventId}/checkin`, { token });
}

/** プロフィールQRからのメンバー照会（staff） */
export function lookupMember(
  eventId: string,
  handle: string,
): Promise<MemberLookupResult> {
  return api.get<MemberLookupResult>(
    `/events/${eventId}/member-lookup?handle=${encodeURIComponent(handle)}`,
  );
}
