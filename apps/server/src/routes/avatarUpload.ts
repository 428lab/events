import type { Context } from "hono";
import type { AppEnv } from "../types.js";
import { getBucket } from "../runtime.js";
import { userAvatarsRepo } from "../db/repositories/userAvatars.js";
import { one } from "../db/client.js";
import { avatarUrlFor } from "../lib/avatarStore.js";
import { avatarUploadPrefix } from "../lib/avatarUploadStorage.js";
import { cardImageDimensions } from "../lib/cardImageDimensions.js";

/** Client prefers WebP, otherwise picks the smaller PNG/JPEG encoding. */
export async function putMyAvatar(c: Context<AppEnv>) {
  const mime = (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!["image/webp", "image/png", "image/jpeg"].includes(mime))
    return c.json({ error: "invalid_content_type" }, 400);
  const bytes = await c.req.arrayBuffer(); // worker-level streaming limit also applies
  if (bytes.byteLength > 1024 * 1024) return c.json({ error: "too_large" }, 413);
  const size = cardImageDimensions(new Uint8Array(bytes), mime);
  if (!size || size.width !== 512 || size.height !== 512) return c.json({ error: "invalid_image" }, 400);
  const userId = c.get("user").id;
  const previous = await userAvatarsRepo.findAvatarSyncState(userId);
  if (!previous) return c.json({ error: "unauthorized" }, 401);
  const key = `${avatarUploadPrefix(userId)}${crypto.randomUUID()}.${mime === "image/jpeg" ? "jpg" : mime.split("/")[1]}`;
  const at = Math.max(Date.now(), (previous.updatedAt ?? 0) + 1), avatarUrl = avatarUrlFor(userId, at);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
  const bucket = getBucket();
  try {
    await bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
    if (!await userAvatarsRepo.setUploadedAvatar(userId, previous.uploadedKey, previous.updatedAt, key, avatarUrl, at, hash, mime)) {
      await bucket.delete(key);
      return c.json({ error: "avatar_conflict" }, 409);
    }
  } catch (error) {
    // An ambiguous DB response may have committed: never delete the current image.
    try {
      const row = await one<{ avatar_uploaded_key: string | null }>("SELECT avatar_uploaded_key FROM user WHERE id = ?", userId);
      if (row?.avatar_uploaded_key !== key) await bucket.delete(key);
    } catch (cleanupError) { console.warn("avatar_upload_cleanup_failed", cleanupError); }
    throw error;
  }
  if (previous.uploadedKey) {
    try { await bucket.delete(previous.uploadedKey); }
    catch (error) { console.warn("avatar_previous_cleanup_failed", error); }
  }
  c.header("Cache-Control", "private, no-store");
  return c.json({ avatarUrl });
}
