import { Hono } from "hono";
import { bindEnv, getAssets, env, type Env } from "./runtime.js";
import type { Event } from "@eventer/shared";
import { authRoutes } from "./routes/auth.js";
import { eventRoutes } from "./routes/events.js";
import { scoringRoutes, getEventScoreResults } from "./routes/scoring.js";
import { awardRoutes, getEventAwards } from "./routes/awards.js";
import { meRoutes } from "./routes/me.js";
import { getEventImage } from "./routes/images.js";
import { publicRoutes } from "./routes/public.js";
import { inquiryRoutes, adminInquiryRoutes } from "./routes/inquiries.js";
import { notificationRoutes } from "./routes/notifications.js";
import { communityRoutes } from "./routes/communities.js";
import { currentUser } from "./auth/session.js";
import { isAppAdmin } from "./auth/admin.js";
import { PROVIDERS, providerConfigured } from "./auth/providers.js";
import { eventsRepo } from "./db/repositories/events.js";

const api = new Hono();
api.get("/health", (c) =>
  c.json({ ok: true, discordConfigured: env.discordConfigured }),
);
api.route("/auth", authRoutes);
// 公開: 開催前イベント一覧（認証不要）
api.route("/public", publicRoutes);
// 公開: イベント画像（認証不要。eventRoutes(要認証)より先に登録）
api.get("/events/:id/image", getEventImage);
// 公開: 表彰内容（認証不要。eventRoutes より先に登録）
api.get("/events/:id/awards", getEventAwards);
// 公開: 採点結果一覧（締切後/終了後のみ。eventRoutes より先に登録）
api.get("/events/:id/scores/results", getEventScoreResults);
api.route("/events", eventRoutes);
api.route("/events", scoringRoutes);
api.route("/events", awardRoutes);
api.route("/me", meRoutes);
api.route("/inquiries", inquiryRoutes);
api.route("/admin/inquiries", adminInquiryRoutes);
api.route("/notifications", notificationRoutes);
api.route("/communities", communityRoutes);

/**
 * staging ゲート用の無地HTML。サービス名・環境名などは出さず、
 * 中身を悟られないよう最小限のサインインのみ表示する。
 */
function stagingGateHtml(loggedInNonAdmin: boolean): string {
  const buttons = PROVIDERS.filter(providerConfigured)
    .map(
      (p) =>
        `<a class="btn" href="/api/auth/${p}/login">${p} でサインイン</a>`,
    )
    .join("");
  const body = loggedInNonAdmin
    ? `<p>アクセスできません。</p>`
    : `<div class="btns">${buttons || '<a class="btn" href="/api/auth/discord/login">サインイン</a>'}</div>`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in</title>
<meta name="robots" content="noindex, nofollow">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0E1426;color:#94A3B8;font-family:system-ui,sans-serif}
.card{text-align:center;padding:40px}
p{color:#94A3B8}
.btns{display:flex;flex-direction:column;gap:12px}
a.btn{display:inline-block;background:#334155;color:#E2E8F0;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:600;text-transform:capitalize}</style>
</head><body><div class="card">${body}</div></body></html>`;
}

const app = new Hono();

// staging: 管理者ログイン限定ゲート（OAuth と health は通す）
app.use("*", async (c, next) => {
  if (!env.isStaging) return next();
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/auth/") || path === "/api/health") return next();
  const user = await currentUser(c);
  if (user && isAppAdmin(user)) return next();
  if (path.startsWith("/api/")) {
    return c.json({ error: "staging_admin_only" }, 403);
  }
  return c.html(stagingGateHtml(Boolean(user)), 403);
});

app.route("/api", api);

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** ASSETS バインディングから index.html を取得 */
async function loadIndexHtml(reqUrl: string): Promise<string> {
  const res = await getAssets().fetch(
    new Request(new URL("/index.html", reqUrl)),
  );
  return res.text();
}

/** /events/:id 用に OG メタを注入した HTML を返す（クローラ向け） */
function injectEventOg(html: string, event: Event): string {
  const url = `${env.appBaseUrl}/events/${event.id}`;
  const title = escapeHtml(event.title);
  const desc = escapeHtml((event.description || "").slice(0, 200));
  // 画像なしイベントは既定OG画像にフォールバック
  const image = event.imageUpdatedAt
    ? `${env.appBaseUrl}/api/events/${event.id}/image?v=${event.imageUpdatedAt}`
    : `${env.appBaseUrl}/og-default.png`;
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ];
  // index.html の既定OGを取り除いてからイベント固有を入れる（重複回避）
  const cleaned = html
    .replace(/\s*<meta property="og:[^>]*>/g, "")
    .replace(/\s*<meta name="twitter:[^>]*>/g, "");
  return cleaned.replace("</head>", `${tags.join("\n")}\n</head>`);
}

// /events/:id（イベント詳細）には OG メタを注入した index.html を返す
app.get("/events/:id", async (c) => {
  const html = await loadIndexHtml(c.req.url);
  const event = await eventsRepo.findById(c.req.param("id"));
  if (event && event.status === "published") {
    return c.html(injectEventOg(html, event));
  }
  return c.html(html);
});

// それ以外（静的アセット & SPA ルート）は ASSETS から配信
app.all("*", (c) => getAssets().fetch(c.req.raw));

export default {
  async fetch(
    request: Request,
    workerEnv: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    // バインディングをリクエスト先頭で束ねる（getDb/getBucket/env が参照）
    bindEnv(workerEnv);
    return app.fetch(request, workerEnv, ctx);
  },
} satisfies ExportedHandler<Env>;
