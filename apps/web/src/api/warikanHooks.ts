import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ExpenseInput,
  PaymentInput,
  PayoutMethodInput,
  WarikanExpense,
  WarikanLedger,
  WarikanPayment,
  WarikanPayout,
} from "@eventer/shared";
import { api } from "./client.js";

/**
 * 割り勘 (#556)。設計は docs/warikan.md。
 *
 * 帳簿は GET 1本で全部返る（按分・精算・内訳はサーバーが shared の関数で計算済み。
 * クライアントで計算し直さない）。ポーリングはしない。書き込みのたびに取り直す。
 */

export function warikanQueryKey(eventId: string) {
  return ["event", eventId, "warikan"] as const;
}

/** 帳簿（確定メンバーと帳簿の当事者だけ。それ以外は 404） */
export function useWarikan(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: warikanQueryKey(eventId),
    enabled: enabled && Boolean(eventId),
    retry: false,
    queryFn: () => api.get<WarikanLedger>(`/events/${eventId}/warikan`),
  });
}

function useInvalidate(eventId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: warikanQueryKey(eventId) });
}

export function useCreateExpense(eventId: string) {
  const invalidate = useInvalidate(eventId);
  return useMutation({
    mutationFn: (input: ExpenseInput) =>
      api.post<{ expense: WarikanExpense }>(`/events/${eventId}/warikan/expenses`, input),
    onSuccess: invalidate,
  });
}

export function useUpdateExpense(eventId: string) {
  const invalidate = useInvalidate(eventId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ExpenseInput }) =>
      api.patch<{ expense: WarikanExpense }>(`/events/${eventId}/warikan/expenses/${id}`, input),
    onSuccess: invalidate,
  });
}

export function useDeleteExpense(eventId: string) {
  const invalidate = useInvalidate(eventId);
  return useMutation({
    mutationFn: (id: string) => api.del(`/events/${eventId}/warikan/expenses/${id}`),
    onSuccess: invalidate,
  });
}

export function useRecordPayment(eventId: string) {
  const invalidate = useInvalidate(eventId);
  return useMutation({
    mutationFn: (input: PaymentInput) =>
      api.post<{ payment: WarikanPayment }>(`/events/${eventId}/warikan/payments`, input),
    onSuccess: invalidate,
  });
}

export function useDeletePayment(eventId: string) {
  const invalidate = useInvalidate(eventId);
  return useMutation({
    mutationFn: (id: string) => api.del(`/events/${eventId}/warikan/payments/${id}`),
    onSuccess: invalidate,
  });
}

/** 自分の受け取り先を置換する（他人の分は送れない） */
export function useSavePayoutMethods(eventId: string) {
  const invalidate = useInvalidate(eventId);
  return useMutation({
    mutationFn: (methods: PayoutMethodInput[]) =>
      api.put<{ payoutMethods: WarikanPayout[] }>(`/events/${eventId}/warikan/payout-methods`, {
        methods,
      }),
    onSuccess: invalidate,
  });
}

export function useDeletePayoutMethod(eventId: string) {
  const invalidate = useInvalidate(eventId);
  return useMutation({
    mutationFn: (id: string) => api.del(`/events/${eventId}/warikan/payout-methods/${id}`),
    onSuccess: invalidate,
  });
}
