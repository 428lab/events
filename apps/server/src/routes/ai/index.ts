import { Hono } from "hono";
import type { Context } from "hono";
import {
  aiCreateEventInput,
  aiListMyEventsInput,
  aiSearchEventsInput,
} from "@eventer/shared";
import type {
  AiCreateEventInput,
  AiListMyEventsInput,
  AiSearchEventsInput,
} from "@eventer/shared";
import type { AppEnv } from "../../types.js";
import { requireAuth, requireScope } from "../../auth/session.js";
import { eventResponseHeaders } from "../../auth/eventAccess.js";
import { valid, zValidator } from "../../lib/validator.js";
import {
  createEvent,
  getEvent,
  getWarikan,
  listMyCommunities,
  listMyEvents,
  searchEvents,
  whoami,
  type AiResult,
} from "./handlers.js";

/**
 * AI 向け API `/api/ai/v1` (#581)。設計は docs/ai-integration.md §5。
 *
 * Bearer（アクセストークン）が有効なのは /api/mcp と /api/ai/* だけ（auth/session.ts）。
 * Cookie セッションでも同じ結果を返す（requireScope は session を常に通す）。
 * 認証の境界はここの use("*", requireAuth) の1か所（/api/me と同じ型）。
 * 書き込み（create_event）だけ requireScope("write")。
 *
 * ハンドラの本体は handlers.ts（MCP のツールも同じ関数を呼ぶ）。
 */
export const aiRoutes = new Hono<AppEnv>();

aiRoutes.use("*", requireAuth);
// 本人の権限で読んだ非公開の中身を含むので、共有キャッシュに載せない
aiRoutes.use("*", async (c, next) => {
  eventResponseHeaders(c, true);
  await next();
});

function respond<T>(c: Context<AppEnv>, result: AiResult<T>) {
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.data as object, result.status ?? 200);
}

/** whoami */
aiRoutes.get("/me", async (c) => respond(c, await whoami(c.get("user"))));

/** list_my_events */
aiRoutes.get("/me/events", zValidator("query", aiListMyEventsInput), async (c) =>
  respond(c, await listMyEvents(c.get("user"), valid<AiListMyEventsInput>(c, "query"))),
);

/** list_my_communities */
aiRoutes.get("/me/communities", async (c) =>
  respond(c, await listMyCommunities(c.get("user"))),
);

/** search_events（/events/:idOrSlug より先に登録） */
aiRoutes.get("/events/search", zValidator("query", aiSearchEventsInput), async (c) =>
  respond(c, await searchEvents(c.get("user"), valid<AiSearchEventsInput>(c, "query"))),
);

/** get_warikan */
aiRoutes.get("/events/:id/warikan", async (c) =>
  respond(c, await getWarikan(c.get("user"), c.req.param("id"))),
);

/** get_event（ID か短い slug） */
aiRoutes.get("/events/:idOrSlug", async (c) =>
  respond(c, await getEvent(c.get("user"), c.req.param("idOrSlug"))),
);

/** create_event（下書きのみ。write スコープ） */
aiRoutes.post(
  "/events",
  requireScope("write"),
  zValidator("json", aiCreateEventInput),
  async (c) =>
    respond(c, await createEvent(c.get("user"), valid<AiCreateEventInput>(c, "json"))),
);
