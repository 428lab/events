import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  EventTrack,
  SaveScheduleInput,
  ScheduleItem,
} from "@eventer/shared";
import { api } from "./client.js";

/** タイムテーブルの取得結果。トラック (#338) は時刻の計算に要るので一緒に返る */
export interface EventTimetable {
  items: ScheduleItem[];
  tracks: EventTrack[];
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
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "timetable"] }),
  });
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
