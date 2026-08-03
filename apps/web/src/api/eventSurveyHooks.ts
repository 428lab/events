import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  SaveSurveyQuestionItem,
  SubmitSurveyAnswerItem,
  SurveyAnswer,
  SurveyQuestion,
} from "@eventer/shared";
import { api } from "./client.js";

/** スタッフ閲覧用の回答1行（回答者 or 確定メンバー） */
export interface SurveyAnswerViewRow {
  user: {
    id: string;
    username: string;
    globalName: string | null;
    avatarUrl: string | null;
  };
  memberStatus: string | null;
  /** questionId → 保存値（checkbox は JSON array 文字列） */
  answers: Record<string, string>;
}

/** 事前アンケートの質問一覧（イベントを閲覧できる人は誰でも） */
export function useEventSurvey(eventId: string) {
  return useQuery({
    queryKey: ["event", eventId, "survey"],
    enabled: Boolean(eventId),
    queryFn: async () =>
      (await api.get<{ questions: SurveyQuestion[] }>(`/events/${eventId}/survey`))
        .questions,
  });
}

/** 自分の回答一覧（ログイン時のみ） */
export function useMySurveyAnswers(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "survey", "my"],
    enabled: Boolean(eventId) && enabled,
    queryFn: async () =>
      (await api.get<{ answers: SurveyAnswer[] }>(`/events/${eventId}/survey/my`))
        .answers,
  });
}

/** 質問の一括保存（staff のみ） */
export function useSaveSurveyQuestions(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (questions: SaveSurveyQuestionItem[]) =>
      api.put<{ questions: SurveyQuestion[] }>(`/events/${eventId}/survey`, {
        questions,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "survey"] }),
  });
}

/** 自分の回答の送信/更新 */
export function useSubmitSurveyAnswers(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (answers: SubmitSurveyAnswerItem[]) =>
      api.put<{ answers: SurveyAnswer[] }>(`/events/${eventId}/survey/my`, {
        answers,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "survey", "my"] }),
  });
}

/** 全回答の一覧（staff のみ） */
export function useSurveyAnswers(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "survey", "answers"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () =>
      api.get<{ questions: SurveyQuestion[]; rows: SurveyAnswerViewRow[] }>(
        `/events/${eventId}/survey/answers`,
      ),
  });
}
