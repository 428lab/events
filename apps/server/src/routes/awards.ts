import { Hono } from "hono";
import type { Context } from "hono";
import {
  createAwardRankInput,
  createSpecialAwardInput,
  setAwardResultInput,
  updateAwardRankInput,
  updateSpecialAwardInput,
} from "@eventer/shared";
import type {
  AwardResultView,
  CreateAwardRankInput,
  CreateSpecialAwardInput,
  SetAwardResultInput,
  UpdateAwardRankInput,
  UpdateSpecialAwardInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { currentUser, requireAuth } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { awardsRepo } from "../db/repositories/awards.js";
import { entriesRepo } from "../db/repositories/entries.js";
import { notificationsRepo } from "../db/repositories/notifications.js";
import { scoresRepo } from "../db/repositories/scores.js";
import { eventStateRepo } from "../db/repositories/eventState.js";
import { sseHub } from "../sse/hub.js";

export const awardRoutes = new Hono<AppEnv>();

async function canView(eventId: string, c: Context): Promise<boolean> {
  const event = await eventsRepo.findById(eventId);
  if (!event) return false;
  if (event.status === "published") return true;
  const user = await currentUser(c);
  if (!user) return false;
  if (isAppAdmin(user)) return true;
  return Boolean(await eventMembersRepo.find(eventId, user.id));
}

/** 公開: 表彰内容（公開イベントは未ログイン可。集計値付き）。
 * eventRoutes のブランケット requireAuth を避けるため api に直接登録する。 */
export async function getEventAwards(c: Context) {
  const eventId = c.req.param("id")!;
  const event = await eventsRepo.findById(eventId);
  if (!event) return c.json({ error: "not_found" }, 404);
  if (!(await canView(eventId, c))) return c.json({ error: "forbidden" }, 403);

  const summary = await scoresRepo.summary(eventId, event.aggregateSelfEntry);
  const scoreByEntry = new Map(summary.entries.map((e) => [e.entryId, e]));
  const ranks = await awardsRepo.listRanks(eventId);
  const specials = await awardsRepo.listSpecials(eventId);
  const results: AwardResultView[] = (await awardsRepo.listResults(eventId)).map((r) => {
    const s = scoreByEntry.get(r.entry_id);
    return {
      id: r.id,
      entryId: r.entry_id,
      entryName: s?.entryName ?? "?",
      awardRankId: r.award_rank_id,
      specialAwardId: r.special_award_id,
      total: s?.total ?? 0,
      perCriterion: s?.perCriterion ?? {},
    };
  });
  return c.json({ ranks, specials, criteria: summary.criteria, results });
}

awardRoutes.use("*", requireAuth);

/* ランク賞 CRUD */
awardRoutes.post(
  "/:id/award-ranks",
  requireEventRole(["staff"]),
  zValidator("json", createAwardRankInput),
  async (c) =>
    c.json(
      {
        rank: await awardsRepo.createRank(
          c.req.param("id"),
          valid<CreateAwardRankInput>(c, "json"),
        ),
      },
      201,
    ),
);
awardRoutes.patch(
  "/:id/award-ranks/:rankId",
  requireEventRole(["staff"]),
  zValidator("json", updateAwardRankInput),
  async (c) => {
    const rank = await awardsRepo.updateRank(
      c.req.param("rankId"),
      valid<UpdateAwardRankInput>(c, "json"),
    );
    if (!rank) return c.json({ error: "not_found" }, 404);
    return c.json({ rank });
  },
);
awardRoutes.delete("/:id/award-ranks/:rankId", requireEventRole(["staff"]), async (c) => {
  await awardsRepo.deleteRank(c.req.param("rankId"));
  return c.json({ ok: true });
});

/* 特別枠 CRUD */
awardRoutes.post(
  "/:id/special-awards",
  requireEventRole(["staff"]),
  zValidator("json", createSpecialAwardInput),
  async (c) =>
    c.json(
      {
        special: await awardsRepo.createSpecial(
          c.req.param("id"),
          valid<CreateSpecialAwardInput>(c, "json"),
        ),
      },
      201,
    ),
);
awardRoutes.patch(
  "/:id/special-awards/:specialId",
  requireEventRole(["staff"]),
  zValidator("json", updateSpecialAwardInput),
  async (c) => {
    const special = await awardsRepo.updateSpecial(
      c.req.param("specialId"),
      valid<UpdateSpecialAwardInput>(c, "json"),
    );
    if (!special) return c.json({ error: "not_found" }, 404);
    return c.json({ special });
  },
);
awardRoutes.delete(
  "/:id/special-awards/:specialId",
  requireEventRole(["staff"]),
  async (c) => {
    await awardsRepo.deleteSpecial(c.req.param("specialId"));
    return c.json({ ok: true });
  },
);

/* 受賞者割当（ランク or 特別枠） */
awardRoutes.put(
  "/:id/award-results",
  requireEventRole(["staff"]),
  zValidator("json", setAwardResultInput),
  async (c) => {
    const eventId = c.req.param("id");
    const input = valid<SetAwardResultInput>(c, "json");
    if (input.awardRankId) {
      await awardsRepo.setRankWinner(eventId, input.awardRankId, input.entryId);
    } else if (input.specialAwardId) {
      await awardsRepo.setSpecialWinner(eventId, input.specialAwardId, input.entryId);
    } else {
      return c.json({ error: "rank_or_special_required" }, 400);
    }
    return c.json({ ok: true });
  },
);

/* 受賞者へアプリ内通知（staff のみ。発表後に明示的に押す＝ネタバレ防止） */
awardRoutes.post(
  "/:id/award-results/notify",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);

    const ranks = await awardsRepo.listRanks(eventId);
    const specials = await awardsRepo.listSpecials(eventId);
    const rankName = new Map(ranks.map((r) => [r.id, r.name]));
    const specialName = new Map(specials.map((s) => [s.id, s.name]));
    const results = await awardsRepo.listResults(eventId);
    const link = `/events/${eventId}/results`;

    const notified = new Set<string>();
    for (const r of results) {
      const awardName = r.award_rank_id
        ? rankName.get(r.award_rank_id)
        : r.special_award_id
          ? specialName.get(r.special_award_id)
          : undefined;
      if (!awardName) continue;
      const entry = await entriesRepo.findById(r.entry_id);
      if (!entry) continue;
      for (const uid of entry.memberUserIds) {
        await notificationsRepo.create(
          uid,
          "award",
          "受賞おめでとうございます🎉",
          `「${event.title}」で${awardName}を受賞しました`,
          link,
        );
        notified.add(uid);
      }
    }
    return c.json({ notified: notified.size });
  },
);

/* 表彰の段階発表 */
awardRoutes.post("/:id/state/awards-advance", requireEventRole(["staff"]), async (c) => {
  const eventId = c.req.param("id");
  const cur = (await eventStateRepo.getOrInit(eventId)).awardsRevealCursor ?? 0;
  const state = await eventStateRepo.setAwardsCursor(eventId, cur + 1);
  sseHub.broadcast(eventId, "state", state);
  return c.json(state);
});
awardRoutes.post("/:id/state/awards-reset", requireEventRole(["staff"]), async (c) => {
  const state = await eventStateRepo.setAwardsCursor(c.req.param("id"), 0);
  sseHub.broadcast(c.req.param("id"), "state", state);
  return c.json(state);
});
