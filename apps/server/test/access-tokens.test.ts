import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AccessToken, CreatedAccessToken } from "@eventer/shared";
import { bindEnv } from "../src/runtime.js";
import { requireAuth, requireScope } from "../src/auth/session.js";
import type { AppEnv } from "../src/types.js";

/**
 * AI 連携のアクセストークン (#581)。設計は docs/ai-integration.md §4。
 *
 * - 設定 API（発行・一覧・失効）は Cookie 専用
 * - Bearer は /api/mcp と /api/ai/* だけで有効。それ以外は 401 token_not_allowed_here
 * - 失効・期限切れ・未知は 401（WWW-Authenticate 付き）
 * - Bearer 経路は DAU/MAU に数えない（last_seen_at を書かない）
 * - 退会申請で全失効、統合で負け側は破棄
 *
 * /api/ai/* のルートは PR2 で入るので、ここでは同じ requireAuth / requireScope を
 * 載せたテスト用の Hono アプリで Bearer 経路を確かめる（currentUser は入口1か所なので
 * 本物のルートと同じ判定を通る）。
 */

const BASE = "https://example.com";
const DAY = 24 * 60 * 60 * 1000;

async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, NULL, NULL, ?)",
  )
    .bind(uid, `t:${uid}`, `t_${uid.slice(0, 8)}`, Date.now())
    .run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sid, uid, Date.now() + DAY)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

