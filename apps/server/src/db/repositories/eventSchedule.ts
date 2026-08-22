import type {
  EventTrack,
  SaveScheduleItemInput,
  SaveScheduleTrackInput,
  ScheduleAudience,
  SchedulePlacement,
  ScheduleItem,
  ScheduleVisibility,
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
  visibility: string;
  u_username: string | null;
  u_global_name: string | null;
  u_avatar_url: string | null;
}

interface TrackRow {
  id: string;
  name: string;
  sort_order: number;
  visibility: string;
}

/** DB の値を配置状態に読み替える。未知の値は「全トラック共通」に倒す
 * （参加者から消えるより、いまの見え方のまま出るほうが安全 #338） */
function toPlacement(value: string): SchedulePlacement {
  return value === "unassigned" || value === "tracks" ? value : "all";
}

/** DB の値を見え方に読み替える (#383)。
 *
 * **未知の値は `'staff'`（＝参加者に出さない）に倒す**。`placement` と逆向きなのは、
 * こちらは間違えたときの被害が非対称だから：表に出るはずの項目が出ないのは
 * 「運営が気づいて直せる不具合」だが、裏方が参加者に出るのは事故で、
 * しかも**誰も報告してくれない**（参加者は「そういうものか」と読む）。 */
function toVisibility(value: string): ScheduleVisibility {
  return value === "public" ? "public" : "staff";
}

/** **参加者に見せてよい項目の条件** (#383)。
 *
 * 「取ってきたあとで JS の filter で除く」をやめ、この断片を `WHERE` に入れる。
 * **見せる／見せないの軸を足すのはここだけ**。3本目の軸が要るようになったときも、
 * 直すのはこの1か所。
 *
 * 必ず**許可リスト**（`= 'public'`）で書く。`!= 'staff'`（拒否リスト）で書くと、
 * 将来値が増えたときに新しい値が参加者へ漏れる。既存の `placement != 'unassigned'` が
 * 実際にその形で、`placement` に値を足す案を採れなかった理由でもある
 * （`placement` 側は 0067 の制約が3値に固定しているので、いまはこの形のまま残す）。
 *
 * `eventSchedule.ts` の外からも使う。「参加者に見せてよい＝登壇として数えてよい」項目の
 * 定義が5か所に散っていた (#394) のを、これで1か所にする。 */
export const publicItemWhere = (alias: string): string =>
  `${alias}.placement != 'unassigned' AND ${alias}.visibility = 'public'`;

/** **参加者に見せてよいトラックの条件** (#383)。上と同じく許可リストで書く */
export const publicTrackWhere = (alias: string): string =>
  `${alias}.visibility = 'public'`;

/** その相手に返してよい項目だけに絞る `AND ...`（staff は絞らない）。
 * `audience` は**必須引数**なので、新しい呼び出し元は付け忘れるとコンパイルが通らない */
const itemFilter = (audience: ScheduleAudience, alias: string): string =>
  audience === "staff" ? "" : ` AND ${publicItemWhere(alias)}`;

/** 同じくトラック用。**SQL の中に三項演算子を直接書かない**のは、
 * `staff-timeline-sql-audit.test.ts` が SQL の文字列リテラルを機械的に走査するため。
 * 入れ子のテンプレートリテラルがあると literal の切り出しが壊れる */
const trackFilter = (audience: ScheduleAudience, alias: string): string =>
  audience === "staff" ? "" : ` AND ${publicTrackWhere(alias)}`;

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
    // 誰に見せるか (#383)。placement とは直交する別の軸で、混ぜない。
    // audience: "public" で取った結果はここが必ず 'public' になる
    visibility: toVisibility(row.visibility),
    // 対応表は placement が 'tracks' のときだけ意味を持つ。
    // 'all'（全トラック共通）と 'unassigned'（未割り当て）はどちらも空
    trackIds,
  };
}

const SELECT = `SELECT s.id, s.event_id, s.title, s.description, s.duration_min,
  s.starts_at, s.speaker_user_id, s.speaker_name, s.material_url,
  s.material_og_image, s.sort_order, s.placement, s.visibility,
  u.username AS u_username, u.global_name AS u_global_name,
  u.avatar_url AS u_avatar_url
  FROM event_schedule_item s LEFT JOIN user u ON u.id = s.speaker_user_id
    AND u.deleted_at IS NULL`;
// 退会申請中 (#250) は ON 側で外す。タイムテーブルの枠は残し登壇者名だけ匿名化する
// （完全削除時も speaker_user_id は SET NULL で枠は残る）

