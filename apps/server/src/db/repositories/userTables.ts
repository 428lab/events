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
 * 5つの UPDATE は表も列も互いに独立なので、どの順で流しても結果は同じ。
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
];
