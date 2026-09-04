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
 *
 * ## `OPEN_ROUTES` に1行足すのは、認可の変更である
 *
 * この表がこの検査の唯一の抜け道になっている。境界の外へ経路を1本出しても、
 * その鍵を表に足せば検査は通る（サブアプリ丸ごとなら全パスぶん足すことになるので
 * 通らないが、1本なら通る）。**だから、`OPEN_ROUTES` への追加は
 * 「この経路を未ログインに開く」という宣言として読み、認可の変更としてレビューすること。**
 * 「テストを通すために足す」は禁止。落ちたときに最初に疑うのは表ではなく、
 * 足した経路が本当に公開でよいのかの方。
 *
 * 事故で足せないよう、行数（`EXPECTED_OPEN_COUNT`）も一致を見ている。
 * 表を触ると必ずこの数も動かすことになるので、差分に必ず現れる。
 */

/**
 * 未ログインで通ってよい経路。ここに無い経路は requireAuth を通ること。
 * **足すことは認可の変更**（上の前口上）。用途ごとに固めてあるので、
 * 足すときはどの塊に属するかを選ぶこと。属せないなら、たぶん公開すべきではない。
 */
const OPEN_ROUTES = new Set<string>([
  /* ── ログイン前に通らないとログインできないもの ───────────── */
  "GET /api/auth/:provider/callback",
  "GET /api/auth/:provider/login",
  "GET /api/auth/bluesky/callback",
  "GET /api/auth/bluesky/client-metadata.json",
  "GET /api/auth/bluesky/login",
  "GET /api/auth/me",
  "GET /api/auth/nostr/challenge",
  "GET /api/auth/providers",
  "POST /api/auth/dev-login",
  "POST /api/auth/logout",
  "POST /api/auth/nostr/login",

  /* ── 死活監視 ──────────────────────────────────────── */
  "GET /api/health",

  /* ── GitHub Actions から叩く定時実行 (#129)。門は CRON_SECRET ── */
  "POST /api/cron/broadcast-emails",
  "POST /api/cron/detect-abuse",
  "POST /api/cron/purge-deleted",
  "POST /api/cron/reminders",

  /* ── メールから未ログインで開かれる (#126) ────────────────── */
  "GET /api/email/unsubscribe",
  "POST /api/email/unsubscribe",

  /* ── 開催前アンケート (#444)。門は128bitトークン ─────────── */
  "GET /api/public/pre-surveys/:token",
  "POST /api/public/pre-surveys/:token/responses",

  /* ── 退会猶予期間の復帰 (#250)。requireAuth が通らない人が使う ── */
  "POST /api/me/restore",

  /* ── 計測ビーコン（誰が見たかを問わない）───────────────── */
  "POST /api/events/:id/view",

  /* ── 公開の読み取り: /api/public（認証なしで読ませる面）─────── */
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
  "GET /api/public/users/:handle",
  "GET /api/public/users/:handle/photos",
  "GET /api/public/venues",
  "GET /api/public/venues/:id",
  "GET /api/public/venues/wanted",

  /* ── 公開の読み取り: イベント配下。境界より前に登録してある。
   *    下書き・非公開の出し分けは各ハンドラが自分で行う ─────── */
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

  /* ── 公開の読み取り: メディアの実体。未ログインで見える一覧や
   *    OGクローラ・メールクライアントから直接引かれる ─────── */
  "GET /api/bgm/:id/audio",
  "GET /api/communities/:id/banner",
  "GET /api/communities/:id/icon",
  "GET /api/decks/:id/images/:imageId",
  "GET /api/live-sets/:id/images/:imageId",
  "GET /api/users/:id/avatar",
  "GET /api/users/:id/card-image",
  "GET /api/venues/:id/image",
  "GET /api/venues/:id/photos",
  "GET /api/venues/:id/photos/:photoId/image",

  /* ── /api の外: SPA の HTML（OGメタ注入）とフィード ─────── */
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
]);

/** `OPEN_ROUTES` の件数。表を1行足すとここも動かすことになるので、
 * 「テストを通すためにこっそり1本開ける」が差分に必ず現れる */
const EXPECTED_OPEN_COUNT = 79;

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

const routesOf = () => (app as unknown as { routes: RouteEntry[] }).routes;

/**
 * 歩けないルート＝パスにワイルドカードを含むもの。`:id` と違って代表パスを
 * 作れないため、ルーターに引かせる形に落とせない。
 *
 * ここに入るのはほぼ全部 `use("*")`・`use("/:id/todos/*")` のミドルウェア登録で、
 * ミドルウェアは終端ではないので歩けなくても穴にならない。**穴になるのは
 * ワイルドカードに終端ハンドラを載せた場合だけ**なので、それを下の検査で見張る。
 *
 * `api.all("/x", h)` のような「メソッドが ALL の終端ハンドラ」は歩ける側に入れて
 * ある（ワイルドカードでなければ代表パスを作れる）。Hono の登録表では
 * `use(path, mw)` と `all(path, h)` は見分けが付かないが、どちらも
 * 「requireAuth を通っているか」を同じ基準で見てよいので分ける必要が無い。
 */
const skipped = () => routesOf().filter((r) => r.path.includes("*"));

/** 登録済みルートを1本ずつ、そのハンドラに届くまでに通る requireAuth の数へ畳む */
function walk(): { key: string; authN: number }[] {
  const out: { key: string; authN: number }[] = [];
  for (const r of routesOf()) {
    if (r.path.includes("*")) continue;
    // `.get(path, requireAuth, handler)` の形で積んだ認証自身は終端ではない
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
    // #472 時点で 538 本。増える方向にしか動かない
    expect(walk().length).toBeGreaterThan(400);
  });

  it("ワイルドカードに載った終端ハンドラは資産のフォールバック1本だけ", () => {
    // ワイルドカードのルートは歩けない（上の skipped 参照）。ミドルウェアなら
    // 終端ではないので穴にならないが、終端ハンドラを載せると検査を素通りする。
    // ミドルウェアは next を受け取る＝引数2つ、終端ハンドラは c だけ＝引数1つ。
    // これで見分け、終端ハンドラは worker.ts 末尾の ASSETS フォールバックだけに保つ。
    // ここが増えたら、その1本は誰にも認証を確かめられていない。
    const terminal = skipped()
      .filter((r) => r.handler.length < 2)
      .map((r) => `${r.method} ${r.path}`);
    expect(uniq(terminal)).toEqual(["ALL /*"]);
  });

  it("公開してよい経路の表の件数（足したら必ず差分に出る）", () => {
    expect(OPEN_ROUTES.size).toBe(EXPECTED_OPEN_COUNT);
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
