import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { AccessTokenScope, User } from "@eventer/shared";
import { env } from "../env.js";
import { sessionsRepo } from "../db/repositories/sessions.js";
import { usersRepo } from "../db/repositories/users.js";
import {
  accessTokensRepo,
  hashAccessToken,
} from "../db/repositories/accessTokens.js";
import { recordLastSeen } from "../lib/lastSeen.js";
import { deferBackground } from "../runtime.js";

const COOKIE_NAME = "eventer_session";

export async function issueSession(c: Context, userId: string): Promise<void> {
  currentUsers.delete(c);
  const session = await sessionsRepo.create(userId);
  setCookie(c, COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: "Lax",
    secure: env.isProd,
    path: "/",
    expires: new Date(session.expiresAt),
  });
}

export async function clearSession(c: Context): Promise<void> {
  currentUsers.delete(c);
  const id = getCookie(c, COOKIE_NAME);
  if (id) await sessionsRepo.delete(id);
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

/** ログイン中のユーザー。
 * 退会申請中（猶予期間 #250）のユーザーはここで null になる。
 * requireAuth も各ルートの任意認証もすべてこの関数を通るため、
 * 「退会したら即座に利用不可」の担保はここ1箇所に集約されている。
 * （復帰のためにセッション自体は発行するが、使えるのは復帰APIだけ）
 *
 * DAU/MAU 計測 (#257) のアクセス記録（last_seen_at と user_active_day）もここで
 * 行う。全リクエストの認証が通る唯一の場所なので計測地点として過不足がない。
 * 書き込みは JST の日付が変わった最初の1回だけ・waitUntil でレスポンス外
 * （lib/lastSeen.ts 参照）。
 *
 * AI 連携のアクセストークン (#581) もここで解く（Authorization: Bearer）。
 * 有効なのは isTokenAllowedPath のパスだけで、それ以外は 401 で打ち切る。
 * トークン経路はアクセス記録の対象外（docs/ai-integration.md §4.4〜§4.6）。 */
const currentUsers = new WeakMap<Context, Promise<User | null>>();

export function currentUser(c: Context): Promise<User | null> {
  let pending = currentUsers.get(c);
  if (!pending) {
    pending = resolveCurrentUser(c);
    currentUsers.set(c, pending);
  }
  return pending;
}

/** 認証の主体 (#581)。Cookie セッションか、AI 連携のアクセストークンか。
 * currentUser が解いたときに c.set("principal") される */
export type Principal =
  | { kind: "session" }
  | { kind: "token"; tokenId: string; scopes: AccessTokenScope[] };

/** アクセストークン (#581) の平文の接頭辞。staging は本番と別にして、
 * 本番コピーの D1 に本番のトークン行があっても staging では通らないようにする（§6.2） */
export function accessTokenPrefix(): string {
  return env.isStaging ? "evls_" : "evl_";
}

/** アクセストークンの平文を作る (#581 §4.2)。接頭辞 + 32 バイト乱数の base64url（43字） */
export function generateAccessToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return accessTokenPrefix() + b64;
}

/** Bearer が有効なパス (#581 §4.5)。ここ以外に Bearer を付けて来たら 401。
 * 発行・失効 (/api/me/access-tokens)・公開・アカウント設定・管理者 API には届かない */
export function isTokenAllowedPath(path: string): boolean {
  return path === "/api/mcp" || path.startsWith("/api/ai/");
}

/** last_used_at の更新間隔 (#581 §4.6)。lastSeen.ts と同じく毎回は書かない */
const TOKEN_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const WWW_AUTHENTICATE = 'Bearer realm="events lab", error="invalid_token"';

function tokenRejected(error: string, wwwAuthenticate?: string): HTTPException {
  const headers: Record<string, string> = {};
  if (wwwAuthenticate) headers["WWW-Authenticate"] = wwwAuthenticate;
  return new HTTPException(401, {
    res: Response.json({ error }, { status: 401, headers }),
  });
}

