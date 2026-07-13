import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LIVE_POLL_MS } from "@eventer/shared";
import type {
  EventLiveState,
  LiveSet,
  UpdateEventLiveStateInput,
} from "@eventer/shared";
import type { Deck } from "@eventer/shared";
import { api } from "./client.js";

/** 配信状態（画面タブ・コントロールタブが共有。1秒ポーリング） */
export function useEventLiveState(eventId: string, poll = true) {
  return useQuery({
    queryKey: ["event", eventId, "liveState"],
    enabled: Boolean(eventId),
    refetchInterval: poll ? LIVE_POLL_MS : false,
    // OBS取り込み中はタブが背面にあることが多いので、非表示でもポーリング継続
    refetchIntervalInBackground: true,
    queryFn: () => api.get<EventLiveState>(`/events/${eventId}/live-state`),
  });
}

export function useUpdateEventLiveState(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateEventLiveStateInput) =>
      api.patch<EventLiveState>(`/events/${eventId}/live-state`, input),
    onSuccess: (state) => {
      qc.setQueryData(["event", eventId, "liveState"], state);
      qc.invalidateQueries({ queryKey: ["event", eventId, "liveSetContent"] });
    },
  });
}

/** 配信で映すスライド（デッキ）の中身 */
export function useEventLiveDeck(eventId: string, deckId: string | null | undefined) {
  return useQuery({
    queryKey: ["event", eventId, "liveDeck", deckId ?? "none"],
    enabled: Boolean(eventId),
    queryFn: async () =>
      (await api.get<{ deck: Deck | null }>(`/events/${eventId}/live-deck-content`))
        .deck,
  });
}

/** イベントで使う配信セットの中身（未選択時はデフォルトテンプレ） */
export function useEventLiveSetContent(eventId: string, liveSetId: string | null | undefined) {
  return useQuery({
    // liveSetId をキーに含めて切替時に取り直す
    queryKey: ["event", eventId, "liveSetContent", liveSetId ?? "default"],
    enabled: Boolean(eventId),
    queryFn: () => api.get<LiveSet>(`/events/${eventId}/live-set-content`),
  });
}
