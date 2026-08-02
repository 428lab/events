import { env, takeEmailSlot } from "../runtime.js";
import { emailRepo } from "../db/repositories/email.js";
import { eventsRepo } from "../db/repositories/events.js";
import { communitiesRepo } from "../db/repositories/communities.js";
import { eventScheduleRepo } from "../db/repositories/eventSchedule.js";
import { computeScheduleTimes } from "@eventer/shared";
import {
  actorTitleHtml,
  eventCardHtml,
  notificationEmailHtml,
  timetableHtml,
} from "./emailTemplates.js";

/** メール送信 (#126)。Resend HTTP API を fetch で直接叩く（npm 依存なし） */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** メール表示だけに使う付加情報 (#134)。DB には保存しない */
export interface EmailExtras {
  /** 「◯◯ さんが…」通知の ◯◯（プロフィールへリンクする） */
  actorName?: string;
  /** actor のプロフィールパス（例: /users/alice） */
  actorPath?: string;
  /** リマインダー用: イベントのタイムテーブルも載せる */
  timetable?: boolean;
}

/** アプリ内リンクに ?ref=email を付けた絶対URLを作る（既にクエリがあれば & で連結） */
export function emailLinkUrl(link: string): string {
  const sep = link.includes("?") ? "&" : "?";
  return `${env.appBaseUrl}${link}${sep}ref=email`;
}

/** HMAC-SHA256("unsub:"+userId, SESSION_SECRET) の hex。配信停止リンクの署名 (#126)。
 * 同じ鍵を使う他のHMAC（Nostrチャレンジ等）と衝突しないようプレフィックスで分離する */
export async function unsubscribeToken(userId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`unsub:${userId}`),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** ワンクリック配信停止URL（認証不要・署名付き） */
export async function unsubscribeUrl(userId: string): Promise<string> {
  const token = await unsubscribeToken(userId);
  return `${env.appBaseUrl}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${token}`;
}

/** Resend でメールを1通送る。API キー未設定や失敗時は false（呼び出し元を壊さない） */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
}): Promise<boolean> {
  const apiKey = env.resendApiKey;
  if (!apiKey) {
    console.warn("email: RESEND_API_KEY 未設定のため送信をスキップ");
    return false;
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.emailFrom,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        ...(opts.headers ? { headers: opts.headers } : {}),
      }),
    });
    if (!res.ok) {
      // 原因特定用に Resend のエラー本文も出す（宛先アドレスは含めない）
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      console.warn(`email: Resend 送信失敗 status=${res.status} ${detail}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("email: Resend 送信エラー", e);
    return false;
  }
}

/** イベント詳細リンク（/events/:uuid）の判定。クエリ付きも許容 */
const EVENT_LINK_RE = /^\/events\/([0-9a-f-]{36})(?:[?#]|$)/;

// 同一イベントへの一斉送信（リマインダー・フォロワー通知）でカードを組み直さないための
// 短命キャッシュ。1回の実行内での重複フェッチ抑制が目的（TTL 60秒・最大50件）
const cardCache = new Map<string, { html: string; at: number }>();
const CARD_CACHE_TTL = 60_000;

/** リンク先がイベント詳細なら、イベントカード（＋タイムテーブル）HTMLを組み立てる (#134)。
 * D1 参照が増えるが送信はレスポンス外（waitUntil / cron）なので許容。
 * 失敗してもプレーンなメールで送れるよう空文字を返す */
async function buildEventExtraHtml(
  link: string,
  withTimetable: boolean,
): Promise<string> {
  try {
    const m = EVENT_LINK_RE.exec(link);
    if (!m) return "";
    const cacheKey = `${m[1]}:${withTimetable ? 1 : 0}`;
    const hit = cardCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CARD_CACHE_TTL) return hit.html;
    const event = await eventsRepo.findById(m[1]!);
    if (!event) return "";
    const community = event.communityId
      ? await communitiesRepo.findById(event.communityId)
      : null;
    let html = eventCardHtml({
      baseUrl: env.appBaseUrl,
      event,
      communityName: community?.name ?? null,
    });
    if (withTimetable) {
      const items = await eventScheduleRepo.listByEvent(event.id);
      if (items.length > 0) {
        // 日程調整中は開始基準が無いので明示指定の項目以外は「--:--」になる
        const times = computeScheduleTimes(
          items,
          event.scheduling ? null : event.startsAt,
        );
        html += timetableHtml({ items, times });
      }
    }
    // 使い捨てに近い用途なので肥大化だけ防ぐ
    if (cardCache.size >= 50) cardCache.clear();
    cardCache.set(cacheKey, { html, at: Date.now() });
    return html;
  } catch (e) {
    console.warn("email: イベントカードの組み立てに失敗（プレーンで送信）", e);
    return "";
  }
}

/** 通知メールを1通組み立てて送る（宛先解決済みの内部ヘルパー）。
 * extras はメール表示のみに使う（アプリ内通知や DB には影響しない） */
export async function sendNotificationEmailTo(
  userId: string,
  to: string,
  title: string,
  body: string,
  link: string,
  extras?: EmailExtras,
): Promise<boolean> {
  // 1リクエストの送信予算（抽選など多人数ループでの暴走防止）
  if (!takeEmailSlot()) {
    console.warn("email: 送信予算を使い切ったためスキップ", userId);
    return false;
  }
  const unsub = await unsubscribeUrl(userId);
  // リッチ化 (#134): イベントカード＋（リマインダーなら）タイムテーブル
  const extraHtml = await buildEventExtraHtml(link, extras?.timetable === true);
  // 「◯◯ さんが…」の ◯◯ をプロフィールへリンク（該当しなければプレーン表示）
  const titleHtml =
    extras?.actorName && extras.actorPath
      ? actorTitleHtml({
          baseUrl: env.appBaseUrl,
          title,
          actorName: extras.actorName,
          actorPath: extras.actorPath,
        })
      : null;
  const html = notificationEmailHtml({
    baseUrl: env.appBaseUrl,
    title,
    titleHtml,
    body,
    extraHtml,
    linkUrl: link ? emailLinkUrl(link) : null,
    unsubscribeUrl: unsub,
  });
  return sendEmail({
    to,
    subject: title,
    html,
    headers: {
      // ワンクリック配信停止（RFC 8058）
      "List-Unsubscribe": `<${unsub}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
}

/** メール通知ONのユーザーへアプリ内通知と同内容のメールを送る。
 * 失敗しても呼び出し元（通知作成）を壊さない。1リクエストの送信予算を消費 */
export async function sendNotificationEmailIfOptedIn(
  userId: string,
  title: string,
  body: string,
  link: string,
  extras?: EmailExtras,
): Promise<void> {
  try {
    const to = await emailRepo.findRecipient(userId);
    if (!to) return;
    await sendNotificationEmailTo(userId, to, title, body, link, extras);
  } catch (e) {
    console.warn("email: 通知メール送信に失敗", e);
  }
}
