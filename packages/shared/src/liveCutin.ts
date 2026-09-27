import { z } from "zod";

export const cutinMessageSchema = z.string().transform(value => value.normalize("NFC").replace(/\p{Zs}+/gu, " ").trim()).pipe(
  z.string().min(1).max(40).refine(value => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]/u.test(value) && !/(?:https?:\/\/|www\.)/i.test(value), "invalid_cut_in_text"),
);
export const triggerCutinInput = z.object({ message: cutinMessageSchema });
export type CutinAction = { actionId: string; message: string; issuedAt: number; expiresAt: number };
export type CutinStatus = { action: CutinAction | null; serverNow: number };
