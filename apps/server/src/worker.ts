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

const app = new Hono();
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
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:url" content="${url}" />`,
  ];
  if (event.imageUpdatedAt) {
    const img = `${env.appBaseUrl}/api/events/${event.id}/image?v=${event.imageUpdatedAt}`;
    tags.push(`<meta property="og:image" content="${img}" />`);
    tags.push(`<meta name="twitter:card" content="summary_large_image" />`);
  }
  return html.replace("</head>", `${tags.join("\n")}\n</head>`);
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
