import { Hono } from "hono";
import type { User, BingoState, BingoStatus } from "@eventer/shared";
import { deriveBingoCard } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { canManageEvent, requireEventRole } from "../auth/roles.js";
import type { EventAccessRow } from "../db/repositories/events.js";
import { gateEvent } from "../auth/eventAccess.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import {
  bingoRank,
  bingoTotals,
  drawnNumbers,
  eventBingoRepo,
} from "../db/repositories/eventBingo.js";
import { eventSignal, type RefetchSignalTarget } from "../lib/eventSignal.js";
import { deferBackground } from "../runtime.js";

/**
 * 数字ビンゴ (#436)。設計は docs/bingo.md。
 *
 * - **門は bingoAudience の述語1つ**（#435 meetPrizeAudience と同じ型）。
 *   ゲーム行の有無が唯一の状態で、イベント設定の列は持たない
 * - 公開の口は作らない（すべて要認証）。参加者向け応答に他人由来の値は
 *   人数（counts）だけ。名前入りの一覧は staff 専用の /status のみ
 * - クライアントからの書き込みは「カードを受け取る」1本（内容はサーバー乱数）
 */

/**
 * ビンゴが誰に見えるか。
 * - "participant": 確定メンバー（staff メンバー含む）。ゲーム行が無ければ GET /bingo は
 *   status "none"（作成前に開いた投影・カード画面が、作成の合図で拾えるように。D-POLL-MIN 第5段階）
 * - "staff": 確定メンバーでなくても運営できる人（作成前のコントロール画面用）
 * - null: 404（イベント不存在と同一応答）
 */
async function bingoAudience(
  event: EventAccessRow,
  user: User,
): Promise<"participant" | "staff" | null> {
  const member = await eventMembersRepo.find(event.id, user.id);
  if (member?.status === "confirmed") return "participant";
  if (await canManageEvent(event.id, user)) return "staff";
  return null;
}

/** ビンゴが変わったことを開いている画面へ送る（D-POLL-MIN 第5段階）。
 * - `bingo-staff`: 抽選コントロール（5b-2）
 * - `bingo`: カード画面・投影（5b-3）。参加者全員が見るので、カード発行では送らない
 *   （人数は次の抽選で追いつく）
 * - `prize-desk`: 抽選・取り消し・終了・リセット・削除はビンゴ景品の達成者も動かす */
function publishBingo(eventId: string, prizeDesk = false): Promise<void> {
  const targets: RefetchSignalTarget[] = [["bingo-staff", eventId], ["bingo", eventId]];
  if (prizeDesk) targets.push(["prize-desk", eventId]);
  return deferBackground(eventSignal.publishRefetch(targets));
}

export const eventBingoRoutes = new Hono<AppEnv>();
// 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)

/** ゲーム・イベント・観客種別をまとめて引く（全ルートの入口）。
 * イベント行は共通門 (requireEventAccess) が読んだもの (D-POLL-MIN S2) */
async function load(event: EventAccessRow, user: User) {
  const eventId = event.id;
  const game = await eventBingoRepo.findGame(eventId);
  const audience = await bingoAudience(event, user);
  if (!audience) return null;
  return { event, game, audience };
}

/** 全カードの導出（数字だけの数え上げ専用クエリ。名前は取得しない） */
async function deriveAllCards(eventId: string, drawn: number[]) {
  const all = await eventBingoRepo.cardNumbersForEvent(eventId);
  return all.map((n) => deriveBingoCard(n, drawn));
}

/** 抽選・取り消しの直後: 全カードを導出して保存人数を書き直し（絶対値）、応答用の人数を返す。
 * 画面は draw/undo の応答を正として直書きするので、応答にも同じ人数を入れる（#436 実機報告） */
async function recount(eventId: string, drawnCount: number, drawn: number[]) {
  const totals = bingoTotals(await deriveAllCards(eventId, drawn));
  await eventBingoRepo.writeTotals(eventId, drawnCount, totals);
  return totals.counts;
}

