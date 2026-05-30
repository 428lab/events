import { Hono } from "hono";
import type { Context } from "hono";
import {
  createAwardRankInput,
  createSpecialAwardInput,
  setAwardResultInput,
  updateAwardRankInput,
} from "@eventer/shared";
import type {
  AwardResultView,
  CreateAwardRankInput,
  CreateSpecialAwardInput,
  SetAwardResultInput,
  UpdateAwardRankInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { currentUser, requireAuth } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { awardsRepo } from "../db/repositories/awards.js";
import { scoresRepo } from "../db/repositories/scores.js";
import { eventStateRepo } from "../db/repositories/eventState.js";
import { sseHub } from "../sse/hub.js";

export const awardRoutes = new Hono<AppEnv>();

function canView(eventId: string, c: Context): boolean {
  const event = eventsRepo.findById(eventId);
  if (!event) return false;
  if (event.status === "published") return true;
  const user = currentUser(c);
  if (!user) return false;
  if (isAppAdmin(user)) return true;
  return Boolean(eventMembersRepo.find(eventId, user.id));
}

/** 公開: 表彰内容（公開イベントは未ログイン可。集計値付き）。
 * eventRoutes のブランケット requireAuth を避けるため api に直接登録する。 */
export function getEventAwards(c: Context) {
  const eventId = c.req.param("id")!;
  const event = eventsRepo.findById(eventId);
  if (!event) return c.json({ error: "not_found" }, 404);
  if (!canView(eventId, c)) return c.json({ error: "forbidden" }, 403);

  const summary = scoresRepo.summary(eventId, event.aggregateSelfEntry);
  const scoreByEntry = new Map(summary.entries.map((e) => [e.entryId, e]));
  const ranks = awardsRepo.listRanks(eventId);
  const specials = awardsRepo.listSpecials(eventId);
  const results: AwardResultView[] = awardsRepo.listResults(eventId).map((r) => {
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
  (c) =>
    c.json(
      {
        rank: awardsRepo.createRank(
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
  (c) => {
    const rank = awardsRepo.updateRank(
      c.req.param("rankId"),
      valid<UpdateAwardRankInput>(c, "json"),
    );
    if (!rank) return c.json({ error: "not_found" }, 404);
    return c.json({ rank });
  },
);
awardRoutes.delete("/:id/award-ranks/:rankId", requireEventRole(["staff"]), (c) => {
  awardsRepo.deleteRank(c.req.param("rankId"));
  return c.json({ ok: true });
});

/* 特別枠 CRUD */
awardRoutes.post(
  "/:id/special-awards",
  requireEventRole(["staff"]),
  zValidator("json", createSpecialAwardInput),
  (c) =>
    c.json(
      {
        special: awardsRepo.createSpecial(
          c.req.param("id"),
          valid<CreateSpecialAwardInput>(c, "json"),
        ),
      },
      201,
    ),
);
awardRoutes.delete(
  "/:id/special-awards/:specialId",
  requireEventRole(["staff"]),
  (c) => {
    awardsRepo.deleteSpecial(c.req.param("specialId"));
    return c.json({ ok: true });
  },
);

/* 受賞者割当（ランク or 特別枠） */
awardRoutes.put(
  "/:id/award-results",
  requireEventRole(["staff"]),
  zValidator("json", setAwardResultInput),
  (c) => {
    const eventId = c.req.param("id");
    const input = valid<SetAwardResultInput>(c, "json");
    if (input.awardRankId) {
      awardsRepo.setRankWinner(eventId, input.awardRankId, input.entryId);
    } else if (input.specialAwardId) {
      awardsRepo.setSpecialWinner(eventId, input.specialAwardId, input.entryId);
    } else {
      return c.json({ error: "rank_or_special_required" }, 400);
    }
    return c.json({ ok: true });
  },
);

/* 表彰の段階発表 */
awardRoutes.post("/:id/state/awards-advance", requireEventRole(["staff"]), (c) => {
  const eventId = c.req.param("id");
  const cur = eventStateRepo.getOrInit(eventId).awardsRevealCursor ?? 0;
  const state = eventStateRepo.setAwardsCursor(eventId, cur + 1);
  sseHub.broadcast(eventId, "state", state);
  return c.json(state);
});
awardRoutes.post("/:id/state/awards-reset", requireEventRole(["staff"]), (c) => {
  const state = eventStateRepo.setAwardsCursor(c.req.param("id"), 0);
  sseHub.broadcast(c.req.param("id"), "state", state);
  return c.json(state);
});
