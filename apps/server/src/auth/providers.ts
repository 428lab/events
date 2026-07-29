import { env } from "../runtime.js";

export type ProviderName = "discord" | "google" | "github" | "x";
export const PROVIDERS: ProviderName[] = ["discord", "google", "github", "x"];

export function isProvider(v: string): v is ProviderName {
  return (PROVIDERS as string[]).includes(v);
}

/** 正規化したOAuthプロフィール */
export interface OAuthProfile {
  providerUserId: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
  email: string | null;
}

interface ProviderConfig {
  authorizeUrl: string;
  scope: string;
  /** PKCE (S256) を使う（X など必須のプロバイダ向け） */
  pkce?: boolean;
  /** authorize URL に追加するクエリ（任意） */
  extraAuthParams?: Record<string, string>;
  /** code を access_token に交換（PKCE 時は codeVerifier が渡る） */
  exchange: (
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ) => Promise<string>;
  /** access_token からプロフィール取得 */
  fetchProfile: (accessToken: string) => Promise<OAuthProfile>;
}

export const redirectUri = (provider: ProviderName): string =>
  `${env.appBaseUrl}/api/auth/${provider}/callback`;

async function postForm(
  url: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body),
  });
}

const CONFIGS: Record<ProviderName, ProviderConfig> = {
  discord: {
    authorizeUrl: "https://discord.com/api/oauth2/authorize",
    scope: "identify email",
    async exchange(code, redirect) {
      const { clientId, clientSecret } = env.providerCreds("discord");
      const res = await postForm("https://discord.com/api/oauth2/token", {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect,
      });
      if (!res.ok) throw new Error("discord_token_failed");
      return ((await res.json()) as { access_token: string }).access_token;
    },
    async fetchProfile(token) {
      const res = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("discord_profile_failed");
      const u = (await res.json()) as {
        id: string;
        username: string;
        global_name: string | null;
        avatar: string | null;
        email: string | null;
        verified?: boolean;
      };
      return {
        providerUserId: u.id,
        username: u.username,
        globalName: u.global_name,
        avatarUrl: u.avatar
          ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png`
          : null,
        email: u.verified ? u.email : null,
      };
    },
  },

  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    scope: "openid email profile",
    extraAuthParams: { access_type: "online", prompt: "select_account" },
    async exchange(code, redirect) {
      const { clientId, clientSecret } = env.providerCreds("google");
      const res = await postForm("https://oauth2.googleapis.com/token", {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect,
      });
      if (!res.ok) throw new Error("google_token_failed");
      return ((await res.json()) as { access_token: string }).access_token;
    },
    async fetchProfile(token) {
      const res = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error("google_profile_failed");
      const u = (await res.json()) as {
        sub: string;
        name?: string;
        email?: string;
        email_verified?: boolean;
        picture?: string;
      };
      return {
        providerUserId: u.sub,
        username: u.name ?? u.email ?? "Google User",
        globalName: u.name ?? null,
        avatarUrl: u.picture ?? null,
        email: u.email_verified ? (u.email ?? null) : null,
      };
    },
  },

  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    scope: "read:user user:email",
    async exchange(code, redirect) {
      const { clientId, clientSecret } = env.providerCreds("github");
      const res = await postForm(
        "https://github.com/login/oauth/access_token",
        {
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirect,
        },
        { Accept: "application/json" },
      );
      if (!res.ok) throw new Error("github_token_failed");
      return ((await res.json()) as { access_token: string }).access_token;
    },
    async fetchProfile(token) {
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "events-lab",
      };
      const res = await fetch("https://api.github.com/user", { headers });
      if (!res.ok) throw new Error("github_profile_failed");
      const u = (await res.json()) as {
        id: number;
        login: string;
        name: string | null;
        avatar_url: string | null;
      };
      // 検証済みのプライマリメールを取得
      let email: string | null = null;
      const emailRes = await fetch("https://api.github.com/user/emails", {
        headers,
      });
      if (emailRes.ok) {
        const emails = (await emailRes.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        email =
          emails.find((e) => e.primary && e.verified)?.email ??
          emails.find((e) => e.verified)?.email ??
          null;
      }
      return {
        providerUserId: String(u.id),
        username: u.login,
        globalName: u.name ?? u.login,
        avatarUrl: u.avatar_url,
        email,
      };
    },
  },

  x: {
    // X (Twitter) は OAuth 2.0 + PKCE 必須。メールは取得できない
    authorizeUrl: "https://x.com/i/oauth2/authorize",
    scope: "users.read tweet.read",
    pkce: true,
    async exchange(code, redirect, codeVerifier) {
      const { clientId, clientSecret } = env.providerCreds("x");
      // Web App（confidential client）は Basic 認証＋code_verifier
      const res = await postForm(
        "https://api.x.com/2/oauth2/token",
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirect,
          client_id: clientId,
          code_verifier: codeVerifier ?? "",
        },
        { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` },
      );
      if (!res.ok) throw new Error("x_token_failed");
      return ((await res.json()) as { access_token: string }).access_token;
    },
    async fetchProfile(token) {
      const res = await fetch(
        "https://api.x.com/2/users/me?user.fields=profile_image_url",
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error("x_profile_failed");
      const { data: u } = (await res.json()) as {
        data: {
          id: string;
          name: string;
          username: string;
          profile_image_url?: string;
        };
      };
      return {
        providerUserId: u.id,
        username: u.username,
        globalName: u.name || u.username,
        // 既定の _normal(48px) を 400x400 に差し替え
        avatarUrl: u.profile_image_url
          ? u.profile_image_url.replace("_normal.", "_400x400.")
          : null,
        email: null,
      };
    },
  },
};

export function providerConfig(provider: ProviderName): ProviderConfig {
  return CONFIGS[provider];
}

export function providerConfigured(provider: ProviderName): boolean {
  const { clientId, clientSecret } = env.providerCreds(provider);
  return Boolean(clientId && clientSecret);
}
