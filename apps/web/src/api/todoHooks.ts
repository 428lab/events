import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateTodoInput,
  EventTodosPayload,
  UpdateTodoInput,
} from "@eventer/shared";
import { api } from "./client.js";

/**
 * スタッフ向けの準備 TODO (#393)。**参加者向けの経路は1本も無い。**
 *
 * 取得も更新もそのイベントのスタッフだけが叩ける。取りに行くかどうかは
 * 呼ぶ側が `enabled` で決める（スタッフでない人の画面から投げると 403 が返るだけ
 * だが、返らない要求は出さない。`broadcastHooks.ts` と同じ形）。
 *
 * 絞り込み（自分の・未割り当て・遅れ…）は**すべて画面側**でやる。サーバーに
 * 絞り込みの口を増やすと、この表を読む経路が1本では無くなる（設計 3.5・8.4）。
 */

export function todosQueryKey(eventId: string) {
  return ["event", eventId, "todos"] as const;
}

export function useEventTodos(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: todosQueryKey(eventId),
    enabled: enabled && Boolean(eventId),
    queryFn: () => api.get<EventTodosPayload>(`/events/${eventId}/todos`),
  });
}

/**
 * 書き込みの共通部分。**成功したら取り直す**の1行を6本に書き写さないための土台。
 *
 * 返りを手元に置く形（`useSaveEventSchedule` のような `setQueryData`）にしないのは、
 * どの口も `{ ok: true }` しか返さないため。1件の更新で全件を返させると、
 * 「チェックを1つ付ける」たびに一覧ぶんの行を読むことになる。
 */
function useTodoWrite<TArgs, TData>(
  eventId: string,
  mutationFn: (args: TArgs) => Promise<TData>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => qc.invalidateQueries({ queryKey: todosQueryKey(eventId) }),
  });
}

/** 追加。返る `id` は、続けて依存を足すときに使う */
export function useCreateTodo(eventId: string) {
  return useTodoWrite(eventId, (input: CreateTodoInput) =>
    api.post<{ id: string }>(`/events/${eventId}/todos`, input),
  );
}

/**
 * 更新。**送ったキーだけ変わる**。
 *
 * `startsOn` / `dueOn` / `assigneeUserId` は
 * **キーが無い＝いまの値を保つ / `null`＝消す**。取り違えると、チェックを付けた
 * つもりで担当や日付が消える（`packages/shared/src/eventTodo.ts` の注）。
 */
export function useUpdateTodo(eventId: string) {
  return useTodoWrite(
    eventId,
    ({ todoId, patch }: { todoId: string; patch: UpdateTodoInput }) =>
      api.patch(`/events/${eventId}/todos/${todoId}`, patch),
  );
}

export function useDeleteTodo(eventId: string) {
  return useTodoWrite(eventId, (todoId: string) =>
    api.del(`/events/${eventId}/todos/${todoId}`),
  );
}

/** 並べ替え。**そのイベントの全 id** を並べて送る（部分だけ送らない） */
export function useReorderTodos(eventId: string) {
  return useTodoWrite(eventId, (ids: string[]) =>
    api.put(`/events/${eventId}/todos/order`, { ids }),
  );
}

/** 依存を足す。`todoId` は `dependsOnId` が終わるまで待ちになる。
 * 輪になる組み合わせはサーバーが `todo_dep_cycle` で弾く */
export function useAddTodoDep(eventId: string) {
  return useTodoWrite(
    eventId,
    ({ todoId, dependsOnId }: { todoId: string; dependsOnId: string }) =>
      api.post(`/events/${eventId}/todos/${todoId}/deps`, { dependsOnId }),
  );
}

export function useRemoveTodoDep(eventId: string) {
  return useTodoWrite(
    eventId,
    ({ todoId, dependsOnId }: { todoId: string; dependsOnId: string }) =>
      api.del(`/events/${eventId}/todos/${todoId}/deps/${dependsOnId}`),
  );
}
