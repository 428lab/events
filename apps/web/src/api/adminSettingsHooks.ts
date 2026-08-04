import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppSettingsPayload } from "@eventer/shared";
import { api } from "./client.js";

/** アプリ全体の運用設定（app admin のみ） (#199) */
export function useAdminSettings(enabled: boolean) {
  return useQuery({
    queryKey: ["adminSettings"],
    enabled,
    queryFn: () => api.get<AppSettingsPayload>("/admin/settings"),
  });
}

/** チャットリレーの上書き。relays=[] で既定に戻す */
export function useUpdateChatRelays() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (relays: string[]) =>
      api.put<AppSettingsPayload>("/admin/settings/chat-relays", { relays }),
    onSuccess: (data) => {
      qc.setQueryData(["adminSettings"], data);
    },
  });
}
