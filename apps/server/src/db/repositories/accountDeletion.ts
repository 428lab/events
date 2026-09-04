import type { User } from "@eventer/shared";
import { DELETED_USER_DISPLAY_NAME } from "@eventer/shared";
import { batch, many, one, run } from "../client.js";
import { staffChatRepo } from "./staffChat.js";
import { ACTIVE, usersRepo } from "./users.js";
import {
  ACTIVITY_TABLES,
  EVENT_LIKE_USER_KINDS,
  SHARED_CONTENT_OWNER_COLUMNS,
} from "./userTables.js";

/** 「退会済みユーザー」システムユーザーの discord_id (#244)。
 * 実IDと衝突しない合成値（ADMIN_DISCORD_IDS にも決して一致しない）。
 * identity を持たない＝ログイン不可で、連携の引き取り (#238) や統合 (#240) は
 * identity の provider_user_id からしかユーザーを解決しないため対象にならない */
const DELETED_USER_DISCORD_ID = "system:deleted-user";

/** 退会の一連（申請 → 猶予期間 → 完全削除）と、その手前で使う
 * 「利用実績があるか」の判定 (#238)。触る表の一覧は userTables.ts と共有する
 * （統合 accountMerge.ts と同じ定義を読む） */
export const accountDeletionRepo = {
  /** アカウントに利用実績があるか (#238)。連携の引き取りで実績のある
   * アカウントを孤児化させないためのガード（参加・作成系の主要テーブルを見る） */
  async hasActivity(userId: string): Promise<boolean> {
    // 見る表は userTables.ts の ACTIVITY_TABLES（どの表をなぜ見るかもそこ）
    const expr = ACTIVITY_TABLES.map(
      ([t, c]) => `EXISTS(SELECT 1 FROM ${t} WHERE ${c} = ?)`,
    ).join(" + ");
    const row = await one<{ n: number }>(
      `SELECT ${expr} AS n`,
      ...ACTIVITY_TABLES.map(() => userId),
    );
    return (row?.n ?? 0) > 0;
  },

  /** ユーザー行を削除（関連行は FK CASCADE）。空アカウントの引き取り時の後始末用 (#238) */
  async deleteById(id: string): Promise<void> {
    await run("DELETE FROM user WHERE id = ?", id);
  },

  /** 退会リクエスト (#250)。データは消さず deleted_at を立て、セッションを
   * 全削除して即座に利用不可・非表示にする（30日後に日次バッチが完全削除）。
   * 単一 batch なので「セッションだけ消えて退会状態にならない」中途半端な
   * 状態にはならない。既に申請済みなら時刻は上書きしない（猶予の延長防止） */
  async requestDeletion(userId: string, now: number): Promise<void> {
    // スタッフチャットのローテーション (#382)。**申請の時点で**回す:
    // purge（31日後）まで待つと、申請前に配られた鍵が手元に生きているので、
    // 猶予期間のあいだ外部クライアントから新しい発言を読み続けられてしまう。
    // 復帰 (restore) した人はゲートを再び通って全世代を受け取り直せる。
    // batch より先に回す: 逆順だと「申請は成立したのにローテーションだけ
    // 失敗して穴が残る」が起きうる。この順なら失敗した時点で申請ごと失敗し、
    // 先に回ってしまっても本人はまだ staff なので新しい鍵を受け取れるだけ
    await staffChatRepo.onStaffLostEverywhere(userId);
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
   * R2 オブジェクトの掃除は呼び出し側（routes/me.ts）が行削除前にキーを控えて行う。
   * @returns 自分の batch **以外**に消費したサブリクエスト数
   *          （スタッフチャットのローテーション分。purge の実行予算に積む） */
  async deleteAccount(userId: string, ghostId: string): Promise<number> {
    // (0) スタッフチャットのローテーション (#382)。本来は退会申請
    //     (requestDeletion) の時点で回っているが、purge はロール変更・参加解除の
    //     ルートを通らないので多重防御としてここでも回す（申請時に回っていれば
    //     1世代余分に進むだけで害は無い。signer 行自体は下の user 削除の CASCADE
    //     で消える）。SQL は staffChat リポジトリの外に書かない
    //     （staff-chat-sql-audit.test.ts）。先に走っても user 行が残って失敗した
    //     場合に害は無い（鍵が1世代進むだけで、翌日の再試行で完結する）
    const rotationCost = await staffChatRepo.onStaffLostEverywhere(userId);

    const stmts: Array<{ sql: string; args?: unknown[] }> = [];

    // (1) 共有コンテンツは ghost 名義に付け替えて残す（参加者の履歴・予定を
    //     壊さない）。いずれも user 列を含む UNIQUE キーが無いため、mergeUsers の
    //     ような「衝突行の先行削除」は不要。FK RESTRICT の event / venue /
    //     event_request / venue_offer の user 参照もここで解消される
    //     対象の表は userTables.ts の SHARED_CONTENT_OWNER_COLUMNS（統合側と共有）
    for (const [table, col] of SHARED_CONTENT_OWNER_COLUMNS) {
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
            WHERE target_key = ? AND kind IN ${EVENT_LIKE_USER_KINDS}`,
      args: [userId],
    });

    // (4) user 行を削除。残りの個人データは FK CASCADE で消える
    //     （session / identity / event_member / entry_member / score /
    //      community_member / event_date_vote / event_request_reaction /
    //      venue_admin / event_survey_answer / event_chat_key / event_like /
    //      user_follow / event_meet / event_photo / event_photo_comment /
    //      event_comment / notification / notification_pref / inquiry /
    //      deck / bgm_track）。venue_photo.user_id と
    //      event_schedule_item.speaker_user_id は SET NULL で匿名化される
    stmts.push({ sql: "DELETE FROM user WHERE id = ?", args: [userId] });

    await batch(stmts);
    return rotationCost;
  },

  /** 「退会済みユーザー」システムユーザーを返す（無ければ作成） (#244)。
   * 退会者の共有コンテンツ（主催イベント・コミュニティ・会場・たまご・
   * 会場オファー）の名義引き受け先。identity なし＝ログイン不可 */
  async ensureDeletedUser(): Promise<User> {
    const existing = await usersRepo.findByDiscordId(DELETED_USER_DISCORD_ID);
    if (existing) return existing;
    try {
      await run(
        `INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`,
        crypto.randomUUID(),
        DELETED_USER_DISCORD_ID,
        await usersRepo.availableUsername("deleted-user"),
        DELETED_USER_DISPLAY_NAME,
        Date.now(),
      );
    } catch {
      // 並行作成で UNIQUE(discord_id) に負けた場合は既存行を使う
    }
    const ghost = await usersRepo.findByDiscordId(DELETED_USER_DISCORD_ID);
    if (!ghost) throw new Error("failed to ensure deleted-user account");
    return ghost;
  },
};
