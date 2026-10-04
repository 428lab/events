import type {
  EncryptedChatMember,
  GroupChatAudience,
  GroupChatKey,
  GroupChatMember,
} from "@eventer/shared";
import { batch, many, one, run } from "../client.js";
import { eventWrite, type EventWriter } from "./eventWriteGuard.js";

/** グループチャット: スタッフチャット (#382, audience='staff') と参加者の
 * 暗号化チャット (#582, audience='members')。設計は docs/staff-chat.md と
 * docs/participant-encrypted-chat.md。
 *
 * **event_group_chat_room / event_group_chat_key / event_group_chat_signer を
 * 読み書きする SQL はこのファイルの中にしか置かない**（鍵がゲートの外へ返る経路を
 * 1本も作らないため。test/staff-chat-sql-audit.test.ts が機械で守る）。
 * 例外は mergeUsers (#396) の uniqueKeyed 1件のみ（あちらのテストが登録漏れを守る）。
 *
 * 部屋は audience で分かれる。staff の部屋の鍵を members の経路へ返さないこと
 * （逆も）。どの関数も audience を引数で受け取り、SQL の WHERE に必ず入れる。
 *
 * 鍵の平文（secret）は payload を返すリポジトリ関数の戻り値にだけ現れる。
 * **ログには出さないこと**（console.log に鍵・roomId を渡さない）。
 */

