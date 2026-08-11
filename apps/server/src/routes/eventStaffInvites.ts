import { Hono } from "hono";
import { createStaffInviteInput } from "@eventer/shared";
import type { CreateStaffInviteInput, Event, User } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { canManageEvent, requireEventRole } from "../auth/roles.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import {
  eventStaffInvitesRepo,
  type StaffInviteRecord,
} from "../db/repositories/eventStaffInvites.js";
import { eventsRepo } from "../db/repositories/events.js";
import { notificationsRepo } from "../db/repositories/notifications.js";
import { usersRepo } from "../db/repositories/users.js";
import { promoteFromWaitlist } from "../lib/waitlist.js";

/**
 * 運営スタッフへの招待 (#339)。
 *
 * 公開前のイベントは既存メンバー以外に見えないので、本人が辿り着いて参加する
 * ことができない。運営が指名して招き、**本人が承諾したときに初めて** staff の
 * メンバー行を作る。承諾するまでは何の権限も無く、イベントの中身も見えない。
 *
 * 招待の口は POST /join を通らないので、参加枠の選択も必須の事前アンケートも
 * 要求されない。運営は参加枠を消費しないため (#277)、枠が満席でも招ける。
 */

/** 招待した本人の表示名（通知文に使う） */
function displayName(user: User): string {
  return user.globalName ?? user.username;
}

/** 招待された人に届く通知。
 * 公開前イベントの中身は漏らさない（題名と招待者名だけ）。遷移先も招待一覧に
 * 留める。イベントページは承諾するまで 404 なので、そこへ飛ばしても行き止まり */
async function notifyInvited(
  event: Event,
  invitedUserId: string,
  inviter: User,
): Promise<void> {
  await notificationsRepo.create(
    invitedUserId,
    "staff_invite",
    `「${event.title}」の運営に招待されました`,
    `${displayName(inviter)} さんからの招待です。承諾すると運営として準備に参加できます。`,
    "/staff-invites",
  );
}

/** 招待した人へ結果を返す。宛先を招待した本人だけにしているのは、
 * 「誰が誰を招いたか」の責任の所在に合わせるため（staff 全員には送らない） */
async function notifyInviteResult(
  event: Event,
  inviterId: string,
  respondent: User,
  accepted: boolean,
): Promise<void> {
  await notificationsRepo.create(
    inviterId,
    "staff_invite_result",
    accepted
      ? `「${event.title}」の運営への招待が承諾されました`
      : `「${event.title}」の運営への招待が辞退されました`,
    accepted
      ? `${displayName(respondent)} さんが運営に加わりました`
      : `${displayName(respondent)} さんは運営に加わりませんでした`,
    `/events/${event.id}`,
  );
}

/* =========================================================
 *  運営側: /api/events/:id/staff-invites
 * =======================================================*/

export const eventStaffInviteRoutes = new Hono<AppEnv>();
eventStaffInviteRoutes.use("*", requireAuth);

/** 招待の一覧（そのイベントの運営のみ）。取り消したものは含まない */
eventStaffInviteRoutes.get(
  "/:id/staff-invites",
  requireEventRole(["staff"]),
  async (c) => {
    return c.json({
      invites: await eventStaffInvitesRepo.listByEvent(c.req.param("id")),
    });
  },
);

/** 指名して招待する（そのイベントの運営のみ）。
 * 相手はプロフィールのハンドルで指定する。ここで作るのは招待だけで、
 * メンバー行は作らない＝この時点では相手はまだ運営ではない */
eventStaffInviteRoutes.post(
  "/:id/staff-invites",
  requireEventRole(["staff"]),
  zValidator("json", createStaffInviteInput),
  async (c) => {
    const eventId = c.req.param("id");
    const inviter = c.get("user");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);

    const { handle } = valid<CreateStaffInviteInput>(c, "json");
    // 画面から「@kojira」の形で貼られることを見越して先頭の @ は落とす
    const target = await usersRepo.findByUsername(handle.replace(/^@/, ""));
    if (!target) return c.json({ error: "user_not_found" }, 404);
    if (target.id === inviter.id) return c.json({ error: "self_invite" }, 400);

    const member = await eventMembersRepo.find(eventId, target.id);
    if (member?.role === "staff") return c.json({ error: "already_staff" }, 409);

    const existing = await eventStaffInvitesRepo.find(eventId, target.id);
    if (existing?.status === "pending") {
      return c.json({ error: "already_invited" }, 409);
    }

    await eventStaffInvitesRepo.invite(eventId, target.id, inviter.id);
    await notifyInvited(event, target.id, inviter);
    return c.json({ invites: await eventStaffInvitesRepo.listByEvent(eventId) }, 201);
  },
);

