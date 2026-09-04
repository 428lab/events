import { Hono } from "hono";
import { valid, zValidator } from "../lib/validator.js";
import {
  joinEventInput,
  setAttendanceInput,
  updateMemberRoleInput,
} from "@eventer/shared";
import type {
  Event,
  EventMember,
  JoinEventInput,
  SetAttendanceInput,
  UpdateMemberRoleInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireEventRole } from "../auth/roles.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { entriesRepo } from "../db/repositories/entries.js";
import { participationSlotsRepo } from "../db/repositories/participationSlots.js";
import { eventSurveyRepo } from "../db/repositories/eventSurvey.js";
import { staffChatRepo } from "../db/repositories/staffChat.js";
import { promoteFromWaitlist } from "../lib/waitlist.js";
import { notifyFollowersOnJoin } from "./follows.js";

/** 参加登録・参加解除・ロール変更・出席チェック */
export const eventMemberRoutes = new Hono<AppEnv>();

/** 終了済みイベントか（日程調整中＝開催日未定は終了扱いしない） */
function isEventEnded(event: Event): boolean {
  return !event.scheduling && event.endsAt < Date.now();
}

/** 募集の締切を過ぎたか (#269)。
 * 未設定（null）は締切なし＝従来どおり isEventEnded まで受け付ける。
 * これで止まるのは**新規の参加登録だけ**。キャンセル・繰り上げ・スタッフ操作
 * （ロール変更・当選操作・出席チェック・QR受付）は当日運営に必要なので通す。 */
function isRegistrationClosed(event: Event): boolean {
  return (
    event.registrationDeadline !== null &&
    event.registrationDeadline <= Date.now()
  );
}

/** 参加登録（枠選択。先着=確定/満員はキャンセル待ち、抽選=申込） */
eventMemberRoutes.post(
  "/:id/join",
  zValidator("json", joinEventInput),
  async (c) => {
    const user = c.get("user");
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    // 終了済みイベントには参加できない（日程調整中は終了扱いしない）
    if (isEventEnded(event)) return c.json({ error: "event_ended" }, 409);

    const existing = await eventMembersRepo.find(eventId, user.id);
    if (existing) return c.json({ member: existing });

    // 募集締切を過ぎたら新規登録を断る (#269)。既存メンバーの再POSTは上で
    // 抜けているので影響しない。アンケート判定より**前**に置くこと：後ろだと
    // 締切後なのに Web がアンケート回答ダイアログを出してから断ることになる
    if (isRegistrationClosed(event)) {
      return c.json({ error: "registration_closed" }, 409);
    }

    // 必須の事前アンケートに未回答なら参加登録をブロック (#152)。
    // Web は先に PUT /survey/my で回答してから join する
    if (!(await eventSurveyRepo.hasAnsweredRequired(eventId, user.id, "pre"))) {
      return c.json({ error: "survey_required" }, 409);
    }

    const input = valid<JoinEventInput>(c, "json");
    const slots = await participationSlotsRepo.listByEvent(eventId);
    let slotId: string | null = null;
    let status = "confirmed";

    if (slots.length > 0) {
      const slot = slots.find((s) => s.id === input.slotId);
      if (!slot) return c.json({ error: "slot_required" }, 400);
      slotId = slot.id;
      if (slot.selectionType === "lottery") {
        status = "applied";
      } else {
        status = slot.confirmedCount < slot.capacity ? "confirmed" : "waitlist";
      }
    }

    const member = await eventMembersRepo.add(
      eventId,
      user.id,
      "participant",
      slotId,
      status,
    );
    if (status === "confirmed") {
      await entriesRepo.createIndividual(
        eventId,
        user.id,
        user.globalName ?? user.username,
      );
      // フォロワーへ「参加した」通知（公開イベントのみ）
      await notifyFollowersOnJoin(event, user.id);
    }
    return c.json({ member, status }, 201);
  },
);

/** 参加を取り消して「参加していない状態」に戻す (#281)。
 * 本人の参加解除 (DELETE /join) と、運営が一般参加者に戻すときで共有する。
 *
 * 確定参加者の取消だけはキャンセル履歴として行を残す（参加実績の集計用）。
 * それ以外（申込中・キャンセル待ち・落選や、参加者以外のロール）は行ごと消す。
 * 行が残ると本人が再度申し込めない（POST /join は既存メンバーで打ち切る）。
 *
 * @returns 繰り上げた人の userId（繰り上げなしなら null） */
async function leaveEvent(
  event: Event,
  leaving: EventMember,
): Promise<string | null> {
  await entriesRepo.removeIndividualEntry(event.id, leaving.userId);
  if (
    leaving.role === "participant" &&
    leaving.status === "confirmed" &&
    event.status === "published"
  ) {
    await eventMembersRepo.cancel(event.id, leaving.userId, event.scheduling);
  } else {
    await eventMembersRepo.remove(event.id, leaving.userId);
  }
  // 事前アンケートの回答は離脱と同時に削除（入館用氏名等のPIIを残さない）
  await eventSurveyRepo.deleteAnswersForUser(event.id, leaving.userId);
  // スタッフ資格の喪失 (#382)。スタッフチャットの共通鍵を1世代進め、本人の
  // signer を失効させる（部屋が無ければ何もしない）。DELETE /join と
  // ロール変更→participant の両方がここを通る（残る経路は「staff → 他ロール」の
  // setRole・退会申請・退会 purge で、それぞれロール変更ハンドラと
  // users.ts の requestDeletion / deleteAccount にある）
  if (leaving.role === "staff") {
    await staffChatRepo.onStaffLost(event.id, leaving.userId);
  }
  return leaving.slotId && leaving.status === "confirmed"
    ? promoteFromWaitlist(event, leaving.slotId)
    : null;
}

