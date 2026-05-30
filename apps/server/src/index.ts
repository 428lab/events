import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { env } from "./env.js";
import { runMigrations } from "./db/migrate.js";
import { authRoutes } from "./routes/auth.js";
import { eventRoutes } from "./routes/events.js";
import { scoringRoutes, getEventScoreResults } from "./routes/scoring.js";
import { awardRoutes, getEventAwards } from "./routes/awards.js";
import { meRoutes } from "./routes/me.js";
import { getEventImage } from "./routes/images.js";
import { publicRoutes } from "./routes/public.js";
import { eventsRepo } from "./db/repositories/events.js";

runMigrations();

const app = new Hono();

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

app.route("/api", api);

// 本番では Hono がビルド済み SPA を同一オリジンで配信する
if (env.isProd) {
  const indexHtml = readFileSync(join(env.webDistPath, "index.html"), "utf8");

  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // /events/:id のリクエストには OG メタを注入（クローラ向け）
  const renderEventOg = (eventId: string): string | null => {
    const event = eventsRepo.findById(eventId);
    if (!event || event.status !== "published") return null;
    const url = `${env.appBaseUrl}/events/${eventId}`;
    const title = escapeHtml(event.title);
    const desc = escapeHtml((event.description || "").slice(0, 200));
    const tags = [
      `<meta property="og:type" content="website" />`,
      `<meta property="og:title" content="${title}" />`,
      `<meta property="og:description" content="${desc}" />`,
      `<meta property="og:url" content="${url}" />`,
    ];
    if (event.imageUpdatedAt) {
      const img = `${env.appBaseUrl}/api/events/${eventId}/image?v=${event.imageUpdatedAt}`;
      tags.push(`<meta property="og:image" content="${img}" />`);
      tags.push(`<meta name="twitter:card" content="summary_large_image" />`);
    }
    return indexHtml.replace("</head>", `${tags.join("\n")}\n</head>`);
  };

  app.use("/*", serveStatic({ root: env.webDistPath }));
  // SPA フォールバック（/me や /events/:id などのクライアントルート）
  app.notFound((c) => {
    if (c.req.path.startsWith("/api")) {
      return c.json({ error: "not_found" }, 404);
    }
    const m = c.req.path.match(/^\/events\/([^/]+)$/);
    if (m) {
      const html = renderEventOg(m[1]);
      if (html) return c.html(html);
    }
    return c.html(indexHtml);
  });
}

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`[server] listening on http://localhost:${info.port}`);
  if (!env.discordConfigured) {
    console.log(
      env.isProd
        ? "[server] 警告: Discord OAuth が未設定です。本番ではログインできません（dev-login は無効）。"
        : "[server] Discord OAuth が未設定です（開発用 /api/auth/dev-login が有効）。",
    );
  }
});
