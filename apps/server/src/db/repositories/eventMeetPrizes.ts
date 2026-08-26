import type {
  CreateMeetPrizeInput,
  MeetPrize,
  MeetPrizeAchiever,
  MeetWinner,
  UpdateMeetPrizeInput,
} from "@eventer/shared";
import { batch, many, one, run, runCount } from "../client.js";
import { PER_USER_COUNTS_SQL } from "./eventMeets.js";

/**
 * 出会いの景品引き換え (#431)。設計は docs/meet-prizes.md。
 *
 * - 達成・残数は**保存せず導出**する。#330 の取り消しで件数が減ったら達成は
 *   自然に消え、引き換え済み（redemption 行）だけが残る
 * - 在庫の確保は redeem() の**1文の INSERT**に閉じる（早い者勝ちの正）
 * - 1位は closeWinners() のスナップショットが正。「確定済みか」は行の有無で表す
 *   （別のフラグ列を持たない。0人で締める操作は呼び出し側が 409 で断る）
 */

interface PrizeRow {
  id: string;
  event_id: string;
  name: string;
  description: string;
  condition_type: string;
  threshold: number | null;
  stock: number;
  created_at: number;
}

const toPrize = (r: PrizeRow): MeetPrize => ({
  id: r.id,
  eventId: r.event_id,
  name: r.name,
  description: r.description,
  conditionType: r.condition_type as MeetPrize["conditionType"],
  threshold: r.threshold,
  stock: r.stock,
  createdAt: r.created_at,
});

