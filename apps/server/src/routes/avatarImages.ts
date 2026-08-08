import type { Context } from "hono";
import { deferBackground, getBucket } from "../runtime.js";
import { safeServeMime } from "../lib/imageMime.js";
import { usersRepo } from "../db/repositories/users.js";
import { avatarKey } from "../lib/avatarStore.js";

/** ?v={更新時刻} 付きで来たとき。中身が変わると ?v= ごと変わる＝同じURLの
 * 中身は変わらないので、実質不変として扱ってよい。
 * これまで連携先CDNが担っていた配信が全部こちらに移るため、名札の一括印刷
 * （最大100人）や参加者一覧で D1/R2 を素通りできることの効きが大きい (#313)。
 *
 * s-maxage を別に置いてエッジ側だけ5分で切っている。エッジに載った分は
 * パージできないので、退会したユーザーのアイコンがここに残ると、D1 の行も
 * R2 の実体も消えたあとまで配信され続けてしまう。D1/R2 の削減はブラウザ
 * キャッシュと If-None-Match でほぼ取れており、エッジ側を長く持つ価値より
 * 「退会したらすぐ消える」を優先する (#313)。
 * ブラウザ側は ?v= が変われば別URLになるので長いままでよい */
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable, s-maxage=300";

/** ?v= 無し（または古い ?v=）で来たとき。更新に追従できるよう短くする */
const SHORT_CACHE = "public, max-age=3600";

/** 公開: ユーザーアイコンの配信 (#312)。認証不要（イベント画像・カードPNGと同じ）。
 * 参加者一覧など未ログインでも見える画面に出るため、ここで認証を要求すると
 * 表示が崩れる。アイコン自体は連携先で公開されているものと同じ。 */
export async function getUserAvatarImage(c: Context) {
  const userId = c.req.param("id")!;
  const v = c.req.query("v");

  // ETag は配信URLの ?v=（＝更新時刻）そのもの。D1 を引く前に条件付きGETを
  // 捌けるので、更新が無ければ D1 read も R2 GET も発生しない。
  // 退会済みでもここは 304 を返し得るが、本文は返さない（既にその画像を
  // 持っているクライアントにしか効かない）ので実害はない
  if (v && c.req.header("if-none-match") === `"${v}"`) {
    return new Response(null, {
      status: 304,
      headers: { ETag: `"${v}"`, "Cache-Control": IMMUTABLE_CACHE },
    });
  }

  // エッジキャッシュ。?v= が付いているURLだけを載せる（内容が変わらないため）。
  // キーは ?v= だけに正規化する。生のURLをそのまま使うと ?v=...&junk=1 のような
  // 余計なクエリの数だけ別エントリが作れてしまう
  const cache = caches.default;
  const url = new URL(c.req.url);
  const cacheKey = new Request(`${url.origin}${url.pathname}?v=${v ?? ""}`, {
    method: "GET",
  });
  if (v) {
    const hit = await cache.match(cacheKey).catch(() => undefined);
    if (hit) return hit;
  }

  // 退会申請中 (#250) は findAvatarImage が null を返す＝ここで 404 になる
  const meta = await usersRepo.findAvatarImage(userId);
  if (!meta) return c.json({ error: "not_found" }, 404);

  const etag = `"${meta.updatedAt}"`;
  // ?v= が付いていない・古い URL で来た場合の 304（ETag は現在の更新時刻）
  const fresh = v === String(meta.updatedAt);
  const cacheControl = fresh ? IMMUTABLE_CACHE : SHORT_CACHE;
  if (c.req.header("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl },
    });
  }
  const obj = await getBucket().get(avatarKey(userId));
  if (!obj) return c.json({ error: "not_found" }, 404);
  const res = new Response(obj.body as unknown as ReadableStream, {
    headers: {
      "Content-Type": safeServeMime(meta.mime),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": cacheControl,
      ETag: etag,
    },
  });
  if (fresh) {
    try {
      // 応答は待たせない。次に同じ ?v= が来たら D1 も R2 も引かずに返せる
      await deferBackground(cache.put(cacheKey, res.clone()).catch(() => {}));
    } catch {
      // waitUntil を受け付けない ExecutionContext。載せられないだけで配信は通る
    }
  }
  return res;
}
