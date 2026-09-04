import { Hono } from "hono";
import type { Event, User, BingoState, BingoStatus } from "@eventer/shared";
import { deriveBingoCard } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { canManageEvent, requireEventRole } from "../auth/roles.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import {
  drawnNumbers,
  eventBingoRepo,
  type BingoGame,
} from "../db/repositories/eventBingo.js";

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
 * - "participant": ゲーム行があり、確定メンバー（staff メンバー含む）
 * - "staff": ゲーム行が無くても運営できる人（作成前のコントロール画面用）
 * - null: 404（イベント不存在と同一応答。ゲームの存在ごと隠す）
 */
async function bingoAudience(
  event: Event,
  game: BingoGame | null,
  user: User,
): Promise<"participant" | "staff" | null> {
  if (game) {
    const member = await eventMembersRepo.find(event.id, user.id);
    if (member?.status === "confirmed") return "participant";
  }
  if (await canManageEvent(event.id, user)) return "staff";
  return null;
}

export const eventBingoRoutes = new Hono<AppEnv>();
// 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)

/** ゲーム・イベント・観客種別をまとめて引く（全ルートの入口） */
async function load(eventId: string, user: User) {
  const event = await eventsRepo.findById(eventId);
  if (!event) return null;
  const game = await eventBingoRepo.findGame(eventId);
  const audience = await bingoAudience(event, game, user);
  if (!audience) return null;
  return { event, game, audience };
}

/** 全カードの導出（数字だけの数え上げ専用クエリ。名前は取得しない） */
async function deriveAllCards(eventId: string, drawn: number[]) {
  const all = await eventBingoRepo.cardNumbersForEvent(eventId);
  return all.map((n) => deriveBingoCard(n, drawn));
}

/** 導出配列 → 人数（カード枚数・ビンゴ・リーチ）。
 * draw/undo の応答にも同じ値を入れる：画面は応答を正として直書きするので、
 * 番号列だけ返すと人数が次のポーリングまで古いまま残る（#436 実機報告） */
function countsOf(derived: { bingo: boolean; reach: boolean }[]) {
  return {
    cards: derived.length,
    bingo: derived.filter((d) => d.bingo).length,
    reach: derived.filter((d) => d.reach).length,
  };
}

/** 参加者向けの状態（カード画面・投影画面が5秒ポーリング）。
 * 自分のカードと判定・人数だけを返す（他人のカード・名前は返さない） */
eventBingoRoutes.get("/:id/bingo", async (c) => {
  const loaded = await load(c.req.param("id"), c.get("user"));
  if (!loaded) return c.json({ error: "not_found" }, 404);
  const { game } = loaded;
  if (!game) {
    // ゲーム作成前。ここに来られるのは staff だけ（作成ボタンを出すための応答）
    return c.json({
      status: "none",
      drawnNumbers: [],
      counts: { cards: 0, bingo: 0, reach: 0 },
      card: null,
      me: null,
    } satisfies BingoState);
  }
  const drawn = drawnNumbers(game);
  // counts は数字だけの数え上げ専用クエリから導出する。名前・アバターを
  // そもそも取得しないことで、参加者応答への漏れ事故の芽を摘む
  const derivedAll = await deriveAllCards(game.eventId, drawn);
  const card = await eventBingoRepo.findCard(game.eventId, c.get("user").id);
  const mine = card ? deriveBingoCard(card, drawn) : null;
  // 自分の順位＝自分より早い手番で完成した人数 + 1（statusRows の競技順位と同じ規則）
  const myRank =
    mine?.completedAtSeq != null
      ? derivedAll.filter(
          (d) =>
            d.completedAtSeq !== null &&
            d.completedAtSeq < mine.completedAtSeq!,
        ).length + 1
      : null;
  return c.json({
    status: game.status,
    drawnNumbers: drawn,
    counts: countsOf(derivedAll),
    card,
    me: mine
      ? { bingo: mine.bingo, reach: mine.reach, rank: myRank }
      : null,
  } satisfies BingoState);
});

/** カードを受け取る（確定メンバー・冪等）。内容はサーバー乱数が決める */
eventBingoRoutes.post("/:id/bingo/card", async (c) => {
  const loaded = await load(c.req.param("id"), c.get("user"));
  if (!loaded || !loaded.game) return c.json({ error: "not_found" }, 404);
  // 発行できるのは確定メンバーだけ（staff 例外で覗けるだけの人には発行しない）
  if (loaded.audience !== "participant") {
    return c.json({ error: "not_found" }, 404);
  }
  if (loaded.game.status === "ended") {
    return c.json({ error: "game_ended" }, 409);
  }
  const numbers = await eventBingoRepo.issueCard(
    loaded.game.eventId,
    c.get("user").id,
  );
  return c.json({ card: numbers });
});

/* ---- 以下 staff（運営）。requireEventRole がコミュニティ管理者等も通す ---- */

/** ゲーム作成（setup で開始待ち。既にあれば 409） */
eventBingoRoutes.post("/:id/bingo", requireEventRole(["staff"]), async (c) => {
  const eventId = c.req.param("id");
  if (!(await eventsRepo.findById(eventId))) {
    return c.json({ error: "not_found" }, 404);
  }
  if (!(await eventBingoRepo.createGame(eventId))) {
    return c.json({ error: "already_exists" }, 409);
  }
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
    if (!(await eventBingoRepo.startGame(eventId))) {
      return c.json({ error: "not_setup" }, 409);
    }
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
    const myCount = await eventBingoRepo.draw(eventId);
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
    return c.json({
      number: order[myCount - 1],
      drawnNumbers: drawn,
      // 引いた直後の人数。画面は応答を正として直書きするので、これが無いと
      // 「ビンゴ n人」が次のポーリングまで増えない（#436 実機報告）
      counts: countsOf(await deriveAllCards(eventId, drawn)),
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
    if (!(await eventBingoRepo.undoDraw(eventId))) {
      return c.json({ error: "nothing_to_undo" }, 409);
    }
    const after = (await eventBingoRepo.findGame(eventId))!;
    const drawn = drawnNumbers(after);
    return c.json({
      drawnNumbers: drawn,
      counts: countsOf(await deriveAllCards(eventId, drawn)),
    });
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
      })),
    );
    if (!ended) return c.json({ error: "not_running" }, 409);
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
    if (!(await eventBingoRepo.resetGame(eventId))) {
      return c.json({ error: "not_ended" }, 409);
    }
    return c.json({ ok: true });
  },
);

/** ゲームごと削除（ビンゴをやめる）。参加者には 404（存在しない）に戻る */
eventBingoRoutes.delete(
  "/:id/bingo",
  requireEventRole(["staff"]),
  async (c) => {
    await eventBingoRepo.deleteGame(c.req.param("id"));
    return c.json({ ok: true });
  },
);

/** 名前入りの導出一覧（staff のみ。抽選コントロールの読み上げ・デスクが使う） */
eventBingoRoutes.get(
  "/:id/bingo/status",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    if (!(await eventsRepo.findById(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const game = await eventBingoRepo.findGame(eventId);
    if (!game) {
      return c.json({
        status: "none",
        drawnNumbers: [],
        counts: { cards: 0, bingo: 0, reach: 0 },
        rows: [],
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
    } satisfies BingoStatus);
  },
);
