import { Hono } from "hono";
import type { Context } from "hono";
import {
  createCriterionInput,
  putScoresBatchInput,
  setModeInput,
  setPresentingInput,
  updateCriterionInput,
} from "@eventer/shared";
import type {
  CreateCriterionInput,
  PutScoresBatchInput,
  SetModeInput,
  SetPresentingInput,
  UpdateCriterionInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { currentUser } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventsRepo } from "../db/repositories/events.js";
import { entriesRepo } from "../db/repositories/entries.js";
import { scoringCriteriaRepo } from "../db/repositories/scoringCriteria.js";
import { scoresRepo } from "../db/repositories/scores.js";
import { eventStateRepo } from "../db/repositories/eventState.js";
import { eventSignal } from "../lib/eventSignal.js";
import { deferBackground } from "../runtime.js";
import { recordAudit } from "../db/repositories/auditLogs.js";
import { HTTPException } from "hono/http-exception";

export const scoringRoutes = new Hono<AppEnv>();

/** 進行状態（モード・発表中・締切・表彰の段階）が変わったことを、開いているイベント画面へ送る
 * （topic `event-state`、D-POLL-MIN 第5段階 5b-3）。表彰の advance/reset も使う */
export function publishEventState(eventId: string): Promise<void> {
  return deferBackground(eventSignal.publishRefetch([["event-state", eventId]]));
}

/** 採点の進捗・集計が変わったことを /control へ送る（topic `scores`、staff の画面だけが知る）。
 * 採点の提出は審査員がまとめて押すので throttle を通す */
function publishScores(eventId: string, throttled = false): Promise<void> {
  return deferBackground(throttled
    ? eventSignal.publishRefetchThrottled([["scores", eventId]])
    : eventSignal.publishRefetch([["scores", eventId]]));
}

/**
 * 公開: 採点結果一覧（集計）。採点締切後またはイベント終了後のみ閲覧可。
 * 公開イベントは未ログイン可、非公開はメンバー/管理者のみ。
 * eventRoutes のブランケット requireAuth を避けるため api に直接登録する。
 */
export async function getEventScoreResults(c: Context) {
  const eventId = c.req.param("id")!;
  const event = await eventsRepo.findById(eventId);
  if (!event) return c.json({ error: "not_found" }, 404);
  if (event.status !== "published") {
    const user = await currentUser(c);
    if (
      !user ||
      (!isAppAdmin(user) && !(await eventMembersRepo.find(eventId, user.id)))
    ) {
      return c.json({ error: "forbidden" }, 403);
    }
  }
  const state = await eventStateRepo.getOrInit(eventId);
  // 日程調整中（endsAt未確定=0）は「終了済み」扱いにしない
  const ended = !event.scheduling && event.endsAt < Date.now();
  const available = state.scoringLocked || ended;
  if (!available) {
    return c.json({ available: false, criteria: [], entries: [] });
  }
  const summary = await scoresRepo.summary(eventId, event.aggregateSelfEntry);
  return c.json({ available: true, ...summary });
}

// 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)

/* 採点項目 (/criteria) と進行状態 (/state) の GET は「そのイベントを見てよい人」に限る。
 * 下書きのイベントIDは招待された人にも渡る (#339) ので、メンバーでない人に
 * 採点項目名や進行状態を読ませない（イベント詳細 GET と同じ基準）。判定は共通門
 * (requireEventAccess) が同じリクエストで済ませ、見えない相手には 404 を返している。
 * ここでイベントを読み直して判定を重ねない (D-POLL-MIN S3) */

/** ===== 採点項目 ===== */
scoringRoutes.get("/:id/criteria", async (c) => {
  return c.json({ criteria: await scoringCriteriaRepo.listByEvent(c.req.param("id")) });
});

