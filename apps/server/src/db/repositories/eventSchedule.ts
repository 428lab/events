import type {
  EventTrack,
  SaveScheduleItemInput,
  SaveScheduleTrackInput,
  SchedulePlacement,
  ScheduleItem,
} from "@eventer/shared";
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
  placement: string;
  u_username: string | null;
  u_global_name: string | null;
  u_avatar_url: string | null;
}

interface TrackRow {
  id: string;
  name: string;
  sort_order: number;
}

/** DB の値を配置状態に読み替える。未知の値は「全トラック共通」に倒す
 * （参加者から消えるより、いまの見え方のまま出るほうが安全 #338） */
function toPlacement(value: string): SchedulePlacement {
  return value === "unassigned" || value === "tracks" ? value : "all";
}

function toItem(row: Row, trackIds: string[] = []): ScheduleItem {
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
    placement: toPlacement(row.placement),
    // 対応表は placement が 'tracks' のときだけ意味を持つ。
    // 'all'（全トラック共通）と 'unassigned'（未割り当て）はどちらも空
    trackIds,
  };
}

const SELECT = `SELECT s.id, s.event_id, s.title, s.description, s.duration_min,
  s.starts_at, s.speaker_user_id, s.speaker_name, s.material_url,
  s.material_og_image, s.sort_order, s.placement,
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
    const links = await many<{ item_id: string; track_id: string }>(
      `SELECT it.item_id, it.track_id FROM event_schedule_item_track it
         JOIN event_schedule_item s ON s.id = it.item_id
         JOIN event_track t ON t.id = it.track_id
        WHERE s.event_id = ? ORDER BY t.sort_order ASC`,
      eventId,
    );
    const byItem = new Map<string, string[]>();
    for (const l of links) {
      const list = byItem.get(l.item_id);
      if (list) list.push(l.track_id);
      else byItem.set(l.item_id, [l.track_id]);
    }
    return rows.map((r) => toItem(r, byItem.get(r.id) ?? []));
  },

  /** いま存在する項目・トラックの ID (#340)。
   * 保存の入力に**知らない ID** が混じっていないかを見るために使う。
   * 知らない ID は「編集画面を開いている間に他人が消した」ものなので、
   * 新規として採番し直すと消したはずのセッションが復活してしまう */
  async listIds(
    eventId: string,
  ): Promise<{ itemIds: Set<string>; trackIds: Set<string> }> {
    const [items, tracks] = await Promise.all([
      many<{ id: string }>(
        "SELECT id FROM event_schedule_item WHERE event_id = ?",
        eventId,
      ),
      many<{ id: string }>(
        "SELECT id FROM event_track WHERE event_id = ?",
        eventId,
      ),
    ]);
    return {
      itemIds: new Set(items.map((r) => r.id)),
      trackIds: new Set(tracks.map((r) => r.id)),
    };
  },

  /** イベントのトラック一覧（並び順） (#338) */
  async listTracks(eventId: string): Promise<EventTrack[]> {
    const rows = await many<TrackRow>(
      "SELECT id, name, sort_order FROM event_track WHERE event_id = ? ORDER BY sort_order ASC",
      eventId,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
    }));
  },

  /** 送られた全項目をアトミックに反映する (#340)。
   * ID が既存項目と一致すれば更新（＝ID が保存をまたいで変わらない）、
   * ID 無し・未知の ID は追加、送られなかった既存項目は削除。並び順は配列順。
   *
   * ID を安定させるのは、登壇者本人の資料URL編集 (#148) が他人の保存で
   * 迷子にならないようにするためと、セッションを ID で参照する後続機能
   * （トラック割り当て #338）が保存のたびに消えないようにするため。
   *
   * OG サムネイルは、URL が変わらない項目はそのまま残し、新規・URL 変更時は
   * 同じ URL を持つ既存項目からキャッシュを引き継ぐ
   * （保存のたびに全再取得してサムネイルが一瞬消えるのを防ぐ）。
   *
   * トラック (#338) も同じ差分の規則で一緒に反映する。tracks が undefined の
   * ときは **トラックを知らないクライアント**からの保存なので、トラックの定義・
   * 割り当て・配置状態には一切触らない（既存値をそのまま書き戻す）。 */
  async saveAll(
    eventId: string,
    items: SaveScheduleItemInput[],
    tracks?: SaveScheduleTrackInput[],
  ): Promise<ScheduleItem[]> {
    const now = Date.now();
    const existing = await many<{
      id: string;
      material_url: string;
      material_og_image: string;
      material_og_url: string;
      placement: string;
    }>(
      "SELECT id, material_url, material_og_image, material_og_url, placement FROM event_schedule_item WHERE event_id = ?",
      eventId,
    );
    // トラックの差分。添字 → 反映後のトラック ID（新規は採番済み）
    const trackStmts: Array<{ sql: string; args: unknown[] }> = [];
    const trackIdByIndex: string[] = [];
    if (tracks) {
      const existingTracks = await many<{ id: string }>(
        "SELECT id FROM event_track WHERE event_id = ?",
        eventId,
      );
      const trackIds = new Set(existingTracks.map((t) => t.id));
      const keptTracks = new Set<string>();
      tracks.forEach((t, i) => {
        // 項目と同じく、既存 ID との一致だけを更新扱いにする
        if (t.id && trackIds.has(t.id) && !keptTracks.has(t.id)) {
          keptTracks.add(t.id);
          trackIdByIndex.push(t.id);
          trackStmts.push({
            sql: "UPDATE event_track SET name = ?, sort_order = ? WHERE id = ? AND event_id = ?",
            args: [t.name, i, t.id, eventId],
          });
          return;
        }
        const id = crypto.randomUUID();
        trackIdByIndex.push(id);
        trackStmts.push({
          sql: "INSERT INTO event_track (id, event_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
          args: [id, eventId, t.name, i, now],
        });
      });
      // 送られなかった既存トラックは削除。対応表の行は FK の CASCADE で消える。
      // そのトラックにしか載っていなかったセッションは、下の placement の
      // 決め方（トラックが空なら未割り当て）でそのまま未割り当てに戻る
      for (const t of existingTracks) {
        if (keptTracks.has(t.id)) continue;
        trackStmts.push({
          sql: "DELETE FROM event_track WHERE id = ? AND event_id = ?",
          args: [t.id, eventId],
        });
      }
    }
    const byId = new Map(existing.map((r) => [r.id, r]));
    // URL → 取得済みOGメタ の引き継ぎマップ（新規・URL 変更時のみ使う）
    const ogByUrl = new Map<string, string>();
    for (const row of existing) {
      if (row.material_og_url !== "" && row.material_og_url === row.material_url) {
        ogByUrl.set(row.material_url, row.material_og_image);
      }
    }

    /** その項目の配置状態と割り当て先を決める (#338)。
     * トラックを知らないクライアントからの保存 (tracks 未指定) は既存値のまま。
     *
     * **割り当て先が空なら未割り当て**。トラックを消して載る先が無くなった場合も、
     * 編集画面でチップを全部外した場合も、規則はこの1つだけ */
    const placementOf = (
      it: SaveScheduleItemInput,
      current: string | undefined,
    ): { placement: SchedulePlacement; trackIds: string[] } => {
      if (!tracks) return { placement: toPlacement(current ?? "all"), trackIds: [] };
      if (it.placement === "unassigned") {
        return { placement: "unassigned", trackIds: [] };
      }
      if (it.placement === "all") return { placement: "all", trackIds: [] };
      const ids = [
        ...new Set(
          it.trackIndexes
            .map((n) => trackIdByIndex[n])
            .filter((id): id is string => id !== undefined),
        ),
      ];
      return ids.length > 0
        ? { placement: "tracks", trackIds: ids }
        : { placement: "unassigned", trackIds: [] };
    };

    const kept = new Set<string>();
    const stmts: Array<{ sql: string; args: unknown[] }> = [];
    // 反映後の 項目ID → 割り当て先トラックID（対応表の書き直しに使う）
    const linksByItem: Array<{ itemId: string; trackIds: string[] }> = [];
    items.forEach((it, i) => {
      // 既存 ID との一致だけを更新対象にする。他イベントの ID や重複指定は
      // 採用せず新規として採番し直す（クライアントの ID を主キーにしない）
      const current = it.id && !kept.has(it.id) ? byId.get(it.id) : undefined;
      if (current) {
        kept.add(current.id);
        const place = placementOf(it, current.placement);
        linksByItem.push({ itemId: current.id, trackIds: place.trackIds });
        // URL が変わらない限り OG キャッシュには触らない
        const [ogImage, ogUrl] =
          it.materialUrl === current.material_url
            ? [current.material_og_image, current.material_og_url]
            : ogByUrl.has(it.materialUrl)
              ? [ogByUrl.get(it.materialUrl)!, it.materialUrl]
              : ["", ""];
        stmts.push({
          sql: `UPDATE event_schedule_item
            SET title = ?, description = ?, duration_min = ?, starts_at = ?,
                speaker_user_id = ?, speaker_name = ?, material_url = ?,
                material_og_image = ?, material_og_url = ?, sort_order = ?,
                placement = ?
            WHERE id = ? AND event_id = ?`,
          args: [
            it.title,
            it.description,
            it.durationMin,
            it.startsAt,
            it.speakerUserId,
            it.speakerName,
            it.materialUrl,
            ogImage,
            ogUrl,
            i,
            place.placement,
            current.id,
            eventId,
          ],
        });
        return;
      }
      const id = crypto.randomUUID();
      const place = placementOf(it, undefined);
      linksByItem.push({ itemId: id, trackIds: place.trackIds });
      stmts.push({
        sql: `INSERT INTO event_schedule_item
          (id, event_id, title, description, duration_min, starts_at,
           speaker_user_id, speaker_name, material_url, material_og_image, material_og_url, sort_order, created_at, placement)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
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
          place.placement,
        ],
      });
    });

    // 対応表は毎回このイベントぶんを消してから入れ直す。
    // 差分を取っても行数は変わらず、消し忘れだけが増えるため
    const linkStmts: Array<{ sql: string; args: unknown[] }> = [];
    if (tracks) {
      linkStmts.push({
        sql: `DELETE FROM event_schedule_item_track WHERE item_id IN
              (SELECT id FROM event_schedule_item WHERE event_id = ?)`,
        args: [eventId],
      });
      for (const link of linksByItem) {
        for (const trackId of link.trackIds) {
          linkStmts.push({
            sql: "INSERT INTO event_schedule_item_track (item_id, track_id) VALUES (?, ?)",
            args: [link.itemId, trackId],
          });
        }
      }
    }

    const removed = existing.filter((r) => !kept.has(r.id)).map((r) => r.id);
    await batch([
      ...removed.map((id) => ({
        sql: "DELETE FROM event_schedule_item WHERE id = ? AND event_id = ?",
        args: [id, eventId],
      })),
      // トラックの追加・改名・並べ替え・削除を先に済ませてから項目を書く。
      // 対応表の INSERT は参照先（項目・トラック）が揃ってからでないと通らない
      ...trackStmts,
      ...stmts,
      ...linkStmts,
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
    if (!row) return null;
    const links = await many<{ track_id: string }>(
      `SELECT it.track_id FROM event_schedule_item_track it
         JOIN event_track t ON t.id = it.track_id
        WHERE it.item_id = ? ORDER BY t.sort_order ASC`,
      row.id,
    );
    return toItem(
      row,
      links.map((l) => l.track_id),
    );
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
   * 下書き・非公開のイベントは id も返さない。
   * 未割り当て（ネタ出し中 #338）は参加者に見せないので、ここでも数えない */
  async listPublicSpokenEventIds(userId: string): Promise<string[]> {
    const rows = await many<{ event_id: string }>(
      `SELECT DISTINCT si.event_id FROM event_schedule_item si
         JOIN event e ON e.id = si.event_id
        WHERE si.speaker_user_id = ? AND e.status = 'published'
          AND si.placement != 'unassigned'`,
      userId,
    );
    return rows.map((r) => r.event_id);
  },
};
