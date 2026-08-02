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

/** 確認ページ（GET）。メールスキャナの先読みGETで誤って停止しないよう、実行はPOSTで行う */
function confirmHtml(action: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>メール通知の停止</title>
<meta name="robots" content="noindex, nofollow">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F8FAFC;color:#0F172A;font-family:system-ui,sans-serif}
.card{text-align:center;padding:40px}
p{color:#64748B;font-size:.9rem}
button{background:#1E293B;color:#fff;border:0;border-radius:8px;padding:12px 28px;font-size:1rem;font-weight:600;cursor:pointer}</style>
</head><body><div class="card"><h1 style="font-size:1.2rem">メール通知を停止しますか？</h1>
<p>events lab からの通知メールが届かなくなります。</p>
<form method="post" action="${action}"><button type="submit">メール通知を停止する</button></form>
</div></body></html>`;
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
  return c.html(confirmHtml(c.req.path + "?" + new URL(c.req.url).searchParams.toString()));
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
  return c.html(doneHtml());
});
