import type { EventMemberWithUser, ParticipationSlot } from "@eventer/shared";
import { i18next } from "../i18n/index.js";

/**
 * 申込者の参加状態を運営が決めるときの共通部分。
 * 「申込者の管理」（LotteryAdminPage）と運営ページの参加者一覧（EventMemberList）が使う。
 */

/** 抽選の当落を運営が手で付けられる行か。抽選枠の参加者で、申込中・当選・落選のどれか
 * （キャンセル・キャンセル待ちは先着枠の話なので扱わない） */
export function canDecideLottery(m: EventMemberWithUser, slot: ParticipationSlot | undefined): slot is ParticipationSlot {
  return (
    slot !== undefined &&
    slot.selectionType === "lottery" &&
    m.role === "participant" &&
    m.slotId === slot.id &&
    (m.status === "applied" || m.status === "confirmed" || m.status === "lost")
  );
}

/** 定員を超える確定は拒否せず、超えることを伝えてから通す (#286)。
 * 当日キャンセルの繰り上げや、その場で1人増やす判断を画面側で塞がない。
 * `names` はこれから確定にする人（既に確定の人は呼び出し側で除く）。まとめて当選にするときは
 * 全員分を渡し、確認は1回だけ出す。定員に収まるなら確認しない */
export function confirmOverCapacity(slot: ParticipationSlot, names: string[]): boolean {
  if (names.length === 0 || slot.confirmedCount + names.length <= slot.capacity) return true;
  return window.confirm(
    i18next.t("staffOps.slotOverCapacityConfirm", {
      slot: slot.name,
      capacity: slot.capacity,
      confirmed: slot.confirmedCount,
      name: names.join(i18next.t("staffOps.slotNameJoiner")),
    }),
  );
}
