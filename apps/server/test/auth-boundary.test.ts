import { describe, it, expect } from "vitest";
import { app } from "../src/worker.js";
import { requireAuth } from "../src/auth/session.js";
import { requireAdmin } from "../src/auth/admin.js";

/**
 * **認証の境界を1か所に決める (#472)**。
 *
 * 登録済みのルートを1本ずつ歩いて、`requireAuth` が **ちょうど1回** 通って
 * いることを確かめる。この検査が空振りしないよう、「未ログインで通ってよい
 * 経路」は下の表に全部書き出してある。
 *
 * ## 契約
 *
 * - `/api/events/*` の認証は `routes/events.ts` の `use("*", requireAuth)`
 *   **だけ** が持つ。`worker.ts` で `api.route("/events", eventRoutes)` が
 *   `/events` への登録の **1本目** であることが前提で、後ろに並べた配下ルート
 *   （scoring・photos・chat …）は全部これを通る。自前で重ねない。
 * - それ以外の接頭辞（`/api/me`・`/api/communities` など）は、各ルート
 *   ファイルの `use("*", requireAuth)` が自分の境界を持つ。
 * - 認証の要らない経路を足すときは **この表に足す**。足さなければ落ちる。
 *   逆に、認証必須のはずの経路を境界の前に登録してしまっても落ちる。
 *
 * ## なぜ「ちょうど1回」まで見るのか
 *
 * Hono のミドルウェアはパターン一致で積まれる。`/api/events/*` に `use("*")`
 * を持つサブアプリを並べると、**どのサブアプリのハンドラを叩いても、並べた
 * 全部の requireAuth が順に走る**。#472 の時点で最大23回、1回あたり
 * セッションとユーザーで2クエリ＝1リクエストで D1 を46回引いていた。
 * 重ねても安全側に倒れるだけで動きは変わらないので、見張らないと静かに戻る。
 */

/** 未ログインで通ってよい経路。ここに無い経路は requireAuth を通ること */
const OPEN_ROUTES = new Set<string>([
  "GET /api/auth/:provider/callback",
  "GET /api/auth/:provider/login",
  "GET /api/auth/bluesky/callback",
  "GET /api/auth/bluesky/client-metadata.json",
  "GET /api/auth/bluesky/login",
  "GET /api/auth/me",
  "GET /api/auth/nostr/challenge",
  "GET /api/auth/providers",
  "GET /api/bgm/:id/audio",
  "GET /api/communities/:id/banner",
  "GET /api/communities/:id/icon",
  "GET /api/decks/:id/images/:imageId",
  "GET /api/email/unsubscribe",
  "GET /api/events/:id",
  "GET /api/events/:id/awards",
  "GET /api/events/:id/comments",
  "GET /api/events/:id/entries",
  "GET /api/events/:id/image",
  "GET /api/events/:id/meet-prizes",
  "GET /api/events/:id/meet-prizes/:prizeId/image",
  "GET /api/events/:id/members",
  "GET /api/events/:id/photos",
  "GET /api/events/:id/photos/:photoId/comments",
  "GET /api/events/:id/photos/:photoId/image",
  "GET /api/events/:id/photos/:photoId/poster",
  "GET /api/events/:id/photos/:photoId/video",
  "GET /api/events/:id/schedule",
  "GET /api/events/:id/scores/results",
  "GET /api/events/:id/slots",
  "GET /api/events/:id/submissions",
  "GET /api/events/:id/survey",
  "GET /api/events/:id/timetable",
  "GET /api/health",
  "GET /api/live-sets/:id/images/:imageId",
  "GET /api/public/communities",
  "GET /api/public/communities/:slug",
  "GET /api/public/communities/:slug/members",
  "GET /api/public/decks/:slug",
  "GET /api/public/event-requests",
  "GET /api/public/event-requests/:id",
  "GET /api/public/event-requests/by-slug/:slug",
  "GET /api/public/events",
  "GET /api/public/events/by-slug/:slug",
  "GET /api/public/events/past",
  "GET /api/public/events/scheduling",
  "GET /api/public/events/search",
  "GET /api/public/pre-surveys/:token",
  "GET /api/public/users/:handle",
  "GET /api/public/users/:handle/photos",
  "GET /api/public/venues",
  "GET /api/public/venues/:id",
  "GET /api/public/venues/wanted",
  "GET /api/users/:id/avatar",
  "GET /api/users/:id/card-image",
  "GET /api/venues/:id/image",
  "GET /api/venues/:id/photos",
  "GET /api/venues/:id/photos/:photoId/image",
  "GET /e/:slug",
  "GET /events/:id",
  "GET /feed/events.ics",
  "GET /feed/events.json",
  "GET /feed/events.rss",
  "GET /feed/requests.json",
  "GET /feed/requests.rss",
  "GET /llms.txt",
  "GET /r/:slug",
  "GET /requests/:id",
  "GET /users/:handle",
  "POST /api/auth/dev-login",
  "POST /api/auth/logout",
  "POST /api/auth/nostr/login",
  "POST /api/cron/broadcast-emails",
  "POST /api/cron/detect-abuse",
  "POST /api/cron/purge-deleted",
  "POST /api/cron/reminders",
  "POST /api/email/unsubscribe",
  "POST /api/events/:id/view",
  "POST /api/me/restore",
  "POST /api/public/pre-surveys/:token/responses",
]);

