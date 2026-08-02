import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../types.js";
import { env } from "../runtime.js";
import { requireAuth, currentUser } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { eventViewsRepo } from "../db/repositories/eventViews.js";

const VISITOR_COOKIE = "ev_vid";

/** JST の YYYY-MM-DD */
function jstDay(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** リンク側で明示された流入元（?ref=）。許可リスト制で統計の汚染を防ぐ */
const REF_PARAM_SOURCES = new Set(["notification", "feed", "email"]);

/** document.referrer から流入元ラベルを作る（ホスト名のみ・先頭 www. 除去） */
function parseSource(ref: unknown): string {
  if (typeof ref !== "string" || !ref) return "direct";
  try {
    const host = new URL(ref).hostname.replace(/^www\./, "");
    const appHost = new URL(env.appBaseUrl).hostname.replace(/^www\./, "");
    if (host === appHost) return "internal";
    return host.slice(0, 100);
  } catch {
    return "direct";
  }
}

/** 計測ビーコン（公開・未認証可）。eventRoutes のブランケット requireAuth より前に登録 */
export async function recordEventView(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  // 公開イベントのみ計測（下書き等は無視）
  const event = await eventsRepo.findById(eventId);
  if (!event || event.status !== "published") return c.body(null, 204);

  // 主催者/管理者自身の閲覧は水増し防止でカウントしない
  const user = await currentUser(c);
  if (user) {
    if (isAppAdmin(user)) return c.body(null, 204);
    const member = await eventMembersRepo.find(eventId, user.id);
    if (member?.role === "staff") return c.body(null, 204);
  }

  let body: { ref?: unknown; refParam?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body なしでも計測（direct 扱い） */
  }
  // 通知・フィード等のアプリ内リンク経由は referrer より ?ref= を優先
  const explicit =
    typeof body.refParam === "string" && REF_PARAM_SOURCES.has(body.refParam)
      ? body.refParam
      : null;
  const source = explicit ?? parseSource(body.ref);
  const country =
    (c.req.raw as { cf?: { country?: string } }).cf?.country ?? "XX";

  // visitor cookie（無ければ発行）
  let vid = getCookie(c, VISITOR_COOKIE);
  if (!vid) {
    vid = crypto.randomUUID();
    setCookie(c, VISITOR_COOKIE, vid, {
      httpOnly: true,
      sameSite: "Lax",
      secure: env.isProd,
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  await eventViewsRepo.record(eventId, jstDay(), source, country, vid);
  return c.body(null, 204);
}

/** イベント統計（staff）。/events にマウント */
export const analyticsRoutes = new Hono<AppEnv>();
analyticsRoutes.use("*", requireAuth);

/** ?days=N を JST の since 日付に。未指定/0以下は全期間（'0000'） */
function sinceDayFromQuery(c: Context<AppEnv>): string {
  const days = Number(c.req.query("days"));
  if (!Number.isFinite(days) || days <= 0) return "0000";
  return new Date(Date.now() + 9 * 3600 * 1000 - days * 86400000)
    .toISOString()
    .slice(0, 10);
}

analyticsRoutes.get(
  "/:id/stats",
  requireEventRole(["staff"]),
  async (c) => {
    return c.json(
      await eventViewsRepo.statsForEvent(c.req.param("id"), sinceDayFromQuery(c)),
    );
  },
);

/** 管理者向け: 全イベント横断。/admin/stats にマウント */
const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isAppAdmin(c.get("user"))) return c.json({ error: "forbidden" }, 403);
  await next();
};

export const adminStatsRoutes = new Hono<AppEnv>();
adminStatsRoutes.use("*", requireAuth, requireAdmin);
adminStatsRoutes.get("/", async (c) => {
  return c.json(await eventViewsRepo.adminOverview(sinceDayFromQuery(c)));
});
