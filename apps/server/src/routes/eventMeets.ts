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
import {
  consumeMeetToken,
  createMeetToken,
  isMeetTokenUsed,
  verifyMeetToken,
} from "../lib/meetToken.js";
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
    if (created) await notifyMeet(me, targetId, event.title, false);
    return c.json({
      created,
      meets: await eventMeetsRepo.countedMeetsForUser(eventId, me.id),
    });
  },
);

/** 相手にも通知（両者にXPが入るため）。失敗しても記録自体は成功扱い。
 * 読み取りで相手の受付（出席）も済ませたときは、それも本文に載せる。
 * 読んでもらった参加者に受付完了が伝わらないと、受付に並び直す二度手間になる (#330) */
async function notifyMeet(
  me: User,
  targetId: string,
  eventTitle: string,
  attendedTarget: boolean,
): Promise<void> {
  const name = me.globalName ?? me.username;
  const actorPath = `/users/${encodeURIComponent(me.username)}`;
  try {
    await notificationsRepo.create(
      targetId,
      "meet",
      `${name} さんと出会いました`,
      attendedTarget
        ? `「${eventTitle}」の受付もこれで完了しています`
        : `「${eventTitle}」`,
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

/**
 * 自分のQRに載せる使い切りトークン。
 *
 * `?current=<token>` に表示中のトークンを付けて呼ぶと、それがまだ読まれて
 * いなければ**同じものを返す**。読まれた・切れた・自分のものでないときだけ
 * 新しく発行する。表示側はこれを数秒おきに呼び、`consumed` が立った時だけ
 * QRを描き替える（定期的に切り替えると、読み取っている最中に変わって
 * 失敗し続けるうえ、行列の2人目以降が「使用済み」で弾かれる）。
 */
meetScanRoutes.get("/token", async (c) => {
  const me = c.get("user");
  const current = c.req.query("current");
  const verified = current ? await verifyMeetToken(current) : null;
  const mine = verified?.ok && verified.userId === me.id ? verified : null;
  if (mine) {
    if (!(await isMeetTokenUsed(mine.nonce))) {
      // まだ誰にも読まれていない。出しっぱなしのQRをそのまま使い続ける
      return c.json({
        token: current!,
        expiresAt: mine.exp * 1000,
        consumed: false,
      });
    }
    // 読まれたので次のぶんを出す。表示側はここで描き替える
    return c.json({ ...(await createMeetToken(me.id)), consumed: true });
  }
  // 手持ちが無い・切れた・自分のものでない
  return c.json({ ...(await createMeetToken(me.id)), consumed: false });
});

/**
 * QRを読み取ったその場で出会いを記録する。トークンはここで使用済みになる。
 *
 * 出会いは、記録できる共通イベント（参加確定・開催時間帯）すべてに記録する。
 *
 * 出席の自動付与は**いま開催中の1件だけ**に絞る。開始30分前〜終了2時間後という
 * 幅のせいで前後のイベントが同時に窓に入ることがあり、その場に居ない回まで
 * 出席になってしまうため (#330)。
 * 付与するのはそのイベントの staff が絡む組み合わせのときだけ（受付の代わり）。
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
  // 自分のQRを自分で読む経路は塞ぐ（自分で自分の出席を付けられないこと）。
  // 消費より先に見て、自分で自分のQRを潰せないようにする
  if (verified.userId === me.id) return c.json({ error: "self" }, 400);

  const target = await usersRepo.findById(verified.userId);
  if (!target) return c.json({ error: "invalid" }, 400);

  // ここで使い切る。写真を後から渡されても、目の前の人が読んだ時点で終わり
  if (!(await consumeMeetToken(verified.nonce))) {
    return c.json({ error: "used" }, 409);
  }

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

  // 出席を付ける対象は1件。開始済みのうち最も新しく始まった回＝いま居る回と見なす
  // （pairs は starts_at の昇順）。まだどれも始まっていなければ直近に始まる回
  const started = pairs.filter((p) => p.startsAt <= now);
  const attendanceTarget = started.length > 0 ? started[started.length - 1] : pairs[0];

  const events: MeetScanEventResult[] = [];
  for (const pair of pairs) {
    const { created } = await eventMeetsRepo.recordMeet(
      pair.id,
      me.id,
      target.id,
    );

    // 相手が staff なら読み取った側を、自分が staff なら相手を出席にする。
    // 既に出席済みなら「この読み取りで付けた」とは数えない（取り消しで
    // 元から付いていた出席まで外さないため）
    const grant = pair.id === attendanceTarget.id;
    const attendedMe =
      grant && pair.targetRole === "staff" && !pair.viewerAttended
        ? Boolean(await eventMembersRepo.setAttended(pair.id, me.id, true, now))
        : false;
    const attendedTarget =
      grant && pair.viewerRole === "staff" && !pair.targetAttended
        ? Boolean(
            await eventMembersRepo.setAttended(pair.id, target.id, true, now),
          )
        : false;

    // 相手の受付も済んだなら通知でそう伝える（受付に並び直させないため）
    if (created) await notifyMeet(me, target.id, pair.title, attendedTarget);

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
 * 出席を外せるのは、その組み合わせなら読み取りで付きえた側だけ:
 * - 自分の出席 … 相手がそのイベントの staff のとき
 * - 相手の出席 … 自分がそのイベントの staff のとき
 * どちらも出席を「外す」方向にしか動かないので、一般参加者が任意の相手を
 * 出席にすることはできない。
 *
 * さらに、**出席になった時刻が直近 UNDO_ATTENDANCE_WINDOW_MS 以内のときだけ**
 * 外す。これが無いと、確定参加者が staff の userId を拾うだけで、受付で正規に
 * 付いた自分の出席を解除できてしまい、当日の名簿が壊れる。
 * それより前のぶんの訂正は、運営画面の出席チェック
 * （PATCH …/members/:userId/attendance）で行う。
 */

/** 出席を取り消せる猶予。「読み取った直後に気づいて戻す」ぶんだけ通す */
const UNDO_ATTENDANCE_WINDOW_MS = 5 * 60_000;

meetScanRoutes.post("/undo", zValidator("json", meetUndoInput), async (c) => {
  const me = c.get("user");
  const { userId: targetId, events } = valid<MeetUndoInput>(c, "json");
  if (targetId === me.id) return c.json({ error: "self" }, 400);

  const now = Date.now();
  let undone = 0;
  let attendanceRevoked = false;
  for (const item of events) {
    const event = await eventsRepo.findById(item.eventId);
    if (!event || event.status !== "published") continue;
    if (!inMeetWindow(event, now)) continue;

    const mine = await eventMembersRepo.find(item.eventId, me.id);
    if (mine?.status !== "confirmed") continue;
    const target = await eventMembersRepo.find(item.eventId, targetId);
    if (target?.status !== "confirmed") continue;

    if (await eventMeetsRepo.deleteMeet(item.eventId, me.id, targetId)) {
      undone++;
    }
    // 直前に付いた出席だけを戻す（受付で正規に付いたぶんには触らない）
    const recent = (at: number | null) =>
      at !== null && now - at <= UNDO_ATTENDANCE_WINDOW_MS;
    if (item.revokeMyAttendance && target.role === "staff" && recent(mine.attendedAt)) {
      await eventMembersRepo.setAttended(item.eventId, me.id, false, null);
      attendanceRevoked = true;
    }
    if (
      item.revokeTargetAttendance &&
      mine.role === "staff" &&
      recent(target.attendedAt)
    ) {
      await eventMembersRepo.setAttended(item.eventId, targetId, false, null);
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
        now - UNDO_ATTENDANCE_WINDOW_MS,
      );
    } catch (err) {
      console.error("meet notification cleanup failed", err);
    }
  }
  return c.json({ undone, attendanceRevoked });
});
