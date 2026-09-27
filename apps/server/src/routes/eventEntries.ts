import { Hono } from "hono";
import { valid, zValidator } from "../lib/validator.js";
import { updateSubmissionInput, selfEntryParticipationInput } from "@eventer/shared";
import type { UpdateSubmissionInput, SelfEntryParticipationInput } from "@eventer/shared";
import { isConfirmedEventStaff } from "../auth/roles.js";
import { eventsRepo } from "../db/repositories/events.js";
import type { AppEnv } from "../types.js";
import { entriesRepo } from "../db/repositories/entries.js";

/**
 * Entry（成果物）への書き込み。
 *
 * 成果物保存は **その Entry のメンバーか**、採点対象参加は **staff 本人か** で認可する。
 * 読み取り（一覧・集約）は未ログインでも通るので `eventsPublic.ts` にある。
 */
export const eventEntryRoutes = new Hono<AppEnv>();

/** 運営本人の採点対象参加。通常参加登録・取消とは分離する。 */
eventEntryRoutes.put(
  "/:id/entries/self/participation",
  zValidator("json", selfEntryParticipationInput),
  async (c) => {
    const eventId = c.req.param("id");
    const userId = c.get("user").id;
    if (!(await isConfirmedEventStaff(eventId, userId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const event = await eventsRepo.findById(eventId);
    if (!event?.contestMode || event.participationType !== "individual") {
      return c.json({ error: "participation_unavailable" }, 409);
    }
    const { participating } = valid<SelfEntryParticipationInput>(c, "json");
    const entry = await entriesRepo.setSelfParticipation(eventId, userId, participating);
    return c.json({ entry });
  },
);

/** 自分の Entry の成果物を保存（その Entry の member のみ） */
eventEntryRoutes.put(
  "/:id/entries/:entryId/submission",
  zValidator("json", updateSubmissionInput),
  async (c) => {
    const user = c.get("user");
    const entryId = c.req.param("entryId");
    const entry = await entriesRepo.findById(entryId);
    // その Entry がこのイベントのものであることを確かめる（親の所有の確認）
    if (!entry || entry.eventId !== c.req.param("id")) {
      return c.json({ error: "not_found" }, 404);
    }
    if (!(await entriesRepo.isMember(entryId, user.id))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const input = valid<UpdateSubmissionInput>(c, "json");
    const norm = (v: string | null | undefined) => (v ? v : null);
    const submission = await entriesRepo.upsertSubmission(
      entry.eventId,
      entryId,
      user.id,
      norm(input.presentationUrl),
      norm(input.sourceCodeUrl),
    );
    if (!submission) return c.json({ error: "access_changed" }, 409);
    return c.json({ submission });
  },
);
