import { Hono } from "hono";
import { createCommunityInput, RESERVED_COMMUNITY_SLUGS } from "@eventer/shared";
import type { CreateCommunityInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { valid, zValidator } from "../lib/validator.js";
import { communitiesRepo } from "../db/repositories/communities.js";

/** /api/communities（作成・参加・自分の主催コミュニティ）。閲覧系は /api/public/communities */
export const communityRoutes = new Hono<AppEnv>();
communityRoutes.use("*", requireAuth);

/** イベント紐付け候補：自分がオーナー/運営のコミュニティ */
communityRoutes.get("/mine", async (c) => {
  return c.json({
    communities: await communitiesRepo.listOwnedByUser(c.get("user").id),
  });
});

communityRoutes.post("/", zValidator("json", createCommunityInput), async (c) => {
  const input = valid<CreateCommunityInput>(c, "json");
  const slug = input.slug.toLowerCase();
  if (RESERVED_COMMUNITY_SLUGS.includes(slug)) {
    return c.json({ error: "reserved" }, 400);
  }
  if (await communitiesRepo.slugTaken(slug)) {
    return c.json({ error: "taken" }, 409);
  }
  const community = await communitiesRepo.create(
    { ...input, slug },
    c.get("user").id,
  );
  return c.json(community, 201);
});

communityRoutes.post("/:id/membership", async (c) => {
  await communitiesRepo.join(c.req.param("id"), c.get("user").id);
  return c.json({ ok: true });
});

communityRoutes.delete("/:id/membership", async (c) => {
  await communitiesRepo.leave(c.req.param("id"), c.get("user").id);
  return c.json({ ok: true });
});
