import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PreSurveyAccessRow,
  PreSurveyAdminView,
  PreSurveyResponseRowView,
  PreSurveyResults,
  PublicPreSurvey,
  SavePreSurveyInput,
  SubmitPreSurveyInput,
} from "@eventer/shared";
import { api } from "./client.js";

/**
 * 開催前アンケート (#444)。
 * 公開側はトークンが門（不明トークンは 404）。ポーリングは無し
 * （回答ページは開いて送るだけ。管理側は操作の invalidate で足りる）。
 */

const invalidate = (qc: ReturnType<typeof useQueryClient>, eventId: string) => {
  void qc.invalidateQueries({ queryKey: ["event", eventId, "pre-survey"] });
  void qc.invalidateQueries({
    queryKey: ["event", eventId, "pre-survey-results"],
  });
  void qc.invalidateQueries({
    queryKey: ["event", eventId, "pre-survey-rows"],
  });
};

/** 訪問済みマークのキー（トークン単位）。トークン再発行後は別キーになり
 * 再び初回扱い＝「新しいURLで配り直した」とみなす仕様 (#450 フォローアップ) */
const visitedKey = (token: string) => `eventer:preSurveyVisited:${token}`;

/** この端末で初めての訪問か。localStorage が使えない環境（プライベート
 * ブラウズ等）では常に初回扱いでよい（分析用途の割り切り） */
export function isFirstPreSurveyVisit(token: string): boolean {
  try {
    return localStorage.getItem(visitedKey(token)) === null;
  } catch {
    return true;
  }
}

/** 訪問済みマークを付ける（読み込みが成功したときだけ呼ぶ） */
export function markPreSurveyVisited(token: string): void {
  try {
    localStorage.setItem(visitedKey(token), "1");
  } catch {
    // 保存できない環境では次回も初回扱いになるだけ（実害なし）
  }
}

/** 回答ページ（未ログイン可）。404 は「無い」であって再試行しない。
 * 初回訪問（マーク無し）のときだけ ?first=1 を付け、成功したらマークを保存
 * →以後のフェッチ（再訪・refetch）はフラグ無しになる */
export function usePublicPreSurvey(token: string) {
  return useQuery({
    queryKey: ["pre-survey", token],
    enabled: Boolean(token),
    queryFn: async () => {
      const first = isFirstPreSurveyVisit(token);
      const data = await api.get<PublicPreSurvey>(
        `/public/pre-surveys/${token}${first ? "?first=1" : ""}`,
      );
      markPreSurveyVisited(token);
      return data;
    },
    retry: false,
  });
}

/** 回答の送信（送信1回きり・編集なし） */
export function useSubmitPreSurvey(token: string) {
  return useMutation({
    mutationFn: (input: SubmitPreSurveyInput) =>
      api.post(`/public/pre-surveys/${token}/responses`, input),
  });
}

/** 管理ビュー（staff のみ）。未作成は 404 → UI は作成フォームを出す */
export function usePreSurveyAdmin(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "pre-survey"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () =>
      api.get<{ survey: PreSurveyAdminView }>(`/events/${eventId}/pre-survey`),
    retry: false,
  });
}

export function useSavePreSurvey(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SavePreSurveyInput) =>
      api.put<{ survey: PreSurveyAdminView }>(
        `/events/${eventId}/pre-survey`,
        input,
      ),
    onSuccess: () => invalidate(qc, eventId),
  });
}

/** rotate / close / reopen / delete（管理操作の小さな口） */
function usePreSurveyOp(eventId: string, path: string, method: "post" | "del") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      method === "del"
        ? api.del(`/events/${eventId}/pre-survey${path}`)
        : api.post(`/events/${eventId}/pre-survey${path}`),
    onSuccess: () => invalidate(qc, eventId),
  });
}

export const useRotatePreSurveyToken = (eventId: string) =>
  usePreSurveyOp(eventId, "/rotate", "post");
export const useClosePreSurvey = (eventId: string) =>
  usePreSurveyOp(eventId, "/close", "post");
export const useReopenPreSurvey = (eventId: string) =>
  usePreSurveyOp(eventId, "/reopen", "post");
export const useDeletePreSurvey = (eventId: string) =>
  usePreSurveyOp(eventId, "", "del");

/** 集計（staff のみ） */
export function usePreSurveyResults(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "pre-survey-results"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () =>
      api.get<{ results: PreSurveyResults }>(
        `/events/${eventId}/pre-survey/results`,
      ),
    retry: false,
  });
}

/** 回答一覧 (#447・staff のみ)。表ビューと CSV が同じデータを使う */
export function usePreSurveyResponses(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "pre-survey-rows"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () =>
      api.get<{ rows: PreSurveyResponseRowView[] }>(
        `/events/${eventId}/pre-survey/responses`,
      ),
    retry: false,
  });
}

/** 日毎のアクセスと回答数 (#450・staff のみ) */
export function usePreSurveyAccess(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "pre-survey-access"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () =>
      api.get<{ rows: PreSurveyAccessRow[] }>(
        `/events/${eventId}/pre-survey/access`,
      ),
    retry: false,
  });
}
