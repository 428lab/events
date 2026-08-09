import { useMutation, useQuery } from "@tanstack/react-query";
import type { MeetScanResult, MeetToken } from "@eventer/shared";
import { api } from "./client.js";

/** QRを描き替える間隔（ミリ秒）。サーバー側の有効期限より十分短く保つこと
 * （apps/server/src/lib/meetToken.ts の MEET_TOKEN_REFRESH_SEC と対応） */
export const MEET_TOKEN_REFRESH_MS = 30_000;

/** 会場の電波が悪いときに待ち続けないための上限（ミリ秒）。
 * これを過ぎたら打ち切って、画面から再試行できるようにする */
const MEET_REQUEST_TIMEOUT_MS = 15_000;

/** 自分のQRに載せる使い捨てトークン (#330)。
 * 表示は出しっぱなしになるので、開いている間は一定間隔で取り直して描き替える */
export function useMyMeetToken(enabled: boolean) {
  return useQuery({
    queryKey: ["meet-token"],
    enabled,
    queryFn: () =>
      api.get<MeetToken>("/meet/token", {
        // 次の描き替えまでに終わらない要求は捨てる
        timeoutMs: MEET_TOKEN_REFRESH_MS,
      }),
    refetchInterval: enabled ? MEET_TOKEN_REFRESH_MS : false,
    // 画面を消して戻したときも即座に新しいものにする
    refetchOnWindowFocus: true,
    // 前の（古い）トークンを表示し続けないよう保持しない。
    // ただしオブザーバが残っている間はキャッシュも残るので、
    // 期限切れを描かない担保は表示側の expiresAt 判定で行う
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
}

/** QRを読み取ったその場での出会い記録 (#330) */
export function useMeetScan() {
  return useMutation({
    mutationFn: (token: string) =>
      api.post<MeetScanResult>(
        "/meet/scan",
        { token },
        { timeoutMs: MEET_REQUEST_TIMEOUT_MS },
      ),
  });
}

/** 読み取りの取り消し (#330)。scan が返したトークンだけを渡す */
export function useMeetUndo() {
  return useMutation({
    mutationFn: (undoToken: string) =>
      api.post<{ undone: number; attendanceRevoked: boolean }>(
        "/meet/undo",
        { undoToken },
        { timeoutMs: MEET_REQUEST_TIMEOUT_MS },
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
