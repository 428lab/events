import type { Context } from "hono";
import { PROFILE_CARD_IMAGE } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { getBucket } from "../runtime.js";
import { usersRepo } from "../db/repositories/users.js";

/** R2 のオブジェクトキー（ユーザーごとに1枚のプロフィールカードPNG） (#193) */
const cardImageKey = (userId: string) => `profile-cards/${userId}.png`;

/** 本人: プロフィールカードPNGのアップロード（Web側で描画したものをOG画像用にキャッシュ）。
 * カードはSVG→canvas経由でPNG化されるため content-type は image/png のみ許可する。 */
export async function putMyCardImage(c: Context<AppEnv>) {
  const userId = c.get("user").id;

  const mime = (c.req.header("content-type") ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
  if (mime !== "image/png") {
    return c.json({ error: "invalid_content_type" }, 400);
  }
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > PROFILE_CARD_IMAGE.maxBytes) {
    return c.json(
      { error: "too_large", maxBytes: PROFILE_CARD_IMAGE.maxBytes },
      413,
    );
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty_body" }, 400);
  if (body.byteLength > PROFILE_CARD_IMAGE.maxBytes) {
    return c.json(
      { error: "too_large", maxBytes: PROFILE_CARD_IMAGE.maxBytes },
      413,
    );
  }
  await getBucket().put(cardImageKey(userId), body, {
    httpMetadata: { contentType: "image/png" },
  });
  const updatedAt = Date.now();
  await usersRepo.setCardImageUpdatedAt(userId, updatedAt);
  return c.json({ ok: true, updatedAt });
}

/** 公開: プロフィールカードPNGの取得（認証不要。OGクローラ/シェア表示用） */
export async function getUserCardImage(c: Context) {
  const userId = c.req.param("id")!;
  const user = await usersRepo.findById(userId);
  if (!user?.cardImageUpdatedAt) return c.json({ error: "not_found" }, 404);

  const etag = `"${user.cardImageUpdatedAt}"`;
  if (c.req.header("if-none-match") === etag) {
    return new Response(null, { status: 304 });
  }
  const obj = await getBucket().get(cardImageKey(userId));
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body as unknown as ReadableStream, {
    headers: {
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
      // OG画像はURLに ?v=updatedAt を付けて配るため、長めにキャッシュしてよい
      "Cache-Control": "public, max-age=3600",
      ETag: etag,
    },
  });
}
