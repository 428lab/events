import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EventStaffingPayload } from "@eventer/shared";
import { api } from "./client.js";

/**
 * スタッフの役割タグと持ち場 (#384)。**参加者向けの経路は1本も無い。**
 *
 * 取得も更新もそのイベントのスタッフだけが叩ける。取りに行くかどうかは
 * 呼ぶ側が `enabled` で決める（**`myRole === "staff"` のときだけ有効化**する。
 * スタッフでない人の画面から投げると 403 が返るだけだが、返らない要求は
 * 出さない。`todoHooks.ts` と同じ形）。
 *
 * 充足の導出（1/2・不足）は**すべて画面側**（`lib/dutyBoard.ts`）でやる。
 * サーバーに絞り込み・集計の口を増やすと、この表を読む経路が1本では無くなる
 * （設計 3.5・3.7）。
 */

export function staffingQueryKey(eventId: string) {
  return ["event", eventId, "staffing"] as const;
}

export function useEventStaffing(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: staffingQueryKey(eventId),
    enabled: enabled && Boolean(eventId),
    queryFn: () => api.get<EventStaffingPayload>(`/events/${eventId}/staffing`),
  });
}

/** 書き込みの共通部分。**成功したら取り直す**の1行を7本に書き写さない
 * （`todoHooks.ts` の `useTodoWrite` と同じ判断） */
function useDutyWrite<TArgs, TData>(
  eventId: string,
  mutationFn: (args: TArgs) => Promise<TData>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: staffingQueryKey(eventId) }),
  });
}

export function useCreateDuty(eventId: string) {
  return useDutyWrite(eventId, (name: string) =>
    api.post<{ id: string }>(`/events/${eventId}/staffing/duties`, { name }),
  );
}

export function useRenameDuty(eventId: string) {
  return useDutyWrite(
    eventId,
    ({ dutyId, name }: { dutyId: string; name: string }) =>
      api.patch(`/events/${eventId}/staffing/duties/${dutyId}`, { name }),
  );
}

/** 並べ替え。**そのイベントの全 id** を並べて送る（部分だけ送らない） */
export function useReorderDuties(eventId: string) {
  return useDutyWrite(eventId, (ids: string[]) =>
    api.put(`/events/${eventId}/staffing/duties/order`, { ids }),
  );
}

/** 役割を消す。持ち場・割り当ても消える（呼ぶ側が使用数を出して確認を取る） */
export function useDeleteDuty(eventId: string) {
  return useDutyWrite(eventId, (dutyId: string) =>
    api.del(`/events/${eventId}/staffing/duties/${dutyId}`),
  );
}

/** その時間帯の持ち場一式。**宣言型**（送った集合に合わせる）。
 * 残る持ち場の割り当ては保たれる（人数だけ変えても人は外れない） */
export function usePutItemSlots(eventId: string) {
  return useDutyWrite(
    eventId,
    ({
      itemId,
      slots,
    }: {
      itemId: string;
      slots: Array<{ dutyId: string; required: number }>;
    }) => api.put(`/events/${eventId}/staffing/items/${itemId}`, { slots }),
  );
}

export function useAddDutyAssignee(eventId: string) {
  return useDutyWrite(
    eventId,
    ({ slotId, userId }: { slotId: string; userId: string }) =>
      api.post<{ id: string }>(
        `/events/${eventId}/staffing/slots/${slotId}/assignees`,
        { userId },
      ),
  );
}

/** 割り当てを外す。行の id で指す（外れた担当は user が返らないため） */
export function useRemoveDutyAssignee(eventId: string) {
  return useDutyWrite(
    eventId,
    ({ slotId, assigneeId }: { slotId: string; assigneeId: string }) =>
      api.del(`/events/${eventId}/staffing/slots/${slotId}/assignees/${assigneeId}`),
  );
}
