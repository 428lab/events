import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "../types.js";
import { env } from "../env.js";
import { usersRepo } from "../db/repositories/users.js";
import { identitiesRepo } from "../db/repositories/identities.js";
import {
  clearSession,
  currentUser,
  issueSession,
  requireAuth,
} from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";
import {
  PROVIDERS,
  isProvider,
  providerConfig,
  providerConfigured,
  redirectUri,
} from "../auth/providers.js";

const STATE_COOKIE = "eventer_oauth_state";

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/me", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json({ user, isAdmin: isAppAdmin(user) });
});

authRoutes.post("/logout", async (c) => {
  await clearSession(c);
  return c.json({ ok: true });
});

/** 有効な（client_id/secret 設定済み）プロバイダ一覧 */
authRoutes.get("/providers", (c) => {
  return c.json({ providers: PROVIDERS.filter(providerConfigured) });
});

/** ログイン中ユーザーの連携プロバイダ一覧 */
authRoutes.get("/identities", requireAuth, async (c) => {
  const user = c.get("user");
  const identities = await identitiesRepo.listByUser(user.id);
  return c.json({
    identities: identities.map((i) => ({ provider: i.provider, email: i.email })),
  });
});

/** 連携解除（最後の1つは外せない） */
authRoutes.delete("/identities/:provider", requireAuth, async (c) => {
  const provider = c.req.param("provider");
  const user = c.get("user");
  if (!isProvider(provider)) return c.json({ error: "unknown_provider" }, 404);
  if ((await identitiesRepo.countByUser(user.id)) <= 1) {
    return c.json({ error: "last_identity" }, 409);
  }
  await identitiesRepo.unlink(user.id, provider);
  if (provider === "discord") {
    // 実Discord IDを手放す（合成値に置換＝管理者判定も解除）
    await usersRepo.setDiscordId(user.id, `removed:${crypto.randomUUID()}`);
  }
  return c.json({ ok: true });
});

/** OAuth 開始（provider はパス） */
authRoutes.get("/:provider/login", (c) => {
  const provider = c.req.param("provider");
  if (!isProvider(provider)) return c.json({ error: "unknown_provider" }, 404);
  if (!providerConfigured(provider)) {
    return c.json({ error: "provider_not_configured" }, 503);
  }
  const cfg = providerConfig(provider);
  const state = crypto.randomUUID();
  setCookie(c, STATE_COOKIE, `${provider}:${state}`, {
    httpOnly: true,
    sameSite: "Lax",
    secure: env.isProd,
    path: "/",
    maxAge: 600,
  });
  const params = new URLSearchParams({
    client_id: env.providerCreds(provider).clientId,
    redirect_uri: redirectUri(provider),
    response_type: "code",
    scope: cfg.scope,
    state,
    ...(cfg.extraAuthParams ?? {}),
  });
  return c.redirect(`${cfg.authorizeUrl}?${params.toString()}`);
});

/** OAuth コールバック。未ログイン→ログイン/新規、ログイン中→連携/統合。 */
authRoutes.get("/:provider/callback", async (c) => {
  const provider = c.req.param("provider");
  if (!isProvider(provider)) return c.json({ error: "unknown_provider" }, 404);

  const code = c.req.query("code");
  const state = c.req.query("state");
  const saved = getCookie(c, STATE_COOKIE);
  if (!code || !state || saved !== `${provider}:${state}`) {
    return c.json({ error: "invalid_oauth_state" }, 400);
  }
  deleteCookie(c, STATE_COOKIE, { path: "/" });

  const cfg = providerConfig(provider);
  let profile;
  try {
    const token = await cfg.exchange(code, redirectUri(provider));
    profile = await cfg.fetchProfile(token);
  } catch {
    return c.json({ error: "oauth_failed" }, 502);
  }

  const current = await currentUser(c);
  const existingUserId = await identitiesRepo.findUserId(
    provider,
    profile.providerUserId,
  );

  if (current) {
    // 連携 or 統合
    if (!existingUserId) {
      await identitiesRepo.link(
        current.id,
        provider,
        profile.providerUserId,
        profile.email,
      );
      if (provider === "discord") {
        await usersRepo.setDiscordId(current.id, profile.providerUserId);
      }
    } else if (existingUserId !== current.id) {
      // 別アカウントを現在のアカウントへ統合
      const fromUser = await usersRepo.findById(existingUserId);
      await identitiesRepo.mergeInto(existingUserId, current.id);
      if (fromUser && !fromUser.discordId.includes(":")) {
        await usersRepo.setDiscordId(current.id, fromUser.discordId);
      }
    }
    return c.redirect(env.appBaseUrl + "/account");
  }

  // 未ログイン: 既存ならログイン、無ければ新規作成
  let userId = existingUserId;
  if (!userId) {
    const u = await usersRepo.createFromProfile(provider, profile);
    await identitiesRepo.link(u.id, provider, profile.providerUserId, profile.email);
    userId = u.id;
  }
  await issueSession(c, userId);
  return c.redirect(env.appBaseUrl + "/me");
});

/**
 * 開発専用ログイン。本番(ENVIRONMENT=production)では 404。
 */
authRoutes.post("/dev-login", async (c) => {
  if (env.isProd) return c.json({ error: "not_found" }, 404);
  let u = await usersRepo.findByDiscordId("dev-user");
  if (!u) {
    u = await usersRepo.createFromProfile("discord", {
      providerUserId: "dev-user",
      username: "DevUser",
      globalName: "開発ユーザー",
      avatarUrl: null,
    });
    await identitiesRepo.link(u.id, "discord", "dev-user", null);
  }
  await issueSession(c, u.id);
  return c.json({ user: u });
});