async function issue(
  cookie: string,
  body: Record<string, unknown> = { name: "Claude Code" },
  extra: Record<string, string> = {},
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/me/access-tokens`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, ...extra },
    body: JSON.stringify(body),
  });
}

async function issueOk(
  cookie: string,
  body: Record<string, unknown> = { name: "Claude Code" },
): Promise<CreatedAccessToken> {
  const res = await issue(cookie, body);
  expect(res.status).toBe(200);
  return (await res.json()) as CreatedAccessToken;
}

async function list(cookie: string): Promise<AccessToken[]> {
  const res = await SELF.fetch(`${BASE}/api/me/access-tokens`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { tokens: AccessToken[] }).tokens;
}

async function tokenRow(id: string) {
  return env.DB.prepare("SELECT * FROM access_token WHERE id = ?")
    .bind(id)
    .first<{
      token_hash: string;
      token_prefix: string;
      scopes: string;
      expires_at: number;
      last_used_at: number | null;
      revoked_at: number | null;
    }>();
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** /api/ai/* と同じ載せ方（use("*", requireAuth)）のテスト用アプリ */
const aiApp = new Hono<AppEnv>();
aiApp.use("/api/ai/*", requireAuth);
aiApp.get("/api/ai/v1/whoami", (c) =>
  c.json({ id: c.get("user").id, principal: c.get("principal") }),
);
aiApp.post("/api/ai/v1/write", requireScope("write"), (c) => c.json({ ok: true }));
// 到達範囲外（/api/me と同じ載せ方）
aiApp.use("/api/me/*", requireAuth);
aiApp.get("/api/me/x", (c) => c.json({ id: c.get("user").id }));

function hitAi(
  path: string,
  headers: Record<string, string>,
  method = "GET",
): Promise<Response> {
  return Promise.resolve(aiApp.request(`${BASE}${path}`, { method, headers }));
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

beforeEach(() => {
  bindEnv(env as never);
});

describe("設定 API（発行・一覧・失効）(#581)", () => {
  it("発行すると平文を1回だけ返し、DB にはハッシュと prefix だけを持つ", async () => {
    const u = await makeUser();
    const created = await issueOk(u.cookie, { name: "Claude Code", write: true, expiresInDays: 30 });
    expect(created.token).toMatch(/^evl_[A-Za-z0-9_-]{43}$/);
    expect(created.prefix).toBe(created.token.slice(0, 12));
    expect(created.scopes).toEqual(["read", "write"]);
    expect(created.expiresAt - created.createdAt).toBe(30 * DAY);
    expect(created.lastUsedAt).toBeNull();
    expect(created.revokedAt).toBeNull();

    const row = await tokenRow(created.id);
    expect(row!.token_hash).toBe(await sha256Hex(created.token));
    expect(row!.token_hash).not.toContain(created.token);
    expect(row!.scopes).toBe("read write");

    // 一覧には平文が出ない
    const tokens = await list(u.cookie);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).not.toHaveProperty("token");
    expect(JSON.stringify(tokens)).not.toContain(created.token);
    expect(tokens[0]!.prefix).toBe(created.prefix);

    // 監査ログ。detail に平文を入れない
    const audit = await env.DB.prepare(
      "SELECT detail FROM audit_log WHERE action = 'access_token_create' AND actor_user_id = ?",
    )
      .bind(u.userId)
      .first<{ detail: string }>();
    expect(JSON.parse(audit!.detail)).toEqual({
      tokenId: created.id,
      prefix: created.prefix,
      scopes: ["read", "write"],
      expiresAt: created.expiresAt,
    });
    expect(audit!.detail).not.toContain(created.token);
  });

  it("既定は read のみ・90日。期限は 30/90/180 以外を受けない", async () => {
    const u = await makeUser();
    const created = await issueOk(u.cookie, { name: "x" });
    expect(created.scopes).toEqual(["read"]);
    expect(created.expiresAt - created.createdAt).toBe(90 * DAY);
    expect((await issue(u.cookie, { name: "x", expiresInDays: 365 })).status).toBe(400);
    expect((await issue(u.cookie, { name: "" })).status).toBe(400);
    expect((await issue(u.cookie, { name: "a".repeat(41) })).status).toBe(400);
  });

  it("有効なトークンは10本まで。失効・期限切れは数えない", async () => {
    const u = await makeUser();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await issueOk(u.cookie, { name: `t${i}` })).id);
    const over = await issue(u.cookie, { name: "t10" });
    expect(over.status).toBe(409);
    expect(await over.json()).toEqual({ error: "too_many_tokens" });

    // 1本失効すれば発行できる
    await SELF.fetch(`${BASE}/api/me/access-tokens/${ids[0]}`, {
      method: "DELETE",
      headers: { cookie: u.cookie },
    });
    await issueOk(u.cookie, { name: "t10" });
    expect((await issue(u.cookie, { name: "t11" })).status).toBe(409);

    // 1本期限切れにすれば発行できる
    await env.DB.prepare("UPDATE access_token SET expires_at = ? WHERE id = ?")
      .bind(Date.now() - 1, ids[1])
      .run();
    await issueOk(u.cookie, { name: "t11" });
  });

  it("失効は revoked_at を立てて行を残す。他人の id は 404", async () => {
    const u = await makeUser();
    const other = await makeUser();
    const created = await issueOk(u.cookie);

    const byOther = await SELF.fetch(`${BASE}/api/me/access-tokens/${created.id}`, {
      method: "DELETE",
      headers: { cookie: other.cookie },
    });
    expect(byOther.status).toBe(404);
    expect((await tokenRow(created.id))!.revoked_at).toBeNull();

    const res = await SELF.fetch(`${BASE}/api/me/access-tokens/${created.id}`, {
      method: "DELETE",
      headers: { cookie: u.cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const tokens = await list(u.cookie);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.revokedAt).not.toBeNull();

    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'access_token_revoke' AND actor_user_id = ?",
    )
      .bind(u.userId)
      .first<{ n: number }>();
    expect(audit!.n).toBe(1);

    // 失効したトークンは使えない
    const used = await hitAi("/api/ai/v1/whoami", bearer(created.token));
    expect(used.status).toBe(401);
  });

  it("未ログインは 401。Bearer では発行も一覧も失効もできない（Cookie と併用しても）", async () => {
    const u = await makeUser();
    const created = await issueOk(u.cookie, { name: "x", write: true });
    expect((await issue("", { name: "x" })).status).toBe(401);

    for (const [method, path] of [
      ["GET", "/api/me/access-tokens"],
      ["POST", "/api/me/access-tokens"],
      ["DELETE", `/api/me/access-tokens/${created.id}`],
    ] as const) {
      for (const headers of [bearer(created.token), { ...bearer(created.token), cookie: u.cookie }]) {
        const res = await SELF.fetch(`${BASE}${path}`, {
          method,
          headers: { "content-type": "application/json", ...headers },
          body: method === "POST" ? JSON.stringify({ name: "x" }) : undefined,
        });
        expect(res.status, `${method} ${path}`).toBe(401);
        expect(await res.json()).toEqual({ error: "token_not_allowed_here" });
      }
    }
    expect(await list(u.cookie)).toHaveLength(1);
    expect((await tokenRow(created.id))!.revoked_at).toBeNull();
  });
});

describe("Bearer 認証 (#581)", () => {
  it("/api/ai/* では本人として通り、principal は token", async () => {
    const u = await makeUser();
    const created = await issueOk(u.cookie);
    const res = await hitAi("/api/ai/v1/whoami", bearer(created.token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: u.userId,
      principal: { kind: "token", tokenId: created.id, scopes: ["read"] },
    });
  });

  it("Cookie だけなら principal は session", async () => {
    const u = await makeUser();
    const res = await hitAi("/api/ai/v1/whoami", { cookie: u.cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: u.userId, principal: { kind: "session" } });
  });

  it("Cookie と Bearer が両方あれば Bearer を優先する", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const tb = await issueOk(b.cookie);
    const res = await hitAi("/api/ai/v1/whoami", { ...bearer(tb.token), cookie: a.cookie });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe(b.userId);
  });

  it("未知・期限切れ・失効は 401 と WWW-Authenticate", async () => {
    const u = await makeUser();
    const unknown = await hitAi("/api/ai/v1/whoami", bearer(`evl_${"A".repeat(43)}`));
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual({ error: "invalid_token" });
    expect(unknown.headers.get("WWW-Authenticate")).toBe(
      'Bearer realm="events lab", error="invalid_token"',
    );

    const expired = await issueOk(u.cookie);
    await env.DB.prepare("UPDATE access_token SET expires_at = ? WHERE id = ?")
      .bind(Date.now() - 1, expired.id)
      .run();
    const r1 = await hitAi("/api/ai/v1/whoami", bearer(expired.token));
    expect(r1.status).toBe(401);
    expect(await r1.json()).toEqual({ error: "token_expired" });
    expect(r1.headers.get("WWW-Authenticate")).toContain("Bearer");

    const revoked = await issueOk(u.cookie);
    await env.DB.prepare("UPDATE access_token SET revoked_at = ? WHERE id = ?")
      .bind(Date.now(), revoked.id)
      .run();
    const r2 = await hitAi("/api/ai/v1/whoami", bearer(revoked.token));
    expect(r2.status).toBe(401);
    expect(await r2.json()).toEqual({ error: "invalid_token" });
  });

  it("到達範囲外のパスは 401 token_not_allowed_here（Cookie があっても）", async () => {
    const u = await makeUser();
    const created = await issueOk(u.cookie);
    const local = await hitAi("/api/me/x", { ...bearer(created.token), cookie: u.cookie });
    expect(local.status).toBe(401);
    expect(await local.json()).toEqual({ error: "token_not_allowed_here" });

    // 本物の worker でも、認証必須・任意認証のどちらの経路でも同じ
    for (const path of ["/api/me/events", "/api/auth/me", "/api/notifications"]) {
      const res = await SELF.fetch(`${BASE}${path}`, { headers: bearer(created.token) });
      expect(res.status, path).toBe(401);
      expect(await res.json()).toEqual({ error: "token_not_allowed_here" });
    }
  });

  it("この環境の接頭辞でない Bearer はトークンとして扱わない（Cookie 経路へ）", async () => {
    const u = await makeUser();
    const res = await hitAi("/api/ai/v1/whoami", { ...bearer(`evls_${"A".repeat(43)}`), cookie: u.cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: u.userId, principal: { kind: "session" } });
  });

  it("requireScope('write'): read トークンは 403、write トークンと Cookie は通る", async () => {
    const u = await makeUser();
    const read = await issueOk(u.cookie, { name: "r" });
    const write = await issueOk(u.cookie, { name: "w", write: true });
    const r = await hitAi("/api/ai/v1/write", bearer(read.token), "POST");
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "insufficient_scope" });
    expect((await hitAi("/api/ai/v1/write", bearer(write.token), "POST")).status).toBe(200);
    expect((await hitAi("/api/ai/v1/write", { cookie: u.cookie }, "POST")).status).toBe(200);
  });

  it("DAU/MAU に数えない（last_seen_at を書かない）。last_used_at は5分に1回だけ", async () => {
    const u = await makeUser();
    const created = await issueOk(u.cookie);
    // 発行の Cookie リクエストで書かれた分を消してから測る
    await env.DB.prepare("UPDATE user SET last_seen_at = NULL WHERE id = ?").bind(u.userId).run();
    await env.DB.prepare("DELETE FROM user_active_day WHERE user_id = ?").bind(u.userId).run();

    const before = Date.now();
    expect((await hitAi("/api/ai/v1/whoami", bearer(created.token))).status).toBe(200);
    const seen = await env.DB.prepare("SELECT last_seen_at FROM user WHERE id = ?")
      .bind(u.userId)
      .first<{ last_seen_at: number | null }>();
    expect(seen!.last_seen_at).toBeNull();
    const days = await env.DB.prepare("SELECT COUNT(*) AS n FROM user_active_day WHERE user_id = ?")
      .bind(u.userId)
      .first<{ n: number }>();
    expect(days!.n).toBe(0);

    const used = (await tokenRow(created.id))!.last_used_at;
    expect(used).not.toBeNull();
    expect(used!).toBeGreaterThanOrEqual(before);

    // 5分以内は書き直さない
    const recent = Date.now() - 60_000;
    await env.DB.prepare("UPDATE access_token SET last_used_at = ? WHERE id = ?")
      .bind(recent, created.id)
      .run();
    await hitAi("/api/ai/v1/whoami", bearer(created.token));
    expect((await tokenRow(created.id))!.last_used_at).toBe(recent);

    // 5分を過ぎていれば書く
    const old = Date.now() - 6 * 60_000;
    await env.DB.prepare("UPDATE access_token SET last_used_at = ? WHERE id = ?")
      .bind(old, created.id)
      .run();
    await hitAi("/api/ai/v1/whoami", bearer(created.token));
    expect((await tokenRow(created.id))!.last_used_at!).toBeGreaterThan(old);
  });
});

describe("退会・統合 (#581)", () => {
  it("退会申請で全トークンが失効する", async () => {
    const u = await makeUser();
    const t1 = await issueOk(u.cookie, { name: "a" });
    const t2 = await issueOk(u.cookie, { name: "b", write: true });
    const res = await SELF.fetch(`${BASE}/api/me`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie: u.cookie },
      body: JSON.stringify({ confirm: true }),
    });
    expect(res.status).toBe(200);
    for (const t of [t1, t2]) {
      expect((await tokenRow(t.id))!.revoked_at).not.toBeNull();
      expect((await hitAi("/api/ai/v1/whoami", bearer(t.token))).status).toBe(401);
    }
  });

  it("統合で負け側のトークンは破棄され、勝ち側のものは残る", async () => {
    const winner = await makeUser();
    const loser = await makeUser();
    const tw = await issueOk(winner.cookie, { name: "w" });
    const tl = await issueOk(loser.cookie, { name: "l" });
    const { accountMergeRepo } = await import("../src/db/repositories/accountMerge.js");
    await accountMergeRepo.mergeUsers(winner.userId, loser.userId);
    expect(await tokenRow(tl.id)).toBeNull();
    expect(await tokenRow(tw.id)).not.toBeNull();
    expect((await hitAi("/api/ai/v1/whoami", bearer(tl.token))).status).toBe(401);
    const ok = await hitAi("/api/ai/v1/whoami", bearer(tw.token));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { id: string }).id).toBe(winner.userId);
  });
});
