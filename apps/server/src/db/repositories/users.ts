import type { User } from "@eventer/shared";
import { DELETED_USER_DISPLAY_NAME } from "@eventer/shared";
import { batch, many, one, run } from "../client.js";

interface UserRow {
  id: string;
  discord_id: string;
  username: string;
  global_name: string | null;
  avatar_url: string | null;
  created_at: number;
  /** プロフィールカードPNG（OG画像キャッシュ）の更新時刻 (#193) */
  card_image_updated_at: number | null;
  card_image_key: string | null;
  /** 退会申請時刻。NULL = 在籍中 (#250) */
  deleted_at: number | null;
  /** 最終アクセス時刻。NULL = 計測開始 (#257) より前からのユーザー */
  last_seen_at: number | null;
  /** 自前保管したアイコン (#312) の更新時刻。NULL = 保管なし（配信もしない） */
  avatar_image_updated_at: number | null;
  avatar_image_mime: string | null;
  avatar_image_hash: string | null;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    discordId: row.discord_id,
    username: row.username,
    globalName: row.global_name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    cardImageUpdatedAt: row.card_image_updated_at ?? null,
    cardImageKey: row.card_image_key ?? null,
  };
}

/** 猶予期間中 (#250) かどうかを含むユーザー。復帰フローと日次バッチでのみ使う。
 * 通常の参照系は deleted_at IS NULL で除外するため、この型は出てこない */
export type UserWithDeletion = User & { deletedAt: number | null };

function toUserWithDeletion(row: UserRow): UserWithDeletion {
  return { ...toUser(row), deletedAt: row.deleted_at };
}

/** 最終アクセス時刻 (#257) を含むユーザー。currentUser の内部でだけ使う。
 * 公開型 User には入れない（APIレスポンスに載せる情報ではない） */
export type UserWithLastSeen = User & { lastSeenAt: number | null };

/** 退会申請済み（猶予期間中）のユーザーを除外する条件 (#250)。
 * 参照系のクエリには原則これを付ける。付け忘れると退会したユーザーが
 * 他ユーザーから見えてしまうため、新しいクエリを足すときは必ず確認すること */
const ACTIVE = "deleted_at IS NULL";

/** 在籍中のユーザーを id で引く（生の行）。findById 系はすべてここを通す。
 * SQL をコピーして持つと、将来 ACTIVE の条件を変えたときに片方だけ直す事故になる */
function findActiveRow(id: string): Promise<UserRow | null> {
  return one<UserRow>(`SELECT * FROM user WHERE id = ? AND ${ACTIVE}`, id);
}

/** 「退会済みユーザー」システムユーザーの discord_id (#244)。
 * 実IDと衝突しない合成値（ADMIN_DISCORD_IDS にも決して一致しない）。
 * identity を持たない＝ログイン不可で、連携の引き取り (#238) や統合 (#240) は
 * identity の provider_user_id からしかユーザーを解決しないため対象にならない */
const DELETED_USER_DISCORD_ID = "system:deleted-user";