scoringRoutes.post(
  "/:id/criteria",
  requireEventRole(["staff"]),
  zValidator("json", createCriterionInput),
  async (c) => {
    const criterion = await scoringCriteriaRepo.create(
      c.req.param("id"),
      valid<CreateCriterionInput>(c, "json"), {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"manager"});
    await publishScores(c.req.param("id"));
    return c.json({ criterion }, 201);
  },
);

scoringRoutes.patch(
  "/:id/criteria/:cid",
  requireEventRole(["staff"]),
  zValidator("json", updateCriterionInput),
  async (c) => {
    const existing = await scoringCriteriaRepo.findById(c.req.param("cid"));
    if (!existing || existing.eventId !== c.req.param("id")) {
      return c.json({ error: "not_found" }, 404);
    }
    const criterion = await scoringCriteriaRepo.update(
      c.req.param("cid"),
      valid<UpdateCriterionInput>(c, "json"), {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"manager"});
    if (!criterion) return c.json({ error: "not_found" }, 404);
    await publishScores(c.req.param("id"));
    return c.json({ criterion });
  },
);

scoringRoutes.delete("/:id/criteria/:cid", requireEventRole(["staff"]), async (c) => {
  const existing = await scoringCriteriaRepo.findById(c.req.param("cid"));
  if (!existing || existing.eventId !== c.req.param("id")) {
    return c.json({ error: "not_found" }, 404);
  }
  await scoringCriteriaRepo.delete(c.req.param("cid"), {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"manager"});
  await publishScores(c.req.param("id"));
  return c.json({ ok: true });
});

/** ===== 採点 ===== */
scoringRoutes.get("/:id/scores/mine", async (c) => {
  const user = c.get("user");
  return c.json({ scores: await scoresRepo.listForJudge(c.req.param("id"), user.id) });
});

/** 採点の保存（「採点を保存」）。1つのエントリーの点数をまとめて1リクエスト・1バッチで書く。
 * 点数を押すたびには通信しない（書き込み回数を使わない）。運営が「採点を開始する」まで、
 * また締切後は受け付けない（オーナー決定 2026-11-08） */
scoringRoutes.put(
  "/:id/scores/batch",
  requireEventRole(["participant", "judge", "staff"]),
  zValidator("json", putScoresBatchInput),
  async (c) => {
    const user = c.get("user");
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);

    const state = await eventStateRepo.getOrInit(eventId);
    if (!state.scoringStarted) return c.json({ error: "scoring_not_started" }, 409);
    if (state.scoringLocked) return c.json({ error: "scoring_locked" }, 409);

    const input = valid<PutScoresBatchInput>(c, "json");
    // いま使う種類のエントリーだけ採点できる（チーム参加ならチーム、それ以外は個人。#9）
    const entry = await entriesRepo.findActive(eventId, input.entryId);
    if (!entry) return c.json({ error: "entry_not_found" }, 404);
    const criteria = new Set((await scoringCriteriaRepo.listByEvent(eventId)).map((cr) => cr.id));
    if (input.scores.some((s) => !criteria.has(s.criterionId))) {
      return c.json({ error: "criterion_not_found" }, 404);
    }
    // 自己採点制限
    if (!event.aggregateSelfEntry && (await entriesRepo.isMember(input.entryId, user.id))) {
      return c.json({ error: "self_scoring_forbidden" }, 403);
    }
    try {
      await scoresRepo.upsertMany(eventId, input.entryId, user.id, input.scores,
        { eventId, actorId: user.id, permission: "scorer" });
    } catch (error) {
      // 読んでから書くまでの間に締め切られた・未開始に戻された
      if (`${String(error)} ${String((error as Error)?.cause)}`.includes("scoring_not_open")) {
        throw new HTTPException(409, { res: Response.json({ error: "scoring_not_open" }, { status: 409 }) });
      }
      throw error;
    }
    await publishScores(eventId, true);
    return c.json({ ok: true });
  },
);

/** 集計。定期には取り直さず、`signal`（topic `scores`）の合図で /control が取り直す
 * （D-POLL-MIN 第5段階 5b-3）。進捗（/scores/progress）も同じ合図で取り直す */
