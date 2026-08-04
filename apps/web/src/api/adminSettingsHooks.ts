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

/** 猶予期間を過ぎた退会アカウントの削除を今すぐ実行する（運営管理者・検証用）(#250) */
export function useRunPurgeDeleted() {
  return useMutation({
    mutationFn: () =>
      api.post<{ purged: number; failed: number; remaining: number }>(
        "/admin/run-purge-deleted",
      ),
  });
}
