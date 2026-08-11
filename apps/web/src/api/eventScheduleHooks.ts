import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SCHEDULE_EDIT_POLL_MS } from "@eventer/shared";
import type {
  EventTrack,
  SaveScheduleInput,
  ScheduleEditingState,
  ScheduleItem,
} from "@eventer/shared";
import { api } from "./client.js";

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
 * useHoldScheduleEditing に任せて、こちらは止める（同じ間隔で二重に取りに行かない） */
export function useScheduleEditingState(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: EDITING_KEY(eventId),
    enabled: enabled && Boolean(eventId),
    refetchInterval: SCHEDULE_EDIT_POLL_MS,
    queryFn: () =>
      api.get<ScheduleEditingState>(`/events/${eventId}/timetable/editing`),
  });
}

/** 編集画面を開いている間、「自分が編集中」と言い続ける (#340)。
 *
 * 取りに行くのと心拍が同じ1本なのは、**間隔をずらす理由が無い**ため。
 * 返ってくるのは反映後の状態なので、先に他の人が編集中だった場合は
 * その人の名前がそのまま返る（奪わない）。
 *
 * 画面を閉じたら宣言を外す。外し損ねても SCHEDULE_EDIT_EXPIRE_MS で自動的に空く */
export function useHoldScheduleEditing(eventId: string) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: [...EDITING_KEY(eventId), "hold"],
    enabled: Boolean(eventId),
    refetchInterval: SCHEDULE_EDIT_POLL_MS,
    // 背面のタブでも心拍を続ける（前面に戻すまで他の人に「空き」と見せないため）。
    // ブラウザ側の間引きがあるので、期限は心拍間隔よりずっと長く取ってある
    refetchIntervalInBackground: true,
    queryFn: () =>
      api.post<ScheduleEditingState>(`/events/${eventId}/timetable/editing`),
  });
  useEffect(() => {
    if (!eventId) return;
    return () => {
      // 片付けなので失敗は無視してよい（期限切れで自動的に空く）
      void api
        .del(`/events/${eventId}/timetable/editing`)
        .catch(() => {})
        .finally(() => qc.invalidateQueries({ queryKey: EDITING_KEY(eventId) }));
    };
  }, [eventId, qc]);
  return q;
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
