import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { bindEnv, getAssets, env, type Env } from "./runtime.js";
import { gamificationFromStats } from "@eventer/shared";
import type { Event, User } from "@eventer/shared";
import { authRoutes } from "./routes/auth.js";
import { eventRoutes } from "./routes/events.js";
import { scoringRoutes, getEventScoreResults } from "./routes/scoring.js";
import { awardRoutes, getEventAwards } from "./routes/awards.js";
import { meRoutes, postRestoreAccount } from "./routes/me.js";
import { getEventImage } from "./routes/images.js";
import { getUserCardImage } from "./routes/profileCardImages.js";
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
  eventCommentRoutes,
  getEventComments,
} from "./routes/eventComments.js";
import { eventLikeRoutes } from "./routes/eventLikes.js";
import { eventChatRoutes } from "./routes/eventChat.js";
import { meetEventRoutes, meetUserRoutes } from "./routes/eventMeets.js";
import {
  eventScheduleRoutes,
  getEventTimetable,
} from "./routes/eventSchedule.js";
import {
  eventSurveyRoutes,
  getEventSurvey,
} from "./routes/eventSurvey.js";
import { attendanceCsvRoutes } from "./routes/attendanceCsv.js";
import {
  analyticsRoutes,
  adminStatsRoutes,
  recordEventView,
} from "./routes/analytics.js";
import { currentUser, pendingDeletionUser } from "./auth/session.js";
import { PROVIDERS, providerConfigured } from "./auth/providers.js";
import { eventsRepo } from "./db/repositories/events.js";
import { usersRepo } from "./db/repositories/users.js";
import { gamificationRepo } from "./db/repositories/gamification.js";
import {
  feedRss,
  feedJson,
  feedIcs,
  feedRequestsRss,
  feedRequestsJson,
} from "./routes/feeds.js";
import {
  eventRequestRoutes,
  publicEventRequestRoutes,
} from "./routes/eventRequests.js";
import { eventRequestsRepo } from "./db/repositories/eventRequests.js";
import { followRoutes } from "./routes/follows.js";
import {
  publicVenueRoutes,
  venueRoutes,
  getVenueImage,
  getVenuePhotos,
  getVenuePhotoImage,
} from "./routes/venues.js";
import { venueOfferRoutes } from "./routes/venueOffers.js";
import { emailRoutes } from "./routes/email.js";
import { sendEventReminders } from "./lib/reminders.js";
import { purgeDeletedAccounts } from "./lib/purgeDeleted.js";
import {
  adminPurgeDeletedRoutes,
  adminReminderRoutes,
} from "./routes/adminReminders.js";
import { adminSettingsRoutes } from "./routes/adminSettings.js";
import { adminAuditRoutes } from "./routes/adminAudit.js";
import { adminKpiRoutes } from "./routes/adminKpi.js";

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
// 公開: メール配信停止（署名付きリンク。認証不要） (#126)
api.route("/email", emailRoutes);
// 公開: 開催前イベント一覧（認証不要）
api.route("/public", publicRoutes);
// 公開: イベントのたまご一覧・詳細（認証不要）
api.route("/public/event-requests", publicEventRequestRoutes);
// イベントのたまご（投稿・賛同・開催宣言。要認証）
api.route("/event-requests", eventRequestRoutes);
// 公開: 会場一覧・詳細・カバー画像（認証不要）
api.get("/venues/:id/image", getVenueImage);
api.get("/venues/:id/photos", getVenuePhotos);
api.get("/venues/:id/photos/:photoId/image", getVenuePhotoImage);
api.route("/public/venues", publicVenueRoutes);
// 会場の登録・編集（要認証）
api.route("/venues", venueRoutes);
// 会場オファー（要認証）
api.route("/venue-offers", venueOfferRoutes);
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
// 公開: イベントコメント一覧（下書きはメンバーのみ。eventRoutes より先に登録）
api.get("/events/:id/comments", getEventComments);
// 公開: タイムテーブル (#116)（下書きはメンバーのみ。eventRoutes より先に登録）
api.get("/events/:id/timetable", getEventTimetable);
// 公開: 事前アンケートの質問 (#152)（下書きはメンバーのみ。eventRoutes より先に登録）
api.get("/events/:id/survey", getEventSurvey);
// 公開: アクセス計測ビーコン（eventRoutes より先に登録）
api.post("/events/:id/view", recordEventView);
api.route("/events", eventRoutes);
api.route("/events", scoringRoutes);
api.route("/events", awardRoutes);
api.route("/events", liveControlRoutes);
api.route("/events", eventPhotoRoutes);
api.route("/events", eventCommentRoutes);
// いいね (#155)（参加確定メンバーのみ。要認証）
api.route("/events", eventLikeRoutes);
// Nostrイベントチャットの紐付け (#199)（参加確定メンバーのみ。要認証）
api.route("/events", eventChatRoutes);
// 出会った記録 (#189)（参加確定メンバー同士。要認証）
api.route("/events", meetEventRoutes);
api.route("/events", eventScheduleRoutes);
// 事前アンケート (#152)（質問保存・回答・スタッフ閲覧。要認証）
api.route("/events", eventSurveyRoutes);
// 入館名簿CSV (#154)（staff または成立会場の運営者。要認証）
api.route("/events", attendanceCsvRoutes);
api.route("/events", analyticsRoutes);
// 退会の取り消し（復帰） (#250)。猶予期間中は requireAuth が通らないため、
// requireAuth 付きの meRoutes より先に登録する
api.post("/me/restore", postRestoreAccount);
api.route("/me", meRoutes);
// 公開: プロフィールカードPNG（認証不要。OGクローラ用。要認証の /users ルートより先に登録） (#193)
api.get("/users/:id/card-image", getUserCardImage);
// フォロー（要認証）
api.route("/users", followRoutes);
// 出会える共通イベントの取得 (#189)（要認証）
api.route("/users", meetUserRoutes);
api.route("/inquiries", inquiryRoutes);
api.route("/admin/inquiries", adminInquiryRoutes);
api.route("/admin/run-reminders", adminReminderRoutes);
// 退会猶予期間 (#250) の完全削除の手動実行（staging 検証用。app admin のみ）
api.route("/admin/run-purge-deleted", adminPurgeDeletedRoutes);
// GitHub Actions のスケジュール実行から叩く（Workers Free は cron 上限のため #129）。
// CRON_SECRET 未設定なら閉じたまま（404）。
// 未設定なら null、鍵違いなら Response を返す
function checkCronKey(c: Context): Response | null {
  const secret = env.cronSecret;
  if (!secret) return c.json({ error: "not_found" }, 404);
  const given = c.req.header("x-cron-key") ?? "";
  // 長さ非依存の単純比較で十分（総当たりはレート的に非現実的だが一応固定時間で）
  let diff = given.length === secret.length ? 0 : 1;
  for (let i = 0; i < Math.min(given.length, secret.length); i++) {
    diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  if (diff !== 0) return c.json({ error: "forbidden" }, 403);
  return null;
}

api.post("/cron/reminders", async (c) => {
  const denied = checkCronKey(c);
  if (denied) return denied;
  const sent = await sendEventReminders();
  return c.json({ sent });
});

// 退会猶予期間 (#250) を過ぎたアカウントの完全削除。日次実行
// （.github/workflows/purge-deleted.yml）
api.post("/cron/purge-deleted", async (c) => {
  const denied = checkCronKey(c);
  if (denied) return denied;
  return c.json(await purgeDeletedAccounts());
});
api.route("/admin/stats", adminStatsRoutes);
// 運営ダッシュボード: サービス全体のKPI（app admin のみ） (#257)
api.route("/admin/kpi", adminKpiRoutes);
// アプリ全体の運用設定（チャットリレー等。app admin のみ） (#199)
api.route("/admin/settings", adminSettingsRoutes);
// 重要操作の監査ログ（app admin のみ） (#248)
api.route("/admin/audit-logs", adminAuditRoutes);
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
  // メール配信停止はメールクライアントから未ログインで開かれるため通す (#126)。
  // メール内の画像（ロゴ・イベント画像）もメールクライアントは未ログインのため通す。
  // 画像バイナリのみで、イベント情報のJSONはゲート対象のまま
  if (
    path.startsWith("/api/auth/") ||
    path === "/api/health" ||
    path === "/api/email/unsubscribe" ||
    path === "/logo-email.png" ||
    /^\/api\/events\/[0-9a-f-]{36}\/image$/.test(path) ||
    /^\/api\/users\/[0-9a-f-]{36}\/card-image$/.test(path)
  )
    return next();
  const user = await currentUser(c);
  if (user) return next();
  // 退会申請中 (#250) は currentUser が null になるが、復帰フローに辿り着けないと
  // staging で復帰を試せない。有効なセッションを持つ以上ゲートは通す
  // （猶予期間中にできる操作は復帰のみで、これは各ルート側で制限している）
  if (await pendingDeletionUser(c)) return next();
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

/** プロフィール用の OG メタ注入 (#193)。
 * カードPNGが生成済みなら大きなカード画像、なければ既定OG画像を出す */
function injectProfileOg(
  html: string,
  user: User,
  summary: string,
): string {
  // スペース入りハンドル (#236) でも有効なURLになるようエンコードする
  const url = escapeHtml(
    `${env.appBaseUrl}/users/${encodeURIComponent(user.username)}`,
  );
  const title = escapeHtml(`${user.globalName ?? user.username} ・ events lab`);
  const desc = escapeHtml(summary);
  const image = escapeHtml(
    user.cardImageUpdatedAt
      ? `${env.appBaseUrl}/api/users/${user.id}/card-image?${
          user.cardImageKey ? `k=${user.cardImageKey}&` : ""
        }v=${user.cardImageUpdatedAt}`
      : `${env.appBaseUrl}/og-default.png`,
  );
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    // カードPNGは 2148x1300 の横長なので large card。既定画像は通常カード
    `<meta name="twitter:card" content="${user.cardImageUpdatedAt ? "summary_large_image" : "summary"}" />`,
  ];
  const cleaned = html
    .replace(/\s*<meta property="og:[^>]*>/g, "")
    .replace(/\s*<meta name="twitter:[^>]*>/g, "");
  return cleaned.replace("</head>", `${tags.join("\n")}\n</head>`);
}

// /users/:handle（公開プロフィール）に OG メタを注入 (#193)
app.get("/users/:handle", async (c) => {
  const html = await loadIndexHtml(c.req.url);
  const handle = c.req.param("handle");
  // 公開プロフィールAPIと同じ解決順: username 優先、UUID直指定も後方互換で許可
  const user =
    (await usersRepo.findByUsername(handle)) ??
    (await usersRepo.findById(handle));
  if (!user) return c.html(html); // 存在しないユーザーは素の SPA HTML
  // 実績サマリー（有効イベント基準）。1クエリで済む statsForUser のみ使う
  const stats = await gamificationRepo.statsForUser(user.id, Date.now());
  const level = gamificationFromStats(stats).level;
  const summary = `Lv.${level} ・ 主催${stats.hosted} ・ 登壇${stats.spoken} ・ 参加${stats.attendedQualifying}`;
  return c.html(injectProfileOg(html, user, summary));
});

// 公開イベントのフィード（RSS / JSON Feed / iCal。フィルタはクエリ）
app.get("/feed/events.rss", feedRss);
app.get("/feed/events.json", feedJson);
app.get("/feed/events.ics", feedIcs);
// イベントのたまごのフィード (#51)
app.get("/feed/requests.rss", feedRequestsRss);
app.get("/feed/requests.json", feedRequestsJson);

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
    // バインディングをリクエスト先頭で束ねる（getDb/getBucket/env が参照）。
    // ctx も束ね、メール送信等を waitUntil でレスポンス外に逃がせるようにする
    bindEnv(workerEnv, ctx);
    return app.fetch(request, workerEnv, ctx);
  },

  // cron（毎日 UTC 0:00 = JST 9:00）: 前日リマインダーメール (#126)
  async scheduled(
    _controller: ScheduledController,
    workerEnv: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    bindEnv(workerEnv);
    // staging はDBが本番コピーになり得るため cron 送信しない（二重送信防止）。
    // staging での動作確認は POST /api/admin/run-reminders を使う
    if (env.isStaging) return;
    ctx.waitUntil(sendEventReminders());
  },
} satisfies ExportedHandler<Env>;
