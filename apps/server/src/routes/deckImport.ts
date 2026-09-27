import type { Context } from "hono";
import { convertDeckImport, DECK_IMPORT_MAX_BYTES, DeckImportJsonError, parseDeckImport } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { deckImportRepo, importUniqueConflict, type DeckImportReceipt } from "../db/repositories/deckImport.js";

const IMPORT_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function receiptResponse(c: Context<AppEnv>, receipt: DeckImportReceipt, ownerId: string, hash: string, replayed: boolean) {
  if (!receipt.target_id) return c.json({ error: "import_target_deleted" }, 410);
  if (receipt.owner_id !== ownerId) return c.json({ error: "forbidden" }, 403);
  if (receipt.payload_sha256 !== hash) return c.json({ error: "import_key_conflict", id: receipt.deck_id, slug: receipt.slug }, 409);
  c.header("Location", `/api/decks/${receipt.deck_id}`);
  return c.json({ id: receipt.deck_id, slug: receipt.slug, replayed }, replayed ? 200 : 201);
}

/** requireAuth is owned by deckRoutes. Raw bytes are bounded at the worker's single body gate. */
export async function postDeckImport(c: Context<AppEnv>) {
  c.header("Cache-Control", "no-store");
  if (c.req.header("Origin") !== new URL(c.req.url).origin) return c.json({ error: "forbidden_origin" }, 403);
  const mediaType = c.req.header("Content-Type") ?? "";
  const encoding = c.req.header("Content-Encoding");
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(mediaType) ||
      (encoding !== undefined && encoding.toLowerCase() !== "identity")) {
    return c.json({ error: "unsupported_media_type" }, 415);
  }
  const key = c.req.header("X-Deck-Import-Key") ?? "";
  if (!IMPORT_KEY.test(key)) return c.json({ error: "invalid_import_key" }, 400);
  const ownerId = c.get("user").id;
  // Compare against this POST's authenticated session, never a client preflight.
  // The header is a precondition, not an authority for the INSERT owner.
  if (c.req.header("X-Deck-Import-Owner") !== ownerId) return c.json({ error: "import_owner_mismatch" }, 403);
  try {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > DECK_IMPORT_MAX_BYTES) return c.json({ error: "too_large", maxBytes: DECK_IMPORT_MAX_BYTES }, 413);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
    const existing = await deckImportRepo.find(ownerId, key);
    if (existing) return receiptResponse(c, existing, ownerId, hash, true);
    const parsed = parseDeckImport(bytes);
    if (!parsed.ok) return c.json({ error: "invalid_deck_import", issues: parsed.issues, truncated: parsed.truncated }, 422);
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = crypto.randomUUID();
      const slug = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
      const converted = convertDeckImport(parsed.value, () => crypto.randomUUID());
      const content = JSON.stringify(converted.content);
      if (new TextEncoder().encode(content).byteLength > DECK_IMPORT_MAX_BYTES) {
        return c.json({ error: "invalid_deck_import", issues: [{ path: "slides", code: "converted_too_large", message: "Reduce elements or text; converted content must fit in 1048576 bytes." }], truncated: false }, 422);
      }
      const now = Date.now();
      let changes: number[];
      try {
        changes = await deckImportRepo.insert({ ownerId, key, hash, id, slug, title: converted.title, content, now });
      } catch (error) {
        const conflict = importUniqueConflict(error);
        if (conflict === "receipt") {
          const receipt = await deckImportRepo.find(ownerId, key);
          if (receipt) return receiptResponse(c, receipt, ownerId, hash, true);
          return c.json({ error: "import_unavailable" }, 503);
        }
        if (conflict === "identity") continue;
        throw error;
      }
      if (changes.length === 2 && changes.every((n) => n === 0)) {
        // The prior request may have consumed the final quota slot using this very key.
        const receipt = await deckImportRepo.find(ownerId, key);
        if (receipt) return receiptResponse(c, receipt, ownerId, hash, true);
        c.header("Retry-After", String(Math.max(1, Math.ceil(((Math.floor(now / 86400000) + 1) * 86400000 - now) / 1000))));
        return c.json({ error: "import_daily_limit" }, 429);
      }
      if (changes.length !== 2 || !changes.every((n) => n === 1)) return c.json({ error: "import_unavailable" }, 503);
      const receipt = await deckImportRepo.find(ownerId, key);
      if (!receipt) return c.json({ error: "import_unavailable" }, 503);
      return receiptResponse(c, receipt, ownerId, hash, false);
    }
    return c.json({ error: "import_unavailable" }, 503);
  } catch (error) {
    if (error instanceof DeckImportJsonError) {
      if (error.code === "too_large") return c.json({ error: error.code, maxBytes: DECK_IMPORT_MAX_BYTES }, 413);
      return c.json({ error: error.code, line: error.line, column: error.column }, 400);
    }
    // No raw input, key, hash, title or DB error text in logs/responses.
    return c.json({ error: "import_unavailable" }, 503);
  }
}
