import type { StaffChatKey, StaffChatMember } from "@eventer/shared";
import { batch, many, one, run } from "../client.js";

/** イベントスタッフ用のチャットルーム (#382)。設計は docs/staff-chat.md。
 *
 * **event_group_chat_room / event_group_chat_key / event_group_chat_signer を
 * 読み書きする SQL はこのファイルの中にしか置かない**（参加者向けの経路を
 * 1本も作らないため。test/staff-chat-sql-audit.test.ts が機械で守る）。
 * 例外は mergeUsers (#396) の uniqueKeyed 1件のみ（あちらのテストが登録漏れを守る）。
 *
 * audience は表・PK に持たせてあるが、いまの読み書きは 'staff' 固定。
 * #205 が乗るときに引数化する（先に配り歩くと使われない引数が転がる）。
 *
 * 鍵の平文（secret）は payload を返すリポジトリ関数の戻り値にだけ現れる。
 * **ログには出さないこと**（console.log に鍵・roomId を渡さない）。
 */

/** 乱数 hex（グループ共通鍵 32バイト / roomId 32バイト） */
function randomHex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const staffChatRepo = {
  /** 部屋の roomId（未開設なら null） */
  async roomIdFor(eventId: string): Promise<string | null> {
    const row = await one<{ room_id: string }>(
      `SELECT room_id FROM event_group_chat_room
        WHERE event_id = ? AND audience = 'staff'`,
      eventId,
    );
    return row?.room_id ?? null;
  },

  /** 部屋と v1 鍵を無ければ作る（先勝ち・冪等。設計 7.1）。
   * 2人の staff が同時に開いても、部屋（PK の INSERT OR IGNORE）と v1
   * （PK (event, audience, version) の INSERT OR IGNORE）は1つに定まる。
   * 鍵の行は消えないので v1 は常に存在し、後着の生成が世代を乱すことはない */
  async ensureRoom(eventId: string): Promise<string> {
    const now = Date.now();
    await run(
      `INSERT OR IGNORE INTO event_group_chat_room
         (event_id, audience, room_id, created_at)
       VALUES (?, 'staff', ?, ?)`,
      eventId,
      randomHex(32),
      now,
    );
    await run(
      `INSERT OR IGNORE INTO event_group_chat_key
         (event_id, audience, version, secret, created_at, reason)
       VALUES (?, 'staff', 1, ?, ?, 'created')`,
      eventId,
      randomHex(32),
      now,
    );
    const settled = await this.roomIdFor(eventId);
    if (!settled) throw new Error("staff chat room was not created");
    return settled;
  },

  /** 共通鍵の全世代（過去ログの復号のため全部返す。新規発言は最新 version） */
  async listKeys(eventId: string): Promise<StaffChatKey[]> {
    return many<StaffChatKey>(
      `SELECT version, secret FROM event_group_chat_key
        WHERE event_id = ? AND audience = 'staff' ORDER BY version ASC`,
      eventId,
    );
  },

  /** 本人の発言用一時鍵（失効中も返す。呼び出し側が revokedAt で判断する） */
  async signerFor(
    eventId: string,
    userId: string,
  ): Promise<{ pubkey: string; secret: string; revokedAt: number | null } | null> {
    const row = await one<{
      pubkey: string;
      secret: string;
      revoked_at: number | null;
    }>(
      `SELECT pubkey, secret, revoked_at FROM event_group_chat_signer
        WHERE event_id = ? AND audience = 'staff' AND user_id = ?`,
      eventId,
      userId,
    );
    return row
      ? { pubkey: row.pubkey, secret: row.secret, revokedAt: row.revoked_at }
      : null;
  },

  /** その pubkey をこの部屋で持っている人（乱数衝突の保険 #332 と同じ） */
  async pubkeyOwner(eventId: string, pubkey: string): Promise<string | null> {
    const row = await one<{ user_id: string }>(
      `SELECT user_id FROM event_group_chat_signer
        WHERE event_id = ? AND audience = 'staff' AND pubkey = ?`,
      eventId,
      pubkey,
    );
    return row?.user_id ?? null;
  },

  /** 発言用一時鍵を保存する。**イベント×ユーザーで1回だけ**成功し、
   * 2回目以降は何もしない（先勝ち。確定した鍵は signerFor で読み直すこと） */
  async addSigner(
    eventId: string,
    userId: string,
    pubkey: string,
    secret: string,
  ): Promise<void> {
    await run(
      `INSERT OR IGNORE INTO event_group_chat_signer
         (event_id, audience, user_id, pubkey, secret, created_at, revoked_at)
       VALUES (?, 'staff', ?, ?, ?, ?, NULL)`,
      eventId,
      userId,
      pubkey,
      secret,
      Date.now(),
    );
  },

  /** 失効した signer を再有効化する（再招待→再承諾で戻った人。設計 7.3）。
   * 同じ signer をそのまま使うので、不在期間の前の発言も本人のものとして残る */
  async reactivateSigner(eventId: string, userId: string): Promise<void> {
    await run(
      `UPDATE event_group_chat_signer SET revoked_at = NULL
        WHERE event_id = ? AND audience = 'staff' AND user_id = ?`,
      eventId,
      userId,
    );
  },

  /** 表示許可リスト（pubkey → ユーザー情報）。クライアントはこの pubkey の
   * メッセージだけ描画する。失効した人（revokedAt 付き）も返す：過去の発言の
   * 名前解決のため。ただし revokedAt より後のメッセージは表示側が描画しない。
   * 退会申請中（deleted_at 付き）の人は participant チャット（listMembersRows）と
   * 同じく外す（退会した人の名前を出し続けない） */
  async listMembers(eventId: string): Promise<StaffChatMember[]> {
    const rows = await many<{
      pubkey: string;
      user_id: string;
      username: string;
      global_name: string | null;
      avatar_url: string | null;
      revoked_at: number | null;
    }>(
      `SELECT s.pubkey, u.id AS user_id, u.username, u.global_name,
              u.avatar_url, s.revoked_at
         FROM event_group_chat_signer s
         JOIN user u ON u.id = s.user_id
        WHERE s.event_id = ? AND s.audience = 'staff' AND u.deleted_at IS NULL
        ORDER BY s.created_at ASC`,
      eventId,
    );
    return rows.map((r) => ({
      pubkey: r.pubkey,
      userId: r.user_id,
      username: r.username,
      name: r.global_name ?? r.username,
      avatarUrl: r.avatar_url,
      revokedAt: r.revoked_at,
    }));
  },

  /** スタッフ資格の喪失（設計 7.3）。1トランザクション（D1 batch）で
   * 1. その部屋の signer 行に revoked_at を打つ（行は消さない。履歴表示のため）
   * 2. 部屋が存在すれば共通鍵を1世代進める（reason='rotated'）
   * を行う。部屋が無ければどちらの文も0行で、何も起きない（冪等に呼べる）。
   *
   * 呼び出し箇所は資格を失う4経路すべて（漏れると「抜けた人が新しい発言を
   * 読める」が残る。test/staff-chat.test.ts がそれぞれの経路を落とす）:
   * - 降格: routes/events.ts のロール変更ハンドラ
   * - 参加解除: routes/events.ts の leaveEvent()（DELETE /join とロール変更→
   *   participant の両方がここを通る）
   * - 退会申請 (soft delete): users.ts requestDeletion → onStaffLostEverywhere
   * - 退会 purge: users.ts deleteAccount → onStaffLostEverywhere（多重防御）
   *
   * 新 version の採番は INSERT...SELECT MAX(version)+1 で行う。batch は単一
   * トランザクションなので同時実行でも歯抜け・重複にならない。
   * GROUP BY を付けるのは、鍵が1行も無いとき（部屋未開設）に集約が
   * NULL の1行を返して NOT NULL 制約で落ちるのを防ぐため（0行のまま通す） */
  async onStaffLost(eventId: string, userId: string): Promise<void> {
    const now = Date.now();
    await batch([
      {
        sql: `UPDATE event_group_chat_signer SET revoked_at = ?
               WHERE event_id = ? AND audience = 'staff' AND user_id = ?
                 AND revoked_at IS NULL`,
        args: [now, eventId, userId],
      },
      {
        sql: `INSERT INTO event_group_chat_key
                (event_id, audience, version, secret, created_at, reason)
              SELECT event_id, audience, MAX(version) + 1, ?, ?, 'rotated'
                FROM event_group_chat_key
               WHERE event_id = ? AND audience = 'staff'
               GROUP BY event_id, audience`,
        args: [randomHex(32), now, eventId],
      },
    ]);
  },

  /** confirmed staff だった**すべての部屋**をローテーションする。呼ぶのは2箇所:
   *
   * - **退会申請**（soft delete #250。users.ts requestDeletion）。申請の時点で
   *   本人は API を叩けなくなるが、**申請前に受け取った鍵は手元に生きている**ので、
   *   ここで回さないと猶予期間（30日）のあいだ外部クライアントから新しい発言を
   *   読み続けられる。復帰（restore）した人はゲートを再び通って全世代を
   *   受け取り直すので、先に回しても困らない
   * - **退会の完全削除**（purge。users.ts deleteAccount）。purge はロール変更・
   *   参加解除のルートを通らないための多重防御（申請時に回っていれば2世代目が
   *   増えるだけで害は無い）。signer 行自体は user 削除の FK CASCADE で消える
   *
   * 部屋が1つも無ければ SELECT 1回だけで終わる。
   * @returns 消費したサブリクエスト数（列挙 1 ＋ 部屋ごとの batch 1。
   *          purge の実行予算（lib/purgeDeleted.ts）に積むため返す） */
  async onStaffLostEverywhere(userId: string): Promise<number> {
    const rooms = await many<{ event_id: string }>(
      `SELECT r.event_id FROM event_group_chat_room r
         JOIN event_member m ON m.event_id = r.event_id AND m.user_id = ?
        WHERE r.audience = 'staff' AND m.role = 'staff' AND m.status = 'confirmed'`,
      userId,
    );
    for (const room of rooms) {
      await this.onStaffLost(room.event_id, userId);
    }
    return 1 + rooms.length;
  },
};
