import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { CommunityCohost, EventCohost, EventCohostStatus } from "@eventer/shared";
import { api } from "./client.js";

/** 共催コミュニティ (#625)。
 * 主催側（イベント単位の一覧・申請・取り下げ）と共催先側（コミュニティ単位の
 * 依頼中・共催中の一覧・承諾・辞退）で問い合わせ先が違うので、キーも分けている */

const eventKey = (eventId: string) => ["event", eventId, "cohosts"];
const communityKey = (communityId: string) => ["community", communityId, "cohosts"];

/** 共催が成立・解消すると中身が変わる、コミュニティページのイベント一覧のクエリを取り直させる。
 * ページ本体（["community", slug, "viewer", …]。開催予定・過去の一覧と開催数を含む）と
 * 一覧検索（["communityEventSearch", …]）。どのコミュニティかは slug で引いているので全件 */
function invalidateCommunityEventLists(qc: QueryClient) {
  void qc.invalidateQueries({
    predicate: (q) => q.queryKey[0] === "community" && q.queryKey[2] === "viewer",
  });
  void qc.invalidateQueries({ queryKey: ["communityEventSearch"] });
}

/** そのイベントの共催一覧（イベントの管理者のみ。それ以外は403なので再試行しない） */
export function useEventCohosts(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: eventKey(eventId),
    enabled: enabled && Boolean(eventId),
    retry: false,
    queryFn: async () =>
      (await api.get<{ cohosts: EventCohost[] }>(`/events/${eventId}/cohosts`)).cohosts,
  });
}

export function useRequestCohost(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      api.post<{ status: EventCohostStatus; cohosts: EventCohost[] }>(
        `/events/${eventId}/cohosts`,
        { slug },
      ),
    onSuccess: (data) => {
      qc.setQueryData(eventKey(eventId), data.cohosts);
      // 自分が管理するコミュニティはすぐ共催中になり、詳細と共催先の一覧が変わる
      if (data.status === "accepted") {
        qc.invalidateQueries({ queryKey: ["event", eventId, "viewer"] });
        invalidateCommunityEventLists(qc);
      }
    },
  });
}

/** 取り下げ。共催中だったものは詳細ページの表示と共催先のコミュニティページの一覧からも
 * 消えるので、どちらも取り直させる */
export function useRemoveCohost(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (communityId: string) =>
      api.del<{ cohosts: EventCohost[] }>(`/events/${eventId}/cohosts/${communityId}`),
    onSuccess: (data) => {
      qc.setQueryData(eventKey(eventId), data.cohosts);
      qc.invalidateQueries({ queryKey: ["event", eventId, "viewer"] });
      invalidateCommunityEventLists(qc);
    },
  });
}

/** 共催先コミュニティに届いた依頼と共催中の一覧（owner/admin のみ） */
export function useCommunityCohosts(communityId: string, enabled: boolean) {
  return useQuery({
    queryKey: communityKey(communityId),
    enabled: enabled && Boolean(communityId),
    retry: false,
    queryFn: async () =>
      (await api.get<{ cohosts: CommunityCohost[] }>(`/communities/${communityId}/cohosts`))
        .cohosts,
  });
}

/** 承諾（accept）/ 辞退・共催をやめる（remove）。
 * コミュニティページのイベント一覧も変わるので取り直させる（この一覧そのものは
 * 応答で置き換えたので取り直さない） */
export function useRespondCohost(communityId: string, action: "accept" | "remove") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) =>
      action === "accept"
        ? api.post<{ cohosts: CommunityCohost[] }>(
            `/communities/${communityId}/cohosts/${eventId}/accept`,
          )
        : api.del<{ cohosts: CommunityCohost[] }>(
            `/communities/${communityId}/cohosts/${eventId}`,
          ),
    onSuccess: (data) => {
      qc.setQueryData(communityKey(communityId), data.cohosts);
      invalidateCommunityEventLists(qc);
    },
  });
}
