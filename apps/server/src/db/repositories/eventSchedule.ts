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
    // 生のリンクは表示用と別に必ず返す (#250)。編集画面はこれを保持したまま
    // 保存するので、猶予期間中に staff がタイムテーブルを保存しても
    // speaker_user_id が NULL 落ちせず、復帰すれば登壇者表示が戻る
    speakerUserId: row.speaker_user_id,
    // ユーザーに紐付いた枠は speaker_name を返さない (#250)。
    // LEFT JOIN の ON 側で退会申請中を外して speaker を null にしても、
    // 手入力名が残っていると表示名がそのまま出てしまう。
    // 紐付け時は Web 側も speakerName を空にしているので表示は変わらない
    speakerName: row.speaker_user_id ? "" : row.speaker_name,
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
  FROM event_schedule_item s LEFT JOIN user u ON u.id = s.speaker_user_id
    AND u.deleted_at IS NULL`;
// 退会申請中 (#250) は ON 側で外す。タイムテーブルの枠は残し登壇者名だけ匿名化する
// （完全削除時も speaker_user_id は SET NULL で枠は残る）

export const eventScheduleRepo = {
  async listByEvent(eventId: string): Promise<ScheduleItem[]> {
    const rows = await many<Row>(
      `${SELECT} WHERE s.event_id = ? ORDER BY s.sort_order ASC`,
      eventId,
    );
    return rows.map(toItem);
  },

  /** 全項目をアトミックに置き換える（削除＋一括挿入）。並び順は配列順。
   * OG サムネイルは URL が同じ既存項目からキャッシュを引き継ぐ
   * （保存のたびに全再取得してサムネイルが一瞬消えるのを防ぐ） */
  async replaceAll(
    eventId: string,
    items: SaveScheduleItemInput[],
  ): Promise<ScheduleItem[]> {
    const now = Date.now();
    // URL → 取得済みOGメタ の引き継ぎマップ
    const ogByUrl = new Map<string, string>();
    for (const row of await many<{ material_url: string; material_og_image: string; material_og_url: string }>(
      "SELECT material_url, material_og_image, material_og_url FROM event_schedule_item WHERE event_id = ? AND material_og_url <> ''",
      eventId,
    )) {
      if (row.material_og_url === row.material_url) {
        ogByUrl.set(row.material_url, row.material_og_image);
      }
    }
    await batch([
      {
        sql: "DELETE FROM event_schedule_item WHERE event_id = ?",
        args: [eventId],
      },
      ...items.map((it, i) => ({
        sql: `INSERT INTO event_schedule_item
          (id, event_id, title, description, duration_min, starts_at,
           speaker_user_id, speaker_name, material_url, material_og_image, material_og_url, sort_order, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          ogByUrl.get(it.materialUrl) ?? "",
          ogByUrl.has(it.materialUrl) ? it.materialUrl : "",
          i,
          now,
        ],
      })),
    ]);
    return this.listByEvent(eventId);
  },

  /** 1項目を取得（イベント跨ぎ防止のため eventId でも絞る）。
   * speakerUserId は toItem が生の値を返すので、ユーザーが猶予期間中でも
   * 登壇者本人かどうかを判定できる */
  async findItem(
    eventId: string,
    itemId: string,
  ): Promise<ScheduleItem | null> {
    const row = await one<Row>(
      `${SELECT} WHERE s.event_id = ? AND s.id = ?`,
      eventId,
      itemId,
    );
    return row ? toItem(row) : null;
  },

  /** 資料URLのみ更新（登壇者本人の自己編集用 #148）。
   * URL が変わるので OG キャッシュはクリアし、バックグラウンド再取得に任せる */
  async updateMaterial(
    eventId: string,
    itemId: string,
    url: string,
  ): Promise<void> {
    await run(
      `UPDATE event_schedule_item
        SET material_url = ?, material_og_image = '', material_og_url = ''
        WHERE id = ? AND event_id = ?`,
      url,
      itemId,
      eventId,
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
  /** OG メタを書き込む。取得開始時の URL と現在値が一致する場合のみ反映
   * （並行実行の古い結果で新しい URL のサムネイルを上書きしないための CAS） */
  async setOgMeta(
    itemId: string,
    ogImage: string,
    ogUrl: string,
  ): Promise<void> {
    await run(
      "UPDATE event_schedule_item SET material_og_image = ?, material_og_url = ? WHERE id = ? AND material_url = ?",
      ogImage,
      ogUrl,
      itemId,
      ogUrl,
    );
  },

  /** 公開プロフィール用: そのユーザーが登壇者として紐づいている公開イベントの id (#308)。
   * タイムテーブルは公開イベントページで誰でも見られる情報なので公開してよい。
   * 下書き・非公開のイベントは id も返さない */
  async listPublicSpokenEventIds(userId: string): Promise<string[]> {
    const rows = await many<{ event_id: string }>(
      `SELECT DISTINCT si.event_id FROM event_schedule_item si
         JOIN event e ON e.id = si.event_id
        WHERE si.speaker_user_id = ? AND e.status = 'published'`,
      userId,
    );
    return rows.map((r) => r.event_id);
  },
};