/** 一覧から片付ける（そのイベントの運営のみ）。
 * 返事待ちなら取り消し、断られた行なら一覧からの片付けになる。
 * 承諾済みだけは対象外：ここで消しても運営から外れはしない（それはロール変更の
 * 仕事）ので、取り違えないよう 409 で断る */
eventStaffInviteRoutes.delete(
  "/:id/staff-invites/:inviteId",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    const invite = await eventStaffInvitesRepo.findById(c.req.param("inviteId"));
    // 別イベントの招待IDを渡されても触らせない
    if (!invite || invite.eventId !== eventId) {
      return c.json({ error: "not_found" }, 404);
    }
    if (!(await eventStaffInvitesRepo.revoke(invite.id))) {
      return c.json({ error: "not_pending" }, 409);
    }
    return c.json({ invites: await eventStaffInvitesRepo.listByEvent(eventId) });
  },
);

/* =========================================================
 *  招待された本人: /api/me/staff-invites
 * =======================================================*/

export const myStaffInviteRoutes = new Hono<AppEnv>();
myStaffInviteRoutes.use("*", requireAuth);

/** 自分宛の返事待ちの招待。イベントの題名と開催日時までしか返さない */
myStaffInviteRoutes.get("/", async (c) => {
  return c.json({
    invites: await eventStaffInvitesRepo.listPendingForUser(c.get("user").id),
  });
});

/** 自分宛の招待を取り出す。**他人の招待は必ずここで弾く**（承諾も辞退も本人だけ） */
async function myPendingInvite(
  inviteId: string,
  userId: string,
): Promise<{ invite: StaffInviteRecord; event: Event } | null> {
  const invite = await eventStaffInvitesRepo.findById(inviteId);
  if (!invite || invite.userId !== userId || invite.status !== "pending") {
    return null;
  }
  const event = await eventsRepo.findById(invite.eventId);
  return event ? { invite, event } : null;
}

/** 承諾する。ここで初めて staff のメンバー行ができる。
 *
 * POST /join を通らないので、参加枠の選択も必須の事前アンケートも募集締切も
 * 関わらない（運営は枠を消費しないため #277、満席のイベントにも入れる）。
 * 既に一般参加者だった場合は枠を外して確定に揃え (#277)、空いた先着枠は
 * キャンセル待ちへ繰り上げる (#281)。 */
myStaffInviteRoutes.post("/:inviteId/accept", async (c) => {
  const user = c.get("user");
  const found = await myPendingInvite(c.req.param("inviteId"), user.id);
  if (!found) return c.json({ error: "not_found" }, 404);
  const { invite, event } = found;

  // 招待した人がいまも運営かを、承諾のこの時点で確かめる。
  // 降格・脱退・退会しても pending の招待は残るので、見ないと資格を失った人の
  // 招待で運営になれてしまう。降格や脱退の側で招待を取り消す形にしなかったのは、
  // 資格を失う経路（ロール変更・参加取消・退会・コミュニティ管理者から外れる）が
  // 複数あり、どれかを塞ぎ忘れると同じ穴が開くため。ここ1か所で見れば漏れない
  const inviter = await usersRepo.findById(invite.invitedBy);
  if (!inviter || !(await canManageEvent(event.id, inviter))) {
    return c.json({ error: "inviter_not_staff" }, 409);
  }

  // 招待の消費とメンバー行の作成を1回のバッチで行う。別々に書くと、間で失敗した
  // ときに「招待だけ消費されて運営になっていない」状態が残り、本人には直せない。
  // 取り消しと同時押しになった場合もここで負ける（pending のときだけ進む）
  const before = await eventMembersRepo.find(event.id, user.id);
  if (!(await eventStaffInvitesRepo.accept(invite.id, event.id, user.id))) {
    return c.json({ error: "not_found" }, 404);
  }

  // 先着枠の確定者だったなら席が空いたので繰り上げる (#281)
  const promotedUserId =
    before?.slotId && before.status === "confirmed"
      ? await promoteFromWaitlist(event, before.slotId)
      : null;

  await notifyInviteResult(event, invite.invitedBy, user, true);
  return c.json({ eventId: event.id, promotedUserId });
});

/** 辞退する。メンバー行は作らないので、相手のイベントには一切関わらないまま終わる */
myStaffInviteRoutes.post("/:inviteId/decline", async (c) => {
  const user = c.get("user");
  const found = await myPendingInvite(c.req.param("inviteId"), user.id);
  if (!found) return c.json({ error: "not_found" }, 404);
  const { invite, event } = found;
  if (!(await eventStaffInvitesRepo.resolveIfPending(invite.id, "declined"))) {
    return c.json({ error: "not_found" }, 404);
  }
  await notifyInviteResult(event, invite.invitedBy, user, false);
  return c.json({ ok: true });
});
