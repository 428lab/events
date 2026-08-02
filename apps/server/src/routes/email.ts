import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types.js";
import { emailRepo } from "../db/repositories/email.js";
import { unsubscribeToken } from "../lib/email.js";

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

/** 停止完了の最小HTML（メールクライアントのブラウザで開かれる） */
function doneHtml(): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>メール通知を停止しました</title>
<meta name="robots" content="noindex, nofollow">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F8FAFC;color:#0F172A;font-family:system-ui,sans-serif}
.card{text-align:center;padding:40px}
p{color:#64748B;font-size:.9rem}</style>
</head><body><div class="card"><h1 style="font-size:1.2rem">メール通知を停止しました</h1>
<p>再開するには events lab のアカウント設定から「メール通知」を ON にしてください。</p></div></body></html>`;
}

async function handleUnsubscribe(c: Context<AppEnv>) {
  const userId = c.req.query("u") ?? "";
  const token = c.req.query("t") ?? "";
  if (!userId || !token) return c.text("bad request", 400);
  const expected = await unsubscribeToken(userId);
  if (!timingSafeEqual(token, expected)) return c.text("forbidden", 403);
  try {
    await emailRepo.disableEmail(userId);
  } catch {
    // ユーザーが既に削除済みなどでも、停止リンクとしては成功扱いにする（冪等）
  }
  return c.html(doneHtml());
}

export const emailRoutes = new Hono<AppEnv>();
// GET: メール本文のリンクから開く
emailRoutes.get("/unsubscribe", handleUnsubscribe);
// POST: List-Unsubscribe-Post（メールクライアントのワンクリック停止）
emailRoutes.post("/unsubscribe", handleUnsubscribe);
