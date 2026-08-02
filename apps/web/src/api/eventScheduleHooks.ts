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

/** タイムテーブルの一括保存（全置き換え。staff のみ） */
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
