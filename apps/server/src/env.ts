import { config } from "dotenv";

// NODE_ENV で読み込む env ファイルを切り替える（開発: .env / 本番: .env.production）
config({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env",
});

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  port: Number(optional("PORT", "8787")),
  nodeEnv: optional("NODE_ENV", "development"),
  isProd: optional("NODE_ENV", "development") === "production",
  databasePath: optional("DATABASE_PATH", "./data/eventer.db"),
  webDistPath: optional("WEB_DIST_PATH", "apps/web/dist"),
  appBaseUrl: optional("APP_BASE_URL", "http://localhost:5173"),
  sessionSecret: optional("SESSION_SECRET", "dev-insecure-secret"),
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID ?? "",
    clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
    redirectUri: optional(
      "DISCORD_REDIRECT_URI",
      "http://localhost:8787/api/auth/discord/callback",
    ),
  },
  /** Discord OAuth が設定済みか */
  get discordConfigured(): boolean {
    return Boolean(this.discord.clientId && this.discord.clientSecret);
  },
  /** 本番でしか使わないが、明示的に required を呼ぶためのヘルパ */
  requireDiscord() {
    return {
      clientId: required("DISCORD_CLIENT_ID"),
      clientSecret: required("DISCORD_CLIENT_SECRET"),
      redirectUri: this.discord.redirectUri,
    };
  },
};