export const eventScheduleRepo = {
  /** タイムテーブルの項目一覧。
   *
   * **`audience` は必須**（既定値を持たせない #383）。`"public"` なら未割り当てと
   * 裏方が**そもそも SQL の結果に入らない**。「取ってから除く」形にしないのは、
   * 除き忘れた経路が黙って参加者へ配ってしまうため（実際にそうなっていた）。 */
  async listByEvent(
    eventId: string,
    audience: ScheduleAudience,
  ): Promise<ScheduleItem[]> {
    const rows = await many<Row>(
      `${SELECT} WHERE s.event_id = ?${itemFilter(audience, "s")}
        ORDER BY s.sort_order ASC`,
      eventId,
    );
    // 対応表も同じ相手向けに絞る。絞らないと trackIds にスタッフ用トラックの ID が
    // 混ざり、**トラックの一覧には無い ID を参加者の画面が受け取る**
    // （描画は壊れないが、スタッフ用トラックが在ること自体が漏れる #383）
    const links = await many<{ item_id: string; track_id: string }>(
      `SELECT it.item_id, it.track_id FROM event_schedule_item_track it
         JOIN event_schedule_item s ON s.id = it.item_id
         JOIN event_track t ON t.id = it.track_id
        WHERE s.event_id = ?${itemFilter(audience, "s")}${trackFilter(audience, "t")}
        ORDER BY t.sort_order ASC`,
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

  /** イベントのトラック一覧（並び順） (#338)。
   * `audience` は**必須** (#383)。`"public"` ならスタッフ用の列は入らない */
  async listTracks(
    eventId: string,
    audience: ScheduleAudience,
  ): Promise<EventTrack[]> {
    const rows = await many<TrackRow>(
      `SELECT id, name, sort_order, visibility FROM event_track
        WHERE event_id = ?${trackFilter(audience, "event_track")}
        ORDER BY sort_order ASC`,
      eventId,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
      visibility: toVisibility(r.visibility),
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
      visibility: string;
    }>(
      "SELECT id, material_url, material_og_image, material_og_url, placement, visibility FROM event_schedule_item WHERE event_id = ?",
      eventId,
    );
    // トラックの差分。添字 → 反映後のトラック ID（新規は採番済み）
    const trackStmts: Array<{ sql: string; args: unknown[] }> = [];
    const trackIdByIndex: string[] = [];
    // 添字 → そのトラックがスタッフ用か (#383)。下の 4.2 の正規化で使う
    const trackIsStaffByIndex: boolean[] = [];
    if (tracks) {
      const existingTracks = await many<{ id: string }>(
        "SELECT id FROM event_track WHERE event_id = ?",
        eventId,
      );
      const trackIds = new Set(existingTracks.map((t) => t.id));
      const keptTracks = new Set<string>();
      tracks.forEach((t, i) => {
        trackIsStaffByIndex.push(t.visibility === "staff");
        // 項目と同じく、既存 ID との一致だけを更新扱いにする
        if (t.id && trackIds.has(t.id) && !keptTracks.has(t.id)) {
          keptTracks.add(t.id);
          trackIdByIndex.push(t.id);
          trackStmts.push({
            sql: "UPDATE event_track SET name = ?, sort_order = ?, visibility = ? WHERE id = ? AND event_id = ?",
            args: [t.name, i, t.visibility, t.id, eventId],
          });
          return;
        }
        const id = crypto.randomUUID();
        trackIdByIndex.push(id);
        trackStmts.push({
          sql: "INSERT INTO event_track (id, event_id, name, sort_order, created_at, visibility) VALUES (?, ?, ?, ?, ?, ?)",
          args: [id, eventId, t.name, i, now, t.visibility],
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

    /** その項目の配置状態・見え方・割り当て先を決める (#338 / #383)。
     * トラックを知らないクライアントからの保存 (tracks 未指定) は既存値のまま。
     *
     * **割り当て先が空なら未割り当て**。トラックを消して載る先が無くなった場合も、
     * 編集画面でチップを全部外した場合も、規則はこの1つだけ。
     *
     * **見え方も tracks 未指定なら既存値のまま**にする (#383)。トラックを知らない
     * クライアントは裏方のことも知らず、`visibility` の既定値 `'public'` を送ってくる。
     * それを素直に書くと、**入力済みの裏方が黙って参加者に出る**（`placement` を
     * 既存値のままにしているのとまったく同じ理由）。 */
    const placeOf = (
      it: SaveScheduleItemInput,
      current: { placement: string; visibility: string } | undefined,
    ): {
      placement: SchedulePlacement;
      visibility: ScheduleVisibility;
      trackIds: string[];
    } => {
      if (!tracks) {
        return {
          placement: toPlacement(current?.placement ?? "all"),
          visibility: toVisibility(current?.visibility ?? "public"),
          trackIds: [],
        };
      }
      if (it.placement === "unassigned") {
        // 未割り当ては placement だけで参加者から外れる。visibility は触らない
        // （配置し直したときに元の見え方へ戻れるよう、運営の入力を捨てない）
        return {
          placement: "unassigned",
          visibility: it.visibility,
          trackIds: [],
        };
      }
      if (it.placement === "all") {
        // 全トラック共通の裏方（全体の設営など）は正しい組み合わせ。そのまま通す
        return { placement: "all", visibility: it.visibility, trackIds: [] };
      }
      const picked = [
        ...new Set(
          it.trackIndexes.filter((n) => trackIdByIndex[n] !== undefined),
        ),
      ];
      if (picked.length === 0) {
        return {
          placement: "unassigned",
          visibility: it.visibility,
          trackIds: [],
        };
      }
      // 4.2 規則1: **スタッフ用トラックにしか載っていない項目は裏方に格上げする**。
      // 参加者に見せると決まっている項目が、参加者に見えない列にだけ置かれている
      // 状態は意味を持たない。落とす先を「消す」ではなく「格上げ」にするのは、
      // 0067 が未割り当てへ落としたのと同じで**運営の入力を捨てない**ため。
      // 逆（裏方の項目が公開トラックに載る）は要件2そのものなので正さない
      const onlyStaffTracks = picked.every(
        (n) => trackIsStaffByIndex[n] === true,
      );
      return {
        placement: "tracks",
        visibility: onlyStaffTracks ? "staff" : it.visibility,
        trackIds: picked.map((n) => trackIdByIndex[n]!),
      };
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
        const place = placeOf(it, current);
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
                placement = ?, visibility = ?
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
            place.visibility,
            current.id,
            eventId,
          ],
        });
        return;
      }
      const id = crypto.randomUUID();
      const place = placeOf(it, undefined);
      linksByItem.push({ itemId: id, trackIds: place.trackIds });
      stmts.push({
        sql: `INSERT INTO event_schedule_item
          (id, event_id, title, description, duration_min, starts_at,
           speaker_user_id, speaker_name, material_url, material_og_image, material_og_url, sort_order, created_at, placement, visibility)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          place.visibility,
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
    // 保存は staff 限定（requireEventRole(["staff"])）なので staff 向けに返す
    return this.listByEvent(eventId, "staff");
  },

  /** 1項目を取得（イベント跨ぎ防止のため eventId でも絞る）。
   * speakerUserId は toItem が生の値を返すので、ユーザーが猶予期間中でも
   * 登壇者本人かどうかを判定できる。
   *
   * `audience` は**必須** (#383)。`"public"` で引くと裏方の項目は**そもそも引けず**
   * 404 になる。「引いてから弾く」形にしない。 */
  async findItem(
    eventId: string,
    itemId: string,
    audience: ScheduleAudience,
  ): Promise<ScheduleItem | null> {
    const row = await one<Row>(
      `${SELECT} WHERE s.event_id = ? AND s.id = ?${itemFilter(audience, "s")}`,
      eventId,
      itemId,
    );
    if (!row) return null;
    const links = await many<{ track_id: string }>(
      `SELECT it.track_id FROM event_schedule_item_track it
         JOIN event_track t ON t.id = it.track_id
        WHERE it.item_id = ?${trackFilter(audience, "t")}
        ORDER BY t.sort_order ASC`,
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

  /** OG メタが未取得（URL 変更含む）の項目を列挙する (#149)。
   * 参加者に見せる項目だけを対象にする (#383)。裏方の URL を外部ホストへ
   * 取りに行かない（要らない通信を増やさない） */
  async listNeedingOgRefresh(
    eventId: string,
    limit: number,
  ): Promise<Array<{ id: string; materialUrl: string }>> {
    const rows = await many<{ id: string; material_url: string }>(
      `SELECT si.id, si.material_url FROM event_schedule_item si
        WHERE si.event_id = ? AND si.material_url != ''
          AND si.material_og_url != si.material_url
          AND ${publicItemWhere("si")}
        ORDER BY si.sort_order ASC LIMIT ?`,
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
   * 参加者に見せない項目（未割り当て #338 / 裏方 #383）はここでも数えない */
  async listPublicSpokenEventIds(userId: string): Promise<string[]> {
    const rows = await many<{ event_id: string }>(
      `SELECT DISTINCT si.event_id FROM event_schedule_item si
         JOIN event e ON e.id = si.event_id
        WHERE si.speaker_user_id = ? AND e.status = 'published'
          AND ${publicItemWhere("si")}`,
      userId,
    );
    return rows.map((r) => r.event_id);
  },
};
