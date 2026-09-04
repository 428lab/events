import { Hono } from "hono";
import { valid, zValidator } from "../lib/validator.js";
import { updateSubmissionInput } from "@eventer/shared";
import type { UpdateSubmissionInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { entriesRepo } from "../db/repositories/entries.js";

/**
 * Entry（成果物）への書き込み。
 *
 * 権限の軸がイベントのロールではなく **その Entry のメンバーか** なので、
 * `requireEventRole` を使う他のファイルとは別に置く。
 * 読み取り（一覧・集約）は未ログインでも通るので `eventsPublic.ts` にある。
 */
export const eventEntryRoutes = new Hono<AppEnv>();

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
      entryId,
      norm(input.presentationUrl),
      norm(input.sourceCodeUrl),
    );
    return c.json({ submission });
  },
);
