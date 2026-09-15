import { Hono, type Context } from "hono";
import { accessRevisionInput, createEventAccessInviteInput, revokeEventAccessInviteInput,
  leaveEventAccessInput, type MyEventAccess } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { canViewEvent, eventResponseHeaders, isEventManager } from "../auth/eventAccess.js";
import { requireEventRole } from "../auth/roles.js";
import { eventsRepo } from "../db/repositories/events.js";
import { usersRepo } from "../db/repositories/users.js";
import { eventAccessInvitesRepo as invites, accessInviteStatus, nextCursor, type AccessInviteRow } from "../db/repositories/eventAccessInvites.js";
import { revokeEventAccess } from "../db/repositories/eventAccessExit.js";
import { zValidator, valid } from "../lib/validator.js";

export const eventAccessInviteRoutes = new Hono<AppEnv>();
eventAccessInviteRoutes.get("/:id/access-invites", requireEventRole(["staff"]), async (c) => {
  const event = (await eventsRepo.findById(c.req.param("id")))!;
  return c.json({ invites: await invites.list(event.id), accessRevision: event.accessRevision });
});
eventAccessInviteRoutes.post("/:id/access-invites", requireEventRole(["staff"]),
  zValidator("json", createEventAccessInviteInput), async (c) => {
    const input = valid<{ handle: string; expectedUserId?: string; expectedAccessRevision: number }>(c, "json");
    const event = (await eventsRepo.findById(c.req.param("id")))!;
    if (event.visibility !== "private") return c.json({ error: "private_required" }, 409);
    const handle = input.handle.replace(/^@/, "");
    const target = await usersRepo.findByUsername(handle);
    if (!target) return c.json({ error: "user_not_found" }, 404);
    if (input.expectedUserId && input.expectedUserId !== target.id) return c.json({ error: "handle_changed" }, 409);
    if (target.id === c.get("user").id) return c.json({ error: "self_invite" }, 400);
    if (await isEventManager(event.id, target)) return c.json({ error: "already_manager" }, 409);
    const existing = await invites.findForUser(event.id, target.id);
    if (existing && ["accepted", "pending"].includes(accessInviteStatus(existing))) return c.json({ error: "already_invited" }, 409);
    const id = await invites.issue(event.id, c.get("user").id, target.id, input.expectedAccessRevision, handle);
    if (!id) {
      const currentTarget = await usersRepo.findByUsername(handle);
      return c.json({ error: currentTarget?.id !== target.id ? "handle_changed" : "access_changed" }, 409);
    }
    return c.json({ invite: (await invites.list(event.id)).find((i) => i.id === id),
      accessRevision: (await eventsRepo.findById(event.id))!.accessRevision }, 201);
  });
eventAccessInviteRoutes.post("/:id/access-invites/:inviteId/reissue", requireEventRole(["staff"]),
  zValidator("json", accessRevisionInput), async (c) => {
    const invite = await invites.find(c.req.param("inviteId"));
    if (!invite || invite.event_id !== c.req.param("id")) return c.json({ error: "not_found" }, 404);
    if (invite.status === "accepted") return c.json({ error: "already_invited" }, 409);
    const target = await usersRepo.findById(invite.user_id);
    if (!target) return c.json({ error: "user_not_found" }, 404);
    if (await isEventManager(invite.event_id, target)) return c.json({ error: "already_manager" }, 409);
    const input = valid<{ expectedAccessRevision: number }>(c, "json");
    const id = await invites.issue(invite.event_id, c.get("user").id, target.id, input.expectedAccessRevision, target.username, invite.id);
    if (!id) return c.json({ error: "access_changed" }, 409);
    return c.json({ invite: (await invites.list(invite.event_id)).find((i) => i.id === id),
      accessRevision: (await eventsRepo.findById(invite.event_id))!.accessRevision });
  });
eventAccessInviteRoutes.delete("/:id/access-invites/:inviteId", requireEventRole(["staff"]),
  zValidator("json", revokeEventAccessInviteInput), async (c) => {
    const invite = await invites.find(c.req.param("inviteId"));
    if (!invite || invite.event_id !== c.req.param("id")) return c.json({ error: "not_found" }, 404);
    const target = await usersRepo.findById(invite.user_id);
    if (target && await isEventManager(invite.event_id, target)) return c.json({ error: "managed_access" }, 409);
    const input = valid<{ expectedAccessRevision: number; confirmCancelParticipation?: boolean }>(c, "json");
    if (invite.status === "accepted" && !input.confirmCancelParticipation) return c.json({ error: "confirmation_required" }, 400);
    if (invite.status !== "revoked" && !(await revokeEventAccess(invite, c.get("user").id, input.expectedAccessRevision))) {
      return c.json({ error: "access_changed" }, 409);
    }
    return c.json({ ok: true, accessRevision: (await eventsRepo.findById(invite.event_id))!.accessRevision });
  });

