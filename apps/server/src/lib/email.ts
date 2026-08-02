import { env } from "../runtime.js";
import { emailRepo } from "../db/repositories/email.js";

/** メール送信 (#126)。Resend HTTP API を fetch で直接叩く（npm 依存なし） */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** アプリ内リンクに ?ref=email を付けた絶対URLを作る（既にクエリがあれば & で連結） */
export function emailLinkUrl(link: string): string {
  const sep = link.includes("?") ? "&" : "?";
  return `${env.appBaseUrl}${link}${sep}ref=email`;
}

/** HMAC-SHA256(userId, SESSION_SECRET) の hex。配信停止リンクの署名 (#126) */
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
    new TextEncoder().encode(userId),
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

/** 通知メールの最小HTML（インラインスタイル・ライト配色） */
export function notificationEmailHtml(opts: {
  title: string;
  body: string;
  linkUrl: string | null;
  unsubscribeUrl: string;
}): string {
  const button = opts.linkUrl
    ? `<p style="margin:24px 0;">
        <a href="${escapeHtml(opts.linkUrl)}"
           style="display:inline-block;background:#1E293B;color:#FFFFFF;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;">
          詳細を見る
        </a>
      </p>`
    : "";
  const body = opts.body
    ? `<p style="margin:0 0 8px;color:#334155;font-size:15px;line-height:1.7;">${escapeHtml(opts.body)}</p>`
    : "";
  return `<div style="background:#F8FAFC;padding:32px 16px;font-family:'Hiragino Sans','Noto Sans JP',system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;padding:32px;">
    <p style="margin:0 0 24px;color:#64748B;font-size:13px;font-weight:600;letter-spacing:.05em;">events lab</p>
    <h1 style="margin:0 0 12px;color:#0F172A;font-size:18px;line-height:1.5;">${escapeHtml(opts.title)}</h1>
    ${body}
    ${button}
  </div>
  <p style="max-width:560px;margin:16px auto 0;color:#94A3B8;font-size:12px;line-height:1.6;">
    このメールは events lab のメール通知設定が ON のため送信されています。<br>
    <a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#64748B;">メール通知を停止する</a>
  </p>
</div>`;
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
      console.warn(`email: Resend 送信失敗 status=${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("email: Resend 送信エラー", e);
    return false;
  }
}

/** 通知メールを1通組み立てて送る（宛先解決済みの内部ヘルパー） */
export async function sendNotificationEmailTo(
  userId: string,
  to: string,
  title: string,
  body: string,
  link: string,
): Promise<boolean> {
  const unsub = await unsubscribeUrl(userId);
  const html = notificationEmailHtml({
    title,
    body,
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
 * 失敗しても呼び出し元（通知作成）を壊さない */
export async function sendNotificationEmailIfOptedIn(
  userId: string,
  title: string,
  body: string,
  link: string,
): Promise<void> {
  try {
    const to = await emailRepo.findRecipient(userId);
    if (!to) return;
    await sendNotificationEmailTo(userId, to, title, body, link);
  } catch (e) {
    console.warn("email: 通知メール送信に失敗", e);
  }
}
