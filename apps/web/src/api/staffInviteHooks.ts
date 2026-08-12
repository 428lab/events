import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MyStaffInvite, StaffInvite } from "@eventer/shared";
import { api } from "./client.js";
import { i18next, tDynamic } from "../i18n/index.js";
import { errorCode } from "../lib/errorMessage.js";

/** 運営スタッフへの招待 (#339)。
 * 運営側（イベント単位の一覧・招待・取り消し）と、招待された本人側（自分宛の
 * 返事待ち・承諾・辞退）で問い合わせ先が違うので、キーも分けている */

const eventKey = (eventId: string) => ["event", eventId, "staffInvites"];
const myKey = ["myStaffInvites"];

/** そのイベントの招待一覧（運営のみ。運営でなければ403なので再試行しない） */
export function useEventStaffInvites(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: eventKey(eventId),
    enabled: enabled && Boolean(eventId),
    retry: false,
    queryFn: async () =>
      (await api.get<{ invites: StaffInvite[] }>(`/events/${eventId}/staff-invites`))
        .invites,
  });
}

export function useInviteStaff(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (handle: string) =>
      api.post<{ invites: StaffInvite[] }>(`/events/${eventId}/staff-invites`, {
        handle,
      }),
    onSuccess: (data) => qc.setQueryData(eventKey(eventId), data.invites),
  });
}

export function useRevokeStaffInvite(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) =>
      api.del<{ invites: StaffInvite[] }>(
        `/events/${eventId}/staff-invites/${inviteId}`,
      ),
    onSuccess: (data) => qc.setQueryData(eventKey(eventId), data.invites),
  });
}

/** 自分宛の返事待ちの招待。ログインしていないと401なので再試行しない */
export function useMyStaffInvites(enabled = true) {
  return useQuery({
    queryKey: myKey,
    enabled,
    retry: false,
    queryFn: async () =>
      (await api.get<{ invites: MyStaffInvite[] }>("/me/staff-invites")).invites,
  });
}

/** 承諾/辞退。承諾するとイベントのメンバーになるので、
 * イベント一覧・マイページ側のキャッシュも作り直させる */
export function useRespondStaffInvite(action: "accept" | "decline") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) =>
      api.post<{ eventId?: string }>(`/me/staff-invites/${inviteId}/${action}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: myKey });
      qc.invalidateQueries({ queryKey: ["myPage"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

/** 招待が断られた理由を、その場で直せる形の文言にする。
 *
 * コード別の文言は `staffInviteError` 名前空間が持つ（表を2か所に置かない）。
 * 表に無いコードは共通の受け皿に落ちるので、サーバーが増やしても画面は壊れない */
export function inviteErrorMessage(err: unknown): string {
  const fallback = i18next.t("staffOps.inviteErrorDefault");
  const code = errorCode(err);
  return code ? tDynamic(`staffInviteError.${code}`, fallback) : fallback;
}
