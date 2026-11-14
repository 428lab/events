import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateWebhookInput, UpdateWebhookInput, WebhookTestResult, WebhookView } from "@eventer/shared";
import { api } from "./client.js";

/** Discord / Slack 通知の設定 (docs/webhooks.md)。コミュニティとイベントで同じ形 */
export type WebhookOwner = { community: string } | { event: string };

const basePath = (o: WebhookOwner) =>
  "community" in o ? `/communities/${o.community}/webhooks` : `/events/${o.event}/webhooks`;
const key = (o: WebhookOwner) =>
  "community" in o ? ["community", o.community, "webhooks"] : ["event", o.event, "webhooks"];

export function useWebhooks(owner: WebhookOwner) {
  return useQuery({
    queryKey: key(owner),
    retry: false,
    queryFn: async () => (await api.get<{ webhooks: WebhookView[] }>(basePath(owner))).webhooks,
  });
}

export function useWebhookMutations(owner: WebhookOwner) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: key(owner) });
  return {
    create: useMutation({
      mutationFn: (input: Partial<CreateWebhookInput> & { url: string }) => api.post<{ webhook: WebhookView }>(basePath(owner), input),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: UpdateWebhookInput }) => api.patch<{ webhook: WebhookView }>(`${basePath(owner)}/${id}`, patch),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del(`${basePath(owner)}/${id}`),
      onSuccess: refresh,
    }),
    test: useMutation({
      mutationFn: (id: string) => api.post<WebhookTestResult>(`${basePath(owner)}/${id}/test`),
    }),
  };
}
