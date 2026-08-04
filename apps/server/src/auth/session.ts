import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { User } from "@eventer/shared";
import { env } from "../env.js";
import { sessionsRepo } from "../db/repositories/sessions.js";
import { usersRepo } from "../db/repositories/users.js";

const COOKIE_NAME = "eventer_session";

export async function issueSession(c: Context, userId: string): Promise<void> {
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
  const id = getCookie(c, COOKIE_NAME);
  if (id) await sessionsRepo.delete(id);
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

/** ログイン中のユーザー。
 * 退会申請中（猶予期間 #250）のユーザーはここで null になる。
 * requireAuth も各ルートの任意認証もすべてこの関数を通るため、
 * 「退会したら即座に利用不可」の担保はここ1箇所に集約されている。
 * （復帰のためにセッション自体は発行するが、使えるのは復帰APIだけ） */
export async function currentUser(c: Context): Promise<User | null> {
  const id = getCookie(c, COOKIE_NAME);
  if (!id) return null;
  const session = await sessionsRepo.find(id);
  if (!session) return null;
  return usersRepo.findById(session.userId);
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

export function getUser(c: Context): User {
  return c.get("user") as User;
}