/** 参加解除（メンバーと個人 Entry を削除）。先着枠なら待機を自動繰り上げ。 */
eventMemberRoutes.delete("/:id/join", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const event = await eventsRepo.findById(eventId);
  if (!event) return c.json({ error: "not_found" }, 404);
  // 終了済みイベントは参加解除できない（参加履歴を残す）
  if (isEventEnded(event)) return c.json({ error: "event_ended" }, 409);
  const leaving = await eventMembersRepo.find(eventId, user.id);
  if (!leaving) {
    // メンバー行がない場合も後始末だけはしておく（Entry の取り残し防止）
    await entriesRepo.removeIndividualEntry(eventId, user.id);
    await eventMembersRepo.remove(eventId, user.id);
    await eventSurveyRepo.deleteAnswersForUser(eventId, user.id);
    return c.json({ ok: true, promotedUserId: null });
  }
  const promotedUserId = await leaveEvent(event, leaving);
  return c.json({ ok: true, promotedUserId });
});

/** ロール変更（staff のみ）。
 *
 * 一般参加者に戻すのは「参加していない状態」に戻すこと (#281)。参加枠と参加状態は
 * ロールと別の軸なので、ロールだけ書き換えるとスタッフにしたときの確定 (#277) が
 * 残り、一度も当選していない人が確定参加者になってしまう。本人に改めて申し込んで
 * もらう形にして、参加取消と同じ後始末（Entry 削除・枠の繰り上げ）を通す。 */
eventMemberRoutes.patch(
  "/:id/members/:userId/role",
  requireEventRole(["staff"]),
  zValidator("json", updateMemberRoleInput),
  async (c) => {
    const eventId = c.req.param("id");
    const userId = c.req.param("userId");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    const before = await eventMembersRepo.find(eventId, userId);
    if (!before) return c.json({ error: "not_found" }, 404);
    const { role } = valid<UpdateMemberRoleInput>(c, "json");

    // 最後のスタッフは降ろせない (#281)。staff が0人になるとイベントの設定変更も
    // ロール割当も誰にもできなくなり、画面から復旧する手段が無い。
    // 先に別の人をスタッフにしてから、という順番に倒す
    if (
      before.role === "staff" &&
      role !== "staff" &&
      (await eventMembersRepo.countStaff(eventId)) <= 1
    ) {
      return c.json({ error: "last_staff" }, 409);
    }

    if (role === "participant") {
      // 既に参加者なら何もしない（同じロールの指定で参加を消さない）
      if (before.role === "participant") return c.json({ member: before });
      // 終了済みイベントでは参加履歴を消さない（DELETE /join と同じ扱い）。
      // 終了後は本人が申し込み直せないので、消すと戻す手段が無くなる
      if (isEventEnded(event)) return c.json({ error: "event_ended" }, 409);
      const promotedUserId = await leaveEvent(event, before);
      return c.json({ member: null, promotedUserId });
    }

    const member = await eventMembersRepo.setRole(eventId, userId, role);
    if (!member) return c.json({ error: "not_found" }, 404);
    // 降格（staff → judge/observer）はスタッフ資格の喪失 (#382)。
    // スタッフチャットの共通鍵を1世代進め、本人の signer を失効させる
    // （staff → participant は上の leaveEvent の中で同じフックを通っている）
    if (before.role === "staff" && role !== "staff") {
      await staffChatRepo.onStaffLost(eventId, userId);
    }
    // 先着枠の確定者だったなら席が空いたので繰り上げる
    const promotedUserId =
      before.slotId && before.status === "confirmed"
        ? await promoteFromWaitlist(event, before.slotId)
        : null;
    return c.json({ member, promotedUserId });
  },
);

/** 出席チェック（staff のみ）。
 *
 * 出席にできるのは参加確定の人だけ (#286)。落選・申込中・キャンセル待ちのまま
 * 出席にできると、参加していないはずの人が参加実績・一斉連絡の宛先・公開プロフィール
 * に入ってしまう。受付のQR経由 (POST /:id/checkin) は元から確定を求めているので、
 * 手動経路もそこに揃える。出席にしたい相手が確定でないなら、先にロール変更や
 * 繰り上げで参加状態を確定にしてもらう。
 *
 * 出席の解除は確定でなくても通す。誤って出席にした行や、この検査より前に付いて
 * しまった行を staff が画面から直せなくなるほうが困るため（片方向だけ塞ぐ）。 */
eventMemberRoutes.patch(
  "/:id/members/:userId/attendance",
  requireEventRole(["staff"]),
  zValidator("json", setAttendanceInput),
  async (c) => {
    const eventId = c.req.param("id");
    const userId = c.req.param("userId");
    const { attended } = valid<SetAttendanceInput>(c, "json");
    const before = await eventMembersRepo.find(eventId, userId);
    if (!before) return c.json({ error: "not_found" }, 404);
    if (attended && before.status !== "confirmed") {
      return c.json({ error: "not_confirmed" }, 409);
    }
    const member = await eventMembersRepo.setAttended(
      eventId,
      userId,
      attended,
      // 出席にした時刻を記録（解除では NULL に戻る） (#154)
      attended ? Date.now() : null,
    );
    if (!member) return c.json({ error: "not_found" }, 404);
    return c.json({ member });
  },
);