const UUID = "00000000-0000-4000-8000-000000000000";
const probe = (p: string) =>
  p
    .split("/")
    .map((s) => (s.startsWith(":") ? UUID : s))
    .join("/");

type RouteEntry = { path: string; method: string; handler: Function };

/** Hono がそのパスに積むハンドラを、実際のルーターに引かせて並び順どおりに取り出す。
 * ルーターに入っている値は `[handler, routeMeta]` の組 */
function chainOf(method: string, path: string): Function[] {
  const res = (app as unknown as { router: { match: Function } }).router.match(
    method,
    path,
  );
  return ((res[0] ?? []) as unknown[]).map((x) => {
    const v = Array.isArray(x) ? x[0] : x;
    return (Array.isArray(v) ? v[0] : v) as Function;
  });
}

/** 登録済みルートを1本ずつ、そのハンドラに届くまでに通る requireAuth の数へ畳む */
function walk(): { key: string; authN: number }[] {
  const routes = (app as unknown as { routes: RouteEntry[] }).routes;
  const out: { key: string; authN: number }[] = [];
  for (const r of routes) {
    // ワイルドカードと ALL はミドルウェアの登録そのもので、終端ではない
    if (r.path.includes("*") || r.method === "ALL") continue;
    // `.get(path, requireAuth, handler)` の形で積んだ認証自身も終端ではない
    if (r.handler === requireAuth || r.handler === requireAdmin) continue;
    const chain = chainOf(r.method, probe(r.path));
    const pos = chain.indexOf(r.handler);
    const before = pos < 0 ? chain : chain.slice(0, pos);
    out.push({
      key: `${r.method} ${r.path}`,
      authN: before.filter((h) => h === requireAuth).length,
    });
  }
  return out;
}

const uniq = (xs: string[]) => [...new Set(xs)].sort();

describe("認証の境界", () => {
  it("登録済みのルートを歩けている（歩けていないと以下の検査が空振りする）", () => {
    // #472 時点で 533 本。増える方向にしか動かない
    expect(walk().length).toBeGreaterThan(400);
  });

  it("表に無い経路は必ず requireAuth を通る", () => {
    const unguarded = walk()
      .filter((r) => r.authN === 0 && !OPEN_ROUTES.has(r.key))
      .map((r) => r.key);
    expect(uniq(unguarded)).toEqual([]);
  });

  it("requireAuth は1本につき1回だけ（重ねるとセッション参照がその数だけ増える）", () => {
    const doubled = walk()
      .filter((r) => r.authN > 1)
      .map((r) => `${r.key} (requireAuth x${r.authN})`);
    expect(uniq(doubled)).toEqual([]);
  });

  it("表に載せた経路は本当に未認証で通る（表が腐ったら落とす）", () => {
    const guarded = walk()
      .filter((r) => r.authN > 0 && OPEN_ROUTES.has(r.key))
      .map((r) => r.key);
    expect(uniq(guarded)).toEqual([]);
  });

  it("/api/events 配下の認証は routes/events.ts の1枚だけが持つ", () => {
    const bad = walk()
      .filter(
        (r) =>
          r.key.includes(" /api/events") &&
          !OPEN_ROUTES.has(r.key) &&
          r.authN !== 1,
      )
      .map((r) => `${r.key} (requireAuth x${r.authN})`);
    expect(uniq(bad)).toEqual([]);
  });
});
