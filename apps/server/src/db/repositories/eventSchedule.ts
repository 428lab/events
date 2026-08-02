import type { SaveScheduleItemInput, ScheduleItem } from "@eventer/shared";
import { batch, many, one, run } from "../client.js";

interface Row {
  id: string;
  event_id: string;
  title: string;
  description: string;
  duration_min: number;
  starts_at: number | null;
  speaker_user_id: string | null;
  speaker_name: string;
  material_url: string;
  material_og_image: string;
  sort_order: number;
  u_username: string | null;
  u_global_name: string | null;
  u_avatar_url: string | null;
}

function toItem(row: Row): ScheduleItem {
  return {
    id: row.id,
    eventId: row.event_id,
    title: row.title,
    description: row.description,
    durationMin: row.duration_min,
    startsAt: row.starts_at,
    // JOIN できた場合のみ担当者をユーザー情報として返す（削除済み等は null）
    speaker:
      row.speaker_user_id && row.u_username
        ? {
            id: row.speaker_user_id,
            username: row.u_username,
            globalName: row.u_global_name,
            avatarUrl: row.u_avatar_url,
          }
        : null,
    speakerName: row.speaker_name,
    materialUrl: row.material_url,
    materialOgImage: row.material_og_image,
    sortOrder: row.sort_order,
  };
}

const SELECT = `SELECT s.id, s.event_id, s.title, s.description, s.duration_min,
  s.starts_at, s.speaker_user_id, s.speaker_name, s.material_url,
  s.material_og_image, s.sort_order,
  u.username AS u_username, u.global_name AS u_global_name,
  u.avatar_url AS u_avatar_url
  FROM event_schedule_item s LEFT JOIN user u ON u.id = s.speaker_user_id`;

export const eventScheduleRepo = {
  async listByEvent(eventId: string): Promise<ScheduleItem[]> {
    const rows = await many<Row>(
      `${SELECT} WHERE s.event_id = ? ORDER BY s.sort_order ASC`,
      eventId,
    );
    return rows.map(toItem);
  },

  /** 全項目をアトミックに置き換える（削除＋一括挿入）。並び順は配列順。 */
  async replaceAll(
    eventId: string,
    items: SaveScheduleItemInput[],
  ): Promise<ScheduleItem[]> {
    const now = Date.now();
    await batch([
      {
        sql: "DELETE FROM event_schedule_item WHERE event_id = ?",
        args: [eventId],
      },
      ...items.map((it, i) => ({
        sql: `INSERT INTO event_schedule_item
          (id, event_id, title, description, duration_min, starts_at,
           speaker_user_id, speaker_name, material_url, sort_order, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          crypto.randomUUID(),
          eventId,
          it.title,
          it.description,
          it.durationMin,
          it.startsAt,
          it.speakerUserId,
          it.speakerName,
          it.materialUrl,
          i,
          now,
        ],
      })),
    ]);
    return this.listByEvent(eventId);
  },

  /** 1項目を取得（イベント跨ぎ防止のため eventId でも絞る）。
   * 権限判定用に生の speaker_user_id も返す（ユーザー削除済みでも判定できるように） */
  async findItem(
    eventId: string,
    itemId: string,
  ): Promise<(ScheduleItem & { speakerUserId: string | null }) | null> {
    const row = await one<Row>(
      `${SELECT} WHERE s.event_id = ? AND s.id = ?`,
      eventId,
      itemId,
    );
    return row ? { ...toItem(row), speakerUserId: row.speaker_user_id } : null;
  },

  /** 資料URLのみ更新（登壇者本人の自己編集用 #148）。
   * URL が変わるので OG キャッシュはクリアし、バックグラウンド再取得に任せる */
  async updateMaterial(itemId: string, url: string): Promise<void> {
    await run(
      `UPDATE event_schedule_item
        SET material_url = ?, material_og_image = '', material_og_url = ''
        WHERE id = ?`,
      url,
      itemId,
    );
  },

  /** OG メタが未取得（URL 変更含む）の項目を列挙する (#149) */
  async listNeedingOgRefresh(
    eventId: string,
    limit: number,
  ): Promise<Array<{ id: string; materialUrl: string }>> {
    const rows = await many<{ id: string; material_url: string }>(
      `SELECT id, material_url FROM event_schedule_item
        WHERE event_id = ? AND material_url != '' AND material_og_url != material_url
        ORDER BY sort_order ASC LIMIT ?`,
      eventId,
      limit,
    );
    return rows.map((r) => ({ id: r.id, materialUrl: r.material_url }));
  },

  /** OG メタのキャッシュを保存する（失敗時も og_url を埋めて再取得ループを防ぐ） */
  async setOgMeta(
    itemId: string,
    ogImage: string,
    ogUrl: string,
  ): Promise<void> {
    await run(
      "UPDATE event_schedule_item SET material_og_image = ?, material_og_url = ? WHERE id = ?",
      ogImage,
      ogUrl,
      itemId,
    );
  },
};
