import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { randomUUID } from "node:crypto";
import { env } from "../env.js";
import { usersRepo } from "../db/repositories/users.js";
import {
  clearSession,
  currentUser,
  issueSession,
} from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";

const DISCORD_AUTHORIZE = "https://discord.com/api/oauth2/authorize";
const DISCORD_TOKEN = "https://discord.com/api/oauth2/token";
const DISCORD_ME = "https://discord.com/api/users/@me";
const STATE_COOKIE = "eventer_oauth_state";

interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

function avatarUrl(u: DiscordUser): string | null {
  if (!u.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png`;
}

export const authRoutes = new Hono();

authRoutes.get("/me", (c) => {
  const user = currentUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json({ user, isAdmin: isAppAdmin(user) });
});

authRoutes.post("/logout", (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

authRoutes.get("/discord/login", (c) => {
  if (!env.discordConfigured) {
    return c.json({ error: "discord_not_configured" }, 503);
  }
  const state = randomUUID();
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "Lax",
    secure: env.isProd,
    path: "/",
    maxAge: 600,
  });
  const params = new URLSearchParams({
    client_id: env.discord.clientId,
    redirect_uri: env.discord.redirectUri,
    response_type: "code",
    scope: "identify",
    state,
  });
  return c.redirect(`${DISCORD_AUTHORIZE}?${params.toString()}`);
});

authRoutes.get("/discord/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const savedState = getCookie(c, STATE_COOKIE);

  if (!code || !state || !savedState || state !== savedState) {
    return c.json({ error: "invalid_oauth_state" }, 400);
  }

  const tokenRes = await fetch(DISCORD_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.discord.clientId,
      client_secret: env.discord.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: env.discord.redirectUri,
    }),
  });
  if (!tokenRes.ok) return c.json({ error: "token_exchange_failed" }, 502);
  const token = (await tokenRes.json()) as { access_token: string };

  const meRes = await fetch(DISCORD_ME, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!meRes.ok) return c.json({ error: "fetch_profile_failed" }, 502);
  const profile = (await meRes.json()) as DiscordUser;

  const user = usersRepo.upsertByDiscordId({
    discordId: profile.id,
    username: profile.username,
    globalName: profile.global_name,
    avatarUrl: avatarUrl(profile),
  });

  issueSession(c, user.id);
  return c.redirect(env.appBaseUrl + "/me");
});

/**
 * 開発専用ログイン。Discord 設定の有無に関わらず開発時は常に利用可能
 * （開発では Discord ログインと dev-login を併用できる）。
 * `process.env.NODE_ENV !== "production"` で囲うことで、本番ビルド時に
 * esbuild の --define により静的に false 評価され、このブロックごと
 * バンドルから除去される（本番成果物に dev-login は一切含まれない）。
 */
if (process.env.NODE_ENV !== "production") {
  authRoutes.post("/dev-login", (c) => {
    const user = usersRepo.upsertByDiscordId({
      discordId: "dev-user",
      username: "DevUser",
      globalName: "開発ユーザー",
      avatarUrl: null,
    });
    issueSession(c, user.id);
    return c.json({ user });
  });
}
