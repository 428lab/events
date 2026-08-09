import { Hono } from "hono";
import type {
  Event,
  MeetScanEventResult,
  MeetScanInput,
  MeetUndoInput,
  RecordMeetInput,
  User,
} from "@eventer/shared";
import { meetScanInput, meetUndoInput, recordMeetInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { valid, zValidator } from "../lib/validator.js";
import { createMeetToken, verifyMeetToken } from "../lib/meetToken.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import {
  eventMeetsRepo,
  MEET_WINDOW_AFTER_MS,
  MEET_WINDOW_BEFORE_MS,
} from "../db/repositories/eventMeets.js";
import { notificationsRepo } from "../db/repositories/notifications.js";
import { usersRepo } from "../db/repositories/users.js";

/** 出会った記録 (#189)。プロフィールQRの読み合いで両者にXPが入る。要認証 */

/** 開催時間帯（開始30分前〜終了2時間後）に入っているか */
function inMeetWindow(event: Event, now: number): boolean {
  return (
    !event.scheduling &&
    event.startsAt > 0 &&
    event.endsAt > 0 &&
    now >= event.startsAt - MEET_WINDOW_BEFORE_MS &&
    now <= event.endsAt + MEET_WINDOW_AFTER_MS
  );
}

/** /api/users 配下: いま出会いを記録できる共通イベントの取得 */
export const meetUserRoutes = new Hono<AppEnv>();
meetUserRoutes.use("*", requireAuth);

/** 閲覧者と対象ユーザー(:id=ユーザーID)が両方参加中のイベント一覧。自分自身なら空 */
meetUserRoutes.get("/:id/meetable", async (c) => {
  const targetId = c.req.param("id");
  const me = c.get("user");
  if (targetId === me.id) return c.json({ events: [] });
  const events = await eventMeetsRepo.meetableEventsBetween(
    me.id,
    targetId,
    Date.now(),
  );
  return c.json({ events });
});

/** /api/events 配下: 出会いの記録 */
export const meetEventRoutes = new Hono<AppEnv>();
meetEventRoutes.use("*", requireAuth);

/** 出会い数ランキング（スタッフのみ・景品配布などの運営用） */
meetEventRoutes.get(
  "/:id/meets/ranking",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    if (!(await eventsRepo.findById(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ ranking: await eventMeetsRepo.rankingForEvent(eventId) });
  },
);

/** 出会いを記録する。ペアごとに1イベント1回（2回目以降は created=false で冪等） */
meetEventRoutes.post(
  "/:id/meet",
  zValidator("json", recordMeetInput),
  async (c) => {
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    const me = c.get("user");
    const { userId: targetId } = valid<RecordMeetInput>(c, "json");

    // 自分と出会うことはできない
    if (targetId === me.id) return c.json({ error: "self_meet" }, 400);

    // 両者とも確定メンバーであること（管理者バイパスなし）
    const mine = await eventMembersRepo.find(eventId, me.id);
    if (mine?.status !== "confirmed") return c.json({ error: "forbidden" }, 403);
    const target = await eventMembersRepo.find(eventId, targetId);
    if (target?.status !== "confirmed") {
      return c.json({ error: "target_not_member" }, 403);
    }
    // 「両者とも出席済み」の条件は #330 で撤廃した（受付を通していない相手と
    // 記録できず、実際のイベントで「出会ったボタンが出ない」事象が起きたため）

    // 公開イベントの開催時間帯（前30分〜後2時間）のみ受け付ける
    if (event.status !== "published") {
      return c.json({ error: "not_published" }, 409);
    }
    if (!inMeetWindow(event, Date.now())) {
      return c.json({ error: "outside_window" }, 409);
    }

    const { created } = await eventMeetsRepo.recordMeet(eventId, me.id, targetId);
    if (created) await notifyMeet(me, targetId, event.title);
    return c.json({
      created,
      meets: await eventMeetsRepo.countedMeetsForUser(eventId, me.id),
    });
  },
);

/** 相手にも通知（両者にXPが入るため）。失敗しても記録自体は成功扱い */
async function notifyMeet(
  me: User,
  targetId: string,
  eventTitle: string,
): Promise<void> {
  const name = me.globalName ?? me.username;
  const actorPath = `/users/${encodeURIComponent(me.username)}`;
  try {
    await notificationsRepo.create(
      targetId,
      "meet",
      `${name} さんと出会いました`,
      `「${eventTitle}」`,
      actorPath,
      { actorName: name, actorPath },
    );
  } catch (err) {
    console.error("meet notification failed", err);
  }
}

/* =========================================================
 *  読み取ったその場で確定する出会い (#330)
 * =======================================================*/

/** /api/meet 配下。QRの発行・読み取り・取り消し */
export const meetScanRoutes = new Hono<AppEnv>();
meetScanRoutes.use("*", requireAuth);