scoringRoutes.get(
  "/:id/scores/summary",
  requireEventRole(["staff", "judge"]),
  async (c) => {
    const eventId = c.req.param("id");
    const readAt = Date.now();
    const event = (await eventsRepo.findById(eventId))!;
    const summary = await scoresRepo.summary(eventId, event.aggregateSelfEntry);
    return c.json({ ...summary, signal: await eventSignal.source(eventId, "scores", readAt) });
  },
);

scoringRoutes.get(
  "/:id/scores/progress",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    const event = (await eventsRepo.findById(eventId))!;
    return c.json({
      judges: await scoresRepo.progress(
        eventId,
        ["participant", "judge", "staff"],
        event.aggregateSelfEntry,
      ),
    });
  },
);

/** ===== 進行（モード/プレゼン/締切） =====
 * 定期には取り直さず、`signal`（topic `event-state`）の合図で取り直す（D-POLL-MIN 第5段階 5b-3）。
 * 閲覧できる人なら誰でも受け取る（応答と同じ範囲） */
scoringRoutes.get("/:id/state", async (c) => {
  const eventId = c.req.param("id");
  const readAt = Date.now();
  const state = await eventStateRepo.getOrInit(eventId);
  return c.json({ ...state, signal: await eventSignal.source(eventId, "event-state", readAt) });
});

scoringRoutes.patch(
  "/:id/state/mode",
  requireEventRole(["staff"]),
  zValidator("json", setModeInput),
  async (c) => {
    const eventId = c.req.param("id");
    const state = await eventStateRepo.setMode(
      eventId,
      valid<SetModeInput>(c, "json").mode, {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"manager"});
    await publishEventState(eventId);
    return c.json(state);
  },
);

scoringRoutes.patch(
  "/:id/state/presenting",
  requireEventRole(["staff"]),
  zValidator("json", setPresentingInput),
  async (c) => {
    const eventId = c.req.param("id");
    const { presentingEntryId } = valid<SetPresentingInput>(c, "json");
    // 発表中に指定できるのは、このイベントでいま使う種類のエントリーだけ (#9)
    if (presentingEntryId && !(await entriesRepo.findActive(eventId, presentingEntryId))) {
      return c.json({ error: "entry_not_found" }, 404);
    }
    const state = await eventStateRepo.setPresenting(
      eventId,
      presentingEntryId, {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"manager"});
    await publishEventState(eventId);
    return c.json(state);
  },
);

/** 採点を開始する（受付中にする）。押すまで採点は受け付けない */
scoringRoutes.post(
  "/:id/state/scoring-start",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    const state = await eventStateRepo.startScoring(eventId, {eventId,actorId:c.get("user").id,permission:"manager"});
    await publishEventState(eventId);
    return c.json(state);
  },
);

/** 採点結果をすべて消し、採点を未開始・締切なしに戻す（運営）。試しに入れた点を消したいとき・
 * チームを組み直したいときに使う。受賞の割り当て（award_result）は消さない（集計だけが変わる）。
 * 監査ログに件数を残す */
scoringRoutes.delete(
  "/:id/scores",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    const user = c.get("user");
    await eventStateRepo.getOrInit(eventId);
    const deleted = await scoresRepo.resetAll(eventId, {eventId,actorId:user.id,permission:"manager"});
    await recordAudit({
      action: "scores_reset",
      actor: { id: user.id, handle: user.username },
      detail: { eventId, deleted },
    });
    await publishScores(eventId);
    await publishEventState(eventId);
    return c.json({ deleted, state: await eventStateRepo.getOrInit(eventId) });
  },
);

scoringRoutes.post(
  "/:id/state/scoring-lock",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    const current = await eventStateRepo.getOrInit(eventId);
    const state = await eventStateRepo.setScoringLocked(eventId, !current.scoringLocked, {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"manager"});
    await publishEventState(eventId);
    return c.json(state);
  },
);
