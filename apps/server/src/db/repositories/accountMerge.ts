import { batch } from "../client.js";
import {
  EVENT_LIKE_USER_KINDS,
  SHARED_CONTENT_OWNER_COLUMNS,
} from "./userTables.js";

/** アカウント統合 (#240)。付け替える表の一覧は userTables.ts と共有する
 * （退会 accountDeletion.ts と同じ定義を読む） */
export const accountMergeRepo = {
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
      ["event_like", "user_id", ["event_id", "kind", "target_key"]],
      // 運営への招待 (#339)。両方に同じイベントの招待があれば負け側を捨てる
      ["event_staff_invite", "user_id", ["event_id"]],
      // 持ち場の割り当て (#384)。(slot_id, user_id) の UNIQUE があるので simple に
      // できない（勝ち負け両方が同じ持ち場に居ると UPDATE が UNIQUE 違反で落ちる）。
      // 両方に同じ持ち場の割り当てがあれば負け側を捨てる
      ["event_duty_assignee", "user_id", ["slot_id"]],
      // スタッフチャットの発言用一時鍵 (#382)。PK (event_id, audience, user_id)。
      // 両方が同じ部屋に signer を持つときだけ負け側を捨てる（勝ち側の鍵を残す＝
      // 配布済みの鍵を替えずに済む。event_chat_key の統合 (1b) と同じ判断）。
      // 資格は (0) で勝ち側に引き継がれるのでローテーションは不要（設計 7.4）
      ["event_group_chat_signer", "user_id", ["event_id", "audience"]],
      // Q&A の票 (#398)。PK (question_id, user_id)。両アカウントで同じ質問に
      // 投票していると UPDATE が UNIQUE 違反になるので、負け側の票を捨てる
      ["event_question_vote", "user_id", ["question_id"]],
      // 景品の引き換え (#431)。UNIQUE (prize_id, user_id)。両方が同じ景品を
      // 交換済みなら負け側を捨てる（付け替えないと (9) の user 削除で行ごと消え、
      // 在庫の導出値が実在庫とずれる）
      ["event_prize_redemption", "user_id", ["prize_id"]],
      // 1位の確定 (#431)。PK (event_id, user_id)。同率で両方が勝者なら負け側を捨てる
      ["event_meet_winner", "user_id", ["event_id"]],
      // ビンゴのカード (#436)。PK (event_id, user_id)。両方が持っていたら
      // 負け側を捨てる（勝ち側のカードで判定が続く）
      ["event_bingo_card", "user_id", ["event_id"]],
      // ビンゴ成績 (#441)。UNIQUE (event_id, started_at, user_id)。
      // 同じ回に両アカウントで参加していたら負け側を捨てる
      ["event_bingo_result", "user_id", ["event_id", "started_at"]],
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

    // (1b) チャットの発言鍵 (#332)。キーが (event_id, pubkey) で user 列を含まない
    //      ため鍵は衝突せず、両方の鍵の発言が**勝ち側の発言として表示される**
    //      （同一人物の統合なので意図どおり）。同じ理由で、負け側が締め出されて
    //      (#283) いれば勝ち側も締め出しのまま。締め出しは人に対する操作で、
    //      その人の鍵は1つ残らず移るため。統合を締め出しのやり直しにしない。
    //      一時鍵 (#223) だけは「イベント×ユーザーで1つ」の部分UNIQUE があるので、
    //      両方が持つイベントでは負け側の secret を落とす（行は残すので発言は
    //      消えない。既に配布済みの鍵を替えずに済むよう勝ち側を残す）
    stmts.push({
      sql: `UPDATE event_chat_key SET secret = NULL
             WHERE user_id = ? AND secret IS NOT NULL
               AND EXISTS (SELECT 1 FROM event_chat_key w
                            WHERE w.user_id = ? AND w.event_id = event_chat_key.event_id
                              AND w.secret IS NOT NULL)`,
      args: [loserId, winnerId],
    });
    stmts.push({
      sql: "UPDATE event_chat_key SET user_id = ? WHERE user_id = ?",
      args: [winnerId, loserId],
    });

    // (2) event_like.target_key は host/staff/participant のとき対象 user_id。
    //     付け替え後に重複する行と、統合で生じる「自分へのいいね」は削除
    stmts.push({
      sql: `DELETE FROM event_like WHERE target_key = ? AND kind IN ${EVENT_LIKE_USER_KINDS}
            AND EXISTS (SELECT 1 FROM event_like w
                        WHERE w.event_id = event_like.event_id
                          AND w.user_id = event_like.user_id
                          AND w.kind = event_like.kind
                          AND w.target_key = ?)`,
      args: [loserId, winnerId],
    });
    stmts.push({
      sql: `UPDATE event_like SET target_key = ?
            WHERE target_key = ? AND kind IN ${EVENT_LIKE_USER_KINDS}`,
      args: [winnerId, loserId],
    });
    stmts.push({
      sql: `DELETE FROM event_like
            WHERE user_id = ? AND target_key = ? AND kind IN ${EVENT_LIKE_USER_KINDS}`,
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
      // 通知の主語 (#380)。付け替えないと (9) の user 削除で ON DELETE SET NULL が
      // 発火し、統合後に勝ち側が退会しても通知が消えなくなる
      ["notification", "actor_id"],
      ["inquiry", "user_id"],
      ["venue_photo", "user_id"],
      ["event_schedule_item", "speaker_user_id"],
      // 招待した人 (#339)。付け替えないと (9) の user 削除で招待ごと消える
      ["event_staff_invite", "invited_by"],
      // 準備 TODO の担当と作成者 (#393)。付け替えないと (9) の user 削除で
      // ON DELETE SET NULL が発火し、統合したはずの担当が黙って未割り当てになる
      ["event_todo", "assignee_user_id"],
      ["event_todo", "created_by"],
      // Q&A の質問と一斉連絡の履歴 (#398)。付け替えないと (9) の user 削除で
      // ON DELETE CASCADE が発火し、本文ごと行が消える
      ["event_question", "user_id"],
      // 引き換えを付けた staff (#431)。付け替えないと (9) の user 削除で
      // ON DELETE SET NULL が発火し、誰が配ったかの記録が黙って消える
      ["event_prize_redemption", "redeemed_by"],
      ["event_broadcast", "created_by"],
      // 未送信メール (#398) も同じく消える。同じ連絡に両アカウント宛の行が
      // あり得るが、user 列を含む UNIQUE が無いので付け替えは落ちない。
      // 重複行はあえて消さない: 行を消すと event_broadcast.email_pending と
      // ズレて、定期実行がその連絡を空回りで拾い続ける。統合の一度きりの
      // 二重送信のほうが軽い
      ["event_broadcast_email", "user_id"],
      // 開催前アンケートの回答者 (#444/#448)。user_id が入るのは回答者が
      // 同意した記名回答だけで、匿名は NULL・UNIQUE 無し → simple でよい。
      // 付け替えないと (9) の user 削除で SET NULL が発火し、統合しただけで
      // 記名が匿名に痩せる（本人の同意した紐づけは統合先へ引き継ぐ）
      ["event_pre_survey_response", "user_id"],
      ["bgm_track", "owner_id"],
      // 共有コンテンツの所有者列 (userTables.ts)。退会 (deleteAccount) が
      // ghost へ付け替えるのと**同じ表**でなければならないので、定義は1本にして
      // ここへ差し込む。並びは userTables.ts の順＝この batch の文順
      ...SHARED_CONTENT_OWNER_COLUMNS,
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
};
