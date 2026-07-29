import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
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
import { getCommunityImage } from "./routes/communityImages.js";
import { deckRoutes } from "./routes/decks.js";
import { getDeckImage } from "./routes/deckImages.js";
import { liveSetRoutes } from "./routes/liveSets.js";
import { getLiveSetImage } from "./routes/liveSetImages.js";
import { liveControlRoutes } from "./routes/liveControl.js";
import { bgmRoutes, getBgmAudio } from "./routes/bgm.js";
import {
  eventPhotoRoutes,
  getEventPhotos,
  getEventPhotoImage,
  getPhotoComments,
} from "./routes/eventPhotos.js";
import {
  analyticsRoutes,
  adminStatsRoutes,
  recordEventView,
} from "./routes/analytics.js";
import { currentUser } from "./auth/session.js";
import { PROVIDERS, providerConfigured } from "./auth/providers.js";
import { eventsRepo } from "./db/repositories/events.js";
import { feedRss, feedJson, feedIcs } from "./routes/feeds.js";
import {
  eventRequestRoutes,
  publicEventRequestRoutes,
} from "./routes/eventRequests.js";
import { eventRequestsRepo } from "./db/repositories/eventRequests.js";

const api = new Hono();
// リクエストボディの上限（最大の画像アップロード 6MB より少し上）
api.use(
  "*",
  bodyLimit({
    maxSize: 8 * 1024 * 1024,
    onError: (c) => c.json({ error: "too_large" }, 413),
  }),
);
api.get("/health", (c) =>
  c.json({ ok: true, discordConfigured: env.discordConfigured }),
);
api.route("/auth", authRoutes);
// 公開: 開催前イベント一覧（認証不要）
api.route("/public", publicRoutes);
// 公開: イベントのたまご一覧・詳細（認証不要）
api.route("/public/event-requests", publicEventRequestRoutes);
// イベントのたまご（投稿・賛同・開催宣言。要認証）
api.route("/event-requests", eventRequestRoutes);
// 公開: イベント画像（認証不要。eventRoutes(要認証)より先に登録）
api.get("/events/:id/image", getEventImage);
// 公開: 表彰内容（認証不要。eventRoutes より先に登録）
api.get("/events/:id/awards", getEventAwards);
// 公開: 採点結果一覧（締切後/終了後のみ。eventRoutes より先に登録）
api.get("/events/:id/scores/results", getEventScoreResults);
// 公開/参加者限定: イベント写真（photos_public 判定は各ハンドラ内。eventRoutes より先に登録）
api.get("/events/:id/photos", getEventPhotos);
api.get("/events/:id/photos/:photoId/image", getEventPhotoImage);
api.get("/events/:id/photos/:photoId/comments", getPhotoComments);
// 公開: アクセス計測ビーコン（eventRoutes より先に登録）
api.post("/events/:id/view", recordEventView);
api.route("/events", eventRoutes);
api.route("/events", scoringRoutes);
api.route("/events", awardRoutes);
api.route("/events", liveControlRoutes);
api.route("/events", eventPhotoRoutes);
api.route("/events", analyticsRoutes);
api.route("/me", meRoutes);
api.route("/inquiries", inquiryRoutes);
api.route("/admin/inquiries", adminInquiryRoutes);
api.route("/admin/stats", adminStatsRoutes);
api.route("/notifications", notificationRoutes);
// 公開: コミュニティ画像（認証不要。communityRoutes(要認証) より先に登録）
api.get("/communities/:id/icon", getCommunityImage("icon"));
api.get("/communities/:id/banner", getCommunityImage("banner"));
api.route("/communities", communityRoutes);
// 公開: スライド画像（認証不要。deckRoutes より先に登録）
api.get("/decks/:id/images/:imageId", getDeckImage);
api.route("/decks", deckRoutes);
// 公開: 配信シーン画像（認証不要。liveSetRoutes より先に登録）
api.get("/live-sets/:id/images/:imageId", getLiveSetImage);
// 配信セット（配信画面ツール。要認証）
api.route("/live-sets", liveSetRoutes);
// 公開: BGM音声（bgmRoutes より先に登録）
api.get("/bgm/:id/audio", getBgmAudio);
api.route("/bgm", bgmRoutes);

/**
 * staging ゲート用の無地HTML。サービス名・環境名などは出さず、
 * 中身を悟られないよう最小限のサインインのみ表示する。
 * Nostr は SPA に入れないと NIP-07 を呼べないため、ここに直接ボタンを置く。
 */
