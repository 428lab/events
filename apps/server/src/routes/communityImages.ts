import type { Context } from "hono";
import { COMMUNITY_BANNER, COMMUNITY_ICON } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { getBucket } from "../runtime.js";
import { communitiesRepo } from "../db/repositories/communities.js";

type Kind = "icon" | "banner";
const r2Key = (id: string, kind: Kind) => `community-${kind}s/${id}`;

/** 公開: コミュニティ画像の取得（本体は R2、更新時刻は D1） */
export function getCommunityImage(kind: Kind) {
  return async (c: Context<AppEnv>) => {
    const id = c.req.param("id")!;
    const updatedAt = await communitiesRepo.imageUpdatedAt(id, kind);
    if (!updatedAt) return c.json({ error: "not_found" }, 404);

    const etag = `"${updatedAt}"`;
    if (c.req.header("if-none-match") === etag) {
      return new Response(null, { status: 304 });
    }
    const obj = await getBucket().get(r2Key(id, kind));
    if (!obj) return c.json({ error: "not_found" }, 404);
    return new Response(obj.body as unknown as ReadableStream, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType ?? "image/webp",
        "Cache-Control": "public, max-age=60",
        ETag: etag,
      },
    });
  };
}

/** owner/admin: コミュニティ画像のアップロード */
export function putCommunityImage(kind: Kind) {
  const maxBytes =
    kind === "icon" ? COMMUNITY_ICON.maxBytes : COMMUNITY_BANNER.maxBytes;
  return async (c: Context<AppEnv>) => {
    const id = c.req.param("id")!;
    if (!(await communitiesRepo.isManager(id, c.get("user").id))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const mime = c.req.header("content-type") ?? "";
    if (!mime.startsWith("image/")) {
      return c.json({ error: "invalid_content_type" }, 400);
    }
    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0) return c.json({ error: "empty_body" }, 400);
    if (body.byteLength > maxBytes) {
      return c.json({ error: "too_large", maxBytes }, 413);
    }
    await getBucket().put(r2Key(id, kind), body, {
      httpMetadata: { contentType: mime },
    });
    const ts = Date.now();
    await communitiesRepo.setImageUpdated(id, kind, ts);
    return c.json({ ok: true, updatedAt: ts });
  };
}
