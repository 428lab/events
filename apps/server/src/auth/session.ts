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

export async function currentUser(c: Context): Promise<User | null> {
  const id = getCookie(c, COOKIE_NAME);
  if (!id) return null;
  const session = await sessionsRepo.find(id);
  if (!session) return null;
  return usersRepo.findById(session.userId);
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