export const usersRepo = {
  /** 退会申請済み（猶予期間中）は「存在しない」扱いで null を返す (#250)。
   * currentUser / プロフィール / 各種表示がここを通るため、ここでの除外が
   * 「即座に利用不可・非表示」の中心的な担保になっている */
  async findById(id: string): Promise<User | null> {
    const row = await findActiveRow(id);
    return row ? toUser(row) : null;
  },

  /** findById と同じ（退会申請中は null）だが、最終アクセス時刻 (#257) も返す。
   * currentUser 専用。既に SELECT * している行から取るだけなので追加の読み取りは
   * 発生せず、「JSTの日付が変わったか」を JS 側でタダで判定できる */
  async findByIdWithLastSeen(id: string): Promise<UserWithLastSeen | null> {
    const row = await findActiveRow(id);
    return row ? { ...toUser(row), lastSeenAt: row.last_seen_at ?? null } : null;
  },

  /** アクセスを記録する (#257)。DAU/MAU 計測用に2つ書く。
   *   - user.last_seen_at … 最終アクセス時刻（休眠の判定用）
   *   - user_active_day   … その日アクセスした事実（DAU の推移・コホート用）
   * last_seen_at だけだと「最終」日しか残らず過去日の推移が出せないため、
   * 日次の記録を別に持つ（migrations/0056 のコメント参照）。
   *
   * 「JSTの日付が変わった最初の1回だけ」の判定は呼び出し側 (lib/lastSeen.ts) が行う。
   * 2文は D1 の batch で1回にまとめるので、書き込みは 1ユーザー 1日 1回のまま。
   * どちらも在籍中 (deleted_at IS NULL) に限定し、退会申請中のユーザーを
   * 記録しないことを（呼び出し側の判定と合わせて）二重に担保する。
   * @param day now の JST 日付 'YYYY-MM-DD'（JSTの計算は lib/lastSeen.ts に一本化） */
  async touchLastSeen(userId: string, at: number, day: string): Promise<void> {
    await batch([
      {
        sql: `UPDATE user SET last_seen_at = ? WHERE id = ? AND ${ACTIVE}`,
        args: [at, userId],
      },
      {
        // SELECT 経由なのは、退会申請中なら1行も挿さないようにするため
        sql: `INSERT OR IGNORE INTO user_active_day (day, user_id)
              SELECT ?, id FROM user WHERE id = ? AND ${ACTIVE}`,
        args: [day, userId],
      },
    ]);
  },

  /** 猶予期間中でも引ける参照 (#250)。復帰フローと日次バッチ専用 */
  async findByIdIncludingDeleted(id: string): Promise<UserWithDeletion | null> {
    const row = await one<UserRow>("SELECT * FROM user WHERE id = ?", id);
    return row ? toUserWithDeletion(row) : null;
  },

  async findByDiscordId(discordId: string): Promise<User | null> {
    const row = await one<UserRow>(
      `SELECT * FROM user WHERE discord_id = ? AND ${ACTIVE}`,
      discordId,
    );
    return row ? toUser(row) : null;
  },

  /** 猶予期間中でも引ける参照 (#250)。開発用ログインのように
   * 「行の存在」を見たい経路で使う */
  async findByDiscordIdIncludingDeleted(
    discordId: string,
  ): Promise<UserWithDeletion | null> {
    const row = await one<UserRow>(
      "SELECT * FROM user WHERE discord_id = ?",
      discordId,
    );
    return row ? toUserWithDeletion(row) : null;
  },

  /** プロフィールURLのハンドル解決（username、大文字小文字を無視）。
   * 猶予期間中のユーザーは 404 相当にするため除外する (#250) */
  async findByUsername(username: string): Promise<User | null> {
    const row = await one<UserRow>(
      `SELECT * FROM user WHERE username = ? COLLATE NOCASE AND ${ACTIVE} LIMIT 1`,
      username,
    );
    return row ? toUser(row) : null;
  },

  /** ハンドル(username)が他のユーザーに使われているか。
   * findByUsername と違い、猶予期間中 (#250) のユーザーも「使用中」として扱う
   * （復帰したときにハンドルが他人のものになっていると URL が変わってしまう） */
  async isUsernameTaken(
    username: string,
    exceptUserId: string,
  ): Promise<boolean> {
    const row = await one<{ id: string }>(
      "SELECT id FROM user WHERE username = ? COLLATE NOCASE AND id <> ? LIMIT 1",
      username,
      exceptUserId,
    );
    return !!row;
  },

  /** ADMIN_DISCORD_IDS に該当するユーザーの id 一覧（運営宛て通知用）。
   * 猶予期間中の管理者には通知しない (#250) */
  async listIdsByDiscordIds(discordIds: string[]): Promise<string[]> {
    if (discordIds.length === 0) return [];
    const placeholders = discordIds.map(() => "?").join(", ");
    const rows = await many<{ id: string }>(
      `SELECT id FROM user WHERE discord_id IN (${placeholders}) AND ${ACTIVE}`,
      ...discordIds,
    );
    return rows.map((r) => r.id);
  },

  /** ハンドル(username)の重複を避けた利用可能な username を返す。
   * 既に他ユーザーが使っていれば末尾に数字を付ける（exceptUserId は自分自身として除外）。
   * ここは猶予期間中 (#250) のユーザーも「使用中」として扱う。復帰したときに
   * ハンドルが他人に奪われていると URL が変わってしまうため */
  async availableUsername(desired: string, exceptUserId?: string): Promise<string> {
    let candidate = desired;
    for (let n = 2; ; n += 1) {
      const row = await one<{ id: string }>(
        "SELECT id FROM user WHERE username = ? COLLATE NOCASE LIMIT 1",
        candidate,
      );
      if (!row || row.id === exceptUserId) return candidate;
      candidate = `${desired}${n}`;
    }
  },

  /** OAuthプロフィールから新規ユーザーを作成。
   * discord_id は NOT NULL UNIQUE のため、非Discordは "provider:id" の合成値を入れる
   * （ADMIN_DISCORD_IDS には決して一致しない＝管理者にならない）。 */
  async createFromProfile(
    provider: string,
    profile: {
      providerUserId: string;
      username: string;
      globalName: string | null;
      avatarUrl: string | null;
    },
  ): Promise<User> {
    const id = crypto.randomUUID();
    const discordId =
      provider === "discord"
        ? profile.providerUserId
        : `${provider}:${profile.providerUserId}`;
    await run(
      `INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      discordId,
      await this.availableUsername(profile.username),
      profile.globalName,
      profile.avatarUrl,
      Date.now(),
    );
    return (await this.findById(id))!;
  },

  /** Discord 連携時に discord_id を実IDへ更新（管理者判定を効かせる） */
  async setDiscordId(userId: string, discordId: string): Promise<void> {
    await run("UPDATE user SET discord_id = ? WHERE id = ?", discordId, userId);
  },

  /** 自前保管したアイコン (#312) のメタ。配信 (routes/avatarImages.ts) と
   * 「中身が変わったときだけ書き込む」判定 (lib/avatarStore.ts) の両方で使う。
   * 退会申請中 (#250) は null＝配信しない（他の参照系と同じ扱い） */
  async findAvatarImage(userId: string): Promise<{
    updatedAt: number;
    mime: string | null;
    hash: string | null;
  } | null> {
    const row = await one<{
      avatar_image_updated_at: number | null;
      avatar_image_mime: string | null;
      avatar_image_hash: string | null;
    }>(
      `SELECT avatar_image_updated_at, avatar_image_mime, avatar_image_hash
       FROM user WHERE id = ? AND ${ACTIVE}`,
      userId,
    );
    if (!row?.avatar_image_updated_at) return null;
    return {
      updatedAt: row.avatar_image_updated_at,
      mime: row.avatar_image_mime,
      hash: row.avatar_image_hash,
    };
  },

  /** 自前保管したアイコンを記録する (#312)。
   * avatar_url も同時に自ドメインのURLへ差し替える（表示側は全てここを読む）。
   * 1文にまとめてあるので「R2 には入ったが URL が連携先のまま」にはならない。
   *
   * 取り込み元URL (sourceUrl) も併せて残す。avatar_url を上書きしてしまう以上、
   * ここに控えないと元の連携先URLがどこにも残らず、切り戻しができなくなる (#313) */
  async setAvatarImage(
    userId: string,
    avatarUrl: string,
    updatedAt: number,
    mime: string,
    hash: string,
    sourceUrl: string,
  ): Promise<void> {
    await run(
      `UPDATE user SET avatar_url = ?, avatar_image_updated_at = ?,
         avatar_image_mime = ?, avatar_image_hash = ?, avatar_source_url = ?
       WHERE id = ?`,
      avatarUrl,
      updatedAt,
      mime,
      hash,
      sourceUrl,
      userId,
    );
  },

  /** プロフィールカードPNG（OG画像キャッシュ）の更新時刻と選択中の組み合わせを記録 (#193, #201) */
  async setCardImage(userId: string, ts: number, key: string): Promise<void> {
    await run(
      "UPDATE user SET card_image_updated_at = ?, card_image_key = ? WHERE id = ?",
      ts,
      key,
      userId,
    );
  },

  /** ユーザー名（ハンドル）を変更 */
  async setUsername(userId: string, username: string): Promise<void> {
    await run("UPDATE user SET username = ? WHERE id = ?", username, userId);
  },

  /** 表示名を変更する (#232) */
  async setGlobalName(userId: string, globalName: string): Promise<void> {
    await run("UPDATE user SET global_name = ? WHERE id = ?", globalName, userId);
  },

  /** アカウントに利用実績があるか (#238)。連携の引き取りで実績のある
   * アカウントを孤児化させないためのガード（参加・作成系の主要テーブルを見る） */
  async hasActivity(userId: string): Promise<boolean> {
    // 参加・作成系に加え、ユーザー資産（deck/live_set/bgm）・公開コンテンツ
    // （コメント）・問い合わせ・FK RESTRICT で削除をブロックするテーブル
    // （live_set/venue_offer）も判定に含める。ここに漏れがあると
    // 「引き取り→削除」で資産が消えるか、削除がFK違反で失敗する。
    //
    // ここは表ごと直接見る。運営が非表示にした投稿 (#278) も実績として数えたいので、
    // 非表示を落とすリポジトリの SELECT は **使わないこと**。
    // 荒らし投稿しかないアカウントが引き取り可能になってしまう
    const tables: [string, string][] = [
      ["event_member", "user_id"],
      ["event", "created_by"],
      ["community_member", "user_id"],
      ["entry_member", "user_id"],
      ["event_request", "created_by"],
      ["venue", "owner_id"],
      ["venue_admin", "user_id"],
      ["venue_offer", "created_by"],
      ["live_set", "owner_id"],
      ["deck", "owner_id"],
      ["bgm_track", "owner_id"],
      ["event_comment", "user_id"],
      ["inquiry", "user_id"],
    ];
    const expr = tables
      .map(([t, c]) => `EXISTS(SELECT 1 FROM ${t} WHERE ${c} = ?)`)
      .join(" + ");
    const row = await one<{ n: number }>(
      `SELECT ${expr} AS n`,
      ...tables.map(() => userId),
    );
    return (row?.n ?? 0) > 0;
  },

  /** ユーザー行を削除（関連行は FK CASCADE）。空アカウントの引き取り時の後始末用 (#238) */
  async deleteById(id: string): Promise<void> {
    await run("DELETE FROM user WHERE id = ?", id);
  },

  /** アカウント統合 (#240)。負け側(loser)の全ユーザーデータを勝ち側(winner)へ
   * 移動し、負け側のユーザー行を削除する。
   *
   * - UNIQUE キーに user 列を含むテーブルは、勝ち側に同キー行があれば負け側を
   *   捨ててから付け替える（勝ち側優先）
   * - user_follow は統合で生じる自己フォロー・重複を削除
   * - event_meet は (小,大) の正規化を保ちながら付け替え、自己ペア・重複を削除
   * - 負け側の session は全削除（統合ではなく破棄）
   *
   * D1 の batch は単一トランザクションとして実行されるが、万一逐次実行に
   * フォールバックしても途中失敗でログイン手段が失われないよう、
   * 「子テーブル移行 → session/identity → user 削除」の順序を守る。 */
  async mergeUsers(winnerId: string, loserId: string): Promise<void> {
    const stmts: Array<{ sql: string; args?: unknown[] }> = [];

    // (0) event_member の重複破棄でスタッフ権限が落ちないよう、負け側が staff の
    //     イベントでは勝ち側の既存行を先に staff へ引き上げる。
    //     枠と参加状態も setRole (#277) と同じに揃える：ロールだけ書き換えると
    //     抽選に申込中(applied)のままスタッフになり、抽選対象から外れて申込中で
    //     固定された「操作UIは出るのに403」の行ができてしまう (#281)。
    //     勝ち側が取消済みの行を持っていた場合も確定に戻す。role だけ staff に
    //     しても取消済みのままではメンバーとして扱われず、staff 権限が消える
    stmts.push({
      sql: `UPDATE event_member SET role = 'staff', slot_id = NULL, status = 'confirmed'
             WHERE user_id = ? AND role != 'staff'
               AND event_id IN (SELECT event_id FROM event_member
                                 WHERE user_id = ? AND role = 'staff')`,
      args: [winnerId, loserId],
    });

    // (1) UNIQUE キー（user 列 + keyCols）を持つテーブル。
    //     勝ち側に同キーの行が既にあれば、負け側の行を捨ててから付け替える
    const uniqueKeyed: Array<[table: string, userCol: string, keyCols: string[]]> = [
      ["event_member", "user_id", ["event_id"]],
      ["entry_member", "user_id", ["entry_id"]],
      ["score", "judge_user_id", ["entry_id", "criterion_id"]],
      ["community_member", "user_id", ["community_id"]],
      ["event_date_vote", "user_id", ["option_id"]],
      ["event_request_reaction", "user_id", ["request_id", "kind"]],
      ["venue_admin", "user_id", ["venue_id"]],
      ["event_survey_answer", "user_id", ["question_id"]],
      ["event_chat_pubkey", "user_id", ["event_id"]],
      ["event_like", "user_id", ["event_id", "kind", "target_key"]],
    ];
    for (const [table, userCol, keyCols] of uniqueKeyed) {
      const sameKey = keyCols
        .map((k) => `w.${k} = ${table}.${k}`)
        .join(" AND ");
      stmts.push({
        sql: `DELETE FROM ${table} WHERE ${userCol} = ?
              AND EXISTS (SELECT 1 FROM ${table} w
                          WHERE w.${userCol} = ? AND ${sameKey})`,
        args: [loserId, winnerId],
      });
      stmts.push({
        sql: `UPDATE ${table} SET ${userCol} = ? WHERE ${userCol} = ?`,
        args: [winnerId, loserId],
      });
    }

    // (2) event_like.target_key は host/staff/participant のとき対象 user_id。
    //     付け替え後に重複する行と、統合で生じる「自分へのいいね」は削除
    const likeUserKinds = "('host', 'staff', 'participant')";
    stmts.push({
      sql: `DELETE FROM event_like WHERE target_key = ? AND kind IN ${likeUserKinds}
            AND EXISTS (SELECT 1 FROM event_like w
                        WHERE w.event_id = event_like.event_id
                          AND w.user_id = event_like.user_id
                          AND w.kind = event_like.kind
                          AND w.target_key = ?)`,
      args: [loserId, winnerId],
    });
    stmts.push({
      sql: `UPDATE event_like SET target_key = ?
            WHERE target_key = ? AND kind IN ${likeUserKinds}`,
      args: [winnerId, loserId],
    });
    stmts.push({
      sql: `DELETE FROM event_like
            WHERE user_id = ? AND target_key = ? AND kind IN ${likeUserKinds}`,
      args: [winnerId, winnerId],
    });

    // (3) notification_pref は PK user_id。勝ち側の設定を優先し負け側は破棄
    stmts.push({
      sql: `DELETE FROM notification_pref WHERE user_id = ?
            AND EXISTS (SELECT 1 FROM notification_pref WHERE user_id = ?)`,
      args: [loserId, winnerId],
    });
    stmts.push({
      sql: "UPDATE notification_pref SET user_id = ? WHERE user_id = ?",
      args: [winnerId, loserId],
    });

    // (4) user_follow: 両者間のフォロー（統合後の自己フォロー）と重複を削除
    stmts.push({
      sql: `DELETE FROM user_follow
            WHERE (follower_id = ? AND followee_id = ?)
               OR (follower_id = ? AND followee_id = ?)`,
      args: [loserId, winnerId, winnerId, loserId],
    });
    stmts.push({
      sql: `DELETE FROM user_follow WHERE follower_id = ?
            AND EXISTS (SELECT 1 FROM user_follow w
                        WHERE w.follower_id = ?
                          AND w.followee_id = user_follow.followee_id)`,
      args: [loserId, winnerId],
    });
    stmts.push({
      sql: "UPDATE user_follow SET follower_id = ? WHERE follower_id = ?",
      args: [winnerId, loserId],
    });
    stmts.push({
      sql: `DELETE FROM user_follow WHERE followee_id = ?
            AND EXISTS (SELECT 1 FROM user_follow w
                        WHERE w.follower_id = user_follow.follower_id
                          AND w.followee_id = ?)`,
      args: [loserId, winnerId],
    });
    stmts.push({
      sql: "UPDATE user_follow SET followee_id = ? WHERE followee_id = ?",
      args: [winnerId, loserId],
    });

    // (5) event_meet: ペアは (user_low < user_high) に正規化して保存されている。
    //     両者間の出会い（統合後の自己ペア）を消し、付け替え後に重複する行を
    //     消してから、min/max で正規化を保ったまま付け替える
    stmts.push({
      sql: `DELETE FROM event_meet
            WHERE (user_low = ? AND user_high = ?)
               OR (user_low = ? AND user_high = ?)`,
      args: [loserId, winnerId, winnerId, loserId],
    });
    const meetOther =
      "CASE WHEN event_meet.user_low = ? THEN event_meet.user_high ELSE event_meet.user_low END";
    stmts.push({
      sql: `DELETE FROM event_meet WHERE (user_low = ? OR user_high = ?)
            AND EXISTS (SELECT 1 FROM event_meet w
                        WHERE w.event_id = event_meet.event_id
                          AND w.user_low = min(?, ${meetOther})
                          AND w.user_high = max(?, ${meetOther}))`,
      args: [loserId, loserId, winnerId, loserId, winnerId, loserId],
    });
    stmts.push({
      sql: `UPDATE event_meet SET
              user_low = min(?, CASE WHEN user_low = ? THEN user_high ELSE user_low END),
              user_high = max(?, CASE WHEN user_low = ? THEN user_high ELSE user_low END)
            WHERE user_low = ? OR user_high = ?`,
      args: [winnerId, loserId, winnerId, loserId, loserId, loserId],
    });

    // (6) UNIQUE の無い参照列は単純に付け替え
    const simple: Array<[table: string, col: string]> = [
      ["event_photo", "user_id"],
      ["event_photo_comment", "user_id"],
      ["event_comment", "user_id"],
      ["notification", "user_id"],
      ["inquiry", "user_id"],
      ["venue_photo", "user_id"],
      ["event_schedule_item", "speaker_user_id"],
      ["bgm_track", "owner_id"],
      ["event", "created_by"],
      ["event_request", "created_by"],
      ["venue_offer", "created_by"],
      ["community", "owner_id"],
      ["venue", "owner_id"],
      ["deck", "owner_id"],
      ["live_set", "owner_id"],
    ];
    for (const [table, col] of simple) {
      stmts.push({
        sql: `UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`,
        args: [winnerId, loserId],
      });
    }

    // (7) 負け側の session は破棄（統合しない）
    stmts.push({
      sql: "DELETE FROM session WHERE user_id = ?",
      args: [loserId],
    });

    // (8) ログイン方法（identity）は勝ち側へ移す。UNIQUE(provider, provider_user_id)
    //     に user 列は含まれないため衝突しない。user 削除の直前に置き、
    //     万一途中で失敗してもログイン手段が失われないようにする
    stmts.push({
      sql: "UPDATE identity SET user_id = ? WHERE user_id = ?",
      args: [winnerId, loserId],
    });

    // (9) 負け側の user 行を削除（FK RESTRICT の live_set / venue_offer は
    //     (6) で移行済みなので通る）
    stmts.push({ sql: "DELETE FROM user WHERE id = ?", args: [loserId] });

    // (10) 勝ち側に discord の identity があれば user.discord_id を実IDへ揃える
    //      （管理者判定やアイコン解決を効かせる）。既に実IDなら維持。
    //      負け側の user 行は削除済みなので UNIQUE(discord_id) 衝突は起きない
    stmts.push({
      sql: `UPDATE user SET discord_id = (
              SELECT provider_user_id FROM identity
              WHERE user_id = ? AND provider = 'discord'
              ORDER BY created_at LIMIT 1)
            WHERE id = ?
              AND EXISTS (SELECT 1 FROM identity
                          WHERE user_id = ? AND provider = 'discord')
              AND discord_id NOT IN (SELECT provider_user_id FROM identity
                                     WHERE user_id = ? AND provider = 'discord')`,
      args: [winnerId, winnerId, winnerId, winnerId],
    });

    await batch(stmts);
  },

  /** 「退会済みユーザー」システムユーザーを返す（無ければ作成） (#244)。
   * 退会者の共有コンテンツ（主催イベント・コミュニティ・会場・たまご・
   * 会場オファー）の名義引き受け先。identity なし＝ログイン不可 */
  async ensureDeletedUser(): Promise<User> {
    const existing = await this.findByDiscordId(DELETED_USER_DISCORD_ID);
    if (existing) return existing;
    try {
      await run(
        `INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`,
        crypto.randomUUID(),
        DELETED_USER_DISCORD_ID,
        await this.availableUsername("deleted-user"),
        DELETED_USER_DISPLAY_NAME,
        Date.now(),
      );
    } catch {
      // 並行作成で UNIQUE(discord_id) に負けた場合は既存行を使う
    }
    const ghost = await this.findByDiscordId(DELETED_USER_DISCORD_ID);
    if (!ghost) throw new Error("failed to ensure deleted-user account");
    return ghost;
  },

  /** 退会リクエスト (#250)。データは消さず deleted_at を立て、セッションを
   * 全削除して即座に利用不可・非表示にする（30日後に日次バッチが完全削除）。
   * 単一 batch なので「セッションだけ消えて退会状態にならない」中途半端な
   * 状態にはならない。既に申請済みなら時刻は上書きしない（猶予の延長防止） */
  async requestDeletion(userId: string, now: number): Promise<void> {
    await batch([
      {
        sql: `UPDATE user SET deleted_at = ? WHERE id = ? AND ${ACTIVE}`,
        args: [now, userId],
      },
      { sql: "DELETE FROM session WHERE user_id = ?", args: [userId] },
    ]);
  },

  /** 猶予期間中の退会申請を取り消して復帰する (#250) */
  async restore(userId: string): Promise<void> {
    await run(
      "UPDATE user SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL",
      userId,
    );
  },

  /** 猶予期間 (#250) を過ぎた退会申請の id を古い順に返す。日次バッチ用。
   * 1回の実行あたりの件数を絞って Workers のサブリクエスト上限を守る。
   *
   * 境界は `<` で、復帰の判定（経過時間 > 猶予期間なら復帰不可）と表裏一致させる。
   * `<=` だと「経過時間 == 猶予期間」の 1ms だけ復帰も完全削除も可能になる */
  async listPurgeTargets(before: number, limit: number): Promise<string[]> {
    const rows = await many<{ id: string }>(
      `SELECT id FROM user WHERE deleted_at IS NOT NULL AND deleted_at < ?
        ORDER BY deleted_at LIMIT ?`,
      before,
      limit,
    );
    return rows.map((r) => r.id);
  },

  /** 完全削除待ちの残件数（listPurgeTargets と同じ条件）。
   * 1回の上限に達したときだけ呼び、消化しきれていないことをログに出す */
  async countPurgeTargets(before: number): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM user WHERE deleted_at IS NOT NULL AND deleted_at < ?",
      before,
    );
    return row?.n ?? 0;
  },

  /** 退会（アカウント削除） (#244)。単一トランザクション（D1 batch）で
   * 「共有コンテンツを『退会済みユーザー』(ghost) に付け替え → 個人データ削除 →
   * user 行削除（FK CASCADE で残りが消える）」を行う。
   * R2 オブジェクトの掃除は呼び出し側（routes/me.ts）が行削除前にキーを控えて行う */
  async deleteAccount(userId: string, ghostId: string): Promise<void> {
    const stmts: Array<{ sql: string; args?: unknown[] }> = [];

    // (1) 共有コンテンツは ghost 名義に付け替えて残す（参加者の履歴・予定を
    //     壊さない）。いずれも user 列を含む UNIQUE キーが無いため、mergeUsers の
    //     ような「衝突行の先行削除」は不要。FK RESTRICT の event / venue /
    //     event_request / venue_offer の user 参照もここで解消される
    const reassign: Array<[table: string, col: string]> = [
      ["event", "created_by"],
      ["community", "owner_id"],
      ["venue", "owner_id"],
      ["event_request", "created_by"],
      ["venue_offer", "created_by"],
    ];
    for (const [table, col] of reassign) {
      stmts.push({
        sql: `UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`,
        args: [ghostId, userId],
      });
    }

    // (1-b) 付け替えた共有コンテンツに残る本人の連絡先を消す。
    //     venue_offer.organizer_contact は承諾成立後に会場側へ開示されるため、
    //     退会後に承諾されると連絡先が渡ってしまう。未応答のオファーは辞退扱いに
    stmts.push({
      sql: `UPDATE venue_offer SET organizer_contact = '',
              status = CASE WHEN status = 'pending' THEN 'declined' ELSE status END
             WHERE created_by = ?`,
      args: [ghostId],
    });
    // 会場の連絡先も本人の個人情報。管理者が他に居なければ募集を止める
    stmts.push({
      sql: `UPDATE venue SET contact = '',
              status = CASE
                WHEN NOT EXISTS (SELECT 1 FROM venue_admin WHERE venue_id = venue.id
                                   AND user_id != ?) THEN 'closed'
                ELSE status END
             WHERE owner_id = ?`,
      args: [userId, ghostId],
    });

    // (1-c) 個人参加のエントリーは本人の活動記録（entry.name に表示名、
    //     submission に成果物URL）。entry は user への FK が無く entry_member の
    //     CASCADE だけでは残ってしまうため明示削除する（チーム参加は共有物として残す）
    stmts.push({
      sql: `DELETE FROM entry
             WHERE kind = 'individual'
               AND EXISTS (SELECT 1 FROM entry_member m
                            WHERE m.entry_id = entry.id AND m.user_id = ?)`,
      args: [userId],
    });

    // (1-d) 参加者のいない下書きイベントは誰にも見えず誰も消せない孤児になるため削除
    stmts.push({
      sql: `DELETE FROM event
             WHERE created_by = ? AND status = 'draft'
               AND NOT EXISTS (SELECT 1 FROM event_member m
                                WHERE m.event_id = event.id AND m.user_id != ?)`,
      args: [ghostId, userId],
    });

    // (2) FK RESTRICT の個人資産 live_set は user 削除前に明示削除。
    //     event_live_state.live_set_id は ON DELETE SET NULL なのでブロックしない
    stmts.push({
      sql: "DELETE FROM live_set WHERE owner_id = ?",
      args: [userId],
    });

    // (3) FK の無い参照: 本人が「もらった」いいね（target_key がユーザーID）。
    //     残すと存在しないユーザーを指す宙ぶらりんの行になるため削除する
    stmts.push({
      sql: `DELETE FROM event_like
            WHERE target_key = ? AND kind IN ('host', 'staff', 'participant')`,
      args: [userId],
    });

    // (4) user 行を削除。残りの個人データは FK CASCADE で消える
    //     （session / identity / event_member / entry_member / score /
    //      community_member / event_date_vote / event_request_reaction /
    //      venue_admin / event_survey_answer / event_chat_pubkey / event_like /
    //      user_follow / event_meet / event_photo / event_photo_comment /
    //      event_comment / notification / notification_pref / inquiry /
    //      deck / bgm_track）。venue_photo.user_id と
    //      event_schedule_item.speaker_user_id は SET NULL で匿名化される
    stmts.push({ sql: "DELETE FROM user WHERE id = ?", args: [userId] });

    await batch(stmts);
  },

  /** 表示名/アイコンが未設定の場合のみ補完（Nostrプロフィール等の反映用） */
  async fillProfile(
    userId: string,
    globalName: string | null,
    avatarUrl: string | null,
  ): Promise<void> {
    await run(
      `UPDATE user SET
         global_name = CASE
           WHEN (global_name IS NULL OR global_name = '') AND ? IS NOT NULL THEN ?
           ELSE global_name END,
         avatar_url = CASE
           WHEN (avatar_url IS NULL OR avatar_url = '') AND ? IS NOT NULL THEN ?
           ELSE avatar_url END
       WHERE id = ?`,
      globalName,
      globalName,
      avatarUrl,
      avatarUrl,
      userId,
    );
  },
};
