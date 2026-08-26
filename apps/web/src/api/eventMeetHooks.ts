import { useMutation, useQuery } from "@tanstack/react-query";
import type { MeetRankingLive, MeetScanResult, MeetToken } from "@eventer/shared";
import { MEET_RANKING_POLL_MS } from "@eventer/shared";
import { api } from "./client.js";

/**
 * 自分のQRのトークンを見張る間隔（ミリ秒） (#330)。
 *
 * トークンは使い切りなので、定期的に切り替える必要はない（読み取っている
 * 最中に変わると失敗し続けるし、行列の2人目以降が使用済みで弾かれる）。
 * 代わりに「読まれたか」を短い間隔で確かめ、読まれた直後だけ描き替える。
 * 3秒にしたのは、次の人にQRを向け直すまでの間に新しいものが出ていてほしい
 * ため。表示している間だけ動かす（enabled ＝ ダイアログの開閉に連動）。
 */
export const MEET_TOKEN_POLL_MS = 3_000;

/** 会場の電波が悪いときに待ち続けないための上限（ミリ秒）。
 * これを過ぎたら打ち切って、画面から再試行できるようにする */
const MEET_REQUEST_TIMEOUT_MS = 15_000;

/** 自分のQRに載せる使い切りトークン (#330)。
 *
 * 表示中のトークンを `current` に添えて問い合わせ、まだ読まれていなければ
 * 同じものが返る（QRは変わらない）。読まれた・切れたときだけ次のぶんが返る。 */
export function useMyMeetToken(enabled: boolean, current: string | null) {
  return useQuery({
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
    refetchInterval: enabled ? MEET_TOKEN_POLL_MS : false,
    // ブラウザが報告する可視状態には依存させない (#420)。
    //
    // false（既定）だと、実行が focusManager.isFocused()（= visibilityState）
    // 頼みになる。スマホでは画面ロック・アプリ切替・ホーム画面追加・アプリ内
    // ブラウザで visibilityState が hidden のまま残る／visibilitychange が
    // 飛ばないことがあり、そうなると表示中なのに見張りが完全に止まる。
    // しかも復帰経路の refetchOnWindowFocus も同じ visibilitychange 頼みなので、
    // 一緒に死ぬ＝「読まれても合図が出ず、QRも切り替わらない」になる。
    // 見張りの期間は enabled（ダイアログの開閉）で既に閉じているので、
    // ここで可視状態の門を重ねる必要はない。本当に裏へ回った間はブラウザ側が
    // タイマーを止める・間引くため、叩きすぎにもならない
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
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

/** 参加者向けの出会いランキング (#418)。投影ページ・詳細パネルが使う。
 *
 * 設定がオフのイベント・非メンバーには 404 が返る（存在ごと隠す門はサーバー側）。
 * その間は refetch を止める：ポーリングを続けても 404 のままで、開きっぱなしの
 * タブから5秒おきの無駄打ちになるだけのため。設定が後からオンになったケースは
 * イベント情報の再取得で enabled が立ち直ってから拾う */
export function useMeetRankingLive(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "meet-ranking-live"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () =>
      api.get<MeetRankingLive>(`/events/${eventId}/meets/ranking/live`),
    refetchInterval: (query) =>
      query.state.error ? false : MEET_RANKING_POLL_MS,
  });
}