/** 自分のQRに載せる使い捨てトークン。表示側は有効期限より手前で取り直す */
meetScanRoutes.get("/token", async (c) => {
  const me = c.get("user");
  return c.json(await createMeetToken(me.id));
});

/**
 * QRを読み取ったその場で出会いを記録する。
 *
 * 記録できる共通イベント（参加確定・開催時間帯）すべてに対してまとめて記録し、
 * 何が起きたかをイベントごとに返す。返した内容はそのまま取り消しの入力になる。
 *
 * 出席の自動付与: そのイベントの staff が絡む組み合わせのときだけ、相手側を
 * 出席にする（受付の代わり）。参加者どうしなら出会いのみ。
 * staff 判定はイベント内のメンバーロールだけで行う。サイト管理者やコミュニティ
 * 管理者を混ぜないのは「イベント配下の判定は myRole だけで行う」方針に揃えるため。
 */
meetScanRoutes.post("/scan", zValidator("json", meetScanInput), async (c) => {
  const me = c.get("user");
  const { token } = valid<MeetScanInput>(c, "json");

  const verified = await verifyMeetToken(token);
  if (!verified.ok) {
    return verified.reason === "expired"
      ? c.json({ error: "expired" }, 410)
      : c.json({ error: "invalid" }, 400);
  }
  // 自分のQRを自分で読む経路は塞ぐ（自分で自分の出席を付けられないこと）
  if (verified.userId === me.id) return c.json({ error: "self" }, 400);

  const target = await usersRepo.findById(verified.userId);
  if (!target) return c.json({ error: "invalid" }, 400);

  const now = Date.now();
  const pairs = await eventMeetsRepo.meetablePairsBetween(
    me.id,
    target.id,
    now,
  );
  if (pairs.length === 0) {
    const reason = await eventMeetsRepo.diagnoseUnmeetable(me.id, target.id);
    return c.json({ error: reason }, 409);
  }

  const events: MeetScanEventResult[] = [];
  for (const pair of pairs) {
    const { created } = await eventMeetsRepo.recordMeet(
      pair.id,
      me.id,
      target.id,
    );
    if (created) await notifyMeet(me, target.id, pair.title);

    // 相手が staff なら読み取った側を、自分が staff なら相手を出席にする。
    // 既に出席済みなら「この読み取りで付けた」とは数えない（取り消しで
    // 元から付いていた出席まで外さないため）
    const attendedMe =
      pair.targetRole === "staff" && !pair.viewerAttended
        ? Boolean(await eventMembersRepo.setAttended(pair.id, me.id, true, now))
        : false;
    const attendedTarget =
      pair.viewerRole === "staff" && !pair.targetAttended
        ? Boolean(
            await eventMembersRepo.setAttended(pair.id, target.id, true, now),
          )
        : false;

    events.push({
      eventId: pair.id,
      title: pair.title,
      meetCreated: created,
      attendedMe,
      attendedTarget,
    });
  }

  return c.json({
    target: {
      id: target.id,
      username: target.username,
      name: target.globalName ?? target.username,
      avatarUrl: target.avatarUrl,
    },
    events,
  });
});

/**
 * 読み取りの取り消し（誤読み取り用）。出会いの記録を消し、必要なら出席も戻す。
 *
 * 出席を外せるのは、その組み合わせなら読み取りで付きえた側だけに限る:
 * - 自分の出席 … 相手がそのイベントの staff のとき
 * - 相手の出席 … 自分がそのイベントの staff のとき
 * どちらも出席を「外す」方向にしか動かないので、一般参加者が任意の相手を
 * 出席にすることはできない。
 *
 * 対象は開催時間帯のイベントに限る（記録できる条件と揃える）。時間帯を過ぎた
 * ぶんの訂正は、既存の運営画面の出席チェック（PATCH …/attendance）で行う。
 */
meetScanRoutes.post("/undo", zValidator("json", meetUndoInput), async (c) => {
  const me = c.get("user");
  const { userId: targetId, events } = valid<MeetUndoInput>(c, "json");
  if (targetId === me.id) return c.json({ error: "self" }, 400);

  let undone = 0;
  for (const item of events) {
    const event = await eventsRepo.findById(item.eventId);
    if (!event || event.status !== "published") continue;
    if (!inMeetWindow(event, Date.now())) continue;

    const mine = await eventMembersRepo.find(item.eventId, me.id);
    if (mine?.status !== "confirmed") continue;
    const target = await eventMembersRepo.find(item.eventId, targetId);
    if (target?.status !== "confirmed") continue;

    if (await eventMeetsRepo.deleteMeet(item.eventId, me.id, targetId)) {
      undone++;
    }
    if (item.revokeMyAttendance && target.role === "staff") {
      await eventMembersRepo.setAttended(item.eventId, me.id, false, null);
    }
    if (item.revokeTargetAttendance && mine.role === "staff") {
      await eventMembersRepo.setAttended(item.eventId, targetId, false, null);
    }
  }
  return c.json({ undone });
});
