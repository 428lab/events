import type { DutySlot, StaffDuty } from "@eventer/shared";

/**
 * 充足（埋まっているか）の導出 (#384 設計 3.7)。
 *
 * 「埋まっているか」「何人足りないか」は**保存されていない**。`requiredCount` と
 * `"active"` な割り当ての数から、見るたびにここで導出する。列にすると、
 * 割り当て・除名・退会のたびに更新して回る仕事が生まれ、漏れた瞬間から嘘をつく。
 *
 * **数えるのは `"active"` だけ。** `"left"`（除名・降格・退会申請）を数えると、
 * 「必要2・割り当て2・うち1人退会」が充足に見え、要件3（埋まっていない持ち場が
 * 分かる）が退会のたびに嘘をつく。
 */

export interface SlotBoard {
  slot: DutySlot;
  /** 役割名。役割が見つからない場合は空（FK があるので通常は起きない） */
  dutyName: string;
  /** "active" な割り当ての数（表示は `active/required` の形） */
  activeCount: number;
  /** 外れた担当（"left"）の数。1以上なら再割り当ての案内を出す */
  leftCount: number;
  /** 不足人数。0 なら充足（超過も 0。超過は activeCount > required で分かる） */
  shortage: number;
  /** 自分がこの持ち場に active で入っているか（「自分の持ち場」の実体） */
  mine: boolean;
}

/** 持ち場ごとの充足を導出する。並びは入力の順を保つ */
export function deriveSlotBoards(
  slots: DutySlot[],
  duties: StaffDuty[],
  myUserId: string | null,
): SlotBoard[] {
  const nameById = new Map(duties.map((d) => [d.id, d.name]));
  return slots.map((slot) => {
    const active = slot.assignees.filter((a) => a.state === "active");
    return {
      slot,
      dutyName: nameById.get(slot.dutyId) ?? "",
      activeCount: active.length,
      leftCount: slot.assignees.length - active.length,
      shortage: Math.max(0, slot.requiredCount - active.length),
      mine:
        myUserId !== null && active.some((a) => a.user !== null && a.user.id === myUserId),
    };
  });
}

/** 埋まっていない持ち場の数（ページ上部の集計） */
export function countUnfilled(boards: SlotBoard[]): number {
  return boards.filter((b) => b.shortage > 0).length;
}
