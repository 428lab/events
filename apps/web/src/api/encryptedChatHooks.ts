import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EncryptedChatPayload } from "@eventer/shared";
import { api, ApiError } from "./client.js";

/** 参加者の暗号化チャット (#582) の鍵配布 API。本文はリレー直通でここを通らない。
 * ゲートは参加確定メンバーだけ（管理者のバイパスも無い）。資格が無ければ一律 403。
 * キーは ["event", id, ...] の下に置く: 閲覧権の失効・アカウント切替で
 * eventAccessLifecycle が鍵ごと捨てる（設計 5.2） */

export function encryptedChatQueryKey(eventId: string) {
  return ["event", eventId, "encryptedChat"] as const;
}

export function fetchEncryptedChat(
  eventId: string,
): Promise<EncryptedChatPayload | null> {
  return api
    .get<EncryptedChatPayload>(`/events/${eventId}/encrypted-chat`)
    .catch((err: unknown) => {
      // 部屋が未開設（初回の POST 前）
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    });
}

/** 部屋の鍵一式。5秒ごとに取り直して、ローテーション（keys の増加）・
 * メンバー変化・自分の資格喪失（403）を拾う（設計 3.2 / 4.1）。
 * 取得するたびにサーバー側で資格の照合（遅延ローテーション）が走る */
export function useEncryptedChat(
  eventId: string,
  enabled: boolean,
  failClosed = false,
) {
  return useQuery({
    queryKey: encryptedChatQueryKey(eventId),
    enabled: enabled && Boolean(eventId),
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
    // 403（資格喪失）は再試行しても結果が変わらない。ポーリングは続くので
    // 資格が戻れば次の周回で元に戻る（useChatMembers と同じ判断）
    retry: (count, err) =>
      !failClosed &&
      !(err instanceof ApiError && [401, 403, 404].includes(err.status)) &&
      count < 3,
    queryFn: () => fetchEncryptedChat(eventId),
  });
}

/** 部屋・v1 鍵・自分の signer を無ければ作る（先勝ち・冪等）。
 * 初めて開いたとき・失効から復帰したとき（myKey が null）に呼ぶ */
export function useOpenEncryptedChat(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<EncryptedChatPayload>(`/events/${eventId}/encrypted-chat`),
    onSuccess: (payload) =>
      qc.setQueryData(encryptedChatQueryKey(eventId), payload),
  });
}
