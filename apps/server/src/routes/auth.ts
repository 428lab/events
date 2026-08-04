import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "../types.js";
import { env } from "../env.js";
import { usersRepo } from "../db/repositories/users.js";
import { identitiesRepo } from "../db/repositories/identities.js";
import { deriveHandle } from "../lib/handle.js";
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
import {
  extractNostrProfile,
  issueNostrChallenge,
  verifyNostrLogin,
  type NostrEvent,
} from "../auth/nostr.js";

const STATE_COOKIE = "eventer_oauth_state";
const PKCE_COOKIE = "eventer_oauth_verifier";

/** PKCE: code_verifier（ランダム）→ S256 チャレンジ（base64url） */
function genCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64url(bytes);
}
async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

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
  if (!isProvider(provider) && provider !== "nostr") {
    return c.json({ error: "unknown_provider" }, 404);
  }
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

/* =========================================================
 *  Nostr (NIP-07) ログイン
 * =======================================================*/

/** ログイン用チャレンジの発行（サーバー状態なし・HMAC署名付き・10分有効） */
authRoutes.get("/nostr/challenge", async (c) => {
  return c.json({ challenge: await issueNostrChallenge() });
});

/** NIP-07 で署名した kind:22242 イベントでログイン/連携 */
authRoutes.post("/nostr/login", async (c) => {
  let body: { event?: NostrEvent };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const pubkey = body.event ? await verifyNostrLogin(body.event) : null;
  if (!pubkey) return c.json({ error: "invalid_event" }, 401);

  const current = await currentUser(c);
  const existingUserId = await identitiesRepo.findUserId("nostr", pubkey);

  if (current) {
    // ログイン中 → 連携（OAuthコールバックと同じ規則）
    if (!existingUserId) {
      await identitiesRepo.link(current.id, "nostr", pubkey, null);
    } else if (existingUserId !== current.id) {
      // 別アカウントに連携済み。鍵の所有は署名で証明済みなので、
      // 相手の唯一のログイン方法なら identity を引き取る（他は何も引き継がない）。
      // 他のログイン方法が残るアカウントからの横取りは拒否。
      if ((await identitiesRepo.countByUser(existingUserId)) !== 1) {
        return c.json({ error: "already_linked" }, 409);
      }
      await identitiesRepo.unlink(existingUserId, "nostr");
      // 旧アカウントの合成 discord_id を退役させる（同じ npub での再作成と衝突しないように）
      await usersRepo.setDiscordId(existingUserId, `removed:${crypto.randomUUID()}`);
      await identitiesRepo.link(current.id, "nostr", pubkey, null);
    }
    return c.json({ ok: true, linked: true });
  }

  // 未ログイン: 既存ならログイン、無ければ新規作成
  let userId = existingUserId;
  if (!userId) {
    const u = await usersRepo.createFromProfile("nostr", {
      providerUserId: pubkey,
      username: `nostr_${pubkey.slice(0, 8)}`,
      globalName: null,
      avatarUrl: null,
    });
    await identitiesRepo.link(u.id, "nostr", pubkey, null);
    userId = u.id;
  }
  await issueSession(c, userId);
  return c.json({ ok: true });
});

/** Nostr の kind:0（プロフィール）を検証して表示名/アイコンを補完。
 * イベント自体がユーザー署名済みのため、リレー経由でも改ざんできない。 */
authRoutes.post("/nostr/profile", requireAuth, async (c) => {
  const user = c.get("user");
  let body: { event?: NostrEvent };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const profile = body.event ? extractNostrProfile(body.event) : null;
  if (!profile) return c.json({ error: "invalid_event" }, 401);
  // この pubkey が現在のユーザーに連携されていること
  const linkedUserId = await identitiesRepo.findUserId("nostr", profile.pubkey);
  if (linkedUserId !== user.id) return c.json({ error: "forbidden" }, 403);
  await usersRepo.fillProfile(user.id, profile.name, profile.picture);
  return c.json({ ok: true });
});

/** OAuth 開始（provider はパス） */
authRoutes.get("/:provider/login", async (c) => {
  const provider = c.req.param("provider");
  if (!isProvider(provider)) return c.json({ error: "unknown_provider" }, 404);
  if (!providerConfigured(provider)) {
    return c.json({ error: "provider_not_configured" }, 503);
  }
  const cfg = providerConfig(provider);
  const state = crypto.randomUUID();
  const cookieOpts = {
    httpOnly: true,
    sameSite: "Lax",
    secure: env.isProd,
    path: "/",
    maxAge: 600,
  } as const;
  setCookie(c, STATE_COOKIE, `${provider}:${state}`, cookieOpts);
  const params = new URLSearchParams({
    client_id: env.providerCreds(provider).clientId,
    redirect_uri: redirectUri(provider),
    response_type: "code",
    scope: cfg.scope,
    state,
    ...(cfg.extraAuthParams ?? {}),
  });
  // PKCE（X など必須のプロバイダ）: verifier を cookie に保持し S256 チャレンジを付与
  if (cfg.pkce) {
    const verifier = genCodeVerifier();
    setCookie(c, PKCE_COOKIE, verifier, cookieOpts);
    params.set("code_challenge", await codeChallengeS256(verifier));
    params.set("code_challenge_method", "S256");
  }
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
  // PKCE: 開始時に保存した verifier を取り出して使う（1回限り）
  const verifier = cfg.pkce ? getCookie(c, PKCE_COOKIE) : undefined;
  if (cfg.pkce) {
    deleteCookie(c, PKCE_COOKIE, { path: "/" });
    if (!verifier) return c.json({ error: "invalid_oauth_state" }, 400);
  }
  let profile;
  try {
    const token = await cfg.exchange(code, redirectUri(provider), verifier);
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
      // 別アカウントに連携済み。アカウントの所有は OAuth で証明済みなので、
      // 相手の唯一のログイン方法なら identity を引き取る（DB上の discordId 等は
      // 引き継がない＝旧・自動統合の権限横取り経路を残さない）。
      if ((await identitiesRepo.countByUser(existingUserId)) !== 1) {
        return c.redirect(env.appBaseUrl + "/account?link_error=already_linked");
      }
      await identitiesRepo.unlink(existingUserId, provider);
      // 旧アカウントの実IDを退役（UNIQUE衝突と管理者判定の残置を防ぐ）
      await usersRepo.setDiscordId(existingUserId, `removed:${crypto.randomUUID()}`);
      await identitiesRepo.link(
        current.id,
        provider,
        profile.providerUserId,
        profile.email,
      );
      if (provider === "discord") {
        // OAuth で本人確認済みの実IDのみ反映（DB由来の値は使わない）
        await usersRepo.setDiscordId(current.id, profile.providerUserId);
      }
    }
    return c.redirect(env.appBaseUrl + "/account");
  }

  // 未ログイン: 既存ならログイン、無ければ新規作成。
  // ハンドル概念のないプロバイダ由来の username は許可文字に整形する (#236)
  let userId = existingUserId;
  if (!userId) {
    const u = await usersRepo.createFromProfile(provider, {
      ...profile,
      username: deriveHandle(profile.username, profile.email),
    });
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
  // 開発環境のみ（staging も /api/auth/* はゲート免除のため明示的に塞ぐ）
  if (env.isProd || env.isStaging) return c.json({ error: "not_found" }, 404);
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
