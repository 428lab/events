import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { User } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { env } from "../env.js";
import { usersRepo } from "../db/repositories/users.js";
import { identitiesRepo } from "../db/repositories/identities.js";
import { recordAudit } from "../db/repositories/auditLogs.js";
import { deriveHandle } from "../lib/handle.js";
import {
  clearSession,
  currentUser,
  issueSession,
  pendingDeletionUser,
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

/** 連携の引き取り (#238)。相手が「唯一の連携 かつ 利用実績なし」の空アカウント
 * のときだけユーザー行ごと削除して "ok" を返す（identity は FK CASCADE で消える。
 * unlink を挟まない単一文なので、FK違反等で失敗しても相手アカウントは無傷のまま）。
 * 実績のあるアカウントは孤児化させない（誤ログインでできた空アカウントの回収専用） */
async function takeoverEmptyAccount(
  existingUserId: string,
  actor: User,
  provider: string,
): Promise<"ok" | "already_linked" | "account_in_use" | "account_deleted"> {
  // 退会申請中（猶予期間 #250）は引き取りの対象外。復帰したときに
  // ログイン手段ごとアカウントが消えていた、という事態を防ぐ
  const target = await usersRepo.findByIdIncludingDeleted(existingUserId);
  if (!target || target.deletedAt !== null) return "account_deleted";
  if ((await identitiesRepo.countByUser(existingUserId)) !== 1) {
    return "already_linked";
  }
  if (await usersRepo.hasActivity(existingUserId)) {
    return "account_in_use";
  }
  await usersRepo.deleteById(existingUserId);
  // 監査ログ (#248)。相手のユーザー行ごと消す不可逆操作なので記録する
  await recordAudit({
    action: "identity_takeover",
    actor: { id: actor.id, handle: actor.username },
    target: { id: existingUserId, handle: target.username },
    detail: { provider },
  });
  return "ok";
}

/** 退会申請中（猶予期間 #250）のアカウントか。
 * ログイン自体は通し（本人確認はプロバイダ側で済んでいる）、復帰画面へ誘導する。
 * ログイン自体を弾くと「同じログイン方法でログインすれば復帰できる」導線が
 * 作れないため、この形にしている */
async function isPendingDeletion(userId: string): Promise<boolean> {
  const u = await usersRepo.findByIdIncludingDeleted(userId);
  return !!u && u.deletedAt !== null;
}

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
  // deletionGraceMs は環境で変わる（staging は検証用に短い）ため、
  // UI 文言はこの値を使う (#250)
  if (user) {
    return c.json({
      user,
      isAdmin: isAppAdmin(user),
      deletionGraceMs: env.deletionGraceMs,
    });
  }
  // 退会申請中（猶予期間 #250）は 403 + 復帰の案内を返し、SPA が /restore へ誘導する。
  // 401（未ログイン）と区別できないと、ログインし直すたびに同じ画面をぐるぐるしてしまう
  const pending = await pendingDeletionUser(c);
  if (pending) {
    return c.json(
      {
        error: "pending_deletion",
        pendingDeletion: {
          deletedAt: pending.deletedAt,
          purgeAt: pending.deletedAt + env.deletionGraceMs,
          username: pending.username,
        },
      },
      403,
    );
  }
  return c.json({ error: "unauthorized" }, 401);
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
      // 別アカウントに連携済み。鍵の所有は署名で証明済み → 空アカウントのみ引き取り (#238)
      const takeover = await takeoverEmptyAccount(
        existingUserId,
        current,
        "nostr",
      );
      if (takeover !== "ok") return c.json({ error: takeover }, 409);
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
  // 猶予期間中 (#250) はセッションだけ発行して復帰画面へ誘導する。
  // このセッションで使えるのは復帰API だけ（currentUser が null を返すため）
  const pendingDeletion = await isPendingDeletion(userId);
  await issueSession(c, userId);
  return c.json({ ok: true, pendingDeletion });
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
      // 別アカウントに連携済み。アカウントの所有は OAuth で証明済み → 空アカウントのみ引き取り (#238)
      // （行削除で discord_id の UNIQUE 衝突・管理者判定の残置も同時に消える）
      const takeover = await takeoverEmptyAccount(
        existingUserId,
        current,
        provider,
      );
      if (takeover !== "ok") {
        return c.redirect(env.appBaseUrl + `/account?link_error=${takeover}`);
      }
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
  // 猶予期間中 (#250) はセッションだけ発行して復帰画面へ送る。
  // このセッションで使えるのは復帰API だけ（currentUser が null を返すため）
  const pendingDeletion = await isPendingDeletion(userId);
  await issueSession(c, userId);
  return c.redirect(env.appBaseUrl + (pendingDeletion ? "/restore" : "/me"));
});

/**
 * 開発専用ログイン。本番(ENVIRONMENT=production)では 404。
 */
authRoutes.post("/dev-login", async (c) => {
  // 開発環境のみ（staging も /api/auth/* はゲート免除のため明示的に塞ぐ）
  if (env.isProd || env.isStaging) return c.json({ error: "not_found" }, 404);
  // 猶予期間中 (#250) でも行は再利用する（UNIQUE(discord_id) 衝突を避ける）。
  // 本番の OAuth と同じく、復帰するまで currentUser は null のまま
  let u = await usersRepo.findByDiscordIdIncludingDeleted("dev-user");
  if (!u) {
    const created = await usersRepo.createFromProfile("discord", {
      providerUserId: "dev-user",
      username: "DevUser",
      globalName: "開発ユーザー",
      avatarUrl: null,
    });
    await identitiesRepo.link(created.id, "discord", "dev-user", null);
    u = { ...created, deletedAt: null };
  }
  await issueSession(c, u.id);
  return c.json({ user: u, pendingDeletion: u.deletedAt !== null });
});
