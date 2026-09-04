import { AsyncLocalStorage } from "node:async_hooks";
import type { D1Database, R2Bucket, Fetcher } from "@cloudflare/workers-types";
import { ACCOUNT_DELETION_GRACE_MS } from "@eventer/shared";

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
  CRON_SECRET?: string;
  /** メール差出人（未設定なら既定値） (#126) */
  EMAIL_FROM?: string;
  /** events lab 公式サービス鍵の秘密鍵（64桁hex）。チャンネル作成 kind:40 の
   * サーバー署名に使う。未設定なら公式署名は無効 (#199) */
  NOSTR_SERVICE_KEY?: string;
}

// Worker のバインディングはアイソレート内で安定（リクエスト間で同一ハンドル）なので、
// リクエスト先頭で束ねたモジュール変数を参照しても並行リクエストで競合しない。
let _env: Env | null = null;
// 1リクエストあたりのメール送信予算（サブリクエスト上限の安全弁）。
// アイソレート内の並行リクエストで共有されるためベストエフォートの近似だが、
// 目的は暴走防止なので十分。bindEnv のたびにリセットする。
let _emailBudget = 0;
const EMAIL_BUDGET_PER_REQUEST = 20;
// OGサムネイル取得の1リクエストあたり予算（リダイレクトのホップも1と数える）
let _ogFetchBudget = 0;
const OG_FETCH_BUDGET_PER_REQUEST = 20;

export function bindEnv(e: Env): void {
  _env = e;
  _emailBudget = EMAIL_BUDGET_PER_REQUEST;
  _ogFetchBudget = OG_FETCH_BUDGET_PER_REQUEST;
}

// ExecutionContext はバインディングと違い「その1リクエスト（その1回の cron）」に
// 属する。モジュール変数に置くとアイソレートを共有する並行リクエストで上書きされ、
// A が await している間に B が入ると A の deferBackground が B の ctx に
// waitUntil してしまう。B のレスポンスが先に終われば A の背景処理は打ち切られる (#317)。
// そのため実行文脈だけは AsyncLocalStorage でリクエストごとに持つ。
// 到達経路をこの一本に絞るため、モジュール変数の控えは置かない。
const ctxStore = new AsyncLocalStorage<ExecutionContext>();

/** 1リクエスト（または cron 1回）の実行文脈を張る。この中で走るコードだけが
 * deferBackground で waitUntil に逃がせる。Worker のエントリで1回だけ呼ぶ */
export function runWithExecutionContext<T>(
  ctx: ExecutionContext,
  fn: () => T,
): T {
  return ctxStore.run(ctx, fn);
}

/** レスポンスをブロックせずにバックグラウンド実行する（実行文脈の外では await）。
 * 文脈は呼び出し元のリクエストのものが自動で引き継がれる */
export async function deferBackground(p: Promise<unknown>): Promise<void> {
  const ctx = ctxStore.getStore();
  if (ctx) ctx.waitUntil(p);
  else await p;
}

/** OGサムネイル取得1回ぶんの予算を確保。使い切っていたら false */
export function takeOgFetchSlot(): boolean {
  if (_ogFetchBudget <= 0) return false;
  _ogFetchBudget--;
  return true;
}

/** 残っているメール送信予算の数。
 * 一斉連絡 (#172) の送信待ちを消化するとき、予算切れで送れなかったぶんを
 * 「失敗」と数えないよう、取り出す件数をここに合わせるために使う */
export function emailSlotsLeft(): number {
  return _emailBudget;
}

/** メール1通ぶんの送信予算を確保。使い切っていたら false */
export function takeEmailSlot(): boolean {
  if (_emailBudget <= 0) return false;
  _emailBudget--;
  return true;
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
  /** 退会の猶予期間 (#250)。staging は完全削除まで30日待つと検証できないため
   * 10分に短縮する（表示される期限もこの値から計算される）。
   * 本番・開発・テストは既定の30日 */
  get deletionGraceMs(): number {
    return must().ENVIRONMENT === "staging"
      ? 10 * 60 * 1000
      : ACCOUNT_DELETION_GRACE_MS;
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
  get cronSecret(): string {
    return must().CRON_SECRET || "";
  },
  get resendApiKey(): string {
    return must().RESEND_API_KEY || "";
  },
  /** 公式サービス鍵の秘密鍵hex（未設定なら空文字＝公式署名無効） (#199)。
   * 大文字hexや前後空白の混入で無言の503にならないよう正規化する */
  get nostrServiceKey(): string {
    return (must().NOSTR_SERVICE_KEY || "").trim().toLowerCase();
  },
  /** メール差出人 (#126) */
  get emailFrom(): string {
    return must().EMAIL_FROM || "events lab <noreply@events.kojira.io>";
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
