import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { User } from "@eventer/shared";
import { env } from "../env.js";
import { sessionsRepo } from "../db/repositories/sessions.js";
import { usersRepo } from "../db/repositories/users.js";

const COOKIE_NAME = "eventer_session";

export function issueSession(c: Context, userId: string): void {
  const session = sessionsRepo.create(userId);
  setCookie(c, COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: "Lax",
    secure: env.isProd,
    path: "/",
    expires: new Date(session.expiresAt),
  });
}

export function clearSession(c: Context): void {
  const id = getCookie(c, COOKIE_NAME);
  if (id) sessionsRepo.delete(id);
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

export function currentUser(c: Context): User | null {
  const id = getCookie(c, COOKIE_NAME);
  if (!id) return null;
  const session = sessionsRepo.find(id);
  if (!session) return null;
  return usersRepo.findById(session.userId);
}

/** ログイン必須。c.set("user", user) を設定 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const user = currentUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
};

export function getUser(c: Context): User {
  return c.get("user") as User;
}
