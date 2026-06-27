import type { MiddlewareHandler } from "hono";
import type { EventRole } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { eventsRepo } from "../db/repositories/events.js";
import { communitiesRepo } from "../db/repositories/communities.js";
import { isAppAdmin } from "./admin.js";

/**
 * イベントメンバーであり、かつ指定ロールのいずれかを持つことを要求する。
 * requireAuth の後に使うこと（c.get("user") が必要）。
 * イベント ID はパスパラメータ :id から取得。
 * - アプリ運営管理者（ADMIN_DISCORD_IDS）は常に許可。
 * - イベントが所属するコミュニティの owner/admin は staff 相当として許可。
 */
export function requireEventRole(
  roles: EventRole[],
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    const eventId = c.req.param("id");
    if (!eventId) return c.json({ error: "event_id_required" }, 400);
    if (isAppAdmin(user)) {
      await next();
      return;
    }
    const member = await eventMembersRepo.find(eventId, user.id);
    if (member && roles.includes(member.role)) {
      await next();
      return;
    }
    // コミュニティ管理者（owner/admin）はそのコミュニティのイベントを staff 相当で管理可
    if (roles.includes("staff")) {
      const event = await eventsRepo.findById(eventId);
      if (
        event?.communityId &&
        (await communitiesRepo.isManager(event.communityId, user.id))
      ) {
        await next();
        return;
      }
    }
    return c.json({ error: "forbidden" }, 403);
  };
}
