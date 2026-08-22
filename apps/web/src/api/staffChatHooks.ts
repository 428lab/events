import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StaffChatPayload } from "@eventer/shared";
import { api, ApiError } from "./client.js";

/** スタッフチャット (#382) の鍵配布 API。本文はリレー直通でここを通らない。
 * どちらも staff ゲートの中: staff でなければ一律 403（部屋の有無は返らない） */

/** 部屋の鍵一式（roomId・全世代の共通鍵・自分の signer・表示許可リスト）。
 * 未開設（404）は null。定期的に取り直して、ローテーション（keys の増加）・
 * メンバー変化・自分の資格喪失（403 になる）を拾う（設計 8） */
export function useStaffChat(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "staffChat"],
    enabled: enabled && Boolean(eventId),
    refetchInterval: 5000,
    // 403（資格喪失）は再試行しても結果が変わらないので既定の3回リトライを
    // 待たずに画面へ返す。ポーリング自体は続くため、staff に戻れば次の周回で
    // 自動的に元に戻る（eventChatHooks の useChatMembers と同じ判断）
    retry: (count, err) =>
      !(err instanceof ApiError && err.status === 403) && count < 3,
    queryFn: async (): Promise<StaffChatPayload | null> => {
      try {
        return await api.get<StaffChatPayload>(`/events/${eventId}/staff-chat`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  });
}

/** 部屋・v1 鍵・自分の signer を無ければ作る（先勝ち・冪等）。
 * 初めて開いたとき（部屋が無い/自分の鍵が無い/失効から復帰した）に呼ぶ */
export function useOpenStaffChat(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<StaffChatPayload>(`/events/${eventId}/staff-chat`),
    onSuccess: (payload) =>
      qc.setQueryData(["event", eventId, "staffChat"], payload),
  });
}
