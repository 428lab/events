import type { ChatMember } from "@eventer/shared";
import { many, one, run, runCount } from "../client.js";

/** Nostrイベントチャット (#199) の紐付けデータ。
 * チャット本文はリレーにあり、ここでは「誰がどの鍵で発言するか」（表示許可リスト）、
 * チャンネルID、非表示リストのみを扱う */
export const eventChatRepo = {
  /** チャンネルIDをクリアする（リレー上に部屋が無い場合の作り直し用） */
  async clearChannel(eventId: string): Promise<void> {
    await run(
      "UPDATE event SET chat_channel_id = NULL WHERE id = ?",
      eventId,
    );
  },

  /** そのpubkeyを同一イベントで登録しているユーザーIDを返す（重複チェック用） */
  async pubkeyOwner(eventId: string, pubkey: string): Promise<string | null> {
    const row = await one<{ user_id: string }>(
      "SELECT user_id FROM event_chat_pubkey WHERE event_id = ? AND pubkey = ?",
      eventId,
      pubkey,
    );
    return row?.user_id ?? null;
  },

  /** 発言用の公開鍵を登録（イベント×ユーザーごとに1つ。再登録で置き換え）。
   * ユーザー自身の鍵（NIP-07）への置き換えなので、サーバー管理の一時鍵は消す */
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
  },

  /** 表示許可リスト（pubkey → ユーザー情報）。クライアントはこの pubkey のメッセージだけ描画する */
  async listMembers(eventId: string): Promise<ChatMember[]> {
    const rows = await many<{
      pubkey: string;
      user_id: string;
      username: string;
      global_name: string | null;
      avatar_url: string | null;
      role: string | null;
    }>(
      `SELECT p.pubkey, u.id AS user_id, u.username, u.global_name, u.avatar_url, m.role
         FROM event_chat_pubkey p
         JOIN user u ON u.id = p.user_id
         LEFT JOIN event_member m ON m.event_id = p.event_id AND m.user_id = p.user_id
        WHERE p.event_id = ? AND u.deleted_at IS NULL
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
