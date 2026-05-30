import type { MiddlewareHandler } from "hono";
import type { EventRole } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";

/**
 * イベントメンバーであり、かつ指定ロールのいずれかを持つことを要求する。
 * requireAuth の後に使うこと（c.get("user") が必要）。
 * イベント ID はパスパラメータ :id から取得。
 */
export function requireEventRole(
  roles: EventRole[],
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    const eventId = c.req.param("id");
    if (!eventId) return c.json({ error: "event_id_required" }, 400);
    const member = eventMembersRepo.find(eventId, user.id);
    if (!member || !roles.includes(member.role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  };
}
