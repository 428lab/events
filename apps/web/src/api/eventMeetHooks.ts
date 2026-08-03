import { useMutation, useQuery } from "@tanstack/react-query";
import type { MeetableEvent } from "@eventer/shared";
import { api } from "./client.js";

/** いま「出会った」を記録できる共通イベント (#189)。
 * 他人のプロフィールをログイン中に見ているときだけ enabled にすること */
export function useMeetableEvents(targetUserId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["meetable", targetUserId],
    enabled: enabled && Boolean(targetUserId),
    queryFn: async () =>
      (
        await api.get<{ events: MeetableEvent[] }>(
          `/users/${targetUserId}/meetable`,
        )
      ).events,
  });
}

/** 出会いの記録 (#189)。created=false は同じペアで記録済み（冪等） */
export function useRecordMeet() {
  return useMutation({
    mutationFn: (input: { eventId: string; userId: string }) =>
      api.post<{ created: boolean; meets: number }>(
        `/events/${input.eventId}/meet`,
        { userId: input.userId },
      ),
  });
}

/** 出会い数ランキング（スタッフ運営用） */
export interface MeetRankingRow {
  userId: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  count: number;
}
export function useMeetRanking(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "meet-ranking"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () =>
      api.get<{ ranking: MeetRankingRow[] }>(`/events/${eventId}/meets/ranking`),
  });
}
