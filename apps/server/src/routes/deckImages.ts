import type { Context } from "hono";
import type { AppEnv } from "../types.js";
import { getBucket } from "../runtime.js";
import { decksRepo } from "../db/repositories/decks.js";

const MAX_BYTES = 6 * 1024 * 1024; // 6MB
const r2Key = (deckId: string, imageId: string) =>
  `deck-images/${deckId}/${imageId}`;

/** 公開: スライド画像の取得（imageId は一意なので長期キャッシュ） */
export async function getDeckImage(c: Context<AppEnv>) {
  const obj = await getBucket().get(
    r2Key(c.req.param("id")!, c.req.param("imageId")!),
  );
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body as unknown as ReadableStream, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "image/*",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

/** owner: スライド画像のアップロード（生バイナリ）。URL を返す */
export async function putDeckImage(c: Context<AppEnv>) {
  const id = c.req.param("id")!;
  const deck = await decksRepo.findById(id);
  if (!deck) return c.json({ error: "not_found" }, 404);
  if (deck.ownerId !== c.get("user").id) {
    return c.json({ error: "forbidden" }, 403);
  }
  const mime = c.req.header("content-type") ?? "";
  if (!mime.startsWith("image/")) {
    return c.json({ error: "invalid_content_type" }, 400);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty_body" }, 400);
  if (body.byteLength > MAX_BYTES) {
    return c.json({ error: "too_large", maxBytes: MAX_BYTES }, 413);
  }
  const imageId = crypto.randomUUID();
  await getBucket().put(r2Key(id, imageId), body, {
    httpMetadata: { contentType: mime },
  });
  return c.json({ url: `/api/decks/${id}/images/${imageId}` });
}
