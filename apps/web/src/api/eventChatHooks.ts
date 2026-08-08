import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatMembersPayload, OfficialChannelPayload } from "@eventer/shared";
import { api, ApiError } from "./client.js";

/** Nostrイベントチャット (#199) の紐付けAPI。チャット本文はリレー直通でここを通らない */

/** 表示許可リスト＋チャンネルID＋非表示リスト。
 * 新メンバーの鍵や非表示の反映のため定期的に再取得する */
export function useChatMembers(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "chatMembers"],
    enabled: enabled && Boolean(eventId),
    refetchInterval: 5000,
    // 403（繋がせない状態 #283 / 参加確定前）は再試行しても結果が変わらないので
    // 既定の3回リトライを待たずに画面へ返す。ポーリング自体は続くため、
    // 締め出しが解除されれば次の周回で自動的に元に戻る。
    // 403以外は既定のまま: react-query は失敗のたびに 0 から数えた count を渡し、
    // 既定の retry:3 も `count < 3` で判定するので、この式は既定と同じ3回になる
    retry: (count, err) =>
      !(err instanceof ApiError && err.status === 403) && count < 3,
    queryFn: () =>
      api.get<ChatMembersPayload>(`/events/${eventId}/chat-members`),
  });
}

/** サーバー管理の一時鍵 (#223)。未発行・NIP-07登録中（404）は null、それ以外の失敗は throw */
export async function fetchEphemeralChatKey(
  eventId: string,
): Promise<{ secret: string; pubkey: string } | null> {
  try {
    return await api.get<{ secret: string; pubkey: string }>(
      `/events/${eventId}/chat-key/ephemeral`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** 一時鍵を発行して発言鍵として登録（既にあれば同じ鍵が返る） */
export function useCreateEphemeralChatKey(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ secret: string; pubkey: string }>(
        `/events/${eventId}/chat-key/ephemeral`,
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "chatMembers"] }),
  });
}

/** 発言用の公開鍵を登録（再登録で置き換え） */
export function useRegisterChatKey(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (proof: object) =>
      api.post(`/events/${eventId}/chat-key`, { proof }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "chatMembers"] }),
  });
}

/** チャンネルID（kind:40）を登録。先勝ちのため、確定したIDが返る */
export function useRegisterChatChannel(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelEvent: object) =>
      api.post<{ channelId: string | null }>(`/events/${eventId}/chat-channel`, {
        channelEvent,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "chatMembers"] }),
  });
}

/** 公式サービス鍵で署名済みの kind:40 をサーバーに発行してもらう (#199)。
 * 登録はしない（リレーへの受理を確認してから /chat-channel で登録する）。
 * 公式鍵未設定の環境では 503 (service_key_unset) */
export function createOfficialChannelEvent(
  eventId: string,
): Promise<OfficialChannelPayload> {
  return api.post<OfficialChannelPayload>(
    `/events/${eventId}/chat-channel/official`,
  );
}

/** メッセージをアプリ側で非表示にする（staff） */
export function useHideChatNote(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) =>
      api.post(`/events/${eventId}/chat-hidden`, { noteId }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "chatMembers"] }),
  });
}

/** 非表示を解除する（staff） */
export function useUnhideChatNote(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) =>
      api.del(`/events/${eventId}/chat-hidden/${noteId}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "chatMembers"] }),
  });
}

/** チャンネルIDをリセット（staff・部屋の作り直し用） */
export function useResetChatChannel(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del(`/events/${eventId}/chat-channel`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "chatMembers"] }),
  });
}
