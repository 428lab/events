import type { D1Database, R2Bucket, Fetcher } from "@cloudflare/workers-types";

/** Worker のバインディング/環境変数（wrangler.toml と対応） */
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  APP_BASE_URL: string;
  ADMIN_DISCORD_IDS: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_REDIRECT_URI: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  X_CLIENT_ID: string;
  X_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  /** Resend の API キー（未設定ならメール送信は無効） (#126) */
  RESEND_API_KEY?: string;
  /** メール差出人（未設定なら既定値） (#126) */
  EMAIL_FROM?: string;
}

// Worker のバインディングはアイソレート内で安定（リクエスト間で同一ハンドル）なので、
// リクエスト先頭で束ねたモジュール変数を参照しても並行リクエストで競合しない。
let _env: Env | null = null;

export function bindEnv(e: Env): void {
  _env = e;
}

function must(): Env {
  if (!_env) throw new Error("runtime env is not bound (call bindEnv first)");
  return _env;
}

export function getDb(): D1Database {
  return must().DB;
}

export function getBucket(): R2Bucket {
  return must().BUCKET;
}

export function getAssets(): Fetcher {
  return must().ASSETS;
}

/** 旧 env オブジェクトと同形（getter ベース）。既存の import 箇所をそのまま活かす。 */
export const env = {
  get environment(): string {
    return must().ENVIRONMENT;
  },
  get isProd(): boolean {
    return must().ENVIRONMENT === "production";
  },
  get isStaging(): boolean {
    return must().ENVIRONMENT === "staging";
  },
  get appBaseUrl(): string {
    return must().APP_BASE_URL;
  },
  get sessionSecret(): string {
    const secret = must().SESSION_SECRET;
    if (!secret) {
      // 本番/staging で未設定なら起動させない（弱い既定値で動くのは開発時のみ）
      if (this.isProd || this.isStaging) {
        throw new Error("SESSION_SECRET is not set");
      }
      return "dev-insecure-secret";
    }
    return secret;
  },
  /** Resend API キー（未設定なら空文字＝メール送信無効） (#126) */
  get resendApiKey(): string {
    return must().RESEND_API_KEY || "";
  },
  /** メール差出人 (#126) */
  get emailFrom(): string {
    return must().EMAIL_FROM || "events lab <noreply@kojira.io>";
  },
  get adminDiscordIds(): string[] {
    return (must().ADMIN_DISCORD_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
  discord: {
    get clientId(): string {
      return must().DISCORD_CLIENT_ID || "";
    },
    get clientSecret(): string {
      return must().DISCORD_CLIENT_SECRET || "";
    },
    get redirectUri(): string {
      return must().DISCORD_REDIRECT_URI || "";
    },
  },
  /** プロバイダごとの client id/secret を取得（未設定なら空文字） */
  providerCreds(provider: string): { clientId: string; clientSecret: string } {
    const e = must();
    switch (provider) {
      case "discord":
        return { clientId: e.DISCORD_CLIENT_ID || "", clientSecret: e.DISCORD_CLIENT_SECRET || "" };
      case "google":
        return { clientId: e.GOOGLE_CLIENT_ID || "", clientSecret: e.GOOGLE_CLIENT_SECRET || "" };
      case "github":
        return { clientId: e.GITHUB_CLIENT_ID || "", clientSecret: e.GITHUB_CLIENT_SECRET || "" };
      case "x":
        return { clientId: e.X_CLIENT_ID || "", clientSecret: e.X_CLIENT_SECRET || "" };
      default:
        return { clientId: "", clientSecret: "" };
    }
  },
  get discordConfigured(): boolean {
    const e = must();
    return Boolean(e.DISCORD_CLIENT_ID && e.DISCORD_CLIENT_SECRET);
  },
  requireDiscord() {
    const e = must();
    if (!e.DISCORD_CLIENT_ID || !e.DISCORD_CLIENT_SECRET) {
      throw new Error("Discord OAuth is not configured");
    }
    return {
      clientId: e.DISCORD_CLIENT_ID,
      clientSecret: e.DISCORD_CLIENT_SECRET,
      redirectUri: e.DISCORD_REDIRECT_URI,
    };
  },
};
