import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "../types.js";
import { env } from "../env.js";
import { usersRepo } from "../db/repositories/users.js";
import { identitiesRepo } from "../db/repositories/identities.js";
import { deriveHandle } from "../lib/handle.js";
import {
  AVATAR_SYNC_MIN_INTERVAL_MS,
  syncAvatarInBackground,
} from "../lib/avatarStore.js";
import {
  clearSession,
  currentUser,
  issueSession,
  pendingDeletionUser,
  requireAuth,
} from "../auth/session.js";
import { finishIdentityLogin } from "../auth/accountLink.js";
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
import { blueskyAuthRoutes } from "./authBluesky.js";

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
  if (!isProvider(provider) && provider !== "nostr" && provider !== "bluesky") {
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

  // 鍵の所有は署名で証明済み。以降の引き取り・ログインの判断は OAuth と共通
  const result = await finishIdentityLogin(c, {
    provider: "nostr",
    providerUserId: pubkey,
    profile: {
      username: `nostr_${pubkey.slice(0, 8)}`,
      globalName: null,
      avatarUrl: null,
      email: null,
    },
  });
  // Nostr は XHR 経由なので、失敗は 409 の JSON で返す（OAuth はリダイレクト）
  if (result.kind === "link_error") return c.json({ error: result.code }, 409);
  if (result.kind === "linked") return c.json({ ok: true, linked: true });
  return c.json({ ok: true, pendingDeletion: result.pendingDeletion });
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
  // 表示名は本人が変更できる (#232) ため、これまで通り未設定のときだけ補完する。
  // アイコンはまず未設定なら連携先のURLで埋め（取り込みに失敗したときの見え方を
  // 従来どおりに保つ）、そのうえで自前保管を試みて自ドメインのURLへ差し替える (#312)
  await usersRepo.fillProfile(user.id, profile.name, profile.picture);
  // 取得元URLは本人が何度でも書き換えられるうえ、この API は回数制限が無い。
  // ハッシュ比較では外向きの取得（1MB）までは止められないので、
  // 直近に「試みた」時刻を基準に一定時間は取りに行かない (#313)
  await syncAvatarInBackground(user.id, profile.picture, {
    minIntervalMs: AVATAR_SYNC_MIN_INTERVAL_MS,
  });
  return c.json({ ok: true });
});

/* =========================================================
 *  Bluesky (AT Protocol OAuth) ログイン・連携 (#381)
 * =======================================================*/

// **`/:provider/*` より前に登録すること。** Hono は登録順に照合するので、
// 後ろに置くと /bluesky/login が OAuth 用の :provider に食われて 404 になる
authRoutes.route("/bluesky", blueskyAuthRoutes);

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

  // 引き取り・ログインの判断は Nostr と共通（auth/accountLink.ts）。
  // 新規作成時の username は、ハンドル概念のないプロバイダ由来の値を
  // 許可文字に整形してから渡す (#236)
  const result = await finishIdentityLogin(c, {
    provider,
    providerUserId: profile.providerUserId,
    profile: {
      username: deriveHandle(profile.username, profile.email),
      globalName: profile.globalName,
      avatarUrl: profile.avatarUrl,
      email: profile.email,
    },
    // Discord だけ、連携時に実IDを user 行へ反映して管理者判定を効かせる。
    // OAuth で本人確認済みの実IDのみ使う（DB由来の値は使わない）
    onLinked:
      provider === "discord"
        ? (userId) => usersRepo.setDiscordId(userId, profile.providerUserId)
        : undefined,
  });
  // OAuth はブラウザの遷移なので、失敗もリダイレクトで返す（Nostr は 409 JSON）
  if (result.kind === "link_error") {
    return c.redirect(env.appBaseUrl + `/account?link_error=${result.code}`);
  }
  if (result.kind === "linked") return c.redirect(env.appBaseUrl + "/account");

  // ログインのたびにアイコンを取り直して自前保管する (#312)。
  // 連携先（Discord など）でアイコンを変えると旧URLが 404 になるため、
  // 「未設定のときだけ補完」では直らない。失敗しても握り潰してログインは通す。
  // 取得元は**今回ログインに使った連携先**（複数連携していても最新のものに揃う）。
  // セッション発行のあとに回すのは、連携先CDNの遅延でログインを待たせないため。
  // 退会申請中は表示自体されないので取りに行かない。
  // Nostr は kind:0 を別APIで受け取る方式なのでここには無い（共通化しない）
  if (!result.pendingDeletion) {
    await syncAvatarInBackground(result.userId, profile.avatarUrl);
  }
  return c.redirect(
    env.appBaseUrl + (result.pendingDeletion ? "/restore" : "/me"),
  );
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
