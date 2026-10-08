import { Hono } from "hono";
import { createDeckInput, updateDeckInput } from "@eventer/shared";
import type { CreateDeckInput, UpdateDeckInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { valid, zValidator } from "../lib/validator.js";
import { decksRepo } from "../db/repositories/decks.js";
import { eventLiveStateRepo } from "../db/repositories/eventLiveState.js";
import { publishLive } from "./liveControl.js";
import { putDeckImage } from "./deckImages.js";
import { postDeckImport } from "./deckImport.js";

/** /api/decks（作成・編集・削除・自分の一覧）。閲覧は /api/public/decks/:slug */
export const deckRoutes = new Hono<AppEnv>();
deckRoutes.use("*", requireAuth);
deckRoutes.post("/import", postDeckImport);

/** スライド画像アップロード（owner） */
deckRoutes.put("/:id/images", putDeckImage);

deckRoutes.get("/mine", async (c) => {
  return c.json({ decks: await decksRepo.listByOwner(c.get("user").id) });
});

deckRoutes.post("/", zValidator("json", createDeckInput), async (c) => {
  const deck = await decksRepo.create(
    valid<CreateDeckInput>(c, "json"),
    c.get("user").id,
  );
  return c.json(deck, 201);
});

/** 編集用に owner 本人のデッキを取得 */
deckRoutes.get("/:id", async (c) => {
  const deck = await decksRepo.findById(c.req.param("id"));
  if (!deck) return c.json({ error: "not_found" }, 404);
  if (deck.ownerId !== c.get("user").id) return c.json({ error: "forbidden" }, 403);
  return c.json(deck);
});

deckRoutes.patch("/:id", zValidator("json", updateDeckInput), async (c) => {
  const deck = await decksRepo.findById(c.req.param("id"));
  if (!deck) return c.json({ error: "not_found" }, 404);
  if (deck.ownerId !== c.get("user").id) return c.json({ error: "forbidden" }, 403);
  const updated = await decksRepo.update(
    deck.id,
    valid<UpdateDeckInput>(c, "json"),
  );
  return c.json(updated);
});

deckRoutes.delete("/:id", async (c) => {
  const deck = await decksRepo.findById(c.req.param("id"));
  if (!deck) return c.json({ error: "not_found" }, 404);
  if (deck.ownerId !== c.get("user").id) return c.json({ error: "forbidden" }, 403);
  // 配信中のデッキなら、消すと配信状態から外れる（FK）。開いている配信画面へ知らせる
  const liveEvents = await eventLiveStateRepo.eventIdsUsing("deck_id", deck.id);
  await decksRepo.delete(deck.id);
  if (liveEvents.length > 0) await publishLive(liveEvents);
  return c.json({ ok: true });
});
