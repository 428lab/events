import { Hono } from "hono";
import {
  createCommunityInput,
  setCommunityRoleInput,
  transferOwnershipInput,
  updateCommunityInput,
  RESERVED_COMMUNITY_SLUGS,
} from "@eventer/shared";
import type {
  CreateCommunityInput,
  SetCommunityRoleInput,
  TransferOwnershipInput,
  UpdateCommunityInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";
import { valid, zValidator } from "../lib/validator.js";
import { kpiPeriodFromQuery } from "../lib/kpiPeriod.js";
import { communitiesRepo } from "../db/repositories/communities.js";
import { communityKpiRepo } from "../db/repositories/communityKpi.js";
import { putCommunityImage } from "./communityImages.js";

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

/** 編集（owner/admin） */
communityRoutes.patch(
  "/:id",
  zValidator("json", updateCommunityInput),
  async (c) => {
    const id = c.req.param("id");
    if (!(await communitiesRepo.isManager(id, c.get("user").id))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const updated = await communitiesRepo.update(
      id,
      valid<UpdateCommunityInput>(c, "json"),
    );
    if (!updated) return c.json({ error: "not_found" }, 404);
    return c.json(updated);
  },
);

/** 削除（owner のみ） */
communityRoutes.delete("/:id", async (c) => {
  const community = await communitiesRepo.findById(c.req.param("id"));
  if (!community) return c.json({ error: "not_found" }, 404);
  if (community.ownerId !== c.get("user").id) {
    return c.json({ error: "forbidden" }, 403);
  }
  await communitiesRepo.delete(community.id);
  return c.json({ ok: true });
});

/** メンバーのロール変更 admin↔member（owner のみ。owner自身は対象外） */
communityRoutes.put(
  "/:id/members/:userId/role",
  zValidator("json", setCommunityRoleInput),
  async (c) => {
    const id = c.req.param("id");
    const targetUserId = c.req.param("userId");
    const community = await communitiesRepo.findById(id);
    if (!community) return c.json({ error: "not_found" }, 404);
    if (community.ownerId !== c.get("user").id) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (targetUserId === community.ownerId) {
      return c.json({ error: "cannot_change_owner" }, 400);
    }
    await communitiesRepo.setMemberRole(
      id,
      targetUserId,
      valid<SetCommunityRoleInput>(c, "json").role,
    );
    return c.json({ ok: true });
  },
);

/** コミュニティ別KPI (#262)。そのコミュニティの owner/admin か運営管理者のみ。
 * 一般公開はしない（一般メンバー・非メンバーは 403） */
communityRoutes.get("/:id/kpi", async (c) => {
  const id = c.req.param("id");
  const community = await communitiesRepo.findById(id);
  if (!community) return c.json({ error: "not_found" }, 404);
  const user = c.get("user");
  const allowed =
    isAppAdmin(user) || (await communitiesRepo.isManager(id, user.id));
  if (!allowed) return c.json({ error: "forbidden" }, 403);

  const { days, sinceDay, prevSinceDay } = kpiPeriodFromQuery(c);
  return c.json(
    await communityKpiRepo.overview(
      { id: community.id, slug: community.slug, name: community.name },
      sinceDay,
      prevSinceDay,
      days,
    ),
  );
});

/** アイコン/バナー画像のアップロード（owner/admin。生バイナリ） */
communityRoutes.put("/:id/icon", putCommunityImage("icon"));
communityRoutes.put("/:id/banner", putCommunityImage("banner"));

/** オーナー譲渡（owner のみ。譲渡先は admin であること） */
communityRoutes.post(
  "/:id/transfer",
  zValidator("json", transferOwnershipInput),
  async (c) => {
    const id = c.req.param("id");
    const me = c.get("user").id;
    const community = await communitiesRepo.findById(id);
    if (!community) return c.json({ error: "not_found" }, 404);
    if (community.ownerId !== me) return c.json({ error: "forbidden" }, 403);
    const { toUserId } = valid<TransferOwnershipInput>(c, "json");
    if ((await communitiesRepo.memberRole(id, toUserId)) !== "admin") {
      return c.json({ error: "target_not_admin" }, 400);
    }
    await communitiesRepo.transferOwnership(id, me, toUserId);
    return c.json({ ok: true });
  },
);
