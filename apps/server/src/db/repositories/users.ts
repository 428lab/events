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
  /** 退会申請時刻。NULL = 在籍中 (#250) */
  deleted_at: number | null;
  /** 最終アクセス時刻。NULL = 計測開始 (#257) より前からのユーザー */
  last_seen_at: number | null;
  /** 自前保管したアイコン (#312) の更新時刻。NULL = 保管なし（配信もしない） */
  avatar_image_updated_at: number | null;
  avatar_image_mime: string | null;
  avatar_image_hash: string | null;
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

/** 猶予期間中 (#250) かどうかを含むユーザー。復帰フローと日次バッチでのみ使う。
 * 通常の参照系は deleted_at IS NULL で除外するため、この型は出てこない */
export type UserWithDeletion = User & { deletedAt: number | null };

function toUserWithDeletion(row: UserRow): UserWithDeletion {
  return { ...toUser(row), deletedAt: row.deleted_at };
}

/** 最終アクセス時刻 (#257) を含むユーザー。currentUser の内部でだけ使う。
 * 公開型 User には入れない（APIレスポンスに載せる情報ではない） */
export type UserWithLastSeen = User & { lastSeenAt: number | null };

/** 退会申請済み（猶予期間中）のユーザーを除外する条件 (#250)。
 * 参照系のクエリには原則これを付ける。付け忘れると退会したユーザーが
 * 他ユーザーから見えてしまうため、新しいクエリを足すときは必ず確認すること。
 * user 表を触る他のリポジトリ（userAvatars / accountDeletion）も**これを import する**。
 * 条件を書き写すと、変えたときに片方だけ直る */
export const ACTIVE = "deleted_at IS NULL";

/** 在籍中のユーザーを id で引く（生の行）。findById 系はすべてここを通す。
 * SQL をコピーして持つと、将来 ACTIVE の条件を変えたときに片方だけ直す事故になる */
function findActiveRow(id: string): Promise<UserRow | null> {
  return one<UserRow>(`SELECT * FROM user WHERE id = ? AND ${ACTIVE}`, id);
}

