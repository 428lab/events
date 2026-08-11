import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SaveScheduleItemInput, ScheduleItem } from "@eventer/shared";
import { api } from "./client.js";

export function useEventSchedule(eventId: string) {
  return useQuery({
    queryKey: ["event", eventId, "timetable"],
    enabled: Boolean(eventId),
    queryFn: async () =>
      (await api.get<{ items: ScheduleItem[] }>(`/events/${eventId}/timetable`))
        .items,
  });
}

/** タイムテーブルの保存（全項目を送り、サーバーが差分で反映する。staff のみ #340）。
 * 既存項目は id を付けて送ること。付けないと削除＋新規追加になり ID が変わる */
export function useSaveEventSchedule(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: SaveScheduleItemInput[]) =>
      api.put<{ items: ScheduleItem[] }>(`/events/${eventId}/timetable`, {
        items,
      }),
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
