import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CommunityCohost, EventCohost } from "@eventer/shared";
import { api } from "./client.js";

/** 共催コミュニティ (#625)。
 * 主催側（イベント単位の一覧・申請・取り下げ）と共催先側（コミュニティ単位の
 * 依頼中・共催中の一覧・承諾・辞退）で問い合わせ先が違うので、キーも分けている */

const eventKey = (eventId: string) => ["event", eventId, "cohosts"];
const communityKey = (communityId: string) => ["community", communityId, "cohosts"];

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
      api.post<{ cohosts: EventCohost[] }>(`/events/${eventId}/cohosts`, { slug }),
    onSuccess: (data) => qc.setQueryData(eventKey(eventId), data.cohosts),
  });
}

/** 取り下げ。共催中だったものは詳細ページの表示からも消えるので、詳細も取り直させる */
export function useRemoveCohost(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (communityId: string) =>
      api.del<{ cohosts: EventCohost[] }>(`/events/${eventId}/cohosts/${communityId}`),
    onSuccess: (data) => {
      qc.setQueryData(eventKey(eventId), data.cohosts);
      qc.invalidateQueries({ queryKey: ["event", eventId, "viewer"] });
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
      qc.invalidateQueries({ queryKey: ["communityEventSearch"] });
    },
  });
}
