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

  /** サーバー管理の一時鍵を保存（再発行・NIP-07からの切替は置き換え） */
  async setEphemeral(
    eventId: string,
    userId: string,
    pubkey: string,
    secret: string,
  ): Promise<void> {
    await run(
      `INSERT INTO event_chat_pubkey (event_id, user_id, pubkey, secret, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (event_id, user_id) DO UPDATE SET pubkey = excluded.pubkey, secret = excluded.secret, created_at = excluded.created_at`,
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
    }>(
      `SELECT p.pubkey, u.id AS user_id, u.username, u.global_name, u.avatar_url
         FROM event_chat_pubkey p
         JOIN user u ON u.id = p.user_id
        WHERE p.event_id = ?
        ORDER BY p.created_at ASC`,
      eventId,
    );
    return rows.map((r) => ({
      pubkey: r.pubkey,
      userId: r.user_id,
      username: r.username,
      name: r.global_name ?? r.username,
      avatarUrl: r.avatar_url,
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

  /** 非表示を解除する */
  async unhideNote(eventId: string, noteId: string): Promise<void> {
    await run(
      "DELETE FROM event_chat_hidden WHERE event_id = ? AND note_id = ?",
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
};
