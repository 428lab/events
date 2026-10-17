import { z } from "zod";

/**
 * AI アシスタント連携のアクセストークン (#581)。設計は docs/ai-integration.md §4。
 *
 * 利用者がアカウント設定で発行し、Claude などの MCP クライアントに
 * `Authorization: Bearer <token>` として貼る。届く範囲は `/api/mcp` と
 * `/api/ai/*` だけ（§4.5）。発行・一覧・失効は Cookie 専用。
 */

/** スコープ。`read` は必ず付く。`write` は明示チェックで付く（§4.3） */
export const ACCESS_TOKEN_SCOPES = ["read", "write"] as const;
export type AccessTokenScope = (typeof ACCESS_TOKEN_SCOPES)[number];

/** 有効期限の選択肢（日）。無期限は作らない（§4.3） */
export const ACCESS_TOKEN_EXPIRY_DAYS = [30, 90, 180] as const;
export type AccessTokenExpiryDays = (typeof ACCESS_TOKEN_EXPIRY_DAYS)[number];
export const ACCESS_TOKEN_DEFAULT_EXPIRY_DAYS: AccessTokenExpiryDays = 90;

/** 1ユーザーが持てる有効なトークンの上限（失効・期限切れを除く） */
export const ACCESS_TOKEN_MAX_ACTIVE = 10;
/** トークン名の最大文字数 */
export const ACCESS_TOKEN_NAME_MAX = 40;

/** 一覧・発行の応答に載るトークン1件。平文は載せない（表示は prefix） */
export const accessTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** 平文の先頭 12 文字（"evl_ab12cd34"） */
  prefix: z.string(),
  scopes: z.array(z.enum(ACCESS_TOKEN_SCOPES)),
  createdAt: z.number(),
  expiresAt: z.number(),
  lastUsedAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
});
export type AccessToken = z.infer<typeof accessTokenSchema>;

/** POST /api/me/access-tokens の入力 */
export const createAccessTokenInput = z.object({
  name: z.string().trim().min(1).max(ACCESS_TOKEN_NAME_MAX),
  write: z.boolean().default(false),
  expiresInDays: z
    .union([z.literal(30), z.literal(90), z.literal(180)])
    .default(ACCESS_TOKEN_DEFAULT_EXPIRY_DAYS),
});
export type CreateAccessTokenInput = z.infer<typeof createAccessTokenInput>;

/** GET /api/me/access-tokens の応答 */
export interface AccessTokensPayload {
  tokens: AccessToken[];
}

/** POST /api/me/access-tokens の応答。`token`（平文）はこの1回だけ返る */
export type CreatedAccessToken = AccessToken & { token: string };
