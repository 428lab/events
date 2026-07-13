import { Hono } from "hono";
import type { Context } from "hono";
import { BGM_MAX_BYTES } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { getBucket } from "../runtime.js";
import { bgmTracksRepo } from "../db/repositories/bgmTracks.js";

/** アップロードを許可する音声MIME（画像と同様の許可リスト方式） */
const ALLOWED_AUDIO_MIMES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
]);

function normalizeAudioMime(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  return ALLOWED_AUDIO_MIMES.has(mime) ? mime : null;
}

const r2Key = (id: string) => `bgm/${id}`;

/** 公開: BGM音声の配信（配信画面タブの <audio> 用。IDはUUIDで推測困難） */
export async function getBgmAudio(c: Context<AppEnv>) {
  const track = await bgmTracksRepo.findById(c.req.param("id")!);
  if (!track) return c.json({ error: "not_found" }, 404);
  const obj = await getBucket().get(track.r2Key);
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body as unknown as ReadableStream, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "audio/mpeg",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export const bgmRoutes = new Hono<AppEnv>();
bgmRoutes.use("*", requireAuth);

/** ビルトイン＋自分の曲一覧 */
bgmRoutes.get("/", async (c) => {
  return c.json({ tracks: await bgmTracksRepo.listForUser(c.get("user").id) });
});

/** アップロード（multipart: file, name, credit） */
bgmRoutes.post("/", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  const credit = typeof body["credit"] === "string" ? body["credit"].trim() : "";
  if (!(file instanceof File)) return c.json({ error: "file_required" }, 400);
  if (!name || name.length > 120) return c.json({ error: "name_required" }, 400);
  if (credit.length > 2000) return c.json({ error: "credit_too_long" }, 400);
  const mime = normalizeAudioMime(file.type);
  if (!mime) return c.json({ error: "invalid_content_type" }, 400);
  if (file.size === 0) return c.json({ error: "empty_body" }, 400);
  if (file.size > BGM_MAX_BYTES) {
    return c.json({ error: "too_large", maxBytes: BGM_MAX_BYTES }, 413);
  }

  const id = crypto.randomUUID();
  await getBucket().put(r2Key(id), await file.arrayBuffer(), {
    httpMetadata: { contentType: mime },
  });
  const track = await bgmTracksRepo.create(c.get("user").id, name, credit, r2Key(id));
  return c.json({ track }, 201);
});

/** 削除（自分の曲のみ。ビルトインは不可） */
bgmRoutes.delete("/:id", async (c) => {
  const track = await bgmTracksRepo.findById(c.req.param("id"));
  if (!track) return c.json({ error: "not_found" }, 404);
  if (track.ownerId !== c.get("user").id) {
    return c.json({ error: "forbidden" }, 403);
  }
  await getBucket().delete(track.r2Key);
  await bgmTracksRepo.delete(track.id);
  return c.json({ ok: true });
});
