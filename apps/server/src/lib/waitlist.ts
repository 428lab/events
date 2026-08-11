import type { Event } from "@eventer/shared";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { entriesRepo } from "../db/repositories/entries.js";
import { notificationsRepo } from "../db/repositories/notifications.js";
import { participationSlotsRepo } from "../db/repositories/participationSlots.js";
import { usersRepo } from "../db/repositories/users.js";

/** 先着枠で席が空いたとき、キャンセル待ちの最古を確定へ繰り上げる (#281)。
 * 呼び出し前に席を空けておくこと（confirmedCount はその場で数え直す）。
 *
 * 席が空く経路は参加解除だけではない。参加者をスタッフ等にすると枠が外れて
 * 席が空くので (#277)、そちらからも同じ処理を通す。通さないと空席のまま
 * キャンセル待ちが放置され、後から申し込んだ人に横入りされる。運営への招待を
 * 承諾した人も同じ（参加者だった人がスタッフになる） (#339)。
 *
 * @returns 繰り上げた人の userId（繰り上げなしなら null） */
export async function promoteFromWaitlist(
  event: Event,
  slotId: string,
): Promise<string | null> {
  const slot = await participationSlotsRepo.findById(slotId);
  if (
    !slot ||
    slot.selectionType !== "first_come" ||
    slot.confirmedCount >= slot.capacity
  ) {
    return null;
  }
  const [next] = await eventMembersRepo.membersBySlotStatus(slotId, "waitlist");
  if (!next) return null;
  await eventMembersRepo.setStatus(next.id, "confirmed");
  const u = await usersRepo.findById(next.userId);
  if (u) {
    await entriesRepo.createIndividual(
      event.id,
      next.userId,
      u.globalName ?? u.username,
    );
  }
  await notificationsRepo.create(
    next.userId,
    "waitlist_promoted",
    "キャンセル待ちから繰り上がりました",
    `「${event.title}」への参加が確定しました`,
    `/events/${event.id}`,
  );
  return next.userId;
}
