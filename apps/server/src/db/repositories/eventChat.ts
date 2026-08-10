import type { BlockedChatAuthor, ChatMember } from "@eventer/shared";
import { many, one, run, runCount } from "../client.js";

/** 表示許可リストの取得本体。withBlocked=true のときだけ締め出し中 (#283) も含める。
 * 参加者向けと管理画面で SQL が分かれると片方に除外漏れが出るので、1箇所に寄せてある。
 *
 * 元にするのは「いま署名に使う鍵」(event_chat_pubkey) ではなく
 * **これまでに使った鍵ぜんぶ** (event_chat_pubkey_history) (#332)。
 * 1人が複数行になる（端末や署名手段を変えると鍵が増える）。
 *
 * 締め出し (#283) は**その人の鍵をまとめて**外す。鍵が1人1つだった頃は
 * 「鍵を1つ外す＝その人の発言が全部消える」で一致していたが、履歴を持つように
 * なった今は、外した鍵ぶんだけ消えて別の鍵の発言が残ってしまう。
 * 締め出しは鍵ではなく人に対する操作なので、人単位で外す */
async function listMembersRows(
  eventId: string,
  withBlocked: boolean,
): Promise<ChatMember[]> {
  const rows = await many<{
    pubkey: string;
    user_id: string;
    username: string;
    global_name: string | null;
    avatar_url: string | null;
    role: string | null;
  }>(
    `SELECT p.pubkey, u.id AS user_id, u.username, u.global_name, u.avatar_url, m.role
       FROM event_chat_pubkey_history p
       JOIN user u ON u.id = p.user_id
       LEFT JOIN event_member m ON m.event_id = p.event_id AND m.user_id = p.user_id
      WHERE p.event_id = ? AND u.deleted_at IS NULL${
        withBlocked
          ? ""
          : ` AND NOT EXISTS (
             SELECT 1 FROM event_chat_blocked b
               JOIN event_chat_pubkey_history h
                 ON h.event_id = b.event_id AND h.pubkey = b.pubkey
              WHERE b.event_id = p.event_id AND h.user_id = p.user_id)`
      }
      ORDER BY p.created_at ASC`,
    eventId,
  );
  return rows.map((r) => ({
    pubkey: r.pubkey,
    userId: r.user_id,
    username: r.username,
    name: r.global_name ?? r.username,
    avatarUrl: r.avatar_url,
    role: r.role,
  }));
}

/** いま登録されている鍵を「その人がこれまでに使った鍵」へ記録する (#332)。
 * 登録の直後に呼ぶ（登録経路は setPubkey / setEphemeral の2つだけ）。
 *
 * 現在の行から写すので、同時登録のレースで**実際に確定した鍵**が記録される。
 * 履歴は消さない ＝ 署名の手段を変えても過去の自分の発言が表示され続ける。
 *
 * OR IGNORE なのは、同じ鍵を登録し直したとき（最初の created_at を残す）。
 * 他人が押さえている鍵はそもそも登録側 (pubkeyOwner) で弾かれる */
async function recordKeyHistory(
  eventId: string,
  userId: string,
): Promise<void> {
  await run(
    `INSERT OR IGNORE INTO event_chat_pubkey_history
       (event_id, user_id, pubkey, created_at)
     SELECT event_id, user_id, pubkey, created_at FROM event_chat_pubkey
      WHERE event_id = ? AND user_id = ?`,
    eventId,
    userId,
  );
}

/** Nostrイベントチャット (#199) の紐付けデータ。
 * チャット本文はリレーにあり、ここでは「誰がどの鍵で発言するか」（表示許可リスト）、
 * チャンネルID、非表示リストのみを扱う。
 *
 * 鍵は2つの表に分かれている (#332):
 * - event_chat_pubkey: **いま署名に使う鍵**（イベント×ユーザーで1行。一時鍵の secret 付き）
 * - event_chat_pubkey_history: **これまでに使った鍵ぜんぶ**（表示許可リストの元）
 * 「この鍵は誰のものか」を見る問い合わせは、必ず履歴のほうを見ること。
 * いまの鍵だけを見ると、手放した鍵が別人のものとして扱えてしまう */