/** 参加者向けの状態（カード画面・投影）。定期には取り直さず、`signal`（topic `bingo`）の合図で
 * 取り直す（D-POLL-MIN 第5段階 5b-3）。抽選のたびに参加者全員が取り直すので、読むのはゲーム行と
 * 自分のカードだけ: 人数と順位はゲーム行に保存した値（0109）。
 * 自分のカードと判定・人数だけを返す（他人のカード・名前は返さない） */
eventBingoRoutes.get("/:id/bingo", async (c) => {
  const readAt = Date.now();
  const loaded = await load(gateEvent(c), c.get("user"));
  if (!loaded) return c.json({ error: "not_found" }, 404);
  const { game } = loaded;
  const signal = await eventSignal.source(loaded.event.id, "bingo", readAt);
  if (!game) {
    // ゲーム作成前: staff は作成ボタンを出すため、確定メンバーは作成の合図を待つため
    return c.json({
      status: "none",
      drawnNumbers: [],
      counts: { cards: 0, bingo: 0, reach: 0 },
      card: null,
      me: null,
      signal,
    } satisfies BingoState);
  }
  const drawn = drawnNumbers(game);
  const card = await eventBingoRepo.findCard(game.eventId, c.get("user").id);
  const mine = card ? deriveBingoCard(card, drawn) : null;
  return c.json({
    status: game.status,
    drawnNumbers: drawn,
    counts: game.counts,
    card,
    me: mine
      ? {
          bingo: mine.bingo,
          reach: mine.reach,
          rank: mine.completedAtSeq !== null ? bingoRank(game.bingoBySeq, mine.completedAtSeq) : null,
        }
      : null,
    signal,
  } satisfies BingoState);
});

/** カードを受け取る（確定メンバー・冪等）。内容はサーバー乱数が決める */
eventBingoRoutes.post("/:id/bingo/card", async (c) => {
  const loaded = await load(gateEvent(c), c.get("user"));
  if (!loaded || !loaded.game) return c.json({ error: "not_found" }, 404);
  // 発行できるのは確定メンバーだけ（staff 例外で覗けるだけの人には発行しない）
  if (loaded.audience !== "participant") {
    return c.json({ error: "not_found" }, 404);
  }
  if (loaded.game.status === "ended") {
    return c.json({ error: "game_ended" }, 409);
  }
  const numbers = await eventBingoRepo.issueCard(
    loaded.game,
    c.get("user").id, {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"member"});
  // 開始前に参加者が一斉に受け取るので throttle を通す。参加者向けの topic には送らない
  await deferBackground(eventSignal.publishRefetchThrottled([["bingo-staff", loaded.game.eventId]]));
  return c.json({ card: numbers });
});

/* ---- 以下 staff（運営）。requireEventRole がコミュニティ管理者等も通す ---- */

/** ゲーム作成（setup で開始待ち。既にあれば 409） */
eventBingoRoutes.post("/:id/bingo", requireEventRole(["staff"]), async (c) => {
  const eventId = c.req.param("id");
  if (!(await eventBingoRepo.createGame(eventId, {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"manager"}))) {
    return c.json({ error: "already_exists" }, 409);
  }
  await publishBingo(eventId);
  return c.json({ ok: true }, 201);
});

