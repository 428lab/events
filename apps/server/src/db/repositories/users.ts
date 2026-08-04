import type { User } from "@eventer/shared";
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

/** 「退会済みユーザー」システムユーザーの discord_id (#244)。
 * 実IDと衝突しない合成値（ADMIN_DISCORD_IDS にも決して一致しない）。
 * identity を持たない＝ログイン不可で、連携の引き取り (#238) や統合 (#240) は
 * identity の provider_user_id からしかユーザーを解決しないため対象にならない */
const DELETED_USER_DISCORD_ID = "system:deleted-user";

export interface UpsertUserInput {
  discordId: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
}

export const usersRepo = {
  async findById(id: string): Promise<User | null> {
    const row = await one<UserRow>("SELECT * FROM user WHERE id = ?", id);
    return row ? toUser(row) : null;
  },

  async findByDiscordId(discordId: string): Promise<User | null> {
    const row = await one<UserRow>(
      "SELECT * FROM user WHERE discord_id = ?",
      discordId,
    );
    return row ? toUser(row) : null;
  },

  /** プロフィールURLのハンドル解決（username、大文字小文字を無視） */
  async findByUsername(username: string): Promise<User | null> {
    const row = await one<UserRow>(
      "SELECT * FROM user WHERE username = ? COLLATE NOCASE LIMIT 1",
      username,
    );
    return row ? toUser(row) : null;
  },

  /** ADMIN_DISCORD_IDS に該当するユーザーの id 一覧（運営宛て通知用） */
  async listIdsByDiscordIds(discordIds: string[]): Promise<string[]> {
    if (discordIds.length === 0) return [];
    const placeholders = discordIds.map(() => "?").join(", ");
    const rows = await many<{ id: string }>(
      `SELECT id FROM user WHERE discord_id IN (${placeholders})`,
      ...discordIds,
    );
    return rows.map((r) => r.id);
  },

  /** ハンドル(username)の重複を避けた利用可能な username を返す。
   * 既に他ユーザーが使っていれば末尾に数字を付ける（exceptUserId は自分自身として除外）。 */
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

  async upsertByDiscordId(input: UpsertUserInput): Promise<User> {
    const existing = await this.findByDiscordId(input.discordId);
    if (existing) {
      // ハンドル(username)が他ユーザーと被る変更は据え置く（URL衝突防止）
      let username = input.username;
      if (username.toLowerCase() !== existing.username.toLowerCase()) {
        const taken = await this.findByUsername(username);
        if (taken && taken.id !== existing.id) username = existing.username;
      }
      await run(
        `UPDATE user SET username = ?, global_name = ?, avatar_url = ?
         WHERE discord_id = ?`,
        username,
        input.globalName,
        input.avatarUrl,
        input.discordId,
      );
      return (await this.findByDiscordId(input.discordId))!;
    }
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      input.discordId,
      await this.availableUsername(input.username),
      input.globalName,
      input.avatarUrl,
      Date.now(),
    );
    return (await this.findById(id))!;
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
    // 「引き取り→削除」で資産が消えるか、削除がFK違反で失敗する
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
    //     イベントでは勝ち側の既存行を先に staff へ引き上げる
    stmts.push({
      sql: `UPDATE event_member SET role = 'staff'
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
        "退会済みユーザー",
        Date.now(),
      );
    } catch {
      // 並行作成で UNIQUE(discord_id) に負けた場合は既存行を使う
    }
    const ghost = await this.findByDiscordId(DELETED_USER_DISCORD_ID);
    if (!ghost) throw new Error("failed to ensure deleted-user account");
    return ghost;
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
