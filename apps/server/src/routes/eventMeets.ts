import { Hono } from "hono";
import type {
  MeetScanInput,
  MeetUndoInput,
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
  meetTokenDisplayUntil,
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
import { scanMeetBatch, undoMeetBatch, visibleMeetResults } from "../db/repositories/meetOperations.js";
import { usersRepo } from "../db/repositories/users.js";
import { eventSignal } from "../lib/eventSignal.js";
import { deferBackground } from "../runtime.js";

/** 出会いが増減したイベントのランキング投影と景品デスクへ「取り直して」を送る
 * （topic `meet-ranking`・`prize-desk`、D-POLL-MIN 第5段階 5b-2）。読み取りは交流会で
 * 連打されるので throttle を通す */
function publishMeetsChanged(eventIds: readonly string[]): Promise<void> {
  if (eventIds.length === 0) return Promise.resolve();
  return deferBackground(eventSignal.publishRefetchThrottled(
    eventIds.flatMap((id) => [["meet-ranking", id], ["prize-desk", id]] as const),
  ));
}

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
 * 参加者向けの出会いランキング (#418)。投影ページは `signal`（topic `meet-ranking`）の合図で
 * 取り直す（D-POLL-MIN 第5段階 5b-2）。詳細パネルは開いたとき・タブ復帰で取り直す。
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

  const readAt = Date.now();
  const signal = await eventSignal.source(eventId, "meet-ranking", readAt);
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
      signal,
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
    signal,
  });
});

/* =========================================================
 *  読み取ったその場で確定する出会い (#330)
 * =======================================================*/

/** /api/meet 配下。QRの発行・読み取り・取り消し */
export const meetScanRoutes = new Hono<AppEnv>();
meetScanRoutes.use("*", async (c,next) => { c.header("Cache-Control","private, no-store"); c.header("Referrer-Policy","no-referrer"); await next(); });
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
  // 合図の rev は状態を読む前の時刻（これ以前の「読まれた」はこの応答に反映済み）
  const readAt = Date.now();
  const current = c.req.query("current");
  const verified = current ? await verifyMeetToken(current) : null;
  const mine = verified?.ok && verified.userId === me.id ? verified : null;
  // 表示側は定期に見張らない（D-POLL-MIN 第5段階 5b-4）。読まれたら /scan が
  // 本人宛ての合図（topic `meet-token`）を出し、表示の上限（displayUntil）では
  // 表示側が1回だけ取り直す
  const respond = async (token: { token: string; expiresAt: number }, consumed: boolean) =>
    c.json({
      ...token,
      consumed,
      displayUntil: meetTokenDisplayUntil(Math.floor(token.expiresAt / 1000)),
      signal: await eventSignal.source(me.id, "meet-token", readAt),
    });
  if (mine) {
    // 「読まれた」と「画面から降ろした」を分けて見る。表示の文言に使うのは前者
    const consumed = await isMeetTokenRead(mine.nonce);
    const unusable = consumed || (await isMeetTokenUsed(mine.nonce));
    // 出しっぱなしが長引くと、その画面を撮った写真が効く窓も伸びる。
    // 読み取りが終わらないうちに切り替わらない長さは残しつつ、頭打ちにする
    if (!unusable && !meetTokenTooOld(mine.exp)) {
      // まだ誰にも読まれていない。出しっぱなしのQRをそのまま使い続ける
      return respond({ token: current!, expiresAt: mine.exp * 1000 }, false);
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
    return respond(await createMeetToken(me.id), consumed);
  }
  // 手持ちが無い・切れた・自分のものでない
  return respond(await createMeetToken(me.id), false);
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

  let result;
  try {
    result = await scanMeetBatch(me.id,target.id,pairs.map(p=>p.id),now,`/users/${encodeURIComponent(me.username)}`);
  } catch (error) {
    await releaseMeetToken(verified.nonce);
    throw error;
  }
  if (!result.wrote) {
    await releaseMeetToken(verified.nonce);
  } else {
    // 書けた＝トークンを使い切った。見せている本人の画面へ「読まれた」を送り、
    // 次の人に向けるQRへ切り替えさせる（本人1人宛てなので throttle しない）
    await deferBackground(eventSignal.publishRefetch([["meet-token", verified.userId]]));
  }
  await publishMeetsChanged(result.events.filter((e) => e.meetCreated).map((e) => e.eventId));
  const events = await visibleMeetResults(me.id,target.id,result.events);
  if (!events.length) return c.json({error:"no_shared_event"},409);

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

  const { meetEventIds, ...undone } = await undoMeetBatch(me.id,targetId,grants,(exp-MEET_UNDO_TTL_SEC)*1000);
  await publishMeetsChanged(meetEventIds);
  return c.json(undone);
});