/** Authorization: Bearer の値。この環境の接頭辞で始まるものだけ（§4.4） */
function bearerToken(c: Context): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(c.req.header("Authorization") ?? "");
  if (!m) return null;
  return m[1]!.startsWith(accessTokenPrefix()) ? m[1]! : null;
}

async function resolveCurrentUser(c: Context): Promise<User | null> {
  // Cookie と両方あれば Bearer を優先する (#581 §4.4)
  const bearer = bearerToken(c);
  if (bearer) return resolveTokenUser(c, bearer);
  const id = getCookie(c, COOKIE_NAME);
  if (!id) return null;
  const session = await sessionsRepo.find(id);
  if (!session) return null;
  const user = await usersRepo.findByIdWithLastSeen(session.userId);
  // 退会申請中 (#250) はここで null になるため、アクセス記録も走らない
  if (!user) return null;
  const { lastSeenAt, ...plain } = user;
  try {
    await recordLastSeen(user.id, lastSeenAt);
  } catch (e) {
    // 計測の失敗で認証を壊さない
    console.warn("last_seen_at の記録に失敗", e);
  }
  c.set("principal", { kind: "session" } satisfies Principal);
  return plain;
}

/** Bearer 経路 (#581 §4.4)。到達範囲外・不正・失効・期限切れは HTTPException(401) で
 * その場で打ち切る（null にすると任意認証のルートが匿名として続行してしまう）。
 * DAU/MAU には数えない（recordLastSeen を呼ばない。§4.6） */
async function resolveTokenUser(c: Context, bearer: string): Promise<User | null> {
  if (!isTokenAllowedPath(c.req.path)) throw tokenRejected("token_not_allowed_here");
  const tok = await accessTokensRepo.findByHash(await hashAccessToken(bearer));
  const now = Date.now();
  if (!tok || tok.revokedAt !== null) {
    throw tokenRejected("invalid_token", WWW_AUTHENTICATE);
  }
  if (tok.expiresAt < now) throw tokenRejected("token_expired", WWW_AUTHENTICATE);
  // 退会申請中 (#250) は null（既存どおり）。申請時に全トークンを失効もしている
  const user = await usersRepo.findById(tok.userId);
  if (!user) return null;
  c.set("principal", {
    kind: "token",
    tokenId: tok.id,
    scopes: tok.scopes,
  } satisfies Principal);
  if (tok.lastUsedAt === null || now - tok.lastUsedAt >= TOKEN_TOUCH_INTERVAL_MS) {
    try {
      await deferBackground(
        accessTokensRepo
          .touchLastUsed(tok.id, now, now - TOKEN_TOUCH_INTERVAL_MS)
          .catch((e: unknown) => console.warn("last_used_at の更新に失敗", e)),
      );
    } catch (e) {
      // 計測の失敗で認証を壊さない
      console.warn("last_used_at のバックグラウンド実行に失敗", e);
    }
  }
  return user;
}

/** 退会申請中（猶予期間 #250）のユーザーをセッションから引く。
 * 復帰フロー（GET /api/auth/me の案内・POST /api/me/restore）専用。
 * 在籍中のユーザーや未ログインでは null を返す */
export async function pendingDeletionUser(
  c: Context,
): Promise<(User & { deletedAt: number }) | null> {
  const id = getCookie(c, COOKIE_NAME);
  if (!id) return null;
  const session = await sessionsRepo.find(id);
  if (!session) return null;
  const user = await usersRepo.findByIdIncludingDeleted(session.userId);
  if (!user || user.deletedAt === null) return null;
  return { ...user, deletedAt: user.deletedAt };
}

/** ログイン必須。c.set("user", user) を設定 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
};

/** スコープ必須 (#581 §4.4)。requireAuth の後ろに置く。
 * Cookie セッションは常に通す。トークンは scopes に無ければ 403 insufficient_scope */
export function requireScope(scope: AccessTokenScope): MiddlewareHandler {
  return async (c, next) => {
    const principal = c.get("principal") as Principal | undefined;
    if (principal?.kind === "token" && !principal.scopes.includes(scope)) {
      return c.json({ error: "insufficient_scope" }, 403);
    }
    await next();
  };
}

export function getUser(c: Context): User {
  return c.get("user") as User;
}
