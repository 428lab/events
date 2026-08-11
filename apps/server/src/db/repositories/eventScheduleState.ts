import { SCHEDULE_EDIT_EXPIRE_MS } from "@eventer/shared";
import type { ScheduleEditingState, ScheduleEditingUser } from "@eventer/shared";
import { one, run, runCount } from "../client.js";

/**
 * タイムテーブルの同時編集の状態 (#340)。イベントごとに1行。
 *
 * 2つの役割を1行で持つ。
 *
 * - **版 (version)**  … 保存の最終防衛。読んだ版と食い違えば保存を止める
 * - **編集中の人**    … 声かけのための表示。厳密な排他ではない
 *
 * 配信の操作状態 (eventLiveState) と同じ形。常時接続を使わないので、
 * 画面は短い間隔で取りに行く。
 */

interface Row {
  event_id: string;
  version: number;
  editor_user_id: string | null;
  editor_since: number | null;
  editor_seen_at: number | null;
  u_username: string | null;
  u_global_name: string | null;
  u_avatar_url: string | null;
}

// 退会申請中・削除済み (#250) は ON 側で外す。編集中という事実は残しつつ
// 表示名だけ伏せる（画面は「ほかの運営メンバー」と出す）
const SELECT = `SELECT s.event_id, s.version, s.editor_user_id, s.editor_since,
  s.editor_seen_at, u.username AS u_username, u.global_name AS u_global_name,
  u.avatar_url AS u_avatar_url
  FROM event_schedule_state s LEFT JOIN user u ON u.id = s.editor_user_id
    AND u.deleted_at IS NULL`;

/** 期限切れなら編集者を無かったことにして返す。
 * 期限切れの行を消して回る仕組みは持たず、**読むたびに時刻で判定する**。
 * 放置されたまま誰も画面を開かなければ掃除する必要も無い */
function toState(row: Row, now: number): ScheduleEditingState {
  const editor: ScheduleEditingUser | null =
    row.editor_user_id &&
    row.editor_seen_at !== null &&
    row.editor_seen_at > now - SCHEDULE_EDIT_EXPIRE_MS
      ? {
          userId: row.editor_user_id,
          name: row.u_global_name ?? row.u_username ?? "",
          avatarUrl: row.u_avatar_url,
          startedAt: row.editor_since ?? row.editor_seen_at,
          expiresAt: row.editor_seen_at + SCHEDULE_EDIT_EXPIRE_MS,
        }
      : null;
  return { editor, version: row.version };
}

export const eventScheduleStateRepo = {
  /** 現在の版だけ読む。**行が無ければ 0**（＝まだ一度も保存されていない）。
   * 公開GETからも呼ばれるので、ここでは行を作らない（読みで書きたくない） */
  async getVersion(eventId: string): Promise<number> {
    const row = await one<{ version: number }>(
      "SELECT version FROM event_schedule_state WHERE event_id = ?",
      eventId,
    );
    return row?.version ?? 0;
  },

  /** 行を用意してから読む（書き込み系の入口用）。
   * 版の条件付き更新は行が無いと必ず外れるので、先に 0 の行を作っておく */
  async getOrInit(eventId: string): Promise<ScheduleEditingState> {
    const now = Date.now();
    const row = await one<Row>(`${SELECT} WHERE s.event_id = ?`, eventId);
    if (row) return toState(row, now);
    await run(
      "INSERT OR IGNORE INTO event_schedule_state (event_id, version, updated_at) VALUES (?, 0, ?)",
      eventId,
      now,
    );
    return this.getOrInit(eventId);
  },

  /**
   * 版を1つ進める。**読んだ版と一致したときだけ**進み、進めば新しい版を返す。
   * 一致しなければ null（＝この間に誰かが保存している）。
   *
   * 条件付き UPDATE 1文で行うので、同じ版を持った2人が同時に保存しても
   * 通るのは片方だけになる。事前に読んで比べるだけでは、読んでから書くまでの
   * 隙間に両方が通ってしまう。
   */
  async bumpVersion(eventId: string, expected: number): Promise<number | null> {
    const changed = await runCount(
      "UPDATE event_schedule_state SET version = version + 1, updated_at = ? WHERE event_id = ? AND version = ?",
      Date.now(),
      eventId,
      expected,
    );
    return changed > 0 ? expected + 1 : null;
  },

  /** 版を無条件に1つ進める（登壇者本人の資料URL更新 #148 用）。
   * こちらは全体を上書きするわけではないので止める必要は無いが、
   * **staff が編集画面に抱えている版は古くなる**ので進めておく。
   * これで、編集開始時点の古いURLで全体保存して巻き戻す事故が止まる */
  async touch(eventId: string): Promise<void> {
    await this.getOrInit(eventId);
    await run(
      "UPDATE event_schedule_state SET version = version + 1, updated_at = ? WHERE event_id = ?",
      Date.now(),
      eventId,
    );
  },

  /**
   * 「自分が編集中」と宣言する／その宣言を延長する。心拍としても使う。
   *
   * **他人の編集中は奪わない**。ただし期限切れは空きとみなして引き継ぐ。
   * 奪えないだけで編集も保存も止めないので（助言）、放置されて詰むことはない。
   * 返すのは反映後の状態なので、奪えなかった側には相手の名前が返る。
   */
  async claimEditor(
    eventId: string,
    userId: string,
  ): Promise<ScheduleEditingState> {
    await this.getOrInit(eventId);
    const now = Date.now();
    const alive = now - SCHEDULE_EDIT_EXPIRE_MS;
    await run(
      `UPDATE event_schedule_state
          SET editor_user_id = ?,
              -- 続けて編集している間は開始時刻を据え置く（「◯時◯分から編集中」を保つ）
              editor_since = CASE
                WHEN editor_user_id = ? AND editor_seen_at > ? THEN editor_since
                ELSE ? END,
              editor_seen_at = ?,
              updated_at = ?
        WHERE event_id = ?
          AND (editor_user_id IS NULL OR editor_user_id = ? OR editor_seen_at IS NULL
               OR editor_seen_at <= ?)`,
      userId,
      userId,
      alive,
      now,
      now,
      now,
      eventId,
      userId,
      alive,
    );
    return this.getOrInit(eventId);
  },

  /** 編集をやめたことを伝える（画面を閉じた・保存し終えた）。
   * **自分が持っているときだけ**外す。行は消さない（版が消えるため） */
  async releaseEditor(
    eventId: string,
    userId: string,
  ): Promise<ScheduleEditingState> {
    await run(
      `UPDATE event_schedule_state
          SET editor_user_id = NULL, editor_since = NULL, editor_seen_at = NULL,
              updated_at = ?
        WHERE event_id = ? AND editor_user_id = ?`,
      Date.now(),
      eventId,
      userId,
    );
    return this.getOrInit(eventId);
  },
};
