import { z } from "zod";

export const EVENT_ACCESS_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const accessRevisionInput = z.object({ expectedAccessRevision: z.number().int().nonnegative() });
export const createEventAccessInviteInput = accessRevisionInput.extend({
  handle: z.string().trim().min(1).max(100),
  expectedUserId: z.string().min(1).optional(),
});
export const revokeEventAccessInviteInput = accessRevisionInput.extend({ confirmCancelParticipation: z.boolean().optional() });
export const leaveEventAccessInput = z.object({ confirmCancelParticipation: z.literal(true) });
export type EventAccessInviteStatus = "pending" | "accepted" | "declined" | "revoked" | "expired";
export interface EventAccessInvite {
  id: string; userId: string; handle: string; displayName: string;
  status: EventAccessInviteStatus; source: "invite" | "existing_member";
  expiresAt: number | null; createdAt: number;
}
export interface MyEventInvite {
  id: string; title: string; inviterName: string | null;
  expiresAt: number; status: "pending";
}
export interface MyEventAccess {
  id: string; eventId: string; status: "accepted"; createdAt: number;
  canOpenEvent: boolean; canLeave: boolean;
}
export interface EventAccessInviteList { invites: EventAccessInvite[]; accessRevision: number }
export interface MyEventInviteList { invites: MyEventInvite[]; nextCursor: string | null }
export interface MyEventAccessList { accesses: MyEventAccess[]; nextCursor: string | null }