/** ONLY this DELETE is registered before the event gate. No detail/status/title is returned. */
export async function deleteMyEventAccess(c: Context<AppEnv>) {
  try {
    const user = c.get("user"), eventId = c.req.param("id")!;
    const invite = await invites.findForUser(eventId, user.id);
    if (!invite || !["accepted", "revoked"].includes(invite.status)) return c.json({ error: "not_found" }, 404);
    if (await isEventManager(eventId, user)) return c.json({ error: "managed_access" }, 409);
    const parsed = leaveEventAccessInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "confirmation_required" }, 400);
    if (invite.status === "revoked") return c.json({ ok: true });
    if (!(await revokeEventAccess(invite, user.id))) {
      const current = await invites.findForUser(eventId, user.id);
      // A concurrent identical exit is successful, but a new invitation is not
      // this operation's grant and must never be mistaken for its replay.
      if (current?.id !== invite.id || current.status !== "revoked") {
        return c.json({ error: "access_changed" }, 409);
      }
    }
    return c.json({ ok: true });
  } finally { eventResponseHeaders(c, true); }
}

function listInput(c: Context): { limit: number; cursor?: [number, string] } | null {
  const limit = Number(c.req.query("limit") ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return null;
  const encoded = c.req.query("cursor");
  if (!encoded) return { limit };
  try {
    const cursor = JSON.parse(atob(encoded));
    if (Array.isArray(cursor) && cursor.length === 2 && Number.isSafeInteger(cursor[0]) && typeof cursor[1] === "string") return { limit, cursor: cursor as [number, string] };
  } catch { /* malformed cursors never become SQL */ }
  return null;
}
function recipientRoutes() {
  const routes = new Hono<AppEnv>();
  routes.use("*", async (c, next) => { try { await next(); } finally { eventResponseHeaders(c, true); } });
  routes.use("*", requireAuth);
  return routes;
}
export const myEventInviteRoutes = recipientRoutes();
export const myEventAccessRoutes = recipientRoutes();
myEventInviteRoutes.get("/", async (c) => {
  const input = listInput(c);
  return input ? c.json(await invites.pending(c.get("user").id, input.limit, input.cursor)) : c.json({ error: "invalid_cursor" }, 400);
});
async function owned(c: Context<AppEnv>): Promise<AccessInviteRow | null> {
  const invite = await invites.find(c.req.param("inviteId")!);
  return invite?.user_id === c.get("user").id ? invite : null;
}
myEventInviteRoutes.get("/:inviteId", async (c) => {
  const invite = await owned(c);
  if (!invite) return c.json({ error: "not_found" }, 404);
  const status = accessInviteStatus(invite);
  const event = await eventsRepo.findById(invite.event_id);
  if (!event || event.visibility !== "private") return c.json({ error: "not_found" }, 404);
  if (status === "pending") {
    const by = invite.invited_by ? await usersRepo.findById(invite.invited_by) : null;
    return c.json({ id: invite.id, title: event.title, inviterName: by?.globalName ?? by?.username ?? null, expiresAt: invite.expires_at, status });
  }
  return c.json({ id: invite.id, status, ...(status === "accepted" ? { canOpenEvent: await canViewEvent(event, c.get("user")) } : {}) });
});
for (const action of ["accept", "decline"] as const) {
  myEventInviteRoutes.post(`/:inviteId/${action}`, async (c) => {
    let invite = await owned(c);
    if (!invite) return c.json({ error: "not_found" }, 404);
    const desired = action === "accept" ? "accepted" : "declined";
    if (invite.status !== desired) {
      const status = accessInviteStatus(invite);
      if (status === "expired") return c.json({ error: "invite_expired" }, 409);
      if (status !== "pending") return c.json({ error: "invite_unavailable" }, 409);
      await invites.respond(invite, c.get("user").id, desired);
      // A concurrent identical response is idempotent; reissue/revoke is not.
      invite = await owned(c);
      if (!invite) return c.json({ error: "not_found" }, 404);
      if (invite.status !== desired) {
        if (accessInviteStatus(invite) === "expired") return c.json({ error: "invite_expired" }, 409);
        return c.json({ error: invite.status === "pending" && action === "accept" ? "inviter_not_staff" : "invite_unavailable" }, 409);
      }
    }
    if (action === "decline") return c.json({ ok: true });
    const event = await eventsRepo.findById(invite.event_id);
    if (!event || event.visibility !== "private") return c.json({ error: "invite_unavailable" }, 409);
    return c.json({ eventId: event.id, status: "accepted", canOpenEvent: await canViewEvent(event, c.get("user")) });
  });
}
myEventAccessRoutes.get("/", async (c) => {
  const input = listInput(c);
  if (!input) return c.json({ error: "invalid_cursor" }, 400);
  const user = c.get("user"), rows = await invites.accepted(user.id, input.limit, input.cursor);
  const accesses: MyEventAccess[] = [];
  for (const i of rows.slice(0, input.limit)) {
    const event = await eventsRepo.findById(i.event_id);
    if (!event) continue;
    accesses.push({ id: i.id, eventId: event.id, status: "accepted", createdAt: i.responded_at ?? i.created_at,
      canOpenEvent: await canViewEvent(event, user), canLeave: !(await isEventManager(event.id, user)) });
  }
  return c.json({ accesses, nextCursor: nextCursor(rows, input.limit) });
});
