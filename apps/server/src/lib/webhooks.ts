import type { WebhookKind, WebhookTopic } from "@eventer/shared";
import { env } from "../runtime.js";
import { deferBackground } from "../runtime.js";
import { webhooksRepo, type WebhookTarget } from "../db/repositories/webhooks.js";

/** Discord / Slack への通知 (docs/webhooks.md)。中身の組み立て（純関数）と送り方。
 *
 * 呼び出し側は `notifyWebhooks(eventId, message)` を呼ぶだけ。送るのは裏側（waitUntil）で、
 * 参加・キャンセル・問い合わせの応答を待たせない。宛先の解決・重複除去は webhooksRepo。 */

export type WebhookMessage =
  | {
      topic: "join";
      eventId: string;
      eventTitle: string;
      user: { name: string; handle: string };
      status: "confirmed" | "applied" | "waitlist";
      confirmedCount: number;
    }
  | {
      topic: "cancel";
      eventId: string;
      eventTitle: string;
      user: { name: string; handle: string };
      confirmedCount: number;
      /** 運営が「キャンセル扱い」にした（本人の取り消しではない） */
      byStaff?: boolean;
    }
  | {
      topic: "inquiry";
      eventId: string;
      eventTitle: string;
      inquiryId: string;
      user: { name: string; handle: string };
      subject: string;
      body: string;
      /** 問い合わせを作ったときは false、本人が続けて書いたときは true */
      followUp: boolean;
    };

/** Discord: embed の説明は 4096 字、1メッセージ 10 embed・合計 6000 字 */
const DISCORD_DESC = 4096;
const DISCORD_TOTAL = 6000;
const DISCORD_EMBEDS = 10;
/** Slack: section のテキストは 3000 字、50 ブロックまで */
const SLACK_SECTION = 3000;
const SLACK_BLOCKS = 50;

const STATUS_LABEL = { confirmed: "確定", applied: "抽選申込", waitlist: "キャンセル待ち" } as const;

function base(): string {
  return env.appBaseUrl.replace(/\/+$/, "");
}
const eventUrl = (id: string) => `${base()}/events/${id}`;
const userUrl = (handle: string) => `${base()}/users/${encodeURIComponent(handle)}`;
const inquiryUrl = (eventId: string, inquiryId: string) => `${base()}/events/${eventId}/inquiries/${inquiryId}`;

function title(m: WebhookMessage): string {
  if (m.topic === "join") return `参加: ${m.eventTitle}`;
  if (m.topic === "cancel") return `${m.byStaff ? "キャンセル（運営が記録）" : "キャンセル"}: ${m.eventTitle}`;
  return `${m.followUp ? "問い合わせ（追記）" : "問い合わせ"}: ${m.eventTitle}`;
}

/** 長い本文を size 字ごとに分ける（サロゲートペアを割らない） */
export function chunkText(text: string, size: number): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(""));
  return out.length > 0 ? out : [""];
}

const MORE = (url: string) => `\n…（続きはこちら: ${url}）`;

/** Discord の Webhook 本文 */
export function formatDiscord(m: WebhookMessage): Record<string, unknown> {
  const link = m.topic === "inquiry" ? inquiryUrl(m.eventId, m.inquiryId) : eventUrl(m.eventId);
  const who = `[${m.user.name}](${userUrl(m.user.handle)}) (@${m.user.handle})`;
  const timestamp = new Date().toISOString();
  if (m.topic !== "inquiry") {
    const fields = [{ name: "名前", value: who, inline: true }];
    if (m.topic === "join") fields.push({ name: "状態", value: STATUS_LABEL[m.status], inline: true });
    fields.push({ name: "参加者数（確定）", value: `${m.confirmedCount}人`, inline: true });
    return {
      username: "events lab",
      embeds: [{ title: title(m), url: link, color: m.topic === "join" ? 0x2dd4bf : 0xf87171, fields, timestamp }],
    };
  }
  // 問い合わせ: 本文は全文。説明欄に入るだけ入れて、溢れたら次の embed へ続ける
  const head = `${m.subject ? `**件名:** ${m.subject}\n` : ""}**送った人:** ${who}\n\n`;
  const embeds: Record<string, unknown>[] = [];
  let used = 0;
  const pieces = chunkText(m.body, DISCORD_DESC - 200);
  for (let i = 0; i < pieces.length; i++) {
    let desc = (i === 0 ? head : "") + pieces[i];
    const titleText = i === 0 ? title(m) : "";
    const remainingBudget = DISCORD_TOTAL - used - titleText.length;
    const lastSlot = embeds.length === DISCORD_EMBEDS - 1;
    const truncated = desc.length > remainingBudget || (lastSlot && i < pieces.length - 1);
    if (truncated) {
      const keep = Math.max(0, Math.min(desc.length, remainingBudget) - MORE(link).length);
      desc = Array.from(desc).slice(0, keep).join("") + MORE(link);
    }
    embeds.push({ ...(titleText ? { title: titleText, url: link } : {}), description: desc, color: 0x60a5fa });
    used += titleText.length + desc.length;
    if (truncated) break;
  }
  (embeds[embeds.length - 1] as Record<string, unknown>).timestamp = timestamp;
  return { username: "events lab", embeds };
}

