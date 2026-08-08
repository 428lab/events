import type { Context } from "hono";
import { getBucket } from "../runtime.js";
import { safeServeMime } from "../lib/imageMime.js";
import { usersRepo } from "../db/repositories/users.js";
import { avatarKey } from "../lib/avatarStore.js";

/** 公開: ユーザーアイコンの配信 (#312)。認証不要（イベント画像・カードPNGと同じ）。
 * 参加者一覧など未ログインでも見える画面に出るため、ここで認証を要求すると
 * 表示が崩れる。アイコン自体は連携先で公開されているものと同じ。
 *
 * 配信URLには ?v={更新時刻} が付いており、変わったときだけ取り直されるので
 * 長めにキャッシュしてよい。ETag も更新時刻なので 304 も効く */
export async function getUserAvatarImage(c: Context) {
  const userId = c.req.param("id")!;
  // 退会申請中 (#250) は findAvatarImage が null を返す＝ここで 404 になる
  const meta = await usersRepo.findAvatarImage(userId);
  if (!meta) return c.json({ error: "not_found" }, 404);

  const etag = `"${meta.updatedAt}"`;
  if (c.req.header("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  const obj = await getBucket().get(avatarKey(userId));
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body as unknown as ReadableStream, {
    headers: {
      "Content-Type": safeServeMime(meta.mime),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=3600",
      ETag: etag,
    },
  });
}