/** 乱数 hex（グループ共通鍵 32バイト / roomId 32バイト） */
function randomHex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 参加者の暗号化チャット (#582) の鍵を受け取れる**人**の条件（設計 2.4 の 2〜4）。
 * `u` は user の別名、`?1` は event_id（呼び出し側は番号付きの引数で渡す）。GET のゲートと遅延ローテーションの照合が
 * **同じこの述語**を使う（片方だけ緩むと「抜けた人に新しい世代が配られる」穴になる）。
 * - 参加確定（status='confirmed'）の participant / staff / judge / observer
 * - 退会申請中でない
 * - 締め出し (#283) 中でない。**人単位**: 平文の発言鍵（event_chat_key）と
 *   暗号化部屋の signer のどちらの pubkey で締め出されていても該当（設計 3.3） */
const PERSON_BLOCKED = `EXISTS (SELECT 1 FROM event_chat_blocked b
           WHERE b.event_id = ?1 AND (
             b.pubkey IN (SELECT k.pubkey FROM event_chat_key k
                           WHERE k.event_id = b.event_id AND k.user_id = u.id)
             OR b.pubkey IN (SELECT s2.pubkey FROM event_group_chat_signer s2
                           WHERE s2.event_id = b.event_id AND s2.audience = 'members'
                             AND s2.user_id = u.id)))`;
const MEMBERS_PERSON_ELIGIBLE = `(
  EXISTS (SELECT 1 FROM event_member m
           WHERE m.event_id = ?1 AND m.user_id = u.id AND m.status = 'confirmed'
             AND m.role IN ('participant', 'staff', 'judge', 'observer'))
  AND u.deleted_at IS NULL
  AND NOT ${PERSON_BLOCKED})`;

/** 部屋の鍵を1世代進める文（reason='rotated'）。
 * 新 version の採番は INSERT...SELECT MAX(version)+1 で行う。batch は単一
 * トランザクションなので同時実行でも歯抜け・重複にならない。
 * GROUP BY を付けるのは、鍵が1行も無いとき（部屋未開設）に集約が
 * NULL の1行を返して NOT NULL 制約で落ちるのを防ぐため（0行のまま通す）。
 * `onlyIfChanged` は直前の UPDATE（signer の失効）が1行以上変えたときだけ進める
 * （同時に2本の照合が走っても、失効を打った側だけが世代を進める） */
function rotateKeyStatement(
  eventId: string,
  audience: GroupChatAudience,
  now: number,
  onlyIfChanged: boolean,
): { sql: string; args: unknown[] } {
  return {
    sql: `INSERT INTO event_group_chat_key
            (event_id, audience, version, secret, created_at, reason)
          SELECT event_id, audience, MAX(version) + 1, ?, ?, 'rotated'
            FROM event_group_chat_key
           WHERE event_id = ? AND audience = ?${onlyIfChanged ? " AND changes() > 0" : ""}
           GROUP BY event_id, audience`,
    args: [randomHex(32), now, eventId, audience],
  };
}

export const groupChatRepo = {
  /** 部屋の roomId（未開設なら null） */
  async roomIdFor(
    eventId: string,
    audience: GroupChatAudience,
  ): Promise<string | null> {
    const row = await one<{ room_id: string }>(
      `SELECT room_id FROM event_group_chat_room
        WHERE event_id = ? AND audience = ?`,
      eventId,
      audience,
    );
    return row?.room_id ?? null;
  },

  /** 部屋と v1 鍵を無ければ作る（先勝ち・冪等。設計 7.1）。
   * 2人の staff が同時に開いても、部屋（PK の INSERT OR IGNORE）と v1
   * （PK (event, audience, version) の INSERT OR IGNORE）は1つに定まる。
   * 鍵の行は消えないので v1 は常に存在し、後着の生成が世代を乱すことはない。
   * writer を渡すと、イベントの書き込みガード（private-events の batch guard）と
   * 同じ batch で作る（members の部屋。設計 2.2） */
  async ensureRoom(
    eventId: string,
    audience: GroupChatAudience,
    writer?: EventWriter,
  ): Promise<string> {
    const now = Date.now();
    const stmts = [
      {
        sql: `INSERT OR IGNORE INTO event_group_chat_room
                (event_id, audience, room_id, created_at)
              VALUES (?, ?, ?, ?)`,
        args: [eventId, audience, randomHex(32), now],
      },
      {
        sql: `INSERT OR IGNORE INTO event_group_chat_key
                (event_id, audience, version, secret, created_at, reason)
              VALUES (?, ?, 1, ?, ?, 'created')`,
        args: [eventId, audience, randomHex(32), now],
      },
    ];
    if (writer) {
      await eventWrite(writer, stmts);
    } else {
      for (const st of stmts) await run(st.sql, ...st.args);
    }
    const settled = await this.roomIdFor(eventId, audience);
    if (!settled) throw new Error("group chat room was not created");
    return settled;
  },

  /** 共通鍵の全世代（過去ログの復号のため全部返す。新規発言は最新 version） */
  async listKeys(
    eventId: string,
    audience: GroupChatAudience,
  ): Promise<GroupChatKey[]> {
    return many<GroupChatKey>(
      `SELECT version, secret FROM event_group_chat_key
        WHERE event_id = ? AND audience = ? ORDER BY version ASC`,
      eventId,
      audience,
    );
  },

  /** 本人の発言用一時鍵（失効中も返す。呼び出し側が revokedAt で判断する） */
  async signerFor(
    eventId: string,
    audience: GroupChatAudience,
    userId: string,
  ): Promise<{ pubkey: string; secret: string; revokedAt: number | null } | null> {
    const row = await one<{
      pubkey: string;
      secret: string;
      revoked_at: number | null;
    }>(
      `SELECT pubkey, secret, revoked_at FROM event_group_chat_signer
        WHERE event_id = ? AND audience = ? AND user_id = ?`,
      eventId,
      audience,
      userId,
    );
    return row
      ? { pubkey: row.pubkey, secret: row.secret, revokedAt: row.revoked_at }
      : null;
  },

  /** その pubkey をこの部屋で持っている人（乱数衝突の保険 #332 と同じ） */
  async pubkeyOwner(
    eventId: string,
    audience: GroupChatAudience,
    pubkey: string,
  ): Promise<string | null> {
    const row = await one<{ user_id: string }>(
      `SELECT user_id FROM event_group_chat_signer
        WHERE event_id = ? AND audience = ? AND pubkey = ?`,
      eventId,
      audience,
      pubkey,
    );
    return row?.user_id ?? null;
  },

  /** 発言用一時鍵を保存する。**イベント×ユーザーで1回だけ**成功し、
   * 2回目以降は何もしない（先勝ち。確定した鍵は signerFor で読み直すこと） */
  async addSigner(
    eventId: string,
    audience: GroupChatAudience,
    userId: string,
    pubkey: string,
    secret: string,
    writer?: EventWriter,
  ): Promise<void> {
    const st = {
      sql: `INSERT OR IGNORE INTO event_group_chat_signer
              (event_id, audience, user_id, pubkey, secret, created_at, revoked_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      args: [eventId, audience, userId, pubkey, secret, Date.now()],
    };
    if (writer) await eventWrite(writer, [st]);
    else await run(st.sql, ...st.args);
  },

  /** 失効した signer を再有効化する（再招待→再承諾で戻った人。設計 7.3）。
   * 同じ signer をそのまま使うので、不在期間の前の発言も本人のものとして残る */
  async reactivateSigner(
    eventId: string,
    audience: GroupChatAudience,
    userId: string,
  ): Promise<void> {
    await run(
      `UPDATE event_group_chat_signer SET revoked_at = NULL
        WHERE event_id = ? AND audience = ? AND user_id = ?`,
      eventId,
      audience,
      userId,
    );
  },

  /** 表示許可リスト（pubkey → ユーザー情報）。クライアントはこの pubkey の
   * メッセージだけ描画する。失効した人（revokedAt 付き）も返す：過去の発言の
   * 名前解決のため。ただし revokedAt より後のメッセージは表示側が描画しない。
   * 退会申請中（deleted_at 付き）の人は participant チャット（listMembersRows）と
   * 同じく外す（退会した人の名前を出し続けない） */
  async listMembers(
    eventId: string,
    audience: GroupChatAudience,
  ): Promise<GroupChatMember[]> {
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
        WHERE s.event_id = ? AND s.audience = ? AND u.deleted_at IS NULL
        ORDER BY s.created_at ASC`,
      eventId,
      audience,
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
   * - 参加解除: membershipChange.ts の changeMembership()（DELETE /join とロール変更→
   *   participant の両方がここを通る）
   * - 退会申請 (soft delete): accountDeletion.ts requestDeletion → onStaffLostEverywhere
   * - 退会 purge: accountDeletion.ts deleteAccount → onStaffLostEverywhere（多重防御）
   *
   * 新 version の採番は rotateKeyStatement を参照 */
  async onStaffLost(eventId: string, userId: string): Promise<void> {
    const now = Date.now();
    await batch([
      {
        sql: `UPDATE event_group_chat_signer SET revoked_at = ?
               WHERE event_id = ? AND audience = 'staff' AND user_id = ?
                 AND revoked_at IS NULL`,
        args: [now, eventId, userId],
      },
      rotateKeyStatement(eventId, "staff", now, false),
    ]);
  },

  /** confirmed staff だった**すべての部屋**をローテーションする。呼ぶのは2箇所:
   *
   * - **退会申請**（soft delete #250。accountDeletion.ts requestDeletion）。申請の時点で
   *   本人は API を叩けなくなるが、**申請前に受け取った鍵は手元に生きている**ので、
   *   ここで回さないと猶予期間（30日）のあいだ外部クライアントから新しい発言を
   *   読み続けられる。復帰（restore）した人はゲートを再び通って全世代を
   *   受け取り直すので、先に回しても困らない
   * - **退会の完全削除**（purge。accountDeletion.ts deleteAccount）。purge はロール変更・
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

  /* ===== 参加者の暗号化チャット (#582, audience='members') ===== */

  /** 鍵一式を受け取れるか（設計 2.4 の 1〜4。5 の閲覧は requireEventAccess が見る）。
   * appAdmin・コミュニティ管理者のバイパスは**通さない**（イベント配下は myRole で判定）。
   * イベント側: 暗号化オン・チャット有効・公開済み・日程確定 */
  async isEncryptedChatEligible(eventId: string, userId: string): Promise<boolean> {
    const row = await one<{ ok: number }>(
      `SELECT 1 AS ok FROM event e JOIN user u ON u.id = ?2
        WHERE e.id = ?1 AND e.chat_encrypted = 1 AND e.chat_enabled = 1
          AND e.status = 'published' AND e.scheduling = 0
          AND ${MEMBERS_PERSON_ELIGIBLE}`,
      eventId,
      userId,
    );
    return row !== null;
  },

  /** 遅延ローテーション（設計 3.2）。members 部屋の**現役 signer のうち、持ち主が
   * いまはゲート（人の条件）を通らない人**を全員失効させ、鍵を**1世代だけ**進める
   * （何人抜けても1世代）。抜けた人が居なければ SELECT 1本で終わる。
   *
   * GET/POST /encrypted-chat の先頭で呼ぶ。暗号化に使う最新の鍵はこの照合を
   * 通ったレスポンスからしか手に入らず、web は送信の直前に必ず取り直すので、
   * 資格を失う経路（取消・除外・抽選・閲覧権取消・締め出し……）ごとにフックを
   * 置かなくても、抜けた人に新しい世代が配られることは無い。
   * @returns 失効させた人数 */
  async reconcileMembers(eventId: string): Promise<number> {
    const lost = await many<{ user_id: string }>(
      `SELECT s.user_id FROM event_group_chat_signer s
         JOIN user u ON u.id = s.user_id
        WHERE s.event_id = ?1 AND s.audience = 'members' AND s.revoked_at IS NULL
          AND NOT ${MEMBERS_PERSON_ELIGIBLE}`,
      eventId,
    );
    if (lost.length === 0) return 0;
    const now = Date.now();
    await batch([
      {
        sql: `UPDATE event_group_chat_signer SET revoked_at = ?
               WHERE event_id = ? AND audience = 'members' AND revoked_at IS NULL
                 AND user_id IN (SELECT value FROM json_each(?))`,
        args: [now, eventId, JSON.stringify(lost.map((r) => r.user_id))],
      },
      rotateKeyStatement(eventId, "members", now, true),
    ]);
    return lost.length;
  },

  /** 退会（申請・purge）の即時ローテーション（設計 3.2 の多重防御）。
   * 本人が**現役 signer を持つ** members 部屋をすべて失効＋1世代進める。
   * purge では signer 行が user 削除の CASCADE で消え、遅延照合の対象から外れて
   * 二度と回らなくなるため、ここで先に回す。
   * @returns 消費したサブリクエスト数（列挙 1 ＋ 部屋ごとの batch 1。purge の予算に積む） */
  async onMemberLostEverywhere(userId: string): Promise<number> {
    const rooms = await many<{ event_id: string }>(
      `SELECT event_id FROM event_group_chat_signer
        WHERE user_id = ? AND audience = 'members' AND revoked_at IS NULL`,
      userId,
    );
    const now = Date.now();
    for (const room of rooms) {
      await batch([
        {
          sql: `UPDATE event_group_chat_signer SET revoked_at = ?
                 WHERE event_id = ? AND audience = 'members' AND user_id = ?
                   AND revoked_at IS NULL`,
          args: [now, room.event_id, userId],
        },
        rotateKeyStatement(room.event_id, "members", now, true),
      ]);
    }
    return 1 + rooms.length;
  },

  /** members 部屋の表示許可リストに、イベントでのロールを添えたもの（設計 2.3。
   * staff の発言の色分け #228）。失効した人も返す（過去の発言の名前解決のため）。
   * 退会申請中の人は listMembers と同じく外す。
   * 締め出し中 (#283) の人は、参加者に返す一覧からは外す（平文の許可リストと同じく、
   * これまでの発言ごと画面から消える）。運営の画面は withBlocked で含める */
  async listMembersWithRole(
    eventId: string,
    withBlocked = false,
  ): Promise<EncryptedChatMember[]> {
    const rows = await many<{
      pubkey: string;
      user_id: string;
      username: string;
      global_name: string | null;
      avatar_url: string | null;
      revoked_at: number | null;
      role: string | null;
    }>(
      `SELECT s.pubkey, u.id AS user_id, u.username, u.global_name,
              u.avatar_url, s.revoked_at, m.role
         FROM event_group_chat_signer s
         JOIN user u ON u.id = s.user_id
         LEFT JOIN event_member m ON m.event_id = s.event_id AND m.user_id = s.user_id
        WHERE s.event_id = ?1 AND s.audience = 'members' AND u.deleted_at IS NULL
          ${withBlocked ? "" : `AND NOT ${PERSON_BLOCKED}`}
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
      role: r.role,
    }));
  },

  /** その人が members 部屋の signer の pubkey で締め出されているか（設計 3.3）。
   * 平文の発言鍵での締め出しは eventChatRepo.isUserBlocked が見る。両方を OR で使う */
  async isMembersSignerBlocked(eventId: string, userId: string): Promise<boolean> {
    const row = await one<{ n: number }>(
      `SELECT 1 AS n FROM event_group_chat_signer s
         JOIN event_chat_blocked b ON b.event_id = s.event_id AND b.pubkey = s.pubkey
        WHERE s.event_id = ? AND s.audience = 'members' AND s.user_id = ?`,
      eventId,
      userId,
    );
    return row !== null;
  },

  /** 締め出し (#283) を人単位で効かせるための、その鍵の持ち主の鍵ぜんぶ（設計 3.3）。
   * 持ち主は平文の発言鍵（event_chat_key）と members 部屋の signer のどちらからでも辿る。
   * 返す鍵も両方の表から集める（引いた鍵そのものも必ず含む）。持ち主が辿れなければ
   * userId は null で、鍵はその1本だけ */
  async personPubkeys(
    eventId: string,
    pubkey: string,
  ): Promise<{ userId: string | null; pubkeys: string[] }> {
    const owner = await one<{ user_id: string }>(
      `SELECT user_id FROM event_chat_key WHERE event_id = ?1 AND pubkey = ?2
       UNION
       SELECT user_id FROM event_group_chat_signer
        WHERE event_id = ?1 AND audience = 'members' AND pubkey = ?2
       LIMIT 1`,
      eventId,
      pubkey,
    );
    if (!owner) return { userId: null, pubkeys: [pubkey] };
    const rows = await many<{ pubkey: string }>(
      `SELECT pubkey FROM event_chat_key WHERE event_id = ?1 AND user_id = ?2
       UNION
       SELECT pubkey FROM event_group_chat_signer
        WHERE event_id = ?1 AND audience = 'members' AND user_id = ?2`,
      eventId,
      owner.user_id,
    );
    const pubkeys = rows.map((r) => r.pubkey);
    if (!pubkeys.includes(pubkey)) pubkeys.push(pubkey);
    return { userId: owner.user_id, pubkeys };
  },

  /** members 部屋の signer の鍵の持ち主（監査ログの当事者用）。辿れなければ null */
  async membersSignerAuthor(
    eventId: string,
    pubkey: string,
  ): Promise<{ id: string; handle: string } | null> {
    const row = await one<{ id: string; username: string }>(
      `SELECT u.id, u.username FROM event_group_chat_signer s
         JOIN user u ON u.id = s.user_id
        WHERE s.event_id = ? AND s.audience = 'members' AND s.pubkey = ?`,
      eventId,
      pubkey,
    );
    return row ? { id: row.id, handle: row.username } : null;
  },

  /** 締め出し中の人 (#283) の members 部屋の signer の鍵と、members の signer で
   * 締め出された人の平文の鍵（管理画面の一覧を人単位に広げる。設計 3.3）。
   * eventChatRepo.listBlocked（平文の鍵どうしの広げ）と鍵で突き合わせて使う */
  async listBlockedMembersKeys(eventId: string): Promise<
    Array<{ pubkey: string; userId: string; blockedAt: number; blockedBy: string | null }>
  > {
    const rows = await many<{
      pubkey: string;
      user_id: string;
      created_at: number;
      created_by: string | null;
    }>(
      `WITH person_keys(user_id, pubkey) AS (
         SELECT user_id, pubkey FROM event_chat_key WHERE event_id = ?1
         UNION
         SELECT user_id, pubkey FROM event_group_chat_signer
          WHERE event_id = ?1 AND audience = 'members'
       ),
       blocked_people(user_id, created_at, created_by) AS (
         SELECT pk.user_id, b.created_at, b.created_by
           FROM event_chat_blocked b JOIN person_keys pk ON pk.pubkey = b.pubkey
          WHERE b.event_id = ?1
       )
       SELECT pk.pubkey, pk.user_id, min(bp.created_at) AS created_at, bp.created_by
         FROM person_keys pk JOIN blocked_people bp ON bp.user_id = pk.user_id
        WHERE pk.user_id IN (SELECT user_id FROM event_group_chat_signer
                              WHERE event_id = ?1 AND audience = 'members')
        GROUP BY pk.pubkey ORDER BY created_at ASC`,
      eventId,
    );
    return rows.map((r) => ({
      pubkey: r.pubkey,
      userId: r.user_id,
      blockedAt: r.created_at,
      blockedBy: r.created_by,
    }));
  },

  /** 運営のモデレーション画面 (#278 / #283) に渡す members 部屋の鍵一式（設計 4.5）。
   * 部屋が無ければ null。運営はローテーションの対象外の受け手 */
  async moderationKeys(eventId: string): Promise<{
    roomId: string;
    keys: GroupChatKey[];
    members: EncryptedChatMember[];
  } | null> {
    const roomId = await this.roomIdFor(eventId, "members");
    if (!roomId) return null;
    return {
      roomId,
      keys: await this.listKeys(eventId, "members"),
      members: await this.listMembersWithRole(eventId, true),
    };
  },
};
