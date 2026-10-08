import { useQuery } from "@tanstack/react-query";
import { api } from "./client.js";
import type {
  CheckinResult,
  CheckinTicket,
  MemberLookupResult,
} from "@eventer/shared";

/** QR受付（入場チェックイン） (#154) */

/** 自分の入場チケット（有効期限3分）。開いたときに1回取る。
 * 自動では更新しない（D-POLL-MIN 第5段階 5b-4）。入口に並ぶ全員の画面が定期に
 * 取り直すと、それだけで大量の読み取りになるため。期限が切れたら画面に
 * 「タップで更新」を出し、本人が押したときだけ取り直す（EntranceQrDialog） */
export function useMyTicket(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "my-ticket"],
    enabled,
    queryFn: () => api.get<CheckinTicket>(`/events/${eventId}/my-ticket`),
    // 期限切れの判定は画面の時計で行う。タブ復帰で勝手に取り直さない
    refetchOnWindowFocus: false,
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
