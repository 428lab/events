import { z } from "zod";

/** コミュニティ・イベントごとの Discord / Slack 通知 (docs/webhooks.md)。 */

export const WEBHOOK_KINDS = ["discord", "slack"] as const;
export type WebhookKind = (typeof WEBHOOK_KINDS)[number];

export const WEBHOOK_TOPICS = ["inquiry", "join", "cancel"] as const;
export type WebhookTopic = (typeof WEBHOOK_TOPICS)[number];

/** コミュニティ・イベントそれぞれに登録できる数 */
export const MAX_WEBHOOKS_PER_SCOPE = 10;
/** 続けて失敗したら自動で止める回数 */
export const WEBHOOK_MAX_CONSECUTIVE_FAILURES = 5;

const DISCORD_HOSTS = ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"];
const DISCORD_PATH = /^\/api\/webhooks\/\d{5,30}\/[A-Za-z0-9_-]{20,200}\/?$/;
const SLACK_PATH = /^\/services\/[A-Z0-9]{5,20}\/[A-Z0-9]{5,20}\/[A-Za-z0-9]{10,64}\/?$/;

/** Webhook の URL から種類を決める。Discord / Slack 以外・https 以外・余計な部分のある URL は null。
 * ここを通った URL にしかサーバーは送らない（任意の宛先へ送らせない SSRF 対策） */
export function webhookKindFromUrl(raw: string): WebhookKind | null {
  if (raw.length > 500) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.port !== "" || u.username || u.password || u.search || u.hash) return null;
  const host = u.hostname.toLowerCase();
  if (DISCORD_HOSTS.includes(host) && DISCORD_PATH.test(u.pathname)) return "discord";
  if (host === "hooks.slack.com" && SLACK_PATH.test(u.pathname)) return "slack";
  return null;
}

export const createWebhookInput = z.object({
  url: z.string().trim().min(1).max(500).refine((v) => webhookKindFromUrl(v) !== null, { message: "unsupported_webhook_url" }),
  label: z.string().trim().max(60).default(""),
  notifyInquiry: z.boolean().default(true),
  notifyJoin: z.boolean().default(true),
  notifyCancel: z.boolean().default(true),
});
export type CreateWebhookInput = z.infer<typeof createWebhookInput>;

export const updateWebhookInput = z.object({
  label: z.string().trim().max(60).optional(),
  notifyInquiry: z.boolean().optional(),
  notifyJoin: z.boolean().optional(),
  notifyCancel: z.boolean().optional(),
  /** 「再開する」（自動停止の解除）。true で失敗回数も 0 に戻す */
  active: z.boolean().optional(),
});
export type UpdateWebhookInput = z.infer<typeof updateWebhookInput>;

/** 画面へ返す形。URL そのものは返さない（トークンを含むため） */
export interface WebhookView {
  id: string;
  kind: WebhookKind;
  /** 例: "discord.com …a9Xz" */
  urlHint: string;
  label: string;
  notifyInquiry: boolean;
  notifyJoin: boolean;
  notifyCancel: boolean;
  active: boolean;
  failCount: number;
  lastError: string | null;
  lastSentAt: number | null;
  createdAt: number;
}

export interface WebhookTestResult {
  ok: boolean;
  status: number | null;
}
