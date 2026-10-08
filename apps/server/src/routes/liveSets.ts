import { Hono } from "hono";
import { createLiveSetInput, updateLiveSetInput, visualLiveSetContent } from "@eventer/shared";
import type { CreateLiveSetInput, UpdateLiveSetInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { valid, zValidator } from "../lib/validator.js";
import { liveSetsRepo } from "../db/repositories/liveSets.js";
import { eventLiveStateRepo } from "../db/repositories/eventLiveState.js";
import { publishLive } from "./liveControl.js";
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
  } else if (input.templateId) {
    baseContent = visualLiveSetContent(input.templateId);
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
  const input = valid<UpdateLiveSetInput>(c, "json");
  const hasVisualElements = liveSet.content.scenes.some(scene => scene.elements.some(el => !["text", "image", "camera", "deck", "eventInfo"].includes(el.type)));
  if (input.content && ((hasVisualElements && input.baseUpdatedAt === undefined) || (input.baseUpdatedAt !== undefined && input.baseUpdatedAt !== liveSet.updatedAt))) {
    return c.json({ error: "editor_outdated", message: "新しい部品を保護するため再読み込みしてください" }, 409);
  }
  const updated = await liveSetsRepo.update(liveSet.id, input);
  if (!updated) return c.json({ error: "editor_outdated" }, 409);
  return c.json(updated);
});

liveSetRoutes.delete("/:id", async (c) => {
  const liveSet = await liveSetsRepo.findById(c.req.param("id"));
  if (!liveSet) return c.json({ error: "not_found" }, 404);
  if (liveSet.ownerId !== c.get("user").id) {
    return c.json({ error: "forbidden" }, 403);
  }
  // 配信中の配信セットなら、消すと配信状態から外れる（FK）。開いている配信画面へ知らせる
  const liveEvents = await eventLiveStateRepo.eventIdsUsing("live_set_id", liveSet.id);
  await liveSetsRepo.delete(liveSet.id);
  if (liveEvents.length > 0) await publishLive(liveEvents);
  return c.json({ ok: true });
});