function stagingGateHtml(): string {
  const buttons = PROVIDERS.filter(providerConfigured)
    .map(
      (p) =>
        `<a class="btn" href="/api/auth/${p}/login">${p} でサインイン</a>`,
    )
    .join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in</title>
<meta name="robots" content="noindex, nofollow">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0E1426;color:#94A3B8;font-family:system-ui,sans-serif}
.card{text-align:center;padding:40px}
p{color:#94A3B8}
.btns{display:flex;flex-direction:column;gap:12px}
.btn{display:inline-block;background:#334155;color:#E2E8F0;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:600;text-transform:capitalize;border:0;font-size:1rem;font-family:inherit;cursor:pointer}
#nostr-err{color:#FCA5A5;font-size:.85rem;margin-top:12px}</style>
</head><body><div class="card"><div class="btns">${buttons}<button class="btn" id="nostr">nostr でサインイン</button></div><div id="nostr-err"></div></div>
<script>
document.getElementById("nostr").onclick = async () => {
  const err = document.getElementById("nostr-err");
  err.textContent = "";
  try {
    if (!window.nostr) { err.textContent = "NIP-07 拡張が見つかりません"; return; }
    const { challenge } = await (await fetch("/api/auth/nostr/challenge")).json();
    const event = await window.nostr.signEvent({
      kind: 22242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["relay", location.origin], ["challenge", challenge]],
      content: "events lab にログイン",
    });
    const r = await fetch("/api/auth/nostr/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event }),
    });
    if (!r.ok) { err.textContent = "サインインに失敗しました"; return; }
    location.reload();
  } catch { err.textContent = "サインインに失敗しました"; }
};
</script></body></html>`;
}

const app = new Hono();

// 全レスポンスに基本セキュリティヘッダを付与（MIMEスニッフ抑止・クリックジャッキング防止）
app.use("*", async (c, next) => {
  await next();
  const set = (h: Headers) => {
    h.set("X-Content-Type-Options", "nosniff");
    h.set("X-Frame-Options", "DENY");
    h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  };
  try {
    set(c.res.headers);
  } catch {
    // ASSETS 由来のイミュータブルなヘッダは複製してから付与
    c.res = new Response(c.res.body, c.res);
    set(c.res.headers);
  }
});

// staging: ログイン必須ゲート（匿名には中身を見せない。OAuth と health は通す）
app.use("*", async (c, next) => {
  if (!env.isStaging) return next();
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/auth/") || path === "/api/health") return next();
  const user = await currentUser(c);
  if (user) return next();
  if (path.startsWith("/api/")) {
    return c.json({ error: "staging_login_required" }, 403);
  }
  return c.html(stagingGateHtml(), 403);
});

app.route("/api", api);

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

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
  const image = escapeHtml(
    event.imageUpdatedAt
      ? `${env.appBaseUrl}/api/events/${event.id}/image?v=${event.imageUpdatedAt}`
      : `${env.appBaseUrl}/og-default.png`,
  );
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

// /e/:slug（短いシェアURL）にも OG メタを注入
app.get("/e/:slug", async (c) => {
  const html = await loadIndexHtml(c.req.url);
  const event = await eventsRepo.findBySlug(c.req.param("slug"));
  if (event && event.status === "published") {
    return c.html(injectEventOg(html, event));
  }
  return c.html(html);
});

/** たまご用の OG メタ注入。メンバー限定はタイトルを漏らさないため注入しない */
function injectRequestOg(html: string, req: EventRequestOg): string {
  const url = `${env.appBaseUrl}/requests/${req.id}`;
  const title = escapeHtml(`🥚 ${req.title}`);
  const desc = escapeHtml(
    `「あったらいいな」に賛同や開催宣言をしよう ／ ${(req.description || "").slice(0, 150)}`,
  );
  const image = escapeHtml(`${env.appBaseUrl}/og-default.png`);
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta name="twitter:card" content="summary" />`,
  ];
  const cleaned = html
    .replace(/\s*<meta property="og:[^>]*>/g, "")
    .replace(/\s*<meta name="twitter:[^>]*>/g, "");
  return cleaned.replace("</head>", `${tags.join("\n")}\n</head>`);
}
interface EventRequestOg {
  id: string;
  title: string;
  description: string;
  membersOnly: boolean;
}

// /requests/:id（たまご詳細）に OG メタを注入
app.get("/requests/:id", async (c) => {
  const html = await loadIndexHtml(c.req.url);
  const req = await eventRequestsRepo.findById(c.req.param("id"));
  if (req && !req.membersOnly) {
    return c.html(injectRequestOg(html, req));
  }
  return c.html(html);
});

// /r/:slug（たまごの短いシェアURL）にも OG メタを注入
app.get("/r/:slug", async (c) => {
  const html = await loadIndexHtml(c.req.url);
  const req = await eventRequestsRepo.findBySlug(c.req.param("slug"));
  if (req && !req.membersOnly) {
    return c.html(injectRequestOg(html, req));
  }
  return c.html(html);
});

// 公開イベントのフィード（RSS / JSON Feed / iCal。フィルタはクエリ）
app.get("/feed/events.rss", feedRss);
app.get("/feed/events.json", feedJson);
app.get("/feed/events.ics", feedIcs);

// llms.txt: 静的配信だと .txt に charset が付かず iOS Safari で日本語が文字化けするため、
// charset=utf-8 を明示して返す（中身はアセットから取得）
app.get("/llms.txt", async (c) => {
  const res = await getAssets().fetch(
    new Request(new URL("/llms.txt", c.req.url)),
  );
  const body = await res.text();
  return c.body(body, res.status as 200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
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
