import type { LiveDeckSummary } from "@eventer/shared";
import { activeManagerSql, adminIds } from "./eventAccessInvites.js";
import { publicItemWhere } from "./eventSchedule.js";
import { eventWrite, type EventWriter } from "./eventWriteGuard.js";
import { many } from "../client.js";

/** **「紐付けが有効」の定義はここ1か所だけ** (#571 設計 3.2)。
 *
 * コマ `s` に紐付いたデッキ `d` を配信に使ってよいのは、次がすべて成り立つときだけ:
 * 1. `s` が参加者に見せるコマ（`publicItemWhere`）
 * 2. `s.live_deck_id = d.id`
 * 3. `d.owner_id = s.speaker_user_id`（紐付けた本人のデッキで、いまも担当者である）
 * 4. 担当者が退会しておらず、このイベントの現役メンバー（キャンセル済みでない）
 *
 * 一覧・選択・紐付け変更後の配信状態の追従は、すべてこの断片を通す。
 * 呼び出し側が `s.event_id` を絞る条件を足す。 */
const EFFECTIVE_LIVE_DECK_FROM = `FROM event_schedule_item s
  JOIN deck d ON d.id = s.live_deck_id AND d.owner_id = s.speaker_user_id
  JOIN user speaker ON speaker.id = s.speaker_user_id AND speaker.deleted_at IS NULL
  JOIN event_member speaker_member ON speaker_member.event_id = s.event_id
    AND speaker_member.user_id = s.speaker_user_id AND speaker_member.status <> 'canceled'
  WHERE ${publicItemWhere("s")}`;

/** そのコマで有効なデッキ ID を返すスカラー副問い合わせ。引数は (eventId, itemId) */
const EFFECTIVE_DECK_ID_OF_ITEM = `(SELECT d.id ${EFFECTIVE_LIVE_DECK_FROM} AND s.event_id = ? AND s.id = ?)`;

export const presenterSlidesRepo = {
  /** イベント内で有効な紐付けをすべて返す（コマ ID → デッキの要約）。slug は引かない */
  async effectiveDecks(eventId: string): Promise<Map<string, LiveDeckSummary>> {
    const rows = await many<{ item_id: string; deck_id: string; title: string; slide_count: number }>(
      `SELECT s.id AS item_id, d.id AS deck_id, d.title AS title,
          CASE WHEN json_valid(d.content) THEN COALESCE(json_array_length(d.content, '$.slides'), 0) ELSE 0 END AS slide_count
        ${EFFECTIVE_LIVE_DECK_FROM} AND s.event_id = ?`,
      eventId,
    );
    return new Map(rows.map((r) => [r.item_id, { id: r.deck_id, title: r.title, slideCount: r.slide_count }]));
  },

  /** 登壇者本人がコマにデッキを紐付ける（deckId）か、本人か staff が外す（null）。
   *
   * 権限は呼び出し側で先に判定するが、**同じ条件を UPDATE の WHERE にも書く**
   * （判定から書き込みまでの間に担当者・メンバー状態・デッキの持ち主が変わっても通さない）。
   * 同じ書き込みで、このコマが配信中なら配信状態のデッキも新しい有効な紐付けに追従させる
   * （外したなら `deck_id` は NULL になる）。返り値は紐付けを書き換えた行数。 */
  async setLink(eventId: string, itemId: string, deckId: string | null, writer: EventWriter): Promise<number> {
    const now = Date.now();
    const speakerSelf = `event_schedule_item.speaker_user_id = ? AND EXISTS (SELECT 1 FROM event_member m
      WHERE m.event_id = event_schedule_item.event_id AND m.user_id = ? AND m.status <> 'canceled')`;
    const target = `event_schedule_item.id = ? AND event_schedule_item.event_id = ? AND ${publicItemWhere("event_schedule_item")}`;
    const statements: Array<{ sql: string; args: unknown[] }> = [];
    if (deckId) {
      statements.push({
        sql: `UPDATE event_schedule_item SET live_deck_id = ?
          WHERE ${target} AND ${speakerSelf}
            AND EXISTS (SELECT 1 FROM deck owned WHERE owned.id = ? AND owned.owner_id = ?)`,
        args: [deckId, itemId, eventId, writer.actorId, writer.actorId, deckId, writer.actorId],
      });
    } else {
      const canClear = `((${speakerSelf}) OR EXISTS (SELECT 1 FROM event e WHERE e.id = event_schedule_item.event_id AND ${activeManagerSql("e", "?")}))`;
      const clearArgs = [itemId, eventId, writer.actorId, writer.actorId, writer.actorId, adminIds()];
      // 外すデッキがいま配信に出ていれば、紐付けを消す前に配信状態からも外す
      // （「その他のスライド」から直接出していた場合も含む。消した後では元の ID を引けない）
      statements.push({
        sql: `UPDATE event_live_state SET deck_id = NULL, deck_page = 0, updated_at = ?
          WHERE event_id = ? AND deck_id IS NOT NULL AND deck_id = (SELECT event_schedule_item.live_deck_id
            FROM event_schedule_item WHERE ${target} AND ${canClear})`,
        args: [now, eventId, ...clearArgs],
      });
      statements.push({
        sql: `UPDATE event_schedule_item SET live_deck_id = NULL WHERE ${target} AND ${canClear}`,
        args: clearArgs,
      });
    }
    // このコマが選ばれている最中なら、配信のデッキを新しい有効な紐付けに合わせる
    // （外したなら NULL、付け替えたなら新しいデッキの 1 ページ目）
    statements.push({
      sql: `UPDATE event_live_state
        SET deck_id = ${EFFECTIVE_DECK_ID_OF_ITEM},
            deck_page = CASE WHEN deck_id IS ${EFFECTIVE_DECK_ID_OF_ITEM} THEN deck_page ELSE 0 END,
            updated_at = ?
        WHERE event_id = ? AND presenter_item_id = ?`,
      args: [eventId, itemId, eventId, itemId, now, eventId, itemId],
    });
    const results = await eventWrite(writer, statements);
    // 紐付けの UPDATE は、設定なら1本目、解除なら2本目
    return results[deckId ? 0 : 1] ?? 0;
  },
};

/** 発表者を選ぶ PATCH の SET 句 (#571)。デッキはサーバーが有効な紐付けから解決し、
 * 1 ページ目に戻す。**同じコマ・同じデッキの選び直しはページを保つ**（誤タップで戻さない）。
 * SQLite の UPDATE の右辺は更新前の値を読むので、比較は選び直す前の状態に対して行われる。 */
export function selectPresenterAssignments(eventId: string, itemId: string | null): { sql: string; args: unknown[] } {
  if (itemId === null) {
    return { sql: "presenter_item_id = NULL, deck_id = NULL, deck_page = 0", args: [] };
  }
  return {
    sql: `presenter_item_id = ?, deck_id = ${EFFECTIVE_DECK_ID_OF_ITEM},
      deck_page = CASE WHEN presenter_item_id IS ? AND deck_id IS ${EFFECTIVE_DECK_ID_OF_ITEM} THEN deck_page ELSE 0 END`,
    args: [itemId, eventId, itemId, itemId, eventId, itemId],
  };
}
