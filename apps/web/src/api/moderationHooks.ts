import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ChatAuthorBlockInput,
  ModerationActionInput,
  ModerationContentPayload,
  ModerationEventsPayload,
} from "@eventer/shared";
import { api } from "./client.js";

/** 運営によるイベント内コンテンツの非表示 (#278)。app admin 専用。
 * イベントのスタッフによる削除とは別系統で、こちらは消さずに非表示にする */

/** 対処するイベントを探す。userId は要確認リスト (#259) からの導線 */
export function useModerationEvents(
  enabled: boolean,
  { userId, q }: { userId: string; q: string },
) {
  return useQuery({
    queryKey: ["moderationEvents", userId, q],
    enabled: enabled && Boolean(userId || q),
    queryFn: () => {
      const params = new URLSearchParams();
      if (userId) params.set("userId", userId);
      if (q) params.set("q", q);
      return api.get<ModerationEventsPayload>(
        `/admin/moderation/events?${params}`,
      );
    },
  });
}

/** イベント内のコンテンツ一式（非表示にしたものも含む） */
export function useModerationContent(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["moderationContent", eventId],
    enabled: enabled && Boolean(eventId),
    queryFn: () =>
      api.get<ModerationContentPayload>(
        `/admin/moderation/events/${eventId}`,
      ),
  });
}

/** 非表示にする / 復元する */
export function useModerateContent(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      action,
      ...input
    }: ModerationActionInput & { action: "hide" | "restore" }) =>
      api.post<{ ok: boolean; changed: boolean }>(
        `/admin/moderation/events/${eventId}/${action}`,
        input,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["moderationContent", eventId] });
    },
  });
}

/** 発言者単位の締め出し / 解除 (#283)。
 * 1件ずつの非表示と違い、その発言者のこのイベントでの発言がまとめて表示されなくなる */
export function useBlockChatAuthor(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      action,
      pubkey,
    }: ChatAuthorBlockInput & { action: "block" | "unblock" }) =>
      api.post<{ ok: boolean; changed: boolean }>(
        `/admin/moderation/events/${eventId}/chat-authors/${action}`,
        { pubkey },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["moderationContent", eventId] });
    },
  });
}
