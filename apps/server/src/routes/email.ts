import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types.js";
import { emailRepo } from "../db/repositories/email.js";
import { unsubscribeToken } from "../lib/email.js";
import { escapeHtml } from "../lib/emailTemplates.js";
import { noticeText, requestLanguage, type NoticeKey } from "../lib/noticeText.js";
import type { AppLanguage } from "@eventer/shared/i18n";

/** メールのワンクリック配信停止 (#126)。署名付きリンクのため認証不要 */

/** タイミング差を作らない比較（長さ一致を確認してから全桁 XOR） */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** 確認ページ（GET）。メールスキャナの先読みGETで誤って停止しないよう、実行はPOSTで行う。
 * 文言はブラウザの言語（Accept-Language）。ログインしていないので宛先の設定は見ない (#352) */
function confirmHtml(action: string, lang: AppLanguage): string {
  const t = (key: NoticeKey) => escapeHtml(noticeText(lang, key));
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t("unsubscribePageTitle")}</title>
<meta name="robots" content="noindex, nofollow">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F8FAFC;color:#0F172A;font-family:system-ui,sans-serif}
.card{text-align:center;padding:40px}
p{color:#64748B;font-size:.9rem}
button{background:#1E293B;color:#fff;border:0;border-radius:8px;padding:12px 28px;font-size:1rem;font-weight:600;cursor:pointer}</style>
</head><body><div class="card"><h1 style="font-size:1.2rem">${t("unsubscribeConfirmTitle")}</h1>
<p>${t("unsubscribeConfirmLead")}</p>
<form method="post" action="${action}"><button type="submit">${t("emailUnsubscribe")}</button></form>
</div></body></html>`;
}

/** 停止完了の最小HTML（メールクライアントのブラウザで開かれる） */
function doneHtml(lang: AppLanguage): string {
  const t = (key: NoticeKey) => escapeHtml(noticeText(lang, key));
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t("unsubscribeDoneTitle")}</title>
<meta name="robots" content="noindex, nofollow">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F8FAFC;color:#0F172A;font-family:system-ui,sans-serif}
.card{text-align:center;padding:40px}
p{color:#64748B;font-size:.9rem}</style>
</head><body><div class="card"><h1 style="font-size:1.2rem">${t("unsubscribeDoneTitle")}</h1>
<p>${t("unsubscribeDoneLead")}</p></div></body></html>`;
}

/** 署名検証。OK なら userId を返す */
async function verify(c: Context<AppEnv>): Promise<string | null> {
  const userId = c.req.query("u") ?? "";
  const token = c.req.query("t") ?? "";
  if (!userId || !token) return null;
  const expected = await unsubscribeToken(userId);
  return timingSafeEqual(token, expected) ? userId : null;
}

export const emailRoutes = new Hono<AppEnv>();
// GET: メール本文のリンクから開く。スキャナの先読みで停止しないよう確認ページのみ表示
emailRoutes.get("/unsubscribe", async (c) => {
  const userId = await verify(c);
  if (!userId) return c.text("forbidden", 403);
  return c.html(confirmHtml(c.req.path + "?" + new URL(c.req.url).searchParams.toString(), requestLanguage(c.req.header("accept-language"))));
});
// POST: 確認ボタン / List-Unsubscribe-Post（RFC 8058 ワンクリック停止）
emailRoutes.post("/unsubscribe", async (c) => {
  const userId = await verify(c);
  if (!userId) return c.text("forbidden", 403);
  try {
    await emailRepo.disableEmail(userId);
  } catch {
    // ユーザーが既に削除済みなどでも、停止リンクとしては成功扱いにする（冪等）
  }
  return c.html(doneHtml(requestLanguage(c.req.header("accept-language"))));
});
