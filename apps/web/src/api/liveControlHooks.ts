import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LIVE_POLL_MS } from "@eventer/shared";
import type { CutinAction, CutinStatus } from "@eventer/shared";
import type {
  EventLiveState,
  LiveSet,
  UpdateEventLiveStateInput,
} from "@eventer/shared";
import type { Deck, LivePresenter } from "@eventer/shared";
import { api } from "./client.js";

/** コントロールタブが配信状態を取り直す間隔。自分の操作は応答で即時に映るので、
 * 拾うのはもう1人の操作者の変更だけ */
export const LIVE_CONTROL_POLL_MS = 5000;

/** 配信状態（画面タブ・コントロールタブが共有）。
 * - screen（OBS の配信画面）: 1秒・非表示でも継続。配信出力は操作者のシーン切替を
 *   約1秒で反映しなければならず、OBS のブラウザソースは常に hidden 扱いで、誰も触れないため
 * - control（コントロールタブ）: 5秒・表示中だけ。自分の操作は即時に映るので、
 *   もう1人の操作者の変更を拾えれば足りるため */
export function useEventLiveState(eventId: string, page: "screen" | "control") {
  const screen = page === "screen";
  return useQuery({
    queryKey: ["event", eventId, "liveState"],
    enabled: Boolean(eventId),
    refetchInterval: screen ? LIVE_POLL_MS : LIVE_CONTROL_POLL_MS,
    retry: false,
    refetchIntervalInBackground: screen,
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

/** 参戦演出（OBS の配信画面だけが使う）。1秒・非表示でも継続:
 * 演出は時刻合わせで出すので、配信出力が約1秒で拾わないと間に合わず、
 * OBS のブラウザソースは常に hidden 扱いで誰も触れないため */
export function useLiveCutin(eventId: string) {
  return useQuery({
    queryKey: ["event", eventId, "cutin"],
    enabled: Boolean(eventId),
    refetchInterval: LIVE_POLL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    queryFn: () => api.get<CutinStatus>(`/events/${eventId}/live-cutin`, { timeoutMs: 4000 }),
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