export const eventChatRepo = {
  /** チャンネルIDをクリアする（リレー上に部屋が無い場合の作り直し用） */
  async clearChannel(eventId: string): Promise<void> {
    await run(
      "UPDATE event SET chat_channel_id = NULL WHERE id = ?",
      eventId,
    );
  },

  /** そのpubkeyを同一イベントで使っているユーザーIDを返す（重複チェック用）。
   * **いま使っている鍵だけでなく、過去に使った鍵も対象** (#332)。
   * 誰かが手放した鍵を別の人が登録できてしまうと、その鍵の過去の発言が
   * 登録した人の名前で表示される（なりすまし）ため */
  async pubkeyOwner(eventId: string, pubkey: string): Promise<string | null> {
    const row = await one<{ user_id: string }>(
      "SELECT user_id FROM event_chat_pubkey_history WHERE event_id = ? AND pubkey = ?",
      eventId,
      pubkey,
    );
    return row?.user_id ?? null;
  },

  /** 発言用の公開鍵を登録（イベント×ユーザーごとに1つ。再登録で置き換え）。
   * ユーザー自身の鍵（NIP-07）への置き換えなので、サーバー管理の一時鍵は消す。
   * 置き換えても**前の鍵は履歴に残る**（過去の発言が消えないように #332） */
  async setPubkey(
    eventId: string,
    userId: string,
    pubkey: string,
  ): Promise<void> {
    await run(
      `INSERT INTO event_chat_pubkey (event_id, user_id, pubkey, secret, created_at)
       VALUES (?, ?, ?, NULL, ?)
       ON CONFLICT (event_id, user_id) DO UPDATE SET pubkey = excluded.pubkey, secret = NULL, created_at = excluded.created_at`,
      eventId,
      userId,
      pubkey,
      Date.now(),
    );
    await recordKeyHistory(eventId, userId);
  },

  /** サーバー管理の一時鍵 (#223)。secret 付きの行のみ返す（NIP-07 登録は対象外） */
  async ephemeralFor(
    eventId: string,
    userId: string,
  ): Promise<{ pubkey: string; secret: string } | null> {
    const row = await one<{ pubkey: string; secret: string | null }>(
      "SELECT pubkey, secret FROM event_chat_pubkey WHERE event_id = ? AND user_id = ?",
      eventId,
      userId,
    );
    return row?.secret ? { pubkey: row.pubkey, secret: row.secret } : null;
  },

  /** サーバー管理の一時鍵を保存。NIP-07 行（secret NULL）からの切替は置き換えるが、
   * 既存の一時鍵は上書きしない（2端末同時発行のレースで鍵が割れないように先勝ち）。
   * 確定した鍵は ephemeralFor で読み直すこと */
  async setEphemeral(
    eventId: string,
    userId: string,
    pubkey: string,
    secret: string,
  ): Promise<void> {
    await run(
      `INSERT INTO event_chat_pubkey (event_id, user_id, pubkey, secret, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (event_id, user_id) DO UPDATE
         SET pubkey = excluded.pubkey, secret = excluded.secret, created_at = excluded.created_at
         WHERE event_chat_pubkey.secret IS NULL`,
      eventId,
      userId,
      pubkey,
      secret,
      Date.now(),
    );
    await recordKeyHistory(eventId, userId);
  },

  /** 表示許可リスト（pubkey → ユーザー情報）。クライアントはこの pubkey のメッセージだけ描画する。
   *
   * **締め出し中の発言者 (#283) はここから外れる**。表示はこのリストで絞られているので、
   * 1行外すだけでその人のこれまでの発言がまとめて見えなくなる。
   * 管理画面だけは締め出し中も含めて見る必要がある → listMembersWithBlocked */
  async listMembers(eventId: string): Promise<ChatMember[]> {
    return listMembersRows(eventId, false);
  },

  /** 締め出し中 (#283) も含む全員。**管理画面専用**。
   * 誰を締め出したのか、その人が何を書いたのかを見たうえで解除を判断するため、
   * 管理画面では pubkey → 発言者 の対応が引けないと困る。
   * 参加者向けの経路では絶対に使わないこと（締め出しが効かなくなる） */
  async listMembersWithBlocked(eventId: string): Promise<ChatMember[]> {
    return listMembersRows(eventId, true);
  },

  /** 発言者を締め出す (#283)。冪等（既に締め出し中なら 0 を返す）。
   * 許可リストの行は消さない ＝ 解除すればそのまま元に戻る */
  async blockAuthor(
    eventId: string,
    pubkey: string,
    adminId: string,
    at: number,
  ): Promise<number> {
    return runCount(
      `INSERT OR IGNORE INTO event_chat_blocked
         (event_id, pubkey, created_at, created_by) VALUES (?, ?, ?, ?)`,
      eventId,
      pubkey,
      at,
      adminId,
    );
  },

  /** 締め出しを解除する (#283)。冪等（締め出していなければ 0 を返す） */
  async unblockAuthor(eventId: string, pubkey: string): Promise<number> {
    return runCount(
      "DELETE FROM event_chat_blocked WHERE event_id = ? AND pubkey = ?",
      eventId,
      pubkey,
    );
  },

  /** 締め出している発言者の一覧（管理画面の解除導線用） */
  async listBlocked(eventId: string): Promise<BlockedChatAuthor[]> {
    const rows = await many<{
      pubkey: string;
      created_at: number;
      created_by: string | null;
    }>(
      `SELECT pubkey, created_at, created_by FROM event_chat_blocked
        WHERE event_id = ? ORDER BY created_at ASC`,
      eventId,
    );
    return rows.map((r) => ({
      pubkey: r.pubkey,
      blockedAt: r.created_at,
      blockedBy: r.created_by,
    }));
  },

  /** その鍵を締め出しているか (#283) */
  async isBlocked(eventId: string, pubkey: string): Promise<boolean> {
    const row = await one<{ n: number }>(
      "SELECT 1 AS n FROM event_chat_blocked WHERE event_id = ? AND pubkey = ?",
      eventId,
      pubkey,
    );
    return row !== null;
  },

  /** そのユーザーが、このイベントで使った鍵のどれかで締め出されているか (#283)。
   * 本人の画面をチャットに繋がせないための判定に使う。
   *
   * 見るのは履歴 (#332) なので、**同じアカウントのまま鍵を登録し直しても外れない**。
   * 鍵が1人1つだった頃は登録し直すと締め出しが外れていたが、履歴が残るように
   * なったのでその抜け道は塞がる（このアプリの中での話。別アカウントで入り直す
   * ことや、外部のクライアントからリレーへ投稿することは相変わらず防げない） */
  async isUserBlocked(eventId: string, userId: string): Promise<boolean> {
    const row = await one<{ n: number }>(
      `SELECT 1 AS n FROM event_chat_pubkey_history p
         JOIN event_chat_blocked b
           ON b.event_id = p.event_id AND b.pubkey = p.pubkey
        WHERE p.event_id = ? AND p.user_id = ?`,
      eventId,
      userId,
    );
    return row !== null;
  },

  /** その鍵をこのイベントで使った人（監査ログの当事者に残すため）。
   * 過去に使った鍵 (#332) も辿る。退会等で辿れなければ null。
   * 鍵しか残らなくても記録の意味は失われない */
  async blockedAuthorOf(
    eventId: string,
    pubkey: string,
  ): Promise<{ id: string; handle: string } | null> {
    const row = await one<{ id: string; username: string }>(
      `SELECT u.id, u.username FROM event_chat_pubkey_history p
         JOIN user u ON u.id = p.user_id
        WHERE p.event_id = ? AND p.pubkey = ?`,
      eventId,
      pubkey,
    );
    return row ? { id: row.id, handle: row.username } : null;
  },

  /** チャンネルID（kind:40 のイベントID）を先勝ちで設定し、確定した値を返す。
   * 既に設定済みなら既存値を返す（後着は無視） */
  async setChannelOnce(
    eventId: string,
    channelId: string,
  ): Promise<string | null> {
    await runCount(
      "UPDATE event SET chat_channel_id = ? WHERE id = ? AND chat_channel_id IS NULL",
      channelId,
      eventId,
    );
    return this.channelIdFor(eventId);
  },

  /** 公式鍵で発行した kind:40 の id を控える（再発行で上書き）(#221) */
  async setPendingChannel(eventId: string, channelId: string): Promise<void> {
    await run(
      "UPDATE event SET chat_channel_pending = ? WHERE id = ?",
      channelId,
      eventId,
    );
  },

  /** このイベント向けに発行済みの公式 kind:40 の id（未発行は null） */
  async pendingChannelFor(eventId: string): Promise<string | null> {
    const row = await one<{ chat_channel_pending: string | null }>(
      "SELECT chat_channel_pending FROM event WHERE id = ?",
      eventId,
    );
    return row?.chat_channel_pending ?? null;
  },

  async channelIdFor(eventId: string): Promise<string | null> {
    const row = await one<{ chat_channel_id: string | null }>(
      "SELECT chat_channel_id FROM event WHERE id = ?",
      eventId,
    );
    return row?.chat_channel_id ?? null;
  },

  /** メッセージをアプリ側で非表示にする（冪等） */
  async hideNote(eventId: string, noteId: string): Promise<void> {
    await run(
      "INSERT OR IGNORE INTO event_chat_hidden (event_id, note_id, created_at) VALUES (?, ?, ?)",
      eventId,
      noteId,
      Date.now(),
    );
  },

  /** 非表示を解除する（スタッフ）。
   * 運営が対処したもの (#278) は残す。戻せてしまうと対処した意味が無くなる */
  async unhideNote(eventId: string, noteId: string): Promise<void> {
    await run(
      `DELETE FROM event_chat_hidden
        WHERE event_id = ? AND note_id = ? AND admin_hidden_at IS NULL`,
      eventId,
      noteId,
    );
  },

  async listHidden(eventId: string): Promise<string[]> {
    const rows = await many<{ note_id: string }>(
      "SELECT note_id FROM event_chat_hidden WHERE event_id = ? ORDER BY created_at ASC",
      eventId,
    );
    return rows.map((r) => r.note_id);
  },

  /** 運営による非表示 (#278)。既にスタッフが非表示にしていた行にも目印を付ける
   * （以後スタッフの解除では戻らなくなる）。変更した行数を返す。
   *
   * **冪等**。既に運営が対処済みの行には触れず 0 を返す。上書きしてしまうと
   * 同じメッセージに2人目が対処したときに「最初に誰がいつ対処したか」が消え、
   * 監査ログにも2件目が残ってしまう（他の4種と揃えてある）。
   *
   * 行があること自体がスタッフの非表示なので、対処前の状態は
   * 「衝突したか」でそのまま決まる（衝突＝スタッフが非表示にしていた）。 */
  async adminHideNote(
    eventId: string,
    noteId: string,
    adminId: string,
    at: number,
  ): Promise<number> {
    return runCount(
      `INSERT INTO event_chat_hidden
         (event_id, note_id, created_at, admin_hidden_at, admin_hidden_by,
          admin_prev_hidden)
       VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT (event_id, note_id) DO UPDATE
         SET admin_hidden_at = excluded.admin_hidden_at,
             admin_hidden_by = excluded.admin_hidden_by,
             admin_prev_hidden = 1
         WHERE event_chat_hidden.admin_hidden_at IS NULL`,
      eventId,
      noteId,
      at,
      at,
      adminId,
    );
  },

  /** 運営による復元 (#278)。**運営の対処だけを解く**。
   * 対処する前からスタッフが非表示にしていたなら、行は残して目印だけ外す
   * （スタッフの判断まで取り消さない）。そうでなければ行ごと消す */
  async adminUnhideNote(eventId: string, noteId: string): Promise<number> {
    const backToStaff = await runCount(
      `UPDATE event_chat_hidden
          SET admin_hidden_at = NULL, admin_hidden_by = NULL,
              admin_prev_hidden = NULL
        WHERE event_id = ? AND note_id = ?
          AND admin_hidden_at IS NOT NULL AND admin_prev_hidden = 1`,
      eventId,
      noteId,
    );
    if (backToStaff > 0) return backToStaff;
    return runCount(
      `DELETE FROM event_chat_hidden
        WHERE event_id = ? AND note_id = ? AND admin_hidden_at IS NOT NULL`,
      eventId,
      noteId,
    );
  },

  /** 管理画面用: 非表示にしている note を、誰がいつ対処したか付きで返す。
   * staffHidden は運営が対処したあとも「対処する前にスタッフが非表示にしていたか」 */
  async listHiddenDetail(eventId: string): Promise<
    Array<{
      noteId: string;
      hiddenAt: number | null;
      hiddenBy: string | null;
      staffHidden: boolean;
    }>
  > {
    const rows = await many<{
      note_id: string;
      created_at: number;
      admin_hidden_at: number | null;
      admin_hidden_by: string | null;
      admin_prev_hidden: number | null;
    }>(
      `SELECT note_id, created_at, admin_hidden_at, admin_hidden_by,
              admin_prev_hidden
         FROM event_chat_hidden WHERE event_id = ? ORDER BY created_at ASC`,
      eventId,
    );
    return rows.map((r) => ({
      noteId: r.note_id,
      hiddenAt: r.admin_hidden_at,
      hiddenBy: r.admin_hidden_by,
      staffHidden:
        r.admin_hidden_at === null ? true : r.admin_prev_hidden === 1,
    }));
  },
};
