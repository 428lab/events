import {
  ACCESS_TOKEN_MAX_ACTIVE,
  type AccessToken,
  type AccessTokenScope,
} from "@eventer/shared";
import { many, one, run, runCount } from "../client.js";

/**
 * AI 連携のアクセストークン (#581)。設計は docs/ai-integration.md §4。
 *
 * - 平文は保存しない。照合は SHA-256(hex) の `token_hash` で引く（§4.2）
 * - 失効は `revoked_at` を立てるだけで行は残す（一覧の「失効済み」表示用）
 * - session とは別テーブル。session の「期限切れなら DELETE」の副作用は持ち込まない
 */

interface AccessTokenRow {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  scopes: string;
  created_at: number;
  expires_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

/** 認証で使う形。一覧の形に userId を足したもの */
export interface StoredAccessToken extends AccessToken {
  userId: string;
}

function parseScopes(s: string): AccessTokenScope[] {
  return s
    .split(" ")
    .filter((x): x is AccessTokenScope => x === "read" || x === "write");
}

function toToken(r: AccessTokenRow): StoredAccessToken {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    prefix: r.token_prefix,
    scopes: parseScopes(r.scopes),
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
  };
}

/** 一覧・発行の応答の形（userId を落とす） */
export function publicToken(t: StoredAccessToken): AccessToken {
  const { userId: _userId, ...rest } = t;
  return rest;
}

/** 平文の SHA-256(hex)。乱数が 256bit あるので HMAC は要らない（§4.2） */
export async function hashAccessToken(plain: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(plain),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 退会申請 (accountDeletion.ts) の batch に混ぜる、全トークン失効の文 */
export function revokeAllForUserStmt(
  userId: string,
  now: number,
): { sql: string; args: unknown[] } {
  return {
    sql: "UPDATE access_token SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
    args: [now, userId],
  };
}

export const accessTokensRepo = {
  /** 発行。有効なトークン（失効・期限切れを除く）が上限に達していれば null。
   * 数えて入れるのを1文の条件付き INSERT にして、同時発行でも上限を越えない */
  async create(input: {
    userId: string;
    name: string;
    tokenHash: string;
    prefix: string;
    scopes: AccessTokenScope[];
    now: number;
    expiresAt: number;
  }): Promise<StoredAccessToken | null> {
    const id = crypto.randomUUID();
    const scopes = input.scopes.join(" ");
    const changes = await runCount(
      `INSERT INTO access_token
         (id, user_id, name, token_hash, token_prefix, scopes, created_at, expires_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM access_token
                WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?) < ?`,
      id,
      input.userId,
      input.name,
      input.tokenHash,
      input.prefix,
      scopes,
      input.now,
      input.expiresAt,
      input.userId,
      input.now,
      ACCESS_TOKEN_MAX_ACTIVE,
    );
    if (changes === 0) return null;
    return {
      id,
      userId: input.userId,
      name: input.name,
      prefix: input.prefix,
      scopes: parseScopes(scopes),
      createdAt: input.now,
      expiresAt: input.expiresAt,
      lastUsedAt: null,
      revokedAt: null,
    };
  },

  /** 本人のトークン一覧（失効済み・期限切れも含む）。新しい順 */
  async listForUser(userId: string): Promise<StoredAccessToken[]> {
    const rows = await many<AccessTokenRow>(
      "SELECT * FROM access_token WHERE user_id = ? ORDER BY created_at DESC, id",
      userId,
    );
    return rows.map(toToken);
  },

  /** ハッシュで引く。失効・期限切れの判定は呼び出し側（currentUser）が行う */
  async findByHash(tokenHash: string): Promise<StoredAccessToken | null> {
    const row = await one<AccessTokenRow>(
      "SELECT * FROM access_token WHERE token_hash = ?",
      tokenHash,
    );
    return row ? toToken(row) : null;
  },

  /** 本人のトークンを失効する。既に失効済みなら時刻は上書きしない。
   * 他人の id・存在しない id は null（ルートは 404 を返す） */
  async revoke(
    userId: string,
    id: string,
    now: number,
  ): Promise<StoredAccessToken | null> {
    const changes = await runCount(
      "UPDATE access_token SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND user_id = ?",
      now,
      id,
      userId,
    );
    if (changes === 0) return null;
    const row = await one<AccessTokenRow>(
      "SELECT * FROM access_token WHERE id = ?",
      id,
    );
    return row ? toToken(row) : null;
  },

  /** 本人の全トークンを失効する */
  async revokeAllForUser(userId: string, now: number): Promise<void> {
    const s = revokeAllForUserStmt(userId, now);
    await run(s.sql, ...s.args);
  },

  /** 最終使用時刻を進める。`before` より古いときだけ書く（5分に1回。§4.6） */
  async touchLastUsed(id: string, now: number, before: number): Promise<void> {
    await run(
      `UPDATE access_token SET last_used_at = ?
        WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)`,
      now,
      id,
      before,
    );
  },
};
