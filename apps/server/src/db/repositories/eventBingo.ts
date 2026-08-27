import type {
  BingoGameStatus,
  BingoStatusRow,
  MyBingoResultRow,
} from "@eventer/shared";
import {
  BINGO_COLUMN_RANGES,
  BINGO_MAX_NUMBER,
  deriveBingoCard,
} from "@eventer/shared";
import { batch, many, one, run, runCount } from "../client.js";

/**
 * 数字ビンゴ (#436)。設計は docs/bingo.md。
 *
 * - カードの内容・抽選順はすべて**サーバー乱数**（クライアント申告を信じる場所を作らない）
 * - 抽選は「事前順列 + drawn_count の条件付き UPDATE 1文」（§3.4。二重に押しても
 *   2回進むだけで、番号が飛んだり重複したりしない）
 * - 達成（リーチ/ビンゴ/順位）は保存せず、読むたびに deriveBingoCard で導出する
 */

export interface BingoGame {
  eventId: string;
  status: BingoGameStatus;
  /** 抽選順の全列（開始前は null）。公開済みは先頭 drawnCount 個 */
  drawOrder: number[] | null;
  drawnCount: number;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

interface GameRow {
  event_id: string;
  status: string;
  draw_order: string | null;
  drawn_count: number;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
}

const toGame = (r: GameRow): BingoGame => ({
  eventId: r.event_id,
  status: r.status as BingoGameStatus,
  drawOrder: r.draw_order ? (JSON.parse(r.draw_order) as number[]) : null,
  drawnCount: r.drawn_count,
  createdAt: r.created_at,
  startedAt: r.started_at,
  endedAt: r.ended_at,
});

/** 公開済みの番号列（引いた順）。ゲームの正はこの2値（順列×件数）から一意に決まる */
export function drawnNumbers(game: BingoGame): number[] {
  return game.drawOrder ? game.drawOrder.slice(0, game.drawnCount) : [];
}

/** crypto 乱数で 0..n-1 の一様な整数 */
function randomInt(n: number): number {
  // 2^32 を n で割った余りの偏りを避ける（棄却サンプリング）
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % n;
  }
}

/** Fisher–Yates（crypto 乱数）で配列を混ぜる */
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/** 1..75 の抽選順列（start 時に固定する） */
export function generateDrawOrder(): number[] {
  return shuffle(Array.from({ length: BINGO_MAX_NUMBER }, (_v, i) => i + 1));
}

/** カードの24個を列ごとの標準範囲から重複なしで作る（列優先・N列は4個） */
export function generateCardNumbers(): number[] {
  const numbers: number[] = [];
  BINGO_COLUMN_RANGES.forEach(([lo, hi], col) => {
    const pool = shuffle(
      Array.from({ length: hi - lo + 1 }, (_v, i) => lo + i),
    );
    numbers.push(...pool.slice(0, col === 2 ? 4 : 5));
  });
  return numbers;
}

