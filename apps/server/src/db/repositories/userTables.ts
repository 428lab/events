/**
 * user を参照するテーブルの一覧。**ここが唯一の定義**で、
 * アカウント統合 (accountMerge.ts)・退会 (accountDeletion.ts)・
 * 利用実績の判定 (accountDeletion.ts の hasActivity) がすべてここを読む。
 *
 * 分ける前は同じ表が統合側・退会側・実績判定に**3回**書かれていた。
 * 新しく user を参照する表が増えたとき、統合には登録されるのに退会には
 * 足し忘れる、という壊れ方が実際に起きる（#339・#380・#393 と3回続いた）。
 * そのときの結果は
 *   - 共有コンテンツが名義不明のまま残る（誰も直せない孤児になる）
 *   - FK が user 行の DELETE をブロックして完全削除そのものが失敗する
 * のどちらかで、**その場では気づかない**。定義を1本にして、片側だけ直る
 * 余地を無くす。網羅は test/user-tables.test.ts と
 * test/merge-user-columns.test.ts が見張る。
 */

/**
 * 退会しても残す共有コンテンツの所有者列。
 * 退会 (deleteAccount) では「退会済みユーザー」(ghost) 名義へ付け替え、
 * 統合 (mergeUsers) では勝ち側へ付け替える。**対象は同じ表**でなければならない。
 * 統合だけに足すと、その表の行は退会で孤児になるか FK で削除をブロックする。
 *
 * 6つの UPDATE は表も列も互いに独立なので、どの順で流しても結果は同じ。
 * 統合も退会もこの配列をそのまま先頭から回す。
 */
export const SHARED_CONTENT_OWNER_COLUMNS: ReadonlyArray<
  [table: string, col: string]
> = [
  // イベント。参加者の履歴・予定を壊さないために残す。
  // FK に ON DELETE が無いので、付け替えないと user 行の削除がブロックされる
  ["event", "created_by"],
  // 開催リクエスト（たまご）。同じく FK に ON DELETE が無い
  ["event_request", "created_by"],
  // 会場オファー。同じく FK に ON DELETE が無い。
  // 本人の連絡先だけは deleteAccount (1-b) で別に消す
  ["venue_offer", "created_by"],
  // コミュニティ。FK は CASCADE なので、付け替えないと
  // 参加者ごとコミュニティが消える
  ["community", "owner_id"],
  // 会場。FK に ON DELETE が無い。連絡先は deleteAccount (1-b) で別に消す
  ["venue", "owner_id"],
  // 割り勘の立替者 (#556)。FK に ON DELETE が無い（付け替え漏れを FK 違反で止める）。
  // 退会者の行は ghost 名義で残し、他人の金額を動かさない（docs/warikan.md §3.3）
  ["event_expense", "payer_user_id"],
];

/**
 * 割り勘の帳簿の当事者列 (#556) を付け替える SQL。`?1` = 移す元、`?2` = 移す先。
 * 統合 (mergeUsers) は勝ち側へ、退会 (deleteAccount) は ghost へ、**同じ配列を
 * 先頭から回す**（統合は simple の前、退会は (1) の直後）。**文の順序が仕様**。
 *
 * 負担行は PK (expense_id, user_id) に user を含むので単純な UPDATE は衝突する。
 * 負け側の行を捨てる（uniqueKeyed）と重みが落ちて第三者の負担額が動くので、
 * **重みを合算**する。Σweight が変わらないので第三者の負担額は1円も動かない
 * （docs/warikan.md §3.3「退会・統合」）。
 */
export const LEDGER_PARTY_REASSIGN_SQL: ReadonlyArray<string> = [
  // (a) 同じ立替に移す先の負担行があれば、重みを足し込む
  `UPDATE event_expense_share
      SET weight = weight + (SELECT s.weight FROM event_expense_share s
                              WHERE s.expense_id = event_expense_share.expense_id AND s.user_id = ?1)
    WHERE user_id = ?2
      AND expense_id IN (SELECT expense_id FROM event_expense_share WHERE user_id = ?1)`,
  // (b) 足し込んだ元の行を消す
  `DELETE FROM event_expense_share
    WHERE user_id = ?1
      AND expense_id IN (SELECT expense_id FROM event_expense_share WHERE user_id = ?2)`,
  // (c) 残りを付け替える（もう PK は衝突しない）
  `UPDATE event_expense_share SET user_id = ?2 WHERE user_id = ?1`,
];

/**
 * event_like.target_key が「ユーザーID」を指す kind。SQL の IN 句にそのまま埋める。
 *
 * event_like から user への FK は無いので、この kind の行だけは
 * 統合で付け替え (mergeUsers (2))、退会で削除する (deleteAccount (3)) 必要がある。
 * 片方に書き漏らすと、存在しないユーザーを指す宙ぶらりんの行が残る。
 * 他の kind（'event' など）の target_key はユーザーIDではないので対象外。
 */
export const EVENT_LIKE_USER_KINDS = "('host', 'staff', 'participant')";

/**
 * アカウントに利用実績があるか (#238) を判定する表と列。
 *
 * 参加・作成系に加え、ユーザー資産（deck/live_set/bgm）・公開コンテンツ
 * （コメント）・問い合わせ・FK が削除をブロックするテーブル
 * （live_set/venue_offer）も判定に含める。ここに漏れがあると
 * 「引き取り→削除」で資産が消えるか、削除がFK違反で失敗する。
 *
 * ここは表ごと直接見る。運営が非表示にした投稿 (#278) も実績として数えたいので、
 * 非表示を落とすリポジトリの SELECT は **使わないこと**。
 * 荒らし投稿しかないアカウントが引き取り可能になってしまう。
 */
export const ACTIVITY_TABLES: ReadonlyArray<[table: string, col: string]> = [
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
  // 割り勘の帳簿の当事者 (#556)。FK が user 行の削除をブロックするので、
  // イベントから外された後に帳簿の行だけが残った人を「実績なし」にしない
  ["event_expense", "payer_user_id"],
  ["event_expense_share", "user_id"],
];

// event_access_invite: user_id CASCADE / invited_by SET NULL on account deletion.
// Neither is shared content; mergeUsers resolves grant conflicts before transfer.
