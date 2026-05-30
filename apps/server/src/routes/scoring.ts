import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  createCriterionInput,
  putScoreInput,
  setModeInput,
  setPresentingInput,
  updateCriterionInput,
} from "@eventer/shared";
import type {
  CreateCriterionInput,
  PutScoreInput,
  SetModeInput,
  SetPresentingInput,
  UpdateCriterionInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth, currentUser } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventsRepo } from "../db/repositories/events.js";
import { entriesRepo } from "../db/repositories/entries.js";
import { scoringCriteriaRepo } from "../db/repositories/scoringCriteria.js";
import { scoresRepo } from "../db/repositories/scores.js";
import { eventStateRepo } from "../db/repositories/eventState.js";
import { sseHub } from "../sse/hub.js";

export const scoringRoutes = new Hono<AppEnv>();

/** ===== SSE（cookie 認証。requireAuth より前に定義） ===== */
scoringRoutes.get("/:id/stream", (c) => {
  const user = currentUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const eventId = c.req.param("id");

  return streamSSE(c, async (stream) => {
    // 接続直後に現在の状態を送る
    await stream.writeSSE({
      event: "state",
      data: JSON.stringify(eventStateRepo.getOrInit(eventId)),
    });

    const unsubscribe = sseHub.subscribe(eventId, (event, data) => {
      void stream.writeSSE({ event, data: JSON.stringify(data) });
    });

    // keep-alive（Cloudflare Tunnel のタイムアウト対策）
    const ping = setInterval(() => {
      void stream.writeSSE({ event: "ping", data: "1" });
    }, 25000);

    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        clearInterval(ping);
        unsubscribe();
        resolve();
      });
    });
  });
});

scoringRoutes.use("*", requireAuth);

/** ===== 採点項目 ===== */
scoringRoutes.get("/:id/criteria", (c) => {
  return c.json({ criteria: scoringCriteriaRepo.listByEvent(c.req.param("id")) });
});

scoringRoutes.post(
  "/:id/criteria",
  requireEventRole(["staff"]),
  zValidator("json", createCriterionInput),
  (c) => {
    const criterion = scoringCriteriaRepo.create(
      c.req.param("id"),
      valid<CreateCriterionInput>(c, "json"),
    );
    return c.json({ criterion }, 201);
  },
);

scoringRoutes.patch(
  "/:id/criteria/:cid",
  requireEventRole(["staff"]),
  zValidator("json", updateCriterionInput),
  (c) => {
    const criterion = scoringCriteriaRepo.update(
      c.req.param("cid"),
      valid<UpdateCriterionInput>(c, "json"),
    );
    if (!criterion) return c.json({ error: "not_found" }, 404);
    return c.json({ criterion });
  },
);

scoringRoutes.delete("/:id/criteria/:cid", requireEventRole(["staff"]), (c) => {
  scoringCriteriaRepo.delete(c.req.param("cid"));
  return c.json({ ok: true });
});

/** ===== 採点 ===== */
scoringRoutes.get("/:id/scores/mine", (c) => {
  const user = c.get("user");
  return c.json({ scores: scoresRepo.listForJudge(c.req.param("id"), user.id) });
});

scoringRoutes.put(
  "/:id/scores",
  requireEventRole(["participant", "judge", "staff"]),
  zValidator("json", putScoreInput),
  (c) => {
    const user = c.get("user");
    const eventId = c.req.param("id");
    const event = eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);

    const state = eventStateRepo.getOrInit(eventId);
    if (state.scoringLocked) return c.json({ error: "scoring_locked" }, 409);

    const input = valid<PutScoreInput>(c, "json");
    const entry = entriesRepo.findById(input.entryId);
    if (!entry || entry.eventId !== eventId) {
      return c.json({ error: "entry_not_found" }, 404);
    }
    // 自己採点制限
    if (!event.aggregateSelfEntry && entriesRepo.isMember(input.entryId, user.id)) {
      return c.json({ error: "self_scoring_forbidden" }, 403);
    }
    scoresRepo.upsert(
      eventId,
      input.entryId,
      input.criterionId,
      user.id,
      input.value,
    );
    sseHub.broadcast(eventId, "score-progress", {
      entryId: input.entryId,
      judgeUserId: user.id,
    });
    return c.json({ ok: true });
  },
);

scoringRoutes.get(
  "/:id/scores/summary",
  requireEventRole(["staff", "judge"]),
  (c) => {
    const eventId = c.req.param("id");
    const event = eventsRepo.findById(eventId)!;
    return c.json(scoresRepo.summary(eventId, event.aggregateSelfEntry));
  },
);

scoringRoutes.get(
  "/:id/scores/progress",
  requireEventRole(["staff"]),
  (c) => {
    const eventId = c.req.param("id");
    const event = eventsRepo.findById(eventId)!;
    return c.json({
      judges: scoresRepo.progress(
        eventId,
        ["participant", "judge", "staff"],
        event.aggregateSelfEntry,
      ),
    });
  },
);

/** ===== 進行（モード/プレゼン/締切） ===== */
scoringRoutes.get("/:id/state", (c) => {
  return c.json(eventStateRepo.getOrInit(c.req.param("id")));
});

scoringRoutes.patch(
  "/:id/state/mode",
  requireEventRole(["staff"]),
  zValidator("json", setModeInput),
  (c) => {
    const eventId = c.req.param("id");
    const state = eventStateRepo.setMode(
      eventId,
      valid<SetModeInput>(c, "json").mode,
    );
    sseHub.broadcast(eventId, "state", state);
    return c.json(state);
  },
);

scoringRoutes.patch(
  "/:id/state/presenting",
  requireEventRole(["staff"]),
  zValidator("json", setPresentingInput),
  (c) => {
    const eventId = c.req.param("id");
    const state = eventStateRepo.setPresenting(
      eventId,
      valid<SetPresentingInput>(c, "json").presentingEntryId,
    );
    sseHub.broadcast(eventId, "state", state);
    return c.json(state);
  },
);

scoringRoutes.post(
  "/:id/state/scoring-lock",
  requireEventRole(["staff"]),
  (c) => {
    const eventId = c.req.param("id");
    const current = eventStateRepo.getOrInit(eventId);
    const state = eventStateRepo.setScoringLocked(eventId, !current.scoringLocked);
    sseHub.broadcast(eventId, "state", state);
    return c.json(state);
  },
);