export const usersRepo = {
  /** 退会申請済み（猶予期間中）は「存在しない」扱いで null を返す (#250)。
   * currentUser / プロフィール / 各種表示がここを通るため、ここでの除外が
   * 「即座に利用不可・非表示」の中心的な担保になっている */
  async findById(id: string): Promise<User | null> {
    const row = await findActiveRow(id);
    return row ? toUser(row) : null;
  },

  /** findById と同じ（退会申請中は null）だが、最終アクセス時刻 (#257) も返す。
   * currentUser 専用。既に SELECT * している行から取るだけなので追加の読み取りは
   * 発生せず、「JSTの日付が変わったか」を JS 側でタダで判定できる */
  async findByIdWithLastSeen(id: string): Promise<UserWithLastSeen | null> {
    const row = await findActiveRow(id);
    return row ? { ...toUser(row), lastSeenAt: row.last_seen_at ?? null } : null;
  },

  /** アクセスを記録する (#257)。DAU/MAU 計測用に2つ書く。
   *   - user.last_seen_at … 最終アクセス時刻（休眠の判定用）
   *   - user_active_day   … その日アクセスした事実（DAU の推移・コホート用）
   * last_seen_at だけだと「最終」日しか残らず過去日の推移が出せないため、
   * 日次の記録を別に持つ（migrations/0056 のコメント参照）。
   *
   * 「JSTの日付が変わった最初の1回だけ」の判定は呼び出し側 (lib/lastSeen.ts) が行う。
   * 2文は D1 の batch で1回にまとめるので、書き込みは 1ユーザー 1日 1回のまま。
   * どちらも在籍中 (deleted_at IS NULL) に限定し、退会申請中のユーザーを
   * 記録しないことを（呼び出し側の判定と合わせて）二重に担保する。
   * @param day now の JST 日付 'YYYY-MM-DD'（JSTの計算は lib/lastSeen.ts に一本化） */
  async touchLastSeen(userId: string, at: number, day: string): Promise<void> {
    await batch([
      {
        sql: `UPDATE user SET last_seen_at = ? WHERE id = ? AND ${ACTIVE}`,
        args: [at, userId],
      },
      {
        // SELECT 経由なのは、退会申請中なら1行も挿さないようにするため
        sql: `INSERT OR IGNORE INTO user_active_day (day, user_id)
              SELECT ?, id FROM user WHERE id = ? AND ${ACTIVE}`,
        args: [day, userId],
      },
    ]);
  },

  /** 猶予期間中でも引ける参照 (#250)。復帰フローと日次バッチ専用 */
  async findByIdIncludingDeleted(id: string): Promise<UserWithDeletion | null> {
    const row = await one<UserRow>("SELECT * FROM user WHERE id = ?", id);
    return row ? toUserWithDeletion(row) : null;
  },

  async findByDiscordId(discordId: string): Promise<User | null> {
    const row = await one<UserRow>(
      `SELECT * FROM user WHERE discord_id = ? AND ${ACTIVE}`,
      discordId,
    );
    return row ? toUser(row) : null;
  },

  /** 猶予期間中でも引ける参照 (#250)。開発用ログインのように
   * 「行の存在」を見たい経路で使う */
  async findByDiscordIdIncludingDeleted(
    discordId: string,
  ): Promise<UserWithDeletion | null> {
    const row = await one<UserRow>(
      "SELECT * FROM user WHERE discord_id = ?",
      discordId,
    );
    return row ? toUserWithDeletion(row) : null;
  },

  /** プロフィールURLのハンドル解決（username、大文字小文字を無視）。
   * 猶予期間中のユーザーは 404 相当にするため除外する (#250) */
  async findByUsername(username: string): Promise<User | null> {
    const row = await one<UserRow>(
      `SELECT * FROM user WHERE username = ? COLLATE NOCASE AND ${ACTIVE} LIMIT 1`,
      username,
    );
    return row ? toUser(row) : null;
  },

  /** ハンドル(username)が他のユーザーに使われているか。
   * findByUsername と違い、猶予期間中 (#250) のユーザーも「使用中」として扱う
   * （復帰したときにハンドルが他人のものになっていると URL が変わってしまう） */
  async isUsernameTaken(
    username: string,
    exceptUserId: string,
  ): Promise<boolean> {
    const row = await one<{ id: string }>(
      "SELECT id FROM user WHERE username = ? COLLATE NOCASE AND id <> ? LIMIT 1",
      username,
      exceptUserId,
    );
    return !!row;
  },

  /** ADMIN_DISCORD_IDS に該当するユーザーの id 一覧（運営宛て通知用）。
   * 猶予期間中の管理者には通知しない (#250) */
  async listIdsByDiscordIds(discordIds: string[]): Promise<string[]> {
    if (discordIds.length === 0) return [];
    const placeholders = discordIds.map(() => "?").join(", ");
    const rows = await many<{ id: string }>(
      `SELECT id FROM user WHERE discord_id IN (${placeholders}) AND ${ACTIVE}`,
      ...discordIds,
    );
    return rows.map((r) => r.id);
  },

  /** ハンドル(username)の重複を避けた利用可能な username を返す。
   * 既に他ユーザーが使っていれば末尾に数字を付ける（exceptUserId は自分自身として除外）。
   * ここは猶予期間中 (#250) のユーザーも「使用中」として扱う。復帰したときに
   * ハンドルが他人に奪われていると URL が変わってしまうため */
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

  /** ユーザー名（ハンドル）を変更 */
  async setUsername(userId: string, username: string): Promise<void> {
    await run("UPDATE user SET username = ? WHERE id = ?", username, userId);
  },

  /** 表示名を変更する (#232) */
  async setGlobalName(userId: string, globalName: string): Promise<void> {
    await run("UPDATE user SET global_name = ? WHERE id = ?", globalName, userId);
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
