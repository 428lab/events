import { Hono } from "hono";
import type {
  MeetScanEventResult,
  MeetScanInput,
  MeetUndoInput,
  User,
} from "@eventer/shared";
import {
  MEET_RANKING_TOP_N,
  meetScanInput,
  meetUndoInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { valid, zValidator } from "../lib/validator.js";
import {
  consumeMeetToken,
  createMeetToken,
  createUndoToken,
  isMeetTokenRead,
  isMeetTokenUsed,
  MEET_UNDO_TTL_SEC,
  meetTokenTooOld,
  releaseMeetToken,
  retireMeetToken,
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
 * 記録できるのは #330 以降、使い切りトークンを読み取る /api/meet/scan だけ。
 * 「相手を選んでボタンを押す」経路（POST /events/:id/meet）は廃止した。
 * 対面の裏付けが無い書き込み経路が残っていると、開催時間帯に確定メンバーの
 * 一覧から相手を選ぶだけで出会いを量産できてしまうため。
 */

/** /api/events 配下: 出会いの集計（読み取り専用） */
export const meetEventRoutes = new Hono<AppEnv>();
// 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)

/** 出会い数ランキング（スタッフのみ・景品配布などの運営用）。
 * meet_ranking 設定 (#418) には従わない：これは #418 以前からある運営機能で、
 * 匿名設定のイベントでも運営には景品配布のため名前入りの全順位が要る */
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

/**
 * 参加者向けの出会いランキング (#418)。投影ページと詳細パネルが5秒ポーリングする。
 *
 * **オフ（meet_ranking = 'off'）の隠蔽の門はここ1か所**（docs/meet-ranking.md §3.8）。
 * イベント不存在と同一の応答（404 not_found）にし、外から設定の有無を判別できなくする。
 * 参加確定メンバー以外にも同じ 404 を返す：named モードの名前・件数を
 * そのイベントの参加者の中に閉じ、非メンバーには機能の存在ごと見せない。
 */
meetEventRoutes.get("/:id/meets/ranking/live", async (c) => {
  const me = c.get("user");
  const eventId = c.req.param("id");
  const event = await eventsRepo.findById(eventId);
  const member = event
    ? await eventMembersRepo.find(eventId, me.id)
    : undefined;
  if (!event || event.meetRanking === "off" || member?.status !== "confirmed") {
    return c.json({ error: "not_found" }, 404);
  }

  const totalRanked = await eventMeetsRepo.countRankedForEvent(eventId);
  // 本人自身の順位・件数。公開プロフィールが既に本人の件数を出しているので、
  // 匿名モードでも返してよい（他人のものは返さない）
  const meRank = await eventMeetsRepo.rankForUser(eventId, me.id);

  if (event.meetRanking === "named") {
    return c.json({
      mode: "named",
      ranking: await eventMeetsRepo.rankingForEvent(eventId, MEET_RANKING_TOP_N),
      totalRanked,
      me: meRank,
    });
  }
  // anonymous: 件数ごとの集約行だけ。個人を指す値（userId 等）は載せない
  return c.json({
    mode: "anonymous",
    ranking: await eventMeetsRepo.anonymousRankingForEvent(
      eventId,
      MEET_RANKING_TOP_N,
    ),
    totalRanked,
    me: meRank,
  });
});

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
      { actorId: me.id },
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
    // 「読まれた」と「画面から降ろした」を分けて見る。表示の文言に使うのは前者
    const consumed = await isMeetTokenRead(mine.nonce);
    const unusable = consumed || (await isMeetTokenUsed(mine.nonce));
    // 出しっぱなしが長引くと、その画面を撮った写真が効く窓も伸びる。
    // 読み取りが終わらないうちに切り替わらない長さは残しつつ、頭打ちにする
    if (!unusable && !meetTokenTooOld(mine.exp)) {
      // まだ誰にも読まれていない。出しっぱなしのQRをそのまま使い続ける
      return c.json({
        token: current!,
        expiresAt: mine.exp * 1000,
        consumed: false,
      });
    }
    // 切り替えるときは、画面から降ろす旧トークンを必ず焼く。
    //
    // 焼かずに次を出すと、撮られたQRが「誰にも消費されないまま有効期限まで
    // 生き残る」状態になる。目の前の人は新しいQRを読むので、写真のほうを
    // 消費して殺す働きが無くなり、回転を入れたことでかえって写真に有利になる。
    // 読み取りの確保とは別キーにするのが要点。同じキーだと、読み直しの
    // 解放（確保 → 何も書かない → 解放）がこの印まで消してしまい、
    // 降ろしたはずのトークンが生き返る。
    await retireMeetToken(mine.nonce);
    // consumed は「読まれたから替わった」ときだけ立てる（表示の文言が変わる）
    return c.json({ ...(await createMeetToken(me.id)), consumed });
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

  // 使用済みのQRは、記録できるかを調べる前に弾く（よくある2度読みの近道）
  if (await isMeetTokenUsed(verified.nonce)) {
    return c.json({ error: "used" }, 409);
  }

  const now = Date.now();
  const pairs = await eventMeetsRepo.meetablePairsBetween(
    me.id,
    target.id,
    now,
  );
  // 記録できない相手の読み取りでは、トークンを確保もしない。
  // 共通イベントが無い他人が読むだけでQRが潰れると、受付の大QRの前で
  // 読み続けられて他の参加者が受付できなくなる
  if (pairs.length === 0) {
    const reason = await eventMeetsRepo.diagnoseUnmeetable(me.id, target.id);
    return c.json({ error: reason }, 409);
  }

  // 書き込みに入る前に、トークンを原子的に確保する。
  // 「使用済みか調べる → 書く → 使用済みにする」の順だと、その隙間に同じ
  // トークンで同時に来たリクエストが全員通ってしまう（写真を流して
  // 「いま一斉に開いて」で複数人ぶんの出席が成立しうる）。
  // 確保できなかった＝誰かが先に読んだということ
  if (!(await consumeMeetToken(verified.nonce))) {
    return c.json({ error: "used" }, 409);
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
    // 出席チェックを使わないイベントには付けない（そちらは「登録＝出席」で
    // 集計されるので attended を立てる意味が無い）
    const grant = pair.id === attendanceTarget.id && pair.attendanceCheck;
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

  // 何も書かなかったなら、確保したトークンを返す。
  // 同じ人が読み直しただけ（記録済みで何も起きない）でQRが潰れると、
  // 受付の大QRの前で読み続けられて他の参加者が受付できなくなる。
  // 写真を後から渡されても成立しないことは、この条件でも変わらない
  // （成立するなら、それは記録が発生する読み取りなので確保したままになる）
  const wrote = events.some(
    (e) => e.meetCreated || e.attendedMe || e.attendedTarget,
  );
  if (!wrote) await releaseMeetToken(verified.nonce);

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
    const deleted =
      grant.meetCreated &&
      (await eventMeetsRepo.deleteMeet(grant.eventId, me.id, targetId));
    if (deleted) undone++;

    // 出席を戻すのは、その回の出会いを実際に取り消せたときだけ。
    // 出会いを消していないのに出席だけ外せると、受付で正規にチェックイン
    // された人が「staff を相手にした読み取り」を口実に自分の出席を消せる。
    // 取り消しの範囲を「この読み取りが書いた行ごと戻す」に閉じる
    if (deleted && grant.attendedMe && target.role === "staff") {
      await eventMembersRepo.setAttended(grant.eventId, me.id, false, null);
      attendanceRevoked = true;
    }
    if (deleted && grant.attendedTarget && mine.role === "staff") {
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
        me.id,
        // トークンの発行時刻。それより前に届いた別の機会の通知は消さない
        (exp - MEET_UNDO_TTL_SEC) * 1000,
      );
    } catch (err) {
      console.error("meet notification cleanup failed", err);
    }
  }
  return c.json({ undone, attendanceRevoked });
});
