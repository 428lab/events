import { Hono, type Context } from "hono";
import { convertDeckImport, DECK_IMPORT_MAX_BYTES, DeckImportJsonError, parseDeckImport } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { env, getBucket } from "../runtime.js";
import { hasImageMagicBytes, normalizeImageMime } from "../lib/imageMime.js";
import { deckImageR2Key } from "./deckImages.js";
import {
  DECK_AGENT_TOKEN_MAX_IMAGES,
  DECK_AGENT_TOKEN_MAX_WRITES,
  deckAgentTokensRepo,
  deckIdentityConflict,
  type DeckAgentTokenListRow,
  type DeckAgentTokenRow,
} from "../db/repositories/deckAgentTokens.js";

/**
 * AI agent deck writing (docs/agent-deck-token.md).
 *
 * Two surfaces:
 * - `deckAgentTokenRoutes` (mounted under the cookie-authenticated /api/decks): the owner
 *   issues, lists and revokes 60-minute tokens.
 * - `deckAgentRoutes` (/api/agent): the agent's only entrance. It reads **only** the
 *   `Authorization: Bearer evd_…` header and never the session cookie, and the token is
 *   looked up nowhere else, so a leaked token cannot reach any other API.
 */

const TOKEN_PREFIX = "evd_";
const TOKEN_RE = /^evd_[A-Za-z0-9_-]{43}$/;
const IMAGE_MAX_BYTES = 6 * 1024 * 1024; // same as the editor's deck image upload
const UPLOADED_SRC_RE = /^\/api\/decks\/([0-9a-f-]{36})\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
export async function hashDeckAgentToken(token: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return TOKEN_PREFIX + b64;
}
const base = () => env.appBaseUrl.replace(/\/+$/, "");
const deckUrls = (deck: { id: string; slug: string }) => ({
  editUrl: `${base()}/decks/${deck.id}/edit`,
  viewUrl: `${base()}/d/${deck.slug}`,
});

function tokenView(row: DeckAgentTokenListRow) {
  return {
    id: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    writeCount: row.write_count,
    imageCount: row.image_count,
    deck: row.deck_id && row.deck_slug !== null
      ? { id: row.deck_id, slug: row.deck_slug, title: row.deck_title ?? "", ...deckUrls({ id: row.deck_id, slug: row.deck_slug }) }
      : null,
  };
}

/* ── Owner side (cookie, under requireAuth) ─────────────────────────── */

export const deckAgentTokenRoutes = new Hono<AppEnv>();

deckAgentTokenRoutes.get("/", async (c) => {
  c.header("Cache-Control", "no-store");
  const rows = await deckAgentTokensRepo.listActive(c.get("user").id, Date.now());
  return c.json({ tokens: rows.map(tokenView) });
});

deckAgentTokenRoutes.post("/", async (c) => {
  c.header("Cache-Control", "no-store");
  // Cookie-authenticated write: same-origin only, like the JSON import.
  if (c.req.header("Origin") !== new URL(c.req.url).origin) return c.json({ error: "forbidden_origin" }, 403);
  const token = newToken();
  const id = crypto.randomUUID();
  const now = Date.now();
  const ok = await deckAgentTokensRepo.issue({ id, ownerId: c.get("user").id, tokenHash: await hashDeckAgentToken(token), now });
  if (!ok) return c.json({ error: "agent_token_daily_limit" }, 429);
  const row = (await deckAgentTokensRepo.listActive(c.get("user").id, now)).find((r) => r.id === id);
  if (!row) return c.json({ error: "agent_token_unavailable" }, 503);
  // The plain token is returned exactly once; only its hash is stored.
  return c.json({ token, specUrl: `${base()}/deck-import/agent.md`, ...tokenView(row) }, 201);
});

