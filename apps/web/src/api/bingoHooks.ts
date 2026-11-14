import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BingoState, BingoStatus, MyBingoResults } from "@eventer/shared";
import { api } from "./client.js";
import { PARTICIPANT_SIGNAL_JITTER_MS, useEventSignal } from "../lib/signalHub.js";

/**
 * 数字ビンゴ (#436)。
 *
 * - 定期には取り直さない（D-POLL-MIN 第5段階）。抽選コントロールは `bingo-staff`、
 *   カード・投影は `bingo` の合図で取り直す。抽選は staff の mutation 応答で即時に映る
 * - イベント詳細の小カードは購読しない。カードは「ビンゴ開催中・開く」を出すだけで、
 *   開いた /bingo ページが追う
 */

const invalidate = (qc: ReturnType<typeof useQueryClient>, eventId: string) => {
  void qc.invalidateQueries({ queryKey: ["event", eventId, "bingo"] });
  void qc.invalidateQueries({ queryKey: ["event", eventId, "bingo-status"] });
};

/** 参加者向けの状態（自分のカード・判定・人数）。カード画面・投影・詳細の小カードが使う。
 *
 * watch: 応答の `signal`（topic `bingo`）の合図で取り直すか。カード（/bingo）と投影
 * （/bingo/screen）だけが立てる: 抽選中に番号が付かないカードではゲームが成り立たず、投影も
 * 同じため。参加者全員が同じ合図で取り直すので、ばらす（`PARTICIPANT_SIGNAL_JITTER_MS`）。
 * ゲーム作成前も確定メンバーには status "none" と合図の購読先が返るので、プロジェクターを
 * 先に映しておいても作成の合図で拾う（#436「最初の1回だけ番号が出ない」）。
 * イベント詳細の小カードは立てない（開いたとき・タブ復帰で取り直す） */
export function useBingoState(eventId: string, enabled: boolean, watch = false) {
  const query = useQuery({
    queryKey: ["event", eventId, "bingo"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () => api.get<BingoState>(`/events/${eventId}/bingo`),
    retry: false,
    refetchOnWindowFocus: true,
  });
  useEventSignal(watch ? query.data?.signal : null, () => query.refetch(), {
    eventId,
    jitterMs: PARTICIPANT_SIGNAL_JITTER_MS,
  });
  return query;
}

/** 名前入りの導出一覧（staff のみ。抽選コントロール・デスクが使う）。
 * 応答の `signal`（topic `bingo-staff`）の合図で取り直す（D-POLL-MIN 第5段階 5b-2）:
 * 抽選係は抽選しながら「ビンゴ」の申告やカードの受け取りが出てくるのを見る必要があるため
 * （抽選の応答は件数を即時に書く） */
export function useBingoStatus(eventId: string, enabled: boolean) {
  const query = useQuery({
    queryKey: ["event", eventId, "bingo-status"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () => api.get<BingoStatus>(`/events/${eventId}/bingo/status`),
  });
  useEventSignal(query.data?.signal, () => query.refetch(), { eventId });
  return query;
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
 * 名前入りの一覧（rows）だけは `bingo-staff` の合図が追いつかせる */
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
