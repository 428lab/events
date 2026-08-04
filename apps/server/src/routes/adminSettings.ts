import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { updateChatRelaysInput } from "@eventer/shared";
import type { AppSettingsPayload, UpdateChatRelaysInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";
import { valid, zValidator } from "../lib/validator.js";
import {
  CHAT_RELAYS_KEY,
  appSettingsRepo,
  getChatRelays,
} from "../db/repositories/appSettings.js";
import { recordAudit } from "../db/repositories/auditLogs.js";

/** アプリ全体の運用設定（app admin のみ）。まずはチャットリレー (#199) */
const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isAppAdmin(c.get("user"))) return c.json({ error: "forbidden" }, 403);
  await next();
};

export const adminSettingsRoutes = new Hono<AppEnv>();
adminSettingsRoutes.use("*", requireAuth, requireAdmin);

async function settingsPayload(c: Context<AppEnv>): Promise<Response> {
  const payload: AppSettingsPayload = {
    chatRelays: await getChatRelays(),
    chatRelaysCustom: (await appSettingsRepo.get(CHAT_RELAYS_KEY)) !== null,
  };
  return c.json(payload);
}

adminSettingsRoutes.get("/", (c) => settingsPayload(c));

/** チャットリレーの上書き。relays=[] で設定を削除して既定に戻す */
adminSettingsRoutes.put(
  "/chat-relays",
  zValidator("json", updateChatRelaysInput),
  async (c) => {
    const { relays } = valid<UpdateChatRelaysInput>(c, "json");
    if (relays.length === 0) {
      await appSettingsRepo.delete(CHAT_RELAYS_KEY);
    } else {
      await appSettingsRepo.set(CHAT_RELAYS_KEY, JSON.stringify(relays));
    }
    // 監査ログ (#248)。リレーURLは公開情報なので値も残す（既定に戻した場合は空）
    const me = c.get("user");
    await recordAudit({
      action: "admin_setting_change",
      actor: { id: me.id, handle: me.username },
      detail: { key: CHAT_RELAYS_KEY, relays, reset: relays.length === 0 },
    });
    return settingsPayload(c);
  },
);
