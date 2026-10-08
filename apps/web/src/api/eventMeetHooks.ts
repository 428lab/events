import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { MeetRankingLive, MeetScanResult, MeetToken } from "@eventer/shared";
import { api } from "./client.js";
import { useEventSignal } from "../lib/signalHub.js";

/** 会場の電波が悪いときに待ち続けないための上限（ミリ秒）。
 * これを過ぎたら打ち切って、画面から再試行できるようにする */
const MEET_REQUEST_TIMEOUT_MS = 15_000;

/** 表示の上限（displayUntil）を過ぎてから取り直すまでの余裕（ミリ秒）。
 * サーバーの「出しすぎ」判定が確実に立ってから聞く */
const MEET_TOKEN_CAP_GRACE_MS = 500;

/** 自分のQRに載せる使い切りトークン (#330)。
 *
 * 表示中のトークンを `current` に添えて問い合わせ、まだ読まれていなければ
 * 同じものが返る（QRは変わらない）。読まれた・切れたときだけ次のぶんが返る。
 *
 * 定期の見張りはしない（D-POLL-MIN 第5段階 5b-4）。取り直すのは次の2つだけ:
 * - 読まれたとき: /scan が本人宛てに出す合図（topic `meet-token`）。待たせない（jitter 0）
 * - 表示の上限（displayUntil）: その時刻に1回だけ。サーバーが次のぶんに切り替える
 *
 * 合図はリレーの WebSocket で届くので、ブラウザが報告する可視状態に左右されない
 * (#420: スマホでは表示中でも visibilityState が hidden のまま残ることがある)。
 * 合図を取りこぼすと、QRは上限まで使用済みのまま残る（読んだ側には「使用済み」が出る）。 */
export function useMyMeetToken(enabled: boolean, current: string | null) {
  const query = useQuery({
    // current はキーに入れない。入れるとトークンが変わるたびに
    // 別クエリになり、前のデータが残ったまま画面がちらつく
    queryKey: ["meet-token"],
    enabled,
    queryFn: () =>
      api.get<MeetToken>(
        current
          ? `/meet/token?current=${encodeURIComponent(current)}`
          : "/meet/token",
        { timeoutMs: MEET_REQUEST_TIMEOUT_MS },
      ),
    refetchOnWindowFocus: true,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
  const { refetch } = query;
  useEventSignal(enabled ? query.data?.signal : null, () => refetch());
  // 表示の上限で1回だけ取り直す（時刻はデータが決める。周期のタイマーではない）
  const displayUntil = enabled ? query.data?.displayUntil : undefined;
  useEffect(() => {
    if (displayUntil === undefined) return;
    const timer = setTimeout(() => void refetch(), Math.max(0, displayUntil - Date.now()) + MEET_TOKEN_CAP_GRACE_MS);
    return () => clearTimeout(timer);
  }, [displayUntil, refetch]);
  return query;
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

/** 参加者向けの出会いランキング (#418)。投影ページ・詳細パネルが使う。
 *
 * 設定がオフのイベント・非メンバーには 404 が返る（存在ごと隠す門はサーバー側）。
 * 404 の間は合図の購読先も無いので取り直さない。設定が後からオンになったケースは
 * イベント情報の再取得で enabled が立ち直ってから拾う */
export function useMeetRankingLive(eventId: string, enabled: boolean, watch = false) {
  const query = useQuery({
    queryKey: ["event", eventId, "meet-ranking-live"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () =>
      api.get<MeetRankingLive>(`/events/${eventId}/meets/ranking/live`),
    refetchOnWindowFocus: true,
  });
  // watch は投影ページ（/meet-ranking/screen）だけが立てる: 応答の `signal`（topic `meet-ranking`）の
  // 合図で取り直す（D-POLL-MIN 第5段階 5b-2）。映しているライブのランキングが止まっていては意味がなく、
  // プロジェクターの前には誰もいないため。詳細ページの小カードは開いたとき・タブ復帰で取り直す
  useEventSignal(watch ? query.data?.signal : null, () => query.refetch(), { eventId });
  return query;
}