export const eventBingoRepo = {
  async findGame(eventId: string): Promise<BingoGame | null> {
    const r = await one<GameRow>(
      "SELECT * FROM event_bingo_game WHERE event_id = ?",
      eventId,
    );
    return r ? toGame(r) : null;
  },

  /** ゲーム作成（setup）。既にあれば false（INSERT OR IGNORE の変更行数で判定） */
  async createGame(eventId: string): Promise<boolean> {
    const changes = await runCount(
      "INSERT OR IGNORE INTO event_bingo_game (event_id, status, drawn_count, created_at) VALUES (?, 'setup', 0, ?)",
      eventId,
      Date.now(),
    );
    return changes > 0;
  },

  /** 開始。順列を固定して running へ。1文の条件付き UPDATE で二重 start を防ぐ */
  async startGame(eventId: string): Promise<boolean> {
    const changes = await runCount(
      `UPDATE event_bingo_game
          SET status = 'running', draw_order = ?, started_at = ?
        WHERE event_id = ? AND status = 'setup'`,
      JSON.stringify(generateDrawOrder()),
      Date.now(),
      eventId,
    );
    return changes > 0;
  },

  /** 「次を引く」。running でない・引き切りは null（在庫確保 #431 と同じ1文の型）。
   * RETURNING で**自分が進めた手番**を原子的に受け取る。UPDATE 後に読み直すと、
   * 同時に引いた2つの応答が同じ「最新の番号」を名乗り、間の1つがどの応答にも
   * 出ない（0回発表）ことがある（レビュー指摘） */
  async draw(eventId: string): Promise<number | null> {
    const r = await one<{ drawn_count: number }>(
      `UPDATE event_bingo_game
          SET drawn_count = drawn_count + 1
        WHERE event_id = ? AND status = 'running' AND drawn_count < ${BINGO_MAX_NUMBER}
        RETURNING drawn_count`,
      eventId,
    );
    return r?.drawn_count ?? null;
  },

  /** 直前の1個を取り消す（staff の誤操作訂正）。0 のときは変更行数 0 */
  async undoDraw(eventId: string): Promise<boolean> {
    const changes = await runCount(
      `UPDATE event_bingo_game
          SET drawn_count = drawn_count - 1
        WHERE event_id = ? AND status = 'running' AND drawn_count > 0`,
      eventId,
    );
    return changes > 0;
  },

  /**
   * 終了（判定の凍結。景品の引き換えは続けられる）と同時に、その回の
   * per-user 成績をスナップショットする (#441 docs/bingo-history.md §3.1)。
   *
   * INSERT と条件付き UPDATE（running→ended）を **1つの batch（D1 の
   * トランザクション）**で行う。同時に2人が end を押しても、
   * UNIQUE (event_id, started_at, user_id) が同じラウンドの二重保存を塞ぎ、
   * 負けた側は UPDATE の変更行数 0（＝呼び出し側が 409）になる。
   * 保存後は追記のみ（reset / ゲーム削除では消さない）。
   *
   * **並び順と drawn_count の門が要点**: 材料（rows・drawnTotal）は batch の
   * 外で導出するため、その直後に draw が入ると古いスナップショットになりうる。
   * そこで各 INSERT に「いまも running で drawn_count が導出時と同じ」の
   * EXISTS を持たせて **INSERT を先・UPDATE を後**に並べ、UPDATE にも
   * `drawn_count = ?` を足す。競合していたら何も入らず・閉じずに false
   * （＝409。押し直せば新しい導出で正しく取れる）。UPDATE だけに条件を
   * 足す形は不可：古い INSERT が先に確定してしまう。
   *
   * batch の規模: 1文あたりバインド10個（SQLite の1文上限 999 に対し余裕）、
   * 文数は参加人数+1（200人でも201文。D1 の batch 上限＝数千文よりずっと
   * 小さい）。chunk 化はトランザクションを壊すのでしない。
   *
   * @param rows 終了時点の導出（全カード保有者。未達成は rank/seq が null）
   * @param drawnTotal 導出時点の drawn_count（この値のまま閉じられた時だけ保存） */
  async endGame(
    eventId: string,
    startedAt: number,
    drawnTotal: number,
    rows: { userId: string; rank: number | null; completedAtSeq: number | null }[],
  ): Promise<boolean> {
    const now = Date.now();
    const changes = await batch([
      ...rows.map((r) => ({
        sql: `INSERT OR IGNORE INTO event_bingo_result
                (id, event_id, user_id, started_at, ended_at, rank, completed_at_seq, drawn_total)
              SELECT ?, ?, ?, ?, ?, ?, ?, ?
               WHERE EXISTS (SELECT 1 FROM event_bingo_game
                              WHERE event_id = ? AND status = 'running'
                                AND drawn_count = ?)`,
        args: [
          crypto.randomUUID(),
          eventId,
          r.userId,
          startedAt,
          now,
          r.rank,
          r.completedAtSeq,
          drawnTotal,
          eventId,
          drawnTotal,
        ],
      })),
      {
        sql: `UPDATE event_bingo_game SET status = 'ended', ended_at = ?
               WHERE event_id = ? AND status = 'running' AND drawn_count = ?`,
        args: [now, eventId, drawnTotal],
      },
    ]);
    return (changes[changes.length - 1] ?? 0) > 0;
  },

  /** 本人のビンゴ成績（新しい順）。イベント名は JOIN で取る（行が生きて
   * いるうちは event も生きている——CASCADE の向きがそれを保証する） */
  async resultsForUser(userId: string): Promise<MyBingoResultRow[]> {
    const rows = await many<{
      event_id: string;
      title: string;
      starts_at: number;
      ended_at: number;
      rank: number | null;
      completed_at_seq: number | null;
      drawn_total: number;
    }>(
      `SELECT r.event_id, e.title, e.starts_at, r.ended_at,
              r.rank, r.completed_at_seq, r.drawn_total
         FROM event_bingo_result r
         JOIN event e ON e.id = r.event_id
        WHERE r.user_id = ?
        ORDER BY r.ended_at DESC`,
      userId,
    );
    return rows.map((r) => ({
      eventId: r.event_id,
      eventTitle: r.title,
      eventStartsAt: r.starts_at,
      endedAt: r.ended_at,
      rank: r.rank,
      completedAtSeq: r.completed_at_seq,
      drawnTotal: r.drawn_total,
    }));
  },

  /**
   * リセット（ended のときだけ）。カードを消して setup に戻す＝カード再配布。
   * D1 batch はトランザクションなので「カードだけ消えて状態はそのまま」を作らない。
   * 達成は導出なので自然に全員未達成へ。引き換え済みの景品には触らない（#431 の規則）
   */
  async resetGame(eventId: string): Promise<boolean> {
    const [, changed] = await batch([
      {
        sql: `DELETE FROM event_bingo_card
               WHERE event_id = ? AND EXISTS (
                 SELECT 1 FROM event_bingo_game g
                  WHERE g.event_id = ? AND g.status = 'ended')`,
        args: [eventId, eventId],
      },
      {
        sql: `UPDATE event_bingo_game
                 SET status = 'setup', draw_order = NULL, drawn_count = 0,
                     started_at = NULL, ended_at = NULL
               WHERE event_id = ? AND status = 'ended'`,
        args: [eventId],
      },
    ]);
    return (changed ?? 0) > 0;
  },

  /** ゲームごと削除（カードは CASCADE）。参加者には 404（存在しない）に戻る */
  async deleteGame(eventId: string): Promise<void> {
    await run("DELETE FROM event_bingo_game WHERE event_id = ?", eventId);
  },

  /* ---- カード ---- */

  /** カード発行（冪等）。内容はサーバー乱数で、2回目以降は同じカードを返す */
  async issueCard(eventId: string, userId: string): Promise<number[]> {
    await run(
      `INSERT OR IGNORE INTO event_bingo_card (event_id, user_id, numbers, created_at)
       VALUES (?, ?, ?, ?)`,
      eventId,
      userId,
      JSON.stringify(generateCardNumbers()),
      Date.now(),
    );
    return (await this.findCard(eventId, userId))!;
  },

  async findCard(eventId: string, userId: string): Promise<number[] | null> {
    const r = await one<{ numbers: string }>(
      "SELECT numbers FROM event_bingo_card WHERE event_id = ? AND user_id = ?",
      eventId,
      userId,
    );
    return r ? (JSON.parse(r.numbers) as number[]) : null;
  },

  /* ---- 導出（達成テーブルは無い） ---- */

  /** 全カードの導出行（staff の読み上げ・デスク用。名前入り）。
   * ビンゴ（rank 順）→ リーチ → その他、同分類は username 順で安定させる */
  async statusRows(eventId: string, drawn: number[]): Promise<BingoStatusRow[]> {
    const rows = await many<{
      user_id: string;
      username: string;
      global_name: string | null;
      avatar_url: string | null;
      numbers: string;
    }>(
      `SELECT c.user_id, u.username, u.global_name, u.avatar_url, c.numbers
         FROM event_bingo_card c
         JOIN user u ON u.id = c.user_id AND u.deleted_at IS NULL
        WHERE c.event_id = ?
        ORDER BY u.username ASC`,
      eventId,
    );
    const derived = rows.map((r) => {
      const d = deriveBingoCard(JSON.parse(r.numbers) as number[], drawn);
      return {
        userId: r.user_id,
        username: r.username,
        name: r.global_name ?? r.username,
        avatarUrl: r.avatar_url,
        bingo: d.bingo,
        reach: d.reach,
        completedAtSeq: d.completedAtSeq,
        rank: null as number | null,
      };
    });
    // 競技順位: 完成手番の昇順。同じ手番（同じ読み上げで完成）は同順位、次は人数分飛ぶ
    const winners = derived
      .filter((d) => d.completedAtSeq !== null)
      .sort((a, b) => a.completedAtSeq! - b.completedAtSeq!);
    let rank = 0;
    let prevSeq = -1;
    winners.forEach((w, i) => {
      if (w.completedAtSeq !== prevSeq) {
        rank = i + 1;
        prevSeq = w.completedAtSeq!;
      }
      w.rank = rank;
    });
    const reach = derived.filter((d) => !d.bingo && d.reach);
    const rest = derived.filter((d) => !d.bingo && !d.reach);
    return [...winners, ...reach, ...rest];
  },

  /** 参加者向けの数え上げ専用: カードの数字だけを返す（名前・アバターを引かない。
   * 個人を指す値をそもそも取得しないことで、参加者応答への漏れ事故の芽を摘む）。
   * 退会者の除外は statusRows と同じ条件（JOIN で deleted_at IS NULL） */
  async cardNumbersForEvent(eventId: string): Promise<number[][]> {
    const rows = await many<{ numbers: string }>(
      `SELECT c.numbers
         FROM event_bingo_card c
         JOIN user u ON u.id = c.user_id AND u.deleted_at IS NULL
        WHERE c.event_id = ?`,
      eventId,
    );
    return rows.map((r) => JSON.parse(r.numbers) as number[]);
  },
};
