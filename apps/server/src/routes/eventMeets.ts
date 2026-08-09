import { Hono } from "hono";
import type {
  MeetScanEventResult,
  MeetScanInput,
  MeetUndoInput,
  User,
} from "@eventer/shared";
import { meetScanInput, meetUndoInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { valid, zValidator } from "../lib/validator.js";
import {
  createMeetToken,
  createUndoToken,
  MEET_UNDO_TTL_SEC,
  verifyMeetToken,
  verifyUndoToken,
} from "../lib/meetToken.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { eventMeetsRepo } from "../db/repositories/eventMeets.js";
import { notificationsRepo } from "../db/repositories/notifications.js";
import { usersRepo } from "../db/repositories/users.js";

/**
 * 出会った記録 (#189)。イベント中に参加者どうしがQRを読み合うと両者にXPが入る。
 *
 * 記録できるのは #330 以降、使い捨てトークンを読み取る /api/meet/scan だけ。
 * 「相手を選んでボタンを押す」経路（POST /events/:id/meet）は廃止した。
 * 対面の裏付けが無い書き込み経路が残っていると、開催時間帯に確定メンバーの
 * 一覧から相手を選ぶだけで出会いを量産できてしまうため。
 */

/** /api/events 配下: 出会いの集計（読み取り専用） */
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
    // 出席チェックを使わないイベントには付けない。そちらは「登録＝出席」で
    // 集計されるので attended を立てる意味が無く、時間帯が重なっただけの
    // 別イベントにまで出席が付くのを避けたい (#330)。
    // 既に出席済みなら「この読み取りで付けた」とは数えない（取り消しで
    // 元から付いていた出席まで外さないため）
    const attendedMe =
      pair.attendanceCheck && pair.targetRole === "staff" && !pair.viewerAttended
        ? Boolean(await eventMembersRepo.setAttended(pair.id, me.id, true, now))
        : false;
    const attendedTarget =
      pair.attendanceCheck && pair.viewerRole === "staff" && !pair.targetAttended
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
    // 取り消せる範囲を、いま実際に書いた行だけに閉じる
    undoToken: await createUndoToken(
      {
        scannerId: me.id,
        targetId: target.id,
        grants: events.map((e) => ({
          eventId: e.eventId,
          meetCreated: e.meetCreated,
          attendedMe: e.attendedMe,
          attendedTarget: e.attendedTarget,
        })),
      },
      now,
    ),
  });
});

/**
 * 読み取りの取り消し（誤読み取り用）。
 *
 * 直前の scan が発行した署名付きトークンだけを受け取り、**そのトークンに
 * 記録された「実際に書いた行」しか戻さない**。
 * 取り消す相手やイベントをクライアントの自己申告で受けると、確定メンバーなら
 * 誰でも「他人が記録した出会い」や「受付で正規に付いた出席」を剥がせてしまう
 * （出席の書き込みは本来 staff 限定なのに、その外側に抜け道ができる）。
 *
 * 二重の歯止めとして、トークンが正しくてもロール条件（相手が staff なら自分の
 * 出席、自分が staff なら相手の出席）を改めて確かめる。どちらも出席を「外す」
 * 方向にしか動かないので、一般参加者が任意の相手を出席にすることはできない。
 *
 * トークンの有効期間を過ぎたぶんの訂正は、運営画面の出席チェック
 * （PATCH …/members/:userId/attendance）で行う。
 */
meetScanRoutes.post("/undo", zValidator("json", meetUndoInput), async (c) => {
  const me = c.get("user");
  const { undoToken } = valid<MeetUndoInput>(c, "json");

  const verified = await verifyUndoToken(undoToken);
  if (!verified.ok) {
    return verified.reason === "expired"
      ? c.json({ error: "expired" }, 410)
      : c.json({ error: "invalid" }, 400);
  }
  const { scannerId, targetId, grants, exp } = verified.payload;
  // 発行者本人しか使えない（他人に渡しても効かない）
  if (scannerId !== me.id) return c.json({ error: "invalid" }, 403);
  if (targetId === me.id) return c.json({ error: "invalid" }, 400);

  let undone = 0;
  let attendanceRevoked = false;
  for (const grant of grants) {
    const mine = await eventMembersRepo.find(grant.eventId, me.id);
    const target = await eventMembersRepo.find(grant.eventId, targetId);
    if (mine?.status !== "confirmed" || target?.status !== "confirmed") continue;

    // この読み取りが作った出会いだけを消す（元からあった記録には触らない）
    if (
      grant.meetCreated &&
      (await eventMeetsRepo.deleteMeet(grant.eventId, me.id, targetId))
    ) {
      undone++;
    }
    if (grant.attendedMe && target.role === "staff") {
      await eventMembersRepo.setAttended(grant.eventId, me.id, false, null);
      attendanceRevoked = true;
    }
    if (grant.attendedTarget && mine.role === "staff") {
      await eventMembersRepo.setAttended(grant.eventId, targetId, false, null);
      attendanceRevoked = true;
    }
  }

  // 出会いを消したなら、その読み取りで出した通知も残さない。
  // 失敗しても取り消し自体は成功扱い（通知が残るだけ）
  if (undone > 0) {
    try {
      await notificationsRepo.deleteMeetSince(
        targetId,
        `/users/${encodeURIComponent(me.username)}`,
        // トークンの発行時刻。それより前に届いた別の機会の通知は消さない
        (exp - MEET_UNDO_TTL_SEC) * 1000,
      );
    } catch (err) {
      console.error("meet notification cleanup failed", err);
    }
  }
  return c.json({ undone, attendanceRevoked });
});