/** Slack の Webhook 本文（Block Kit） */
export function formatSlack(m: WebhookMessage): Record<string, unknown> {
  const link = m.topic === "inquiry" ? inquiryUrl(m.eventId, m.inquiryId) : eventUrl(m.eventId);
  const who = `<${userUrl(m.user.handle)}|${m.user.name}> (@${m.user.handle})`;
  const head = { type: "section", text: { type: "mrkdwn", text: `*<${link}|${title(m)}>*` } };
  if (m.topic !== "inquiry") {
    const fields = [{ type: "mrkdwn", text: `*名前*\n${who}` }];
    if (m.topic === "join") fields.push({ type: "mrkdwn", text: `*状態*\n${STATUS_LABEL[m.status]}` });
    fields.push({ type: "mrkdwn", text: `*参加者数（確定）*\n${m.confirmedCount}人` });
    return { text: title(m), blocks: [head, { type: "section", fields }] };
  }
  const blocks: Record<string, unknown>[] = [
    head,
    { type: "context", elements: [{ type: "mrkdwn", text: `${m.subject ? `件名: ${m.subject} / ` : ""}送った人: ${who}` }] },
  ];
  const room = SLACK_BLOCKS - blocks.length;
  const pieces = chunkText(m.body, SLACK_SECTION - 100);
  for (let i = 0; i < pieces.length && i < room; i++) {
    let text = pieces[i]!;
    if (i === room - 1 && i < pieces.length - 1) text = Array.from(text).slice(0, SLACK_SECTION - 100 - MORE(link).length).join("") + MORE(link);
    blocks.push({ type: "section", text: { type: "plain_text", text: text || " " } });
  }
  return { text: title(m), blocks };
}

export function formatWebhook(kind: WebhookKind, m: WebhookMessage): Record<string, unknown> {
  return kind === "discord" ? formatDiscord(m) : formatSlack(m);
}

const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 5000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 送り直しても直らない失敗: 宛先が無い・消された・権限が無い・転送された（転送は追わない）。
 * これだけを自動停止の回数に数える（429・5xx・通信エラーは一時的なものとして数えない） */
export function isPermanentWebhookFailure(status: number | null): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404 || (status !== null && status >= 300 && status < 400);
}

type PostResult = { ok: boolean; status: number | null; error?: string };

/** 1件送る。429 は Retry-After（最大5秒）を守り、それ以外の一時的な失敗は 0.5 秒・1 秒あけて再送 */
export async function postWebhook(target: WebhookTarget, payload: Record<string, unknown>): Promise<PostResult> {
  let last: PostResult = { ok: false, status: null, error: "not_sent" };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(target.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "manual",
      });
      if (res.ok) return { ok: true, status: res.status };
      last = { ok: false, status: res.status, error: `HTTP ${res.status}` };
      // 宛先が無い・権限が無い・転送されたのは再送しても直らない
      if (isPermanentWebhookFailure(res.status)) break;
      if (attempt < MAX_ATTEMPTS - 1) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(res.status === 429 && Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, MAX_RETRY_AFTER_MS) : 500 * 2 ** attempt);
      }
    } catch {
      // URL（トークン）を含む例外文は残さない
      last = { ok: false, status: null, error: "network_error" };
      if (attempt < MAX_ATTEMPTS - 1) await sleep(500 * 2 ** attempt);
    }
  }
  return last;
}

/** そのイベントで起きたことを、登録済みの Webhook へ送る（成功・失敗を記録し、続けて失敗したら止める）。
 * 失敗しても例外は投げない */
export async function dispatchWebhooks(m: WebhookMessage): Promise<void> {
  try {
    const targets = await webhooksRepo.targetsForEvent(m.eventId, m.topic as WebhookTopic);
    await Promise.all(
      targets.map(async (t) => {
        const r = await postWebhook(t, formatWebhook(t.kind, m));
        if (r.ok) await webhooksRepo.recordSuccess(t.id);
        else await webhooksRepo.recordFailure(t.id, r.error ?? "failed", isPermanentWebhookFailure(r.status));
      }),
    );
  } catch (e) {
    console.warn("[webhook] dispatch failed", e instanceof Error ? e.name : "error");
  }
}

/** 応答を待たせずに送る */
export function notifyWebhooks(m: WebhookMessage): Promise<void> {
  return deferBackground(dispatchWebhooks(m));
}

/** テスト送信（自動停止の回数には数えない） */
export async function sendTestWebhook(target: WebhookTarget): Promise<{ ok: boolean; status: number | null }> {
  const text = "events lab からのテスト送信です。この通知が届いていれば設定は完了です。";
  const payload = target.kind === "discord" ? { username: "events lab", content: text } : { text };
  const r = await postWebhook(target, payload);
  return { ok: r.ok, status: r.status };
}
