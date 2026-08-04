import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

/** staging 相当の env で worker を直接叩く（SELF のバインディングは変えられない） */
async function fetchAsStaging(
  path: string,
  cookie?: string,
): Promise<Response> {
  const { default: worker } = await import("../src/worker.js");
  const staging = { ...(env as Record<string, unknown>), ENVIRONMENT: "staging" };
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`${BASE}${path}`, {
      headers: cookie ? { cookie } : {},
    }),
    staging as never,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function makeUser(deletedAt: number | null): Promise<string> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at, deleted_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)",
  )
    .bind(uid, `g:${uid}`, `g_${uid.slice(0, 8)}`, Date.now(), deletedAt)
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return `eventer_session=${sid}`;
}

describe("staging のログインゲート", () => {
  it("未ログインは弾く", async () => {
    const res = await fetchAsStaging("/api/public/events/search?limit=1");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe(
      "staging_login_required",
    );
  });

  it("在籍中のユーザーは通す", async () => {
    const cookie = await makeUser(null);
    const res = await fetchAsStaging("/api/public/events/search?limit=1", cookie);
    expect(res.status).toBe(200);
  });

  it("退会申請中（猶予期間 #250）もゲートは通す（復帰フローに到達できるように）", async () => {
    const cookie = await makeUser(Date.now());
    // ページ側: ゲートHTML(403)ではなく SPA が返る
    const page = await fetchAsStaging("/account", cookie);
    expect(page.status).not.toBe(403);
    // API 側: ゲートの 403 ではなく、復帰案内の 403 pending_deletion が返る
    const me = await fetchAsStaging("/api/auth/me", cookie);
    expect(((await me.json()) as { error?: string }).error).toBe(
      "pending_deletion",
    );
  });
});
