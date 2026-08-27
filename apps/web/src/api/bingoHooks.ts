import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BingoState, BingoStatus, MyBingoResults } from "@eventer/shared";
import { BINGO_POLL_MS } from "@eventer/shared";
import { api } from "./client.js";

/**
 * 数字ビンゴ (#436)。
 *
 * - 参加者の状態はゲームが無いイベントに 404 が返る（存在ごと隠す門はサーバー側）。
 *   その間は refetch を止める（useMeetRankingLive と同じ理由）
 * - 抽選コントロール・カード・投影は5秒ポーリング。抽選は staff の mutation 応答で
 *   即時に映り、他の画面は最大5秒遅れで追いつく（読み上げは人間がやるので足りる）
 */

const invalidate = (qc: ReturnType<typeof useQueryClient>, eventId: string) => {
  void qc.invalidateQueries({ queryKey: ["event", eventId, "bingo"] });
  void qc.invalidateQueries({ queryKey: ["event", eventId, "bingo-status"] });
};

/** 参加者向けの状態（自分のカード・判定・人数）。カード画面・投影が使う。
 *
 * pollWhileMissing: 404（ゲーム未作成・権限なし）の間もポーリングを続けるか。
 * 投影・カードの**専用ページは true**にする：プロジェクターはゲームを作る前に
 * 開かれるのが普通で、エラーで止めると作成後も再読み込みまで一切更新されない
 * （「最初の1回だけ番号が出ない」実機報告の正体）。イベント詳細の小カードは
 * false のまま（ビンゴをやらないイベントの詳細ページから5秒おきの無駄打ちを
 * しない。詳細ページは開き直しが頻繁で、復帰はそれで足りる） */
export function useBingoState(
  eventId: string,
  enabled: boolean,
  pollWhileMissing = false,
) {
  return useQuery({
    queryKey: ["event", eventId, "bingo"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () => api.get<BingoState>(`/events/${eventId}/bingo`),
    retry: false,
    refetchInterval: (query) =>
      query.state.error && !pollWhileMissing ? false : BINGO_POLL_MS,
  });
}

/** 名前入りの導出一覧（staff のみ。抽選コントロール・デスクが使う） */
export function useBingoStatus(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "bingo-status"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () => api.get<BingoStatus>(`/events/${eventId}/bingo/status`),
    refetchInterval: (query) => (query.state.error ? false : BINGO_POLL_MS),
  });
}

/** 本人のビンゴ成績 (#441)。本人プロフィール（マイページ）だけが使う */
export function useMyBingoResults(enabled: boolean) {
  return useQuery({
    queryKey: ["me", "bingo-results"],
    enabled,
    queryFn: () => api.get<MyBingoResults>("/me/bingo-results"),
  });
}

/** カードを受け取る（確定メンバー・冪等） */
export function useIssueBingoCard(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ card: number[] }>(`/events/${eventId}/bingo/card`),
    onSuccess: () => invalidate(qc, eventId),
  });
}

/** staff のゲーム操作。path は create/start/end/reset */
function useBingoOp(eventId: string, path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/events/${eventId}/bingo${path}`),
    onSuccess: () => invalidate(qc, eventId),
  });
}

export const useCreateBingo = (eventId: string) => useBingoOp(eventId, "");
export const useStartBingo = (eventId: string) => useBingoOp(eventId, "/start");
export const useEndBingo = (eventId: string) => useBingoOp(eventId, "/end");
export const useResetBingo = (eventId: string) => useBingoOp(eventId, "/reset");

/** draw / undo 応答の共通形。counts はサーバーが引いた直後に導出した人数 */
interface DrawResult {
  drawnNumbers: number[];
  counts: { cards: number; bingo: number; reach: number };
}

/** 抽選応答の番号列と人数をその場でキャッシュに書く（draw / undo 共通）。
 *
 * 引いた番号と人数の正は**応答**（サーバーが引いた直後に確定・導出した値）。
 * invalidate 後の取り直しだけに頼ると、取り直しがレース・失敗・遅延したとき
 * 司会の画面が「—」のまま残る（初回の draw で番号が出ない実機報告 #436）。
 * 番号列だけ直書きすると今度は「ビンゴ n人」が次のポーリングまで増えない
 * （同・実機報告2）ので、応答には counts も入れて一緒に書く。
 * 名前入りの一覧（rows）だけは5秒ポーリングが追いつかせる */
function applyDrawResult(
  qc: ReturnType<typeof useQueryClient>,
  eventId: string,
  res: DrawResult,
) {
  qc.setQueryData<BingoStatus>(["event", eventId, "bingo-status"], (old) =>
    old && old.status !== "none"
      ? { ...old, drawnNumbers: res.drawnNumbers, counts: res.counts }
      : old,
  );
  qc.setQueryData<BingoState>(["event", eventId, "bingo"], (old) =>
    old && old.status !== "none"
      ? { ...old, drawnNumbers: res.drawnNumbers, counts: res.counts }
      : old,
  );
}

export function useDrawBingo(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ number: number } & DrawResult>(
        `/events/${eventId}/bingo/draw`,
      ),
    onSuccess: (res) => applyDrawResult(qc, eventId, res),
  });
}

export function useUndoBingoDraw(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<DrawResult>(`/events/${eventId}/bingo/draw/undo`),
    onSuccess: (res) => applyDrawResult(qc, eventId, res),
  });
}

export function useDeleteBingo(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del(`/events/${eventId}/bingo`),
    onSuccess: () => invalidate(qc, eventId),
  });
}
