import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SCHEDULE_EDIT_RENEW_MS } from "@eventer/shared";
import type {
  EventTrack,
  LiveDeckSummary,
  SaveScheduleInput,
  ScheduleEditingState,
  ScheduleItem,
} from "@eventer/shared";
import { api } from "./client.js";
import { useEventSignal } from "../lib/signalHub.js";

/** タイムテーブルの取得結果。トラック (#338) は時刻の計算に要るので一緒に返る */
export interface EventTimetable {
  items: ScheduleItem[];
  tracks: EventTrack[];
  /** 読んだ時点の版 (#340)。保存時にそのまま送り返す */
  version: number;
}

export function useEventSchedule(eventId: string) {
  return useQuery({
    queryKey: ["event", eventId, "timetable"],
    enabled: Boolean(eventId),
    queryFn: () => api.get<EventTimetable>(`/events/${eventId}/timetable`),
  });
}

/** タイムテーブルの保存（全項目を送り、サーバーが差分で反映する。staff のみ #340）。
 * 既存項目・既存トラックは id を付けて送ること。付けないと削除＋新規追加になり
 * ID が変わる（トラックの割り当て #338 もその時点で消える） */
export function useSaveEventSchedule(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveScheduleInput) =>
      api.put<EventTimetable>(`/events/${eventId}/timetable`, input),
    // 保存の返りが**そのまま保存後の姿**（項目・トラック・進んだ版）なので、
    // 取り直さずにそれを置く。取り直しに任せると、届くまでの間だけ古い版が
    // 残り、その隙に編集し直した人が自分の保存に弾かれる（誰とも衝突して
    // いないのに 409 になり、保存ボタンも押せなくなって行き止まりになる）
    onSuccess: (saved) =>
      qc.setQueryData(["event", eventId, "timetable"], saved),
  });
}

/* ===== 編集中ステータス (#340) ===== */

const EDITING_KEY = (eventId: string) => ["event", eventId, "scheduleEditing"];

/** 誰かがタイムテーブルを編集中か（見るだけ）。編集できる人にしか返らないので、
 * staff の画面でだけ有効にする。編集画面を開いている間は下の
 * useHoldScheduleEditing に任せて、こちらは止める。
 * 定期の取り直しはしない（D-POLL-MIN）。開いたとき・タブ復帰と、編集中の人や版が
 * 変わったときの合図（topic `schedule-editing`、第5段階 5b-4）で取り直す。
 * 宣言の期限切れは応答の `expiresAt` を見て画面側で判断する */
export function useScheduleEditingState(eventId: string, enabled: boolean) {
  const query = useQuery({
    queryKey: EDITING_KEY(eventId),
    enabled: enabled && Boolean(eventId),
    refetchOnWindowFocus: true,
    queryFn: () =>
      api.get<ScheduleEditingState>(`/events/${eventId}/timetable/editing`),
  });
  const { refetch } = query;
  useEventSignal(enabled ? query.data?.signal : null, () => refetch(), { eventId });
  return query;
}

/** ページを離れる（タブを閉じる・別サイトへ移る）ときに編集中の宣言を外す。
 * アンマウントの片付けは走らないので、keepalive の fetch で送る（応答は読まない） */
function releaseOnPageHide(eventId: string) {
  void fetch(`/api/events/${eventId}/timetable/editing`, {
    method: "DELETE",
    credentials: "include",
    keepalive: true,
  }).catch(() => {});
}

/** 編集画面を開いている間の「自分が編集中」の宣言 (#340)。
 *
 * 定期の心拍はしない（D-POLL-MIN 第5段階 5b-4）。宣言するのは次のときだけ:
 * - 編集画面を開いたとき
 * - 実際に編集したとき（`touch`）。前の宣言から SCHEDULE_EDIT_RENEW_MS 経っているか、
 *   いまの持ち主が自分でないときに限る
 * 手を止めた人の宣言は SCHEDULE_EDIT_EXPIRE_MS で自然に空く。閉じた・保存した
 * （保存すると画面が閉じる）・ページを離れたときは、その場で外す。
 *
 * 返ってくるのは反映後の状態なので、先に他の人が編集中だった場合は
 * その人の名前がそのまま返る（奪わない）。他の人が編集を始めた・やめた・保存したら
 * 合図（topic `schedule-editing`）が来るので、そのときは状態を読み直す（宣言はしない） */
export function useHoldScheduleEditing(eventId: string) {
  const qc = useQueryClient();
  const holdKey = [...EDITING_KEY(eventId), "hold"];
  const lastClaimAt = useRef(0);
  const claiming = useRef(false);
  const q = useQuery({
    queryKey: holdKey,
    enabled: Boolean(eventId),
    // 宣言は開いたときと編集したときだけ。タブ復帰で宣言し直さない
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    queryFn: async () => {
      const state = await api.post<ScheduleEditingState>(`/events/${eventId}/timetable/editing`);
      lastClaimAt.current = Date.now();
      return state;
    },
  });
  useEventSignal(q.data?.signal, async () => {
    const state = await api.get<ScheduleEditingState>(`/events/${eventId}/timetable/editing`);
    qc.setQueryData(holdKey, state);
  }, { eventId });

  const holder = q.data?.editor?.userId ?? null;
  /** 編集した。宣言が古い・自分が持ち主でないときだけ宣言し直す（奪いはしない） */
  const touch = useCallback(
    (myId: string | undefined) => {
      if (!eventId || claiming.current) return;
      const stale = Date.now() - lastClaimAt.current >= SCHEDULE_EDIT_RENEW_MS;
      if (!stale && holder === myId) return;
      claiming.current = true;
      void api
        .post<ScheduleEditingState>(`/events/${eventId}/timetable/editing`)
        .then((state) => {
          lastClaimAt.current = Date.now();
          qc.setQueryData([...EDITING_KEY(eventId), "hold"], state);
        })
        // 宣言は助言でしかないので、失敗しても編集は続けられる（次の編集で再び試す）
        .catch(() => {})
        .finally(() => {
          claiming.current = false;
        });
    },
    [eventId, holder, qc],
  );

  useEffect(() => {
    if (!eventId) return;
    const onPageHide = () => releaseOnPageHide(eventId);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      // 片付けなので失敗は無視してよい（期限切れで自動的に空く）
      void api
        .del(`/events/${eventId}/timetable/editing`)
        .catch(() => {})
        .finally(() => qc.invalidateQueries({ queryKey: EDITING_KEY(eventId) }));
    };
  }, [eventId, qc]);
  return { ...q, touch };
}

/** 登壇資料URLの更新（登壇者本人の自己編集 #148） */
export function useUpdateScheduleMaterial(eventId: string, itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (materialUrl: string) =>
      api.patch<{ item: ScheduleItem }>(
        `/events/${eventId}/timetable/${itemId}/material`,
        { materialUrl },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "timetable"] }),
  });
}

/** 配信用デッキの紐付け (#571)。deckId を渡せば付ける（本人だけ）、null なら外す（本人か staff） */
export function useSetScheduleLiveDeck(eventId: string, itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deckId: string | null) =>
      api.put<{ liveDeck: LiveDeckSummary | null }>(
        `/events/${eventId}/timetable/${itemId}/live-deck`,
        { deckId },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", eventId, "timetable"] });
      qc.invalidateQueries({ queryKey: ["event", eventId, "livePresenters"] });
    },
  });
}
