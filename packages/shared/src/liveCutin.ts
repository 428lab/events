import { z } from "zod";
import type { EventLiveState } from "./liveSets.js";

export const cutinMessageSchema = z.string().transform(value => value.normalize("NFC").replace(/\p{Zs}+/gu, " ").trim()).pipe(
  z.string().min(1).max(40).refine(value => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]/u.test(value) && !/(?:https?:\/\/|www\.)/i.test(value), "invalid_cut_in_text"),
);
export const triggerCutinInput = z.object({ message: cutinMessageSchema });
export type CutinAction = { actionId: string; message: string; issuedAt: number; expiresAt: number };
export type CutinStatus = { action: CutinAction | null; serverNow: number };
/** GET /events/:id/live-state. The OBS screen reads the cut-in from this one 1 s poll
 * (D-POLL-MIN S7). `cutin` is null when the caller may not read cut-ins
 * (GET /live-cutin would answer 403: not a confirmed staff member). */
export type EventLiveStateWithCutin = EventLiveState & { cutin: CutinStatus | null };
