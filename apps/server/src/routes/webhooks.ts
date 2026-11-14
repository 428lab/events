import { Hono } from "hono";
import type { Context } from "hono";
import {
  MAX_WEBHOOKS_PER_SCOPE,
  createWebhookInput,
  updateWebhookInput,
  webhookKindFromUrl,
} from "@eventer/shared";
import type { CreateWebhookInput, UpdateWebhookInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireEventRole } from "../auth/roles.js";
import { valid, zValidator } from "../lib/validator.js";
import { communitiesRepo } from "../db/repositories/communities.js";
import { webhooksRepo, type WebhookScope } from "../db/repositories/webhooks.js";
import { sendTestWebhook } from "../lib/webhooks.js";

/** Discord / Slack 通知の設定 (docs/webhooks.md)。
 * - コミュニティ: /api/communities/:id/webhooks（owner/admin）
 * - イベント: /api/events/:id/webhooks（そのイベントの運営。共催の申請と同じ認可）
 * URL は返さない（WebhookView の urlHint だけ） */

function mountCrud(app: Hono<AppEnv>, scopeOf: (c: Context<AppEnv>) => WebhookScope) {
  app.get("/:id/webhooks", async (c) => c.json({ webhooks: await webhooksRepo.list(scopeOf(c)) }));

  app.post("/:id/webhooks", zValidator("json", createWebhookInput), async (c) => {
    const scope = scopeOf(c);
    const input = valid<CreateWebhookInput>(c, "json");
    const kind = webhookKindFromUrl(input.url);
    if (!kind) return c.json({ error: "unsupported_webhook_url" }, 400);
    if ((await webhooksRepo.count(scope)) >= MAX_WEBHOOKS_PER_SCOPE) {
      return c.json({ error: "webhook_limit", limit: MAX_WEBHOOKS_PER_SCOPE }, 409);
    }
    const webhook = await webhooksRepo.create(scope, { ...input, kind }, c.get("user").id);
    return c.json({ webhook }, 201);
  });

  app.patch("/:id/webhooks/:webhookId", zValidator("json", updateWebhookInput), async (c) => {
    const webhook = await webhooksRepo.update(scopeOf(c), c.req.param("webhookId")!, valid<UpdateWebhookInput>(c, "json"));
    if (!webhook) return c.json({ error: "not_found" }, 404);
    return c.json({ webhook });
  });

  app.delete("/:id/webhooks/:webhookId", async (c) => {
    if (!(await webhooksRepo.remove(scopeOf(c), c.req.param("webhookId")!))) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  app.post("/:id/webhooks/:webhookId/test", async (c) => {
    const row = await webhooksRepo.findInScope(scopeOf(c), c.req.param("webhookId")!);
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json(await sendTestWebhook({ id: row.id, kind: row.kind, url: row.url }));
  });
}

/** コミュニティの Webhook（owner/admin だけ）。communityRoutes の下に付ける（認証はそちらの境界 #472） */
export const communityWebhookRoutes = new Hono<AppEnv>();
const communityManagerOnly = async (c: Context<AppEnv>, next: () => Promise<void>) => {
  if (!(await communitiesRepo.isManager(c.req.param("id")!, c.get("user").id))) {
    return c.json({ error: "forbidden" }, 403);
  }
  await next();
};
communityWebhookRoutes.use("/:id/webhooks", communityManagerOnly);
communityWebhookRoutes.use("/:id/webhooks/*", communityManagerOnly);
mountCrud(communityWebhookRoutes, (c) => ({ community: c.req.param("id")! }));

/** イベントの Webhook（そのイベントの運営だけ）。認証は /api/events/* の境界で通っている (#472) */
export const eventWebhookRoutes = new Hono<AppEnv>();
eventWebhookRoutes.use("/:id/webhooks", requireEventRole(["staff"]));
eventWebhookRoutes.use("/:id/webhooks/*", requireEventRole(["staff"]));
mountCrud(eventWebhookRoutes, (c) => ({ event: c.req.param("id")! }));
