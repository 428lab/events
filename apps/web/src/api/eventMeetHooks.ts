import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  MeetScanResult,
  MeetToken,
  MeetUndoInput,
  MeetableEvent,
} from "@eventer/shared";
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

/** QRを描き替える間隔（ミリ秒）。サーバー側の有効期限より十分短く保つこと
 * （apps/server/src/lib/meetToken.ts の MEET_TOKEN_REFRESH_SEC と対応） */
export const MEET_TOKEN_REFRESH_MS = 30_000;

/** 自分のQRに載せる使い捨てトークン (#330)。
 * 表示は出しっぱなしになるので、開いている間は一定間隔で取り直して描き替える */
export function useMyMeetToken(enabled: boolean) {
  return useQuery({
    queryKey: ["meet-token"],
    enabled,
    queryFn: () => api.get<MeetToken>("/meet/token"),
    refetchInterval: enabled ? MEET_TOKEN_REFRESH_MS : false,
    // 画面を消して戻したときも即座に新しいものにする
    refetchOnWindowFocus: true,
    // 前の（古い）トークンを表示し続けないよう保持しない
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
}

/** QRを読み取ったその場での出会い記録 (#330) */
export function useMeetScan() {
  return useMutation({
    mutationFn: (token: string) =>
      api.post<MeetScanResult>("/meet/scan", { token }),
  });
}

/** 読み取りの取り消し (#330)。誤って読み取ったとき用 */
export function useMeetUndo() {
  return useMutation({
    mutationFn: (input: MeetUndoInput) =>
      api.post<{ undone: number }>("/meet/undo", input),
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
