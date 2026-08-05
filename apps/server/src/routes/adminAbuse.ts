import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { ABUSE_FLAG_PAGE_SIZE } from "@eventer/shared";
import type { AbuseFlagsPayload } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";
import { abuseFlagsRepo } from "../db/repositories/abuseFlags.js";
import { detectAbuse } from "../lib/detectAbuse.js";

/** 異常行動の「要確認」リスト (#259 PR2)。app admin のみ。
 * ここに出るのは違反の断定ではなく、運営が目視するための候補 */
const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isAppAdmin(c.get("user"))) return c.json({ error: "forbidden" }, 403);
  await next();
};

export const adminAbuseRoutes = new Hono<AppEnv>();
adminAbuseRoutes.use("*", requireAuth, requireAdmin);

/** ?reviewed= の解釈。未指定/空はすべて、'0'/'false' は未確認のみ、
 * '1'/'true' は確認済みのみ。未知の値は「すべて」に倒す */
function parseReviewed(raw: string | undefined): boolean | undefined {
  const v = (raw ?? "").trim();
  if (v === "") return undefined;
  if (v === "0" || v === "false") return false;
  if (v === "1" || v === "true") return true;
  return undefined;
}

/** 未確認件数だけ（運用メニューのバッジ用）。
 * `/:id/review` より前に置く必要はないが、意図を明確にするため先頭に置く */
adminAbuseRoutes.get("/unread-count", async (c) => {
  return c.json({ count: await abuseFlagsRepo.unreviewedCount() });
});

/** GET /api/admin/abuse-flags?reviewed=&page= （1ページ ABUSE_FLAG_PAGE_SIZE 件）。
 * 並びは「未確認が上・その中では新しい順」 */
adminAbuseRoutes.get("/", async (c) => {
  const reviewed = parseReviewed(c.req.query("reviewed"));
  const rawPage = Number.parseInt(c.req.query("page") ?? "1", 10);
  // 上限を設けないと offset が巨大値になり D1 のバインドで 500 になる
  const page =
    Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 100_000) : 1;
  const limit = ABUSE_FLAG_PAGE_SIZE;
  const [flags, counts] = await Promise.all([
    abuseFlagsRepo.list({ reviewed, limit, offset: (page - 1) * limit }),
    abuseFlagsRepo.counts(reviewed),
  ]);
  const payload: AbuseFlagsPayload = {
    flags,
    total: counts.total,
    page,
    limit,
    unreviewed: counts.unreviewed,
  };
  return c.json(payload);
});

/** 確認済みにする。誤検知・正当なヘビーユーザーを毎回見なくて済むようにするための操作。
 *
 * 監査ログ (#248) には記録しない。あちらは統合・退会・連携の引き取りといった
 * **不可逆な**操作を後から調査するためのもので、こちらは可逆な運用上のトリアージ。
 * 「誰がいつ確認したか」は abuse_flag.reviewed_by / reviewed_at 自体が持っている。 */
adminAbuseRoutes.post("/:id/review", async (c) => {
  const ok = await abuseFlagsRepo.markReviewed(
    c.req.param("id"),
    c.get("user").id,
    Date.now(),
  );
  // 既に他の運営が確認済みにしていた場合も 404 ではなく 200（画面の再読込で揃う）
  return c.json({ ok, updated: ok });
});

/** 検知バッチの手動実行（staging 検証用。app admin のみ）。
 * staging は GHA の定時実行を張らないため、動作確認はこのエンドポイントで行う
 * （退会の完全削除 run-purge-deleted と同じパターン） */
export const adminRunDetectAbuseRoutes = new Hono<AppEnv>();
adminRunDetectAbuseRoutes.use("*", requireAuth, requireAdmin);
adminRunDetectAbuseRoutes.post("/", async (c) => {
  return c.json(await detectAbuse());
});
