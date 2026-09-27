import type { Context } from "hono";
import { CARD_COMBO_RE, PROFILE_CARD_IMAGE } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { getBucket } from "../runtime.js";
import { userAvatarsRepo } from "../db/repositories/userAvatars.js";
import { usersRepo } from "../db/repositories/users.js";

const GENERATION = /^[0-9a-f]{32}$/;
const imageKey = (userId: string, generation: string, combo: string) =>
  `profile-cards/${userId}/generations/${generation}/${combo}.png`;
const noStore = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** The caller must upload the generation of the snapshot used to render PNG.
 * Never relabel a stale body with a newly read generation. */
export async function putMyCardImage(c: Context<AppEnv>) {
  for (const [k,v] of Object.entries(noStore)) c.header(k,v);
  const userId = c.get("user").id;
  const combo = c.req.query("k") ?? "";
  if (!CARD_COMBO_RE.test(combo)) return c.json({ error: "invalid_combo" }, 400);
  const generation = c.req.query("g");
  if (generation === undefined) return c.json({ error: "generation_required" }, 400);
  if (!GENERATION.test(generation)) return c.json({ error: "invalid_generation" }, 400);
  const user = await usersRepo.findById(userId);
  if (!user) return c.json({ error: "not_found" }, 404);
  if (user.cardImageGeneration !== generation) return c.json({ error: "card_generation_changed" }, 409);
  const mime = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (mime !== "image/png") return c.json({ error: "invalid_content_type" }, 400);
  if (Number(c.req.header("content-length") ?? "0") > PROFILE_CARD_IMAGE.maxBytes)
    return c.json({ error: "too_large", maxBytes: PROFILE_CARD_IMAGE.maxBytes }, 413);
  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return c.json({ error: "empty_body" }, 400);
  if (body.byteLength > PROFILE_CARD_IMAGE.maxBytes)
    return c.json({ error: "too_large", maxBytes: PROFILE_CARD_IMAGE.maxBytes }, 413);
  const key = imageKey(userId, generation, combo);
  await getBucket().put(key, body, { httpMetadata: { contentType: "image/png" } });
  const updatedAt = Date.now();
  if (!await userAvatarsRepo.setCardImage(userId, updatedAt, combo, generation)) {
    try { await getBucket().delete(key); } catch { /* Unreachable old namespace; cleanup is best effort. */ }
    return c.json({ error: "card_generation_changed" }, 409);
  }
  return c.json({ ok: true, updatedAt, key: combo, generation });
}

/** Old generation-less URLs resolve only the CURRENT namespace, never legacy
 * objects or another combo. Recheck after R2 before conditional/HEAD responses. */
export async function getUserCardImage(c: Context) {
  for (const [k,v] of Object.entries(noStore)) c.header(k,v);
  const userId = c.req.param("id")!;
  const user = await usersRepo.findById(userId);
  if (!user?.cardImageUpdatedAt || !GENERATION.test(user.cardImageGeneration ?? "")) return c.json({ error: "not_found" }, 404);
  const generation = c.req.query("g") ?? user.cardImageGeneration ?? "";
  const combo = c.req.query("k") ?? user.cardImageKey ?? "";
  if (!GENERATION.test(generation) || generation !== user.cardImageGeneration || !CARD_COMBO_RE.test(combo)) return c.json({ error: "not_found" }, 404);
  const obj = await getBucket().get(imageKey(userId,generation,combo));
  if (!obj) return c.json({ error: "not_found" }, 404);
  const current = await usersRepo.findById(userId);
  if (!current?.cardImageUpdatedAt || current.cardImageGeneration !== generation) { await obj.body.cancel(); return c.json({ error: "not_found" }, 404); }
  const etag = `"${generation}:${combo}:${current.cardImageUpdatedAt}"`;
  const headers = { ...noStore, "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", ETag: etag };
  if (c.req.header("if-none-match") === etag) { await obj.body.cancel(); return new Response(null, { status: 304, headers }); }
  if (c.req.method === "HEAD") await obj.body.cancel();
  return new Response(c.req.method === "HEAD" ? null : obj.body as unknown as ReadableStream, { headers });
}