/** 開始（setup → running）。二重 start は条件付き UPDATE の1文が防ぐ */
eventBingoRoutes.post(
  "/:id/bingo/start",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    if (!(await eventBingoRepo.findGame(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    if (!(await eventBingoRepo.startGame(eventId, {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"manager"}))) {
      return c.json({ error: "not_setup" }, 409);
    }
    await publishBingo(eventId);
    return c.json({ ok: true });
  },
);

/** 次を引く。RETURNING で受けた**自分の手番**から番号を決める。
 * UPDATE 後に読み直すと、同時に引いた2応答が同じ番号を名乗ってしまう
 * （draw_order は start 以降不変なので、先に読んでおいてよい） */
eventBingoRoutes.post(
  "/:id/bingo/draw",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    const game = await eventBingoRepo.findGame(eventId);
    if (!game) return c.json({ error: "not_found" }, 404);
    const myCount = await eventBingoRepo.draw(eventId, c.get("user").id);
    if (myCount === null) {
      const now = await eventBingoRepo.findGame(eventId);
      return c.json(
        {
          error:
            now?.status === "running" ? "exhausted" : "not_running",
        },
        409,
      );
    }
    const order = game.drawOrder ?? [];
    const drawn = order.slice(0, myCount);
    // 人数を書いてから合図を送る: 合図で取り直す参加者がこの抽選の人数を読むように
    const counts = await recount(eventId, myCount, drawn);
    await publishBingo(eventId, true);
    return c.json({
      number: order[myCount - 1],
      drawnNumbers: drawn,
      counts,
    });
  },
);

/** 直前の1個を取り消す（誤操作訂正） */
eventBingoRoutes.post(
  "/:id/bingo/draw/undo",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    if (!(await eventBingoRepo.findGame(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    if (!(await eventBingoRepo.undoDraw(eventId, {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"manager"}))) {
      return c.json({ error: "nothing_to_undo" }, 409);
    }
    const after = (await eventBingoRepo.findGame(eventId))!;
    const drawn = drawnNumbers(after);
    const counts = await recount(eventId, after.drawnCount, drawn);
    await publishBingo(eventId, true);
    return c.json({ drawnNumbers: drawn, counts });
  },
);

/** 終了（判定の凍結。景品の引き換えは続けられる）。
 * 成功と同時にその回の成績をスナップショットする (#441)。導出は先に読むが、
 * 書き込みは repo の batch（条件付き UPDATE + INSERT OR IGNORE）が
 * 1トランザクションで行い、同時 end の二重保存を塞ぐ */
eventBingoRoutes.post(
  "/:id/bingo/end",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    const game = await eventBingoRepo.findGame(eventId);
    if (!game) return c.json({ error: "not_found" }, 404);
    if (game.status !== "running" || game.startedAt === null) {
      return c.json({ error: "not_running" }, 409);
    }
    const rows = await eventBingoRepo.statusRows(eventId, drawnNumbers(game));
    const ended = await eventBingoRepo.endGame(
      eventId,
      game.startedAt,
      game.drawnCount,
      rows.map((r) => ({
        userId: r.userId,
        rank: r.rank,
        completedAtSeq: r.completedAtSeq,
      })), {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"manager"});
    if (!ended) return c.json({ error: "not_running" }, 409);
    await publishBingo(eventId, true);
    return c.json({ ok: true });
  },
);

/** リセット（ended のときだけ・カード再配布）。running からは先に end を押させる */
eventBingoRoutes.post(
  "/:id/bingo/reset",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    if (!(await eventBingoRepo.findGame(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    if (!(await eventBingoRepo.resetGame(eventId, {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"manager"}))) {
      return c.json({ error: "not_ended" }, 409);
    }
    await publishBingo(eventId, true);
    return c.json({ ok: true });
  },
);

/** ゲームごと削除（ビンゴをやめる）。参加者には 404（存在しない）に戻る */
eventBingoRoutes.delete(
  "/:id/bingo",
  requireEventRole(["staff"]),
  async (c) => {
    await eventBingoRepo.deleteGame(c.req.param("id"), {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"manager"});
    await publishBingo(c.req.param("id"), true);
    return c.json({ ok: true });
  },
);

/** 名前入りの導出一覧（staff のみ。抽選コントロールの読み上げ・デスクが使う）。
 * 定期には取り直さず、`signal`（topic `bingo-staff`）の合図で取り直す（D-POLL-MIN 第5段階 5b-2） */
eventBingoRoutes.get(
  "/:id/bingo/status",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    const readAt = Date.now();
    const signal = await eventSignal.source(eventId, "bingo-staff", readAt);
    const game = await eventBingoRepo.findGame(eventId);
    if (!game) {
      return c.json({
        status: "none",
        drawnNumbers: [],
        counts: { cards: 0, bingo: 0, reach: 0 },
        rows: [],
        signal,
      } satisfies BingoStatus);
    }
    const drawn = drawnNumbers(game);
    const rows = await eventBingoRepo.statusRows(eventId, drawn);
    return c.json({
      status: game.status,
      drawnNumbers: drawn,
      counts: {
        cards: rows.length,
        bingo: rows.filter((r) => r.bingo).length,
        reach: rows.filter((r) => r.reach).length,
      },
      rows,
      signal,
    } satisfies BingoStatus);
  },
);
