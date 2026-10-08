import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CutinAction } from "@eventer/shared";
import type {
  EventLiveState,
  EventLiveStateWithCutin,
  LiveSet,
  UpdateEventLiveStateInput,
} from "@eventer/shared";
import type { Deck, LivePresenter } from "@eventer/shared";
import { api } from "./client.js";
import { useEventSignal } from "../lib/signalHub.js";

/** 配信状態（画面タブ・コントロールタブが共有）。定期には取り直さない（D-POLL-MIN 第5段階 5b-2）。
 * 応答の `signal`（topic `live`）の合図で1回取り直す。合図はリレーから届くメッセージで動くので、
 * OBS のブラウザソース（常に hidden 扱い）でもタイマーの間引きを受けない。
 *
 * `current` は「最後の取得が成功し、合図の購読がつながっているリレーで EOSE まで来ている」。
 * 配信画面はこれが立っている間だけチャット・参戦演出・LIVE 表示を出す（届かない経路のまま
 * 古い状態を出し続けない）。応答には参戦演出の状態 (`cutin`) も入る (D-POLL-MIN S7) */
export function useEventLiveState(eventId: string) {
  const query = useQuery({
    queryKey: ["event", eventId, "liveState"],
    enabled: Boolean(eventId),
    retry: false,
    queryFn: () => api.get<EventLiveStateWithCutin>(`/events/${eventId}/live-state`),
  });
  const { synced } = useEventSignal(query.data?.signal, () => query.refetch(), { eventId });
  return { ...query, current: synced && !query.isError && query.dataUpdatedAt > 0 };
}

export function useUpdateEventLiveState(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateEventLiveStateInput) =>
      api.patch<EventLiveState>(`/events/${eventId}/live-state`, input),
    onSuccess: (state) => {
      // PATCH の応答は演出と合図の購読先を含まない。直前に取得したものはそのまま残す
      qc.setQueryData<EventLiveStateWithCutin>(["event", eventId, "liveState"], (prev) => ({ ...state, cutin: prev?.cutin ?? null, signal: prev?.signal }));
      qc.invalidateQueries({ queryKey: ["event", eventId, "liveSetContent"] });
    },
  });
}

export const cutinApi = {
  trigger: (eventId: string, body: { message: string }) => api.post<CutinAction & { serverNow: number }>(`/events/${eventId}/live-cutin`, body),
};

/** 発表者一覧 (#571)。タイムテーブルの担当者付きコマと、本人が紐付けたデッキの要約（slug なし）。
 * 定期の取り直しはしない（D-POLL-MIN）。登壇者が当日に紐付けを直したら、操作者のタブ復帰で拾う */
export function useLivePresenters(eventId: string) {
  return useQuery({
    queryKey: ["event", eventId, "livePresenters"],
    enabled: Boolean(eventId),
    refetchOnWindowFocus: true,
    queryFn: async () =>
      (await api.get<{ presenters: LivePresenter[] }>(`/events/${eventId}/live-presenters`)).presenters,
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
