import { Hono } from "hono";
import { createLiveSetInput, updateLiveSetInput } from "@eventer/shared";
import type { CreateLiveSetInput, UpdateLiveSetInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { valid, zValidator } from "../lib/validator.js";
import { liveSetsRepo } from "../db/repositories/liveSets.js";
import { putLiveSetImage } from "./liveSetImages.js";

/** /api/live-sets（配信セットの作成・編集・削除・自分の一覧）。decks と同じオーナーシップ */
export const liveSetRoutes = new Hono<AppEnv>();
liveSetRoutes.use("*", requireAuth);

/** シーン画像アップロード（owner） */
liveSetRoutes.put("/:id/images", putLiveSetImage);

liveSetRoutes.get("/mine", async (c) => {
  return c.json({ liveSets: await liveSetsRepo.listByOwner(c.get("user").id) });
});

liveSetRoutes.post("/", zValidator("json", createLiveSetInput), async (c) => {
  const input = valid<CreateLiveSetInput>(c, "json");
  // ベース指定時は自分のセットの中身を複製（未指定はビルトインテンプレ）
  let baseContent;
  if (input.baseLiveSetId) {
    const base = await liveSetsRepo.findById(input.baseLiveSetId);
    if (!base || base.ownerId !== c.get("user").id) {
      return c.json({ error: "base_not_found" }, 404);
    }
    baseContent = base.content;
  }
  const liveSet = await liveSetsRepo.create(input, c.get("user").id, baseContent);
  return c.json(liveSet, 201);
});

liveSetRoutes.get("/:id", async (c) => {
  const liveSet = await liveSetsRepo.findById(c.req.param("id"));
  if (!liveSet) return c.json({ error: "not_found" }, 404);
  if (liveSet.ownerId !== c.get("user").id) {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json(liveSet);
});

liveSetRoutes.patch("/:id", zValidator("json", updateLiveSetInput), async (c) => {
  const liveSet = await liveSetsRepo.findById(c.req.param("id"));
  if (!liveSet) return c.json({ error: "not_found" }, 404);
  if (liveSet.ownerId !== c.get("user").id) {
    return c.json({ error: "forbidden" }, 403);
  }
  const updated = await liveSetsRepo.update(
    liveSet.id,
    valid<UpdateLiveSetInput>(c, "json"),
  );
  return c.json(updated);
});

liveSetRoutes.delete("/:id", async (c) => {
  const liveSet = await liveSetsRepo.findById(c.req.param("id"));
  if (!liveSet) return c.json({ error: "not_found" }, 404);
  if (liveSet.ownerId !== c.get("user").id) {
    return c.json({ error: "forbidden" }, 403);
  }
  await liveSetsRepo.delete(liveSet.id);
  return c.json({ ok: true });
});