deckAgentTokenRoutes.delete("/:tokenId", async (c) => {
  if (c.req.header("Origin") !== new URL(c.req.url).origin) return c.json({ error: "forbidden_origin" }, 403);
  const ok = await deckAgentTokensRepo.revoke(c.req.param("tokenId"), c.get("user").id, Date.now());
  return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

/* ── Agent side (Bearer evd_ only) ──────────────────────────────────── */

type AgentEnv = { Variables: { agentToken: DeckAgentTokenRow } };
export const deckAgentRoutes = new Hono<AgentEnv>();

const unauthorized = (c: Context) => {
  c.header("WWW-Authenticate", 'Bearer realm="events-lab-agent"');
  return c.json({ error: "invalid_token", message: "Send Authorization: Bearer evd_… with an unexpired, unrevoked token. Ask the user to issue a new one at /decks/import." }, 401);
};

deckAgentRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  const auth = c.req.header("Authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] ?? "";
  if (!TOKEN_RE.test(token)) return unauthorized(c);
  const row = await deckAgentTokensRepo.findUsable(await hashDeckAgentToken(token), Date.now());
  if (!row) return unauthorized(c);
  c.set("agentToken", row);
  await next();
});

async function deckState(row: DeckAgentTokenRow) {
  const deck = row.deck_id ? await deckAgentTokensRepo.findDeck(row.deck_id, row.owner_id) : null;
  return {
    expiresAt: row.expires_at,
    writesLeft: Math.max(0, DECK_AGENT_TOKEN_MAX_WRITES - row.write_count),
    imagesLeft: Math.max(0, DECK_AGENT_TOKEN_MAX_IMAGES - row.image_count),
    deck: deck ? { id: deck.id, slug: deck.slug, title: deck.title, ...deckUrls(deck) } : null,
    deckDeleted: row.deck_id !== null && deck === null,
  };
}

deckAgentRoutes.get("/deck", async (c) => c.json(await deckState(c.get("agentToken"))));

/** Create (first call) or replace (later calls) the token's single deck from a v2 JSON body. */
deckAgentRoutes.put("/deck", async (c) => {
  const row = c.get("agentToken");
  const mediaType = c.req.header("Content-Type") ?? "";
  const encoding = c.req.header("Content-Encoding");
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(mediaType) ||
      (encoding !== undefined && encoding.toLowerCase() !== "identity")) {
    return c.json({ error: "unsupported_media_type", message: "Send Content-Type: application/json with the raw UTF-8 JSON body." }, 415);
  }
  if (row.write_count >= DECK_AGENT_TOKEN_MAX_WRITES) return c.json({ error: "write_limit", message: `This token allows ${DECK_AGENT_TOKEN_MAX_WRITES} writes.` }, 429);
  let existing: { id: string; slug: string; title: string } | null = null;
  if (row.deck_id) {
    existing = await deckAgentTokensRepo.findDeck(row.deck_id, row.owner_id);
    if (!existing) return c.json({ error: "deck_deleted", message: "The user deleted this deck. Ask for a new token." }, 410);
  }
  try {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > DECK_IMPORT_MAX_BYTES) return c.json({ error: "too_large", maxBytes: DECK_IMPORT_MAX_BYTES }, 413);
    const referenced: string[] = [];
    const parsed = parseDeckImport(bytes, {
      uploadedImageSrc: (src) => {
        const m = UPLOADED_SRC_RE.exec(src);
        if (!m || !row.deck_id || m[1] !== row.deck_id) return false;
        referenced.push(m[2]!);
        return true;
      },
    });
    if (!parsed.ok) return c.json({ error: "invalid_deck_import", issues: parsed.issues, truncated: parsed.truncated }, 422);
    if (parsed.value.version !== 2) {
      return c.json({ error: "invalid_deck_import", issues: [{ path: "version", code: "invalid_literal", message: "Use version 2." }], truncated: false }, 422);
    }
    // Uploaded images must exist; a typo would otherwise publish a broken frame.
    const missing: string[] = [];
    for (const imageId of new Set(referenced)) {
      if (!(await getBucket().head(deckImageR2Key(row.deck_id!, imageId)))) missing.push(`/api/decks/${row.deck_id}/images/${imageId}`);
    }
    if (missing.length) {
      return c.json({ error: "invalid_deck_import", issues: missing.slice(0, 50).map((src) => ({ path: "src", code: "image_not_uploaded", message: `No uploaded image at ${src}. Use the src returned by POST /api/agent/deck/images.` })), truncated: missing.length > 50 }, 422);
    }
    const now = Date.now();
    if (existing) {
      const converted = convertDeckImport(parsed.value, () => crypto.randomUUID());
      const content = JSON.stringify(converted.content);
      if (new TextEncoder().encode(content).byteLength > DECK_IMPORT_MAX_BYTES) return convertedTooLarge(c);
      const result = await deckAgentTokensRepo.replaceBoundDeck({ tokenId: row.id, ownerId: row.owner_id, deckId: existing.id, title: converted.title, content, now });
      if (result === "gone") return c.json({ error: "deck_deleted", message: "The user deleted this deck. Ask for a new token." }, 410);
      if (result === "limit") return c.json({ error: "write_limit", message: `This token allows ${DECK_AGENT_TOKEN_MAX_WRITES} writes.` }, 429);
      return c.json({ created: false, id: existing.id, slug: existing.slug, ...deckUrls(existing) }, 200);
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const deckId = crypto.randomUUID();
      const slug = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
      const converted = convertDeckImport(parsed.value, () => crypto.randomUUID());
      const content = JSON.stringify(converted.content);
      if (new TextEncoder().encode(content).byteLength > DECK_IMPORT_MAX_BYTES) return convertedTooLarge(c);
      let ok: boolean;
      try {
        ok = await deckAgentTokensRepo.createBoundDeck({ tokenId: row.id, ownerId: row.owner_id, deckId, slug, title: converted.title, content, now });
      } catch (error) {
        if (deckIdentityConflict(error)) continue;
        throw error;
      }
      if (!ok) {
        // A concurrent request with the same token created the deck first.
        return c.json({ error: "deck_already_created", message: "This token already created a deck. Retry the same PUT to replace it." }, 409);
      }
      c.header("Location", deckUrls({ id: deckId, slug }).editUrl);
      return c.json({ created: true, id: deckId, slug, ...deckUrls({ id: deckId, slug }) }, 201);
    }
    return c.json({ error: "agent_unavailable" }, 503);
  } catch (error) {
    if (error instanceof DeckImportJsonError) {
      if (error.code === "too_large") return c.json({ error: error.code, maxBytes: DECK_IMPORT_MAX_BYTES }, 413);
      return c.json({ error: error.code, line: error.line, column: error.column }, 400);
    }
    // No raw input, token, or DB error text in responses.
    return c.json({ error: "agent_unavailable" }, 503);
  }
});

