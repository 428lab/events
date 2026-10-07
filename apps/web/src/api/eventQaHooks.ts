import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EventQaPayload, EventQuestion } from "@eventer/shared";
import { api } from "./client.js";

/** Q&A の投影・登壇者パネルの反映間隔。チャット (#199) はリレー直結で即時だが、
 * Q&A はサーバー保存なのでポーリングで追う */
export const QA_POLL_MS = 10_000;

export function qaQueryKey(eventId: string) {
  return ["event", eventId, "questions"] as const;
}

/** 質問一覧（参加確定メンバーのみ）。
 * 既定は定期の取り直しをしない（D-POLL-MIN）: 開いたとき・タブ復帰・自分の投稿や投票で取り直す。
 * poll は投影（/chat/screen）と登壇者パネルだけが立てる（10秒・表示中だけ）:
 * ライブ中に映している Q&A が新しい質問や票を出さないと、会場が待っている情報が欠け、
 * しかもその画面の前には誰もいないため */
export function useEventQa(eventId: string, enabled: boolean, poll = false) {
  return useQuery({
    queryKey: qaQueryKey(eventId),
    enabled: enabled && Boolean(eventId),
    refetchInterval: poll ? QA_POLL_MS : false,
    refetchOnWindowFocus: true,
    queryFn: () => api.get<EventQaPayload>(`/events/${eventId}/questions`),
  });
}

export function usePostQuestion(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; anonymous: boolean }) =>
      api.post<{ question: EventQuestion }>(
        `/events/${eventId}/questions`,
        input,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: qaQueryKey(eventId) }),
  });
}

/** 自分の質問の取り消し（投稿者本人のみ。行ごと消える） */
export function useDeleteQuestion(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (questionId: string) =>
      api.del(`/events/${eventId}/questions/${questionId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qaQueryKey(eventId) }),
  });
}

/** 投票 / 取り消し（voted=これから投票したい状態） */
export function useVoteQuestion(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ questionId, voted }: { questionId: string; voted: boolean }) =>
      voted
        ? api.post(`/events/${eventId}/questions/${questionId}/vote`)
        : api.del(`/events/${eventId}/questions/${questionId}/vote`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qaQueryKey(eventId) }),
  });
}

/** 回答済み / 非表示の切り替え（staff） */
export function useUpdateQuestion(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      questionId,
      ...flags
    }: {
      questionId: string;
      answered?: boolean;
      hidden?: boolean;
    }) =>
      api.patch<{ question: EventQuestion }>(
        `/events/${eventId}/questions/${questionId}`,
        flags,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: qaQueryKey(eventId) }),
  });
}

/** 「いまこの質問」の設定・解除（staff）。questionId=null で解除 */
export function usePickQuestion(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (questionId: string | null) =>
      api.put<{ pickedQuestionId: string | null }>(
        `/events/${eventId}/qa/pick`,
        { questionId },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: qaQueryKey(eventId) }),
  });
}