export const eventMeetPrizesRepo = {
  /* ---- 景品の定義（staff の CRUD） ---- */

  async listByEvent(eventId: string): Promise<MeetPrize[]> {
    return (
      await many<PrizeRow>(
        "SELECT * FROM event_prize WHERE event_id = ? ORDER BY created_at ASC, rowid ASC",
        eventId,
      )
    ).map(toPrize);
  },

  async findById(id: string): Promise<MeetPrize | null> {
    const r = await one<PrizeRow>("SELECT * FROM event_prize WHERE id = ?", id);
    return r ? toPrize(r) : null;
  },

  async countForEvent(eventId: string): Promise<number> {
    const row = await one<{ v: number }>(
      "SELECT COUNT(*) AS v FROM event_prize WHERE event_id = ?",
      eventId,
    );
    return row?.v ?? 0;
  },

  async create(
    eventId: string,
    input: CreateMeetPrizeInput,
  ): Promise<MeetPrize> {
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO event_prize
         (id, event_id, name, description, condition_type, threshold, stock, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      eventId,
      input.name,
      input.description,
      input.conditionType,
      input.conditionType === "meet_count" ? input.threshold : null,
      input.stock,
      Date.now(),
    );
    return (await this.findById(id))!;
  },

  async update(
    id: string,
    input: UpdateMeetPrizeInput,
  ): Promise<MeetPrize | null> {
    await run(
      `UPDATE event_prize SET name = ?, description = ?, condition_type = ?,
              threshold = ?, stock = ? WHERE id = ?`,
      input.name,
      input.description,
      input.conditionType,
      input.conditionType === "meet_count" ? input.threshold : null,
      input.stock,
      id,
    );
    return this.findById(id);
  },

  async delete(id: string): Promise<void> {
    // 引き換え記録は FK CASCADE で消える（UI 側が消す前に警告する）
    await run("DELETE FROM event_prize WHERE id = ?", id);
  },

  /* ---- 引き換え（在庫の早い者勝ちの正） ---- */

  /**
   * 交換済みにする。二重引き換えと在庫超過を**1文**で同時に塞ぐ。
   *
   * 「数えてから入れる」を2文に分けると、残り1個に同時到達した2窓口が
   * 両方通る（consumeMeetToken と同じ罠）。SQLite/D1 は1文が原子的なので、
   * 重複チェックと在庫チェックを INSERT の WHERE に畳む。
   * (prize_id, user_id) の UNIQUE インデックスは二重引き換えの最後の砦。
   *
   * @returns true=引き換えた / false=入らなかった（既に交換済みか在庫切れ。
   *          どちらかは findRedemption で読み直して区別する） */
  async redeem(
    prizeId: string,
    userId: string,
    redeemedBy: string,
  ): Promise<boolean> {
    const changes = await runCount(
      `INSERT INTO event_prize_redemption (id, prize_id, user_id, redeemed_by, created_at)
       SELECT ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM event_prize_redemption
                           WHERE prize_id = ? AND user_id = ?)
          AND (SELECT COUNT(*) FROM event_prize_redemption WHERE prize_id = ?)
              < (SELECT stock FROM event_prize WHERE id = ?)`,
      crypto.randomUUID(),
      prizeId,
      userId,
      redeemedBy,
      Date.now(),
      prizeId,
      userId,
      prizeId,
      prizeId,
    );
    return changes > 0;
  },

  async findRedemption(
    prizeId: string,
    userId: string,
  ): Promise<{ id: string; createdAt: number } | null> {
    const r = await one<{ id: string; created_at: number }>(
      "SELECT id, created_at FROM event_prize_redemption WHERE prize_id = ? AND user_id = ?",
      prizeId,
      userId,
    );
    return r ? { id: r.id, createdAt: r.created_at } : null;
  },

  /** 交換済みの取り消し（誤操作訂正）。在庫は導出なので自然に1戻る */
  async deleteRedemption(prizeId: string, userId: string): Promise<boolean> {
    const changes = await runCount(
      "DELETE FROM event_prize_redemption WHERE prize_id = ? AND user_id = ?",
      prizeId,
      userId,
    );
    return changes > 0;
  },

  /** 景品ごとの引き換え済み数（残数の導出用）。0件の景品はキーが無い */
  async redemptionCounts(eventId: string): Promise<Map<string, number>> {
    const rows = await many<{ prize_id: string; n: number }>(
      `SELECT r.prize_id, COUNT(*) AS n
         FROM event_prize_redemption r
         JOIN event_prize p ON p.id = r.prize_id
        WHERE p.event_id = ?
        GROUP BY r.prize_id`,
      eventId,
    );
    return new Map(rows.map((r) => [r.prize_id, r.n]));
  },

  /** イベント内の引き換え記録を1文でまとめて返す（prize_id → user_id → 引き換え時刻）。
   * デスク画面は景品×達成者ぶんの行を出すので、1件ずつ findRedemption を
   * 呼ぶと人数×景品数の N+1 になる（100人×16景品で1,600クエリを5秒おき）。
   * 呼び出し側はこの Map を1回組んで引く */
  async redemptionsForEvent(
    eventId: string,
  ): Promise<Map<string, Map<string, number>>> {
    const rows = await many<{
      prize_id: string;
      user_id: string;
      created_at: number;
    }>(
      `SELECT r.prize_id, r.user_id, r.created_at
         FROM event_prize_redemption r
         JOIN event_prize p ON p.id = r.prize_id
        WHERE p.event_id = ?`,
      eventId,
    );
    const map = new Map<string, Map<string, number>>();
    for (const r of rows) {
      let inner = map.get(r.prize_id);
      if (!inner) map.set(r.prize_id, (inner = new Map()));
      inner.set(r.user_id, r.created_at);
    }
    return map;
  },

  /** 本人が交換済みの景品 id（公開一覧の me 用） */
  async redeemedPrizeIdsForUser(
    eventId: string,
    userId: string,
  ): Promise<string[]> {
    const rows = await many<{ prize_id: string }>(
      `SELECT r.prize_id
         FROM event_prize_redemption r
         JOIN event_prize p ON p.id = r.prize_id
        WHERE p.event_id = ? AND r.user_id = ?`,
      eventId,
      userId,
    );
    return rows.map((r) => r.prize_id);
  },

  /* ---- 1位の確定（締めた時点のスナップショット） ---- */

  /**
   * 1位を確定する（締め直し＝全置換。同率1位は全員が勝者）。
   * DELETE+INSERT を batch でアトミックに行う。
   *
   * 出会いが1件も無いときは**何も消さずに** 0 を返す。先に DELETE してから
   * 気づくと、「締めた後に出会いが全部取り消された」状態からの締め直しで
   * 既存の勝者が黙って消える（409 を返すのに確定は失われている）。
   * @returns 勝者の人数（0 なら誰も出会っていない＝呼び出し側が締めを断る） */
  async closeWinners(eventId: string, now: number): Promise<number> {
    const any = await one<{ v: number }>(
      "SELECT 1 AS v FROM event_meet WHERE event_id = ? LIMIT 1",
      eventId,
    );
    if (!any) return 0;
    const [, inserted] = await batch([
      {
        sql: "DELETE FROM event_meet_winner WHERE event_id = ?",
        args: [eventId],
      },
      {
        sql: `INSERT INTO event_meet_winner (event_id, user_id, count, decided_at)
              SELECT ?, t.id, t.n, ?
                FROM (${PER_USER_COUNTS_SQL}) t
               WHERE t.n = (SELECT MAX(t2.n) FROM (${PER_USER_COUNTS_SQL}) t2)`,
        args: [eventId, now, eventId, eventId, eventId, eventId],
      },
    ]);
    return inserted ?? 0;
  },

  /** 確定を取り消して未確定に戻す（誤操作用） */
  async clearWinners(eventId: string): Promise<void> {
    await run("DELETE FROM event_meet_winner WHERE event_id = ?", eventId);
  },

  /** 「1位が確定済みか」は行の有無で表す（別フラグを持たない） */
  async winnersDecided(eventId: string): Promise<boolean> {
    const row = await one<{ v: number }>(
      "SELECT 1 AS v FROM event_meet_winner WHERE event_id = ? LIMIT 1",
      eventId,
    );
    return Boolean(row);
  },

  async isWinner(eventId: string, userId: string): Promise<boolean> {
    const row = await one<{ v: number }>(
      "SELECT 1 AS v FROM event_meet_winner WHERE event_id = ? AND user_id = ?",
      eventId,
      userId,
    );
    return Boolean(row);
  },

  /** 確定済みの1位（staff のデスク画面用。名前入り） */
  async listWinners(eventId: string): Promise<MeetWinner[]> {
    const rows = await many<{
      user_id: string;
      username: string;
      global_name: string | null;
      avatar_url: string | null;
      count: number;
      decided_at: number;
    }>(
      `SELECT w.user_id, u.username, u.global_name, u.avatar_url, w.count, w.decided_at
         FROM event_meet_winner w
         JOIN user u ON u.id = w.user_id AND u.deleted_at IS NULL
        WHERE w.event_id = ?
        ORDER BY u.username ASC`,
      eventId,
    );
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      name: r.global_name ?? r.username,
      avatarUrl: r.avatar_url,
      count: r.count,
      decidedAt: r.decided_at,
    }));
  },

  /* ---- デスク画面の達成者一覧（staff のみ） ---- */

  /**
   * 「N人以上と出会った人」を件数つきで返す（meet_count 景品の達成者）。
   * 集計は PER_USER_COUNTS_SQL の1本（新しい集計を書かない）。
   * redeemed は呼び出し側が redemption と突き合わせて埋める */
  async achieversAtLeast(
    eventId: string,
    threshold: number,
  ): Promise<Omit<MeetPrizeAchiever, "redeemed" | "redeemedAt">[]> {
    const rows = await many<{
      id: string;
      username: string;
      global_name: string | null;
      avatar_url: string | null;
      n: number;
    }>(
      `SELECT id, username, global_name, avatar_url, n
         FROM (${PER_USER_COUNTS_SQL}) t
        WHERE n >= ?
        ORDER BY n DESC, username ASC`,
      eventId,
      eventId,
      threshold,
    );
    return rows.map((r) => ({
      userId: r.id,
      username: r.username,
      name: r.global_name ?? r.username,
      avatarUrl: r.avatar_url,
      count: r.n,
    }));
  },
};