function convertedTooLarge(c: Context) {
  return c.json({ error: "invalid_deck_import", issues: [{ path: "slides", code: "converted_too_large", message: "Reduce elements or text; converted content must fit in 1048576 bytes." }], truncated: false }, 422);
}

/** Upload one raster image (raw body) into the token's deck. Returns the src to use in image-url. */
deckAgentRoutes.post("/deck/images", async (c) => {
  const row = c.get("agentToken");
  const deck = row.deck_id ? await deckAgentTokensRepo.findDeck(row.deck_id, row.owner_id) : null;
  if (!row.deck_id) return c.json({ error: "deck_not_created", message: "PUT /api/agent/deck first (image-placeholder frames are fine), then upload images." }, 409);
  if (!deck) return c.json({ error: "deck_deleted", message: "The user deleted this deck. Ask for a new token." }, 410);
  const mime = normalizeImageMime(c.req.header("Content-Type"));
  if (!mime) return c.json({ error: "invalid_content_type", message: "Use image/png, image/jpeg, image/webp, image/gif or image/avif. SVG is not accepted." }, 415);
  if (Number(c.req.header("Content-Length") ?? "0") > IMAGE_MAX_BYTES) return c.json({ error: "too_large", maxBytes: IMAGE_MAX_BYTES }, 413);
  const body = new Uint8Array(await c.req.arrayBuffer());
  if (body.byteLength === 0) return c.json({ error: "empty_body" }, 400);
  if (body.byteLength > IMAGE_MAX_BYTES) return c.json({ error: "too_large", maxBytes: IMAGE_MAX_BYTES }, 413);
  if (!hasImageMagicBytes(body.subarray(0, 12), mime)) return c.json({ error: "invalid_image", message: "The bytes do not look like the declared image type." }, 415);
  if (!(await deckAgentTokensRepo.countImage(row.id))) return c.json({ error: "image_limit", message: `This token allows ${DECK_AGENT_TOKEN_MAX_IMAGES} images.` }, 429);
  const imageId = crypto.randomUUID();
  await getBucket().put(deckImageR2Key(deck.id, imageId), body, { httpMetadata: { contentType: mime } });
  const src = `/api/decks/${deck.id}/images/${imageId}`;
  return c.json({ src, url: `${base()}${src}` }, 201);
});
