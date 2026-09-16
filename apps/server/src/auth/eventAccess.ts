import type { Context, MiddlewareHandler } from "hono";
import type { Event, User } from "@eventer/shared";
import { one } from "../db/client.js";
import { eventsRepo } from "../db/repositories/events.js";
import { env } from "../env.js";
import { currentUser } from "./session.js";

/** Arguments are trusted SQL expressions, never request values. Bind user IDs and
 * the JSON administrator list at the call site, including in mutation statements. */
export function eventManagerSql(event: string, user: string, adminIds: string): string {
  return `(${user}.discord_id IN (SELECT value FROM json_each(${adminIds}))
    OR EXISTS (SELECT 1 FROM event_member access_staff
      WHERE access_staff.event_id = ${event}.id AND access_staff.user_id = ${user}.id
        AND access_staff.role = 'staff' AND access_staff.status <> 'canceled')
    OR EXISTS (SELECT 1 FROM community_member access_community
      WHERE access_community.community_id = ${event}.community_id
        AND access_community.user_id = ${user}.id
        AND access_community.role IN ('owner', 'admin')))`;
}

/** §3: visibility is not membership. Unknown values fail closed, even for managers.
 * The active-user check applies to every authenticated source of access. */
export function eventViewSql(event: string, userId: string, adminIds: string): string {
  return `(${event}.visibility IN ('public', 'unlisted', 'private') AND (
    (${event}.status = 'published' AND ${event}.visibility IN ('public', 'unlisted'))
    OR EXISTS (SELECT 1 FROM user access_user
      WHERE access_user.id = ${userId} AND access_user.deleted_at IS NULL AND (
        ${eventManagerSql(event, "access_user", adminIds)}
        OR ((${event}.status = 'published'
          OR (${event}.status IN ('draft', 'archived') AND EXISTS (
            SELECT 1 FROM event_member access_member
            WHERE access_member.event_id = ${event}.id
              AND access_member.user_id = access_user.id
              AND access_member.status <> 'canceled')))
          AND (${event}.visibility <> 'private' OR EXISTS (
            SELECT 1 FROM event_access_invite access_invite
            WHERE access_invite.event_id = ${event}.id
              AND access_invite.user_id = access_user.id
              AND access_invite.status = 'accepted')))
      ))))`;
}

/** Parentless encounters require BOTH active users, not just the caller. */
export function eventPairViewSql(event: string, scanner: string, target: string, admins: string): string {
  return `(EXISTS (SELECT 1 FROM user pair_scanner WHERE pair_scanner.id=${scanner} AND pair_scanner.deleted_at IS NULL)
    AND EXISTS (SELECT 1 FROM user pair_target WHERE pair_target.id=${target} AND pair_target.deleted_at IS NULL)
    AND ${eventViewSql(event, scanner, admins)} AND ${eventViewSql(event, target, admins)})`;
}

export async function canViewEvent(event: Event, user: User | null): Promise<boolean> {
  const row = await one<{ allowed: number }>(
    `SELECT ${eventViewSql("e", "?", "?")} AS allowed FROM event e WHERE e.id = ?`,
    user?.id ?? null, JSON.stringify(env.adminDiscordIds), event.id,
  );
  return row?.allowed === 1;
}

export async function isEventManager(eventId: string, user: User): Promise<boolean> {
  const row = await one<{ allowed: number }>(
    `SELECT ${eventManagerSql("e", "access_user", "?")} AS allowed
       FROM event e JOIN user access_user ON access_user.id = ?
       WHERE e.id = ? AND access_user.deleted_at IS NULL`,
    JSON.stringify(env.adminDiscordIds), user.id, eventId,
  );
  return row?.allowed === 1;
}

export function eventResponseHeaders(c: Context, nonpublic = false): void {
  c.header("Cache-Control", "private, no-store");
  const vary = c.res.headers.get("Vary");
  if (vary !== "*" && !vary?.split(",").some((v) => v.trim().toLowerCase() === "cookie")) {
    c.header("Vary", vary ? `${vary}, Cookie` : "Cookie");
  }
  if (nonpublic) {
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
}

/** Registered before every event child handler, including anonymous media,
 * body-size validation and beacons. The self-exit exception must be an explicit
 * DELETE handler with its own ownership/transaction checks, never a path bypass. */
export const requireEventAccess: MiddlewareHandler = async (c, next) => {
  const event = await eventsRepo.findById(c.req.param("id") ?? "");
  try {
    if (!event || !(await canViewEvent(event, await currentUser(c)))) {
      return c.json({ error: "not_found" }, 404);
    }
    await next();
  } finally {
    // Child media handlers must not replace this with their old cache headers.
    eventResponseHeaders(c, !event || event.visibility !== "public");
  }
};
