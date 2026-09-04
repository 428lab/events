import type { Context } from "hono";
import { CARD_COMBO_RE, PROFILE_CARD_IMAGE } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { getBucket } from "../runtime.js";
import { userAvatarsRepo } from "../db/repositories/userAvatars.js";
import { usersRepo } from "../db/repositories/users.js";

/** R2 のオブジェクトキー。組み合わせ（背景-色）ごとに別ファイルで保存する (#201)。
 * URLが組み合わせで変わるため、変更時にOGクローラのキャッシュが自然に無効化される */
const comboImageKey = (userId: string, combo: string) =>
  `profile-cards/${userId}/${combo}.png`;
/** #193 当時の旧キー（組み合わせ導入前のフォールバック用） */
const legacyImageKey = (userId: string) => `profile-cards/${userId}.png`;

/** 本人: プロフィールカードPNGのアップロード（Web側で描画したものをOG画像用にキャッシュ）。
 * ?k=<背景-色> の組み合わせキー必須。カードはSVG→canvas経由でPNG化されるため
 * content-type は image/png のみ許可する。 */
export async function putMyCardImage(c: Context<AppEnv>) {
  const userId = c.get("user").id;

  const combo = c.req.query("k") ?? "";
  if (!CARD_COMBO_RE.test(combo)) {
    return c.json({ error: "invalid_combo" }, 400);
  }
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
  await getBucket().put(comboImageKey(userId, combo), body, {
    httpMetadata: { contentType: "image/png" },
  });
  const updatedAt = Date.now();
  await userAvatarsRepo.setCardImage(userId, updatedAt, combo);
  return c.json({ ok: true, updatedAt, key: combo });
}

/** 公開: プロフィールカードPNGの取得（認証不要。OGクローラ/シェア表示用）。
 * ?k=<組み合わせ> を指定するとそのファイル、無指定なら選択中（または旧キー）を返す */
export async function getUserCardImage(c: Context) {
  const userId = c.req.param("id")!;
  const user = await usersRepo.findById(userId);
  if (!user?.cardImageUpdatedAt) return c.json({ error: "not_found" }, 404);

  const requested = c.req.query("k") ?? "";
  const combo = CARD_COMBO_RE.test(requested)
    ? requested
    : (user.cardImageKey ?? null);
  const objectKey = combo
    ? comboImageKey(userId, combo)
    : legacyImageKey(userId);

  const etag = `"${user.cardImageUpdatedAt}:${combo ?? "legacy"}"`;
  if (c.req.header("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  const obj = await getBucket().get(objectKey);
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body as unknown as ReadableStream, {
    headers: {
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
      // OG画像はURLに ?k=組み合わせ&v=updatedAt を付けて配るため、長めにキャッシュしてよい
      "Cache-Control": "public, max-age=3600",
      ETag: etag,
    },
  });
}
