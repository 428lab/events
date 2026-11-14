import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deriveBingoCard, parseBingoSignal } from "@eventer/shared";
import type { BingoSignal, BingoState, BingoStatus, MyBingoResults } from "@eventer/shared";
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

/** 合図（topic `bingo` の中身）を手元の状態に重ねた結果。
 * - `state`: そのまま書く。`needsRank` なら自分の順位を取りに1回だけ取り直す
 * - "stale": 手元より古い合図。何もしない
 * - "refetch": 重ねられない（ゲームが替わった・作成／削除・形が違う）。取り直す */
export type BingoSignalApply = { state: BingoState; needsRank: boolean } | "stale" | "refetch";

/** 合図の番号・人数・状態を重ね、自分のリーチ／ビンゴは手元のカードで判定し直す
 * （判定は shared の deriveBingoCard。サーバーと同じ関数）。順位は合図に載らないので、
 * ビンゴなのに順位を知らないときだけ取り直す（ビンゴした人だけが取りに行く） */
export function applyBingoSignal(old: BingoState, signal: BingoSignal): BingoSignalApply {
  if (old.signal && signal.rev <= old.signal.rev) return "stale";
  const sameGame = old.gameId !== null && signal.gameId === old.gameId;
  const started = (s: BingoState["status"]) => s === "running" || s === "ended";
  if (!sameGame || !started(old.status) || !started(signal.status)) return "refetch";
  const mine = old.card ? deriveBingoCard(old.card, signal.drawnNumbers) : null;
  const rank = mine?.bingo ? (old.me?.rank ?? null) : null;
  return {
    state: {
      ...old,
      status: signal.status,
      drawnNumbers: signal.drawnNumbers,
      counts: signal.counts,
      me: mine ? { bingo: mine.bingo, reach: mine.reach, rank } : old.me,
      // 反映済みの rev。これより古い合図（順不同で届いたもの）を捨てる
      signal: old.signal ? { ...old.signal, rev: signal.rev } : old.signal,
    },
    needsRank: Boolean(mine?.bingo) && rank === null,
  };
}

/** 参加者向けの状態（自分のカード・判定・人数）。カード画面・投影・詳細の小カードが使う。
 *
 * watch: 応答の `signal`（topic `bingo`）を購読するか。カード（/bingo）と投影
 * （/bingo/screen）だけが立てる: 抽選中に番号が付かないカードではゲームが成り立たず、投影も
 * 同じため。合図は番号・人数・状態を運ぶので、受けた全員が**同時に**その場で反映する
 * （取り直さない。オーナー決定 2026-11-14）。重ねられないとき（ゲームの作成・開始・リセット・
 * 削除）と、ビンゴして順位が要るときだけ、ばらして（`PARTICIPANT_SIGNAL_JITTER_MS`）取り直す。
 * ゲーム作成前も確定メンバーには status "none" と合図の購読先が返るので、プロジェクターを
 * 先に映しておいても作成の合図で拾う（#436「最初の1回だけ番号が出ない」）。
 * イベント詳細の小カードは立てない（開いたとき・タブ復帰で取り直す） */
export function useBingoState(eventId: string, enabled: boolean, watch = false) {
  const qc = useQueryClient();
  const queryKey = ["event", eventId, "bingo"];
  const query = useQuery({
    queryKey,
    enabled: Boolean(eventId) && enabled,
    queryFn: () => api.get<BingoState>(`/events/${eventId}/bingo`),
    retry: false,
    refetchOnWindowFocus: true,
  });
  // ばらした取り直しは1本だけ待つ（待っている間の合図はこの1回に吸収する）
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchSpread = () => {
    if (refetchTimer.current) return;
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      void query.refetch();
    }, Math.random() * PARTICIPANT_SIGNAL_JITTER_MS);
  };
  useEffect(() => () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = null;
  }, []);
  useEventSignal(watch ? query.data?.signal : null, (content) => {
    const signal = parseBingoSignal(content);
    const old = qc.getQueryData<BingoState>(queryKey);
    const applied = signal && old ? applyBingoSignal(old, signal) : "refetch";
    if (applied === "stale") return;
    if (applied === "refetch") return refetchSpread();
    qc.setQueryData<BingoState>(queryKey, applied.state);
    if (applied.needsRank) refetchSpread();
  }, { eventId });
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
