import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { env } from "./env.js";
import { runMigrations } from "./db/migrate.js";
import { authRoutes } from "./routes/auth.js";
import { eventRoutes } from "./routes/events.js";
import { scoringRoutes } from "./routes/scoring.js";
import { meRoutes } from "./routes/me.js";

runMigrations();

const app = new Hono();

const api = new Hono();
api.get("/health", (c) =>
  c.json({ ok: true, discordConfigured: env.discordConfigured }),
);
api.route("/auth", authRoutes);
api.route("/events", eventRoutes);
api.route("/events", scoringRoutes);
api.route("/me", meRoutes);

app.route("/api", api);

// 本番では Hono がビルド済み SPA を同一オリジンで配信する
if (env.isProd) {
  const indexHtml = readFileSync(join(env.webDistPath, "index.html"), "utf8");
  app.use("/*", serveStatic({ root: env.webDistPath }));
  // SPA フォールバック（/me や /events/:id などのクライアントルート）
  app.notFound((c) => {
    if (c.req.path.startsWith("/api")) {
      return c.json({ error: "not_found" }, 404);
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
