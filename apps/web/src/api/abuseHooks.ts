import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AbuseFlagsPayload } from "@eventer/shared";
import { api } from "./client.js";

/** 未確認件数のポーリング間隔（問い合わせバッジと同じ） */
const POLL = 30000;

/** 異常行動の「要確認」リスト（app admin のみ） (#259)。
 * reviewed は undefined ですべて、false で未確認のみ、true で確認済みのみ */
export function useAbuseFlags(
  enabled: boolean,
  { reviewed, page }: { reviewed: boolean | undefined; page: number },
) {
  return useQuery({
    queryKey: ["abuseFlags", reviewed ?? "all", page],
    enabled,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (reviewed !== undefined) params.set("reviewed", reviewed ? "1" : "0");
      return api.get<AbuseFlagsPayload>(`/admin/abuse-flags?${params}`);
    },
  });
}

/** 運用メニューのバッジ用の未確認件数 (#259) */
export function useAbuseUnreviewedCount(enabled = true) {
  return useQuery({
    queryKey: ["abuseFlags", "unread"],
    enabled,
    refetchInterval: POLL,
    queryFn: async () =>
      (await api.get<{ count: number }>("/admin/abuse-flags/unread-count"))
        .count,
  });
}

/** 「確認済みにする」。一覧とバッジの両方を作り直す */
export function useReviewAbuseFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ ok: boolean; updated: boolean }>(
        `/admin/abuse-flags/${id}/review`,
        {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["abuseFlags"] });
    },
  });
}
