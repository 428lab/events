import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatMembersPayload } from "@eventer/shared";
import { api } from "./client.js";

/** Nostrイベントチャット (#199) の紐付けAPI。チャット本文はリレー直通でここを通らない */

/** 表示許可リスト＋チャンネルID＋非表示リスト。
 * 新メンバーの鍵や非表示の反映のため定期的に再取得する */
export function useChatMembers(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "chatMembers"],
    enabled: enabled && Boolean(eventId),
    refetchInterval: 5000,
    queryFn: () =>
      api.get<ChatMembersPayload>(`/events/${eventId}/chat-members`),
  });
}

/** 発言用の公開鍵を登録（再登録で置き換え） */
export function useRegisterChatKey(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pubkey: string) =>
      api.post(`/events/${eventId}/chat-key`, { pubkey }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "chatMembers"] }),
  });
}

/** チャンネルID（kind:40）を登録。先勝ちのため、確定したIDが返る */
export function useRegisterChatChannel(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) =>
      api.post<{ channelId: string | null }>(`/events/${eventId}/chat-channel`, {
        channelId,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "chatMembers"] }),
  });
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
