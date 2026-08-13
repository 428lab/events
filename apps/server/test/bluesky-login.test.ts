import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { bindEnv, type Env } from "../src/runtime.js";
import { finishIdentityLogin } from "../src/auth/accountLink.js";
import {
  buildClientMetadata,
  createBlueskyClient,
} from "../src/auth/bluesky/client.js";
import { normalizeBlueskyHandle } from "../src/auth/bluesky/index.js";

/**
 * Bluesky ログイン (#381) のルートと入口の検証。設計 14 のテスト 1〜4・7・9。
 * **外部通信はしない。** 認可サーバーとの実通信は staging で見る。
 */

const BASE = "https://example.com";
// テスト環境の APP_BASE_URL は http://localhost（＝localhost 例外の側）
const LOOPBACK_REDIRECT = "http://127.0.0.1/api/auth/bluesky/callback";

interface ClientMetadata {
  client_id: string;
  redirect_uris: string[];
  scope: string;
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  dpop_bound_access_tokens: boolean;
  application_type: string;
  client_uri: string;
}

describe("Bluesky client-metadata.json (#381)", () => {
  it("200 / application/json で返る", async () => {
    const res = await SELF.fetch(
      `${BASE}/api/auth/bluesky/client-metadata.json`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const meta = (await res.json()) as ClientMetadata;
    expect(meta.token_endpoint_auth_method).toBe("none");
    expect(meta.dpop_bound_access_tokens).toBe(true);
    expect(meta.scope).toBe("atproto");
    // トークンを保存しないので refresh_token は宣言しない
    expect(meta.grant_types).toEqual(["authorization_code"]);
    expect(meta.response_types).toEqual(["code"]);
    expect(meta.application_type).toBe("web");
    // テスト環境の base は http なので localhost 例外の形
    expect(meta.redirect_uris).toEqual([LOOPBACK_REDIRECT]);
    expect(meta.client_id).toBe(
      `http://localhost?redirect_uri=${encodeURIComponent(LOOPBACK_REDIRECT)}&scope=atproto`,
    );
  });

  it("https の base では client_id が自分自身の URL になる", () => {
    const meta = buildClientMetadata(
      "https://events.example.com",
    ) as unknown as ClientMetadata;
    expect(meta.client_id).toBe(
      "https://events.example.com/api/auth/bluesky/client-metadata.json",
    );
    expect(meta.redirect_uris).toEqual([
      "https://events.example.com/api/auth/bluesky/callback",
    ]);
    expect(meta.client_uri).toBe("https://events.example.com");
    // 末尾のスラッシュがあっても同じ
    const meta2 = buildClientMetadata(
      "https://events.example.com/",
    ) as unknown as ClientMetadata;
    expect(meta2.client_id).toBe(meta.client_id);
  });

  it("localhost の base では localhost 例外の形（ポート無し・127.0.0.1）", () => {
    const meta = buildClientMetadata(
      "http://localhost:4280",
    ) as unknown as ClientMetadata;
    const redirect = "http://127.0.0.1:4280/api/auth/bluesky/callback";
    expect(meta.redirect_uris).toEqual([redirect]);
    // client_id はポートを付けない・パスは空（RFC 8252 とライブラリの要求）
    expect(meta.client_id).toBe(
      `http://localhost?redirect_uri=${encodeURIComponent(redirect)}&scope=atproto`,
    );
  });
});

describe("OAuthClient の組み立て (#381)", () => {
  // ライブラリは client metadata を構築時に検証する（scope・grant_types・
  // client_id の形など）。外部通信は起きないので、ここで両方の環境を通しておく
  it("本番相当（https）と dev（localhost 例外）のどちらでも組み立てられる", () => {
    bindEnv({
      ...(env as unknown as Env),
      APP_BASE_URL: "https://events.example.com",
    });
    expect(() => createBlueskyClient()).not.toThrow();
    bindEnv(env as unknown as Env);
    expect(() => createBlueskyClient()).not.toThrow();
  });
});

describe("Bluesky ハンドルの正規化 (#381)", () => {
  it("前後空白・先頭の @・大文字を落とす", () => {
    expect(normalizeBlueskyHandle("  @YourName.Bsky.Social ")).toBe(
      "yourname.bsky.social",
    );
    expect(normalizeBlueskyHandle("example.com")).toBe("example.com");
  });

  it("空・不正な文字・長すぎるものは null", () => {
    expect(normalizeBlueskyHandle(undefined)).toBeNull();
    expect(normalizeBlueskyHandle("")).toBeNull();
    expect(normalizeBlueskyHandle("   ")).toBeNull();
    expect(normalizeBlueskyHandle("@")).toBeNull();
    // ドット無し（TLD が無い）
    expect(normalizeBlueskyHandle("nodot")).toBeNull();
    expect(normalizeBlueskyHandle("bad handle.example.com")).toBeNull();
    expect(normalizeBlueskyHandle("under_score.example.com")).toBeNull();
    expect(normalizeBlueskyHandle(`${"a".repeat(300)}.example.com`)).toBeNull();
  });
});

describe("Bluesky /login の入力検証 (#381)", () => {
  it("ハンドル未指定・空・不正は外部へ出る前に 400", async () => {
    for (const q of ["", "?handle=", "?handle=%20", "?handle=nodot", "?handle=@"]) {
      const res = await SELF.fetch(`${BASE}/api/auth/bluesky/login${q}`, {
        redirect: "manual",
      });
      expect([q, res.status]).toEqual([q, 400]);
    }
  });
});

/** state 行を直接作る（認可開始は外部通信を伴うのでテストでは回さない） */
async function insertState(
  state: string,
  tag: string,
  createdAt = Date.now(),
): Promise<void> {
  const data = JSON.stringify({
    iss: "https://bsky.social",
    dpopJwk: {},
    authMethod: { method: "none" },
    verifier: "v",
    appState: JSON.stringify({ tag }),
  });
  await env.DB.prepare(
    "INSERT INTO bluesky_oauth_state (state, data, created_at) VALUES (?, ?, ?)",
  )
    .bind(state, data, createdAt)
    .run();
}

async function stateExists(state: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT state FROM bluesky_oauth_state WHERE state = ?",
  )
    .bind(state)
    .first();
  return row !== null;
}

describe("Bluesky /callback の state 検証 (#381)", () => {
  it("state が無ければ 400", async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/bluesky/callback?code=x`, {
      redirect: "manual",
    });
    expect(res.status).toBe(400);
  });

  it("知らない state は 400（我々が発行していない・リプレイ）", async () => {
    const res = await SELF.fetch(
      `${BASE}/api/auth/bluesky/callback?code=x&state=unknown-${crypto.randomUUID()}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(400);
  });

  it("cookie の tag が一致しなければ 400。その state は使い捨てになる", async () => {
    const state = `s_${crypto.randomUUID()}`;
    await insertState(state, "the-real-tag");
    const res = await SELF.fetch(
      `${BASE}/api/auth/bluesky/callback?code=x&state=${state}`,
      {
        headers: { cookie: "eventer_bluesky_tag=someone-elses-tag" },
        redirect: "manual",
      },
    );
    expect(res.status).toBe(400);
    // 行は消えているので、正しい tag で送り直しても通らない（1回きり）
    expect(await stateExists(state)).toBe(false);
    const again = await SELF.fetch(
      `${BASE}/api/auth/bluesky/callback?code=x&state=${state}`,
      {
        headers: { cookie: "eventer_bluesky_tag=the-real-tag" },
        redirect: "manual",
      },
    );
    expect(again.status).toBe(400);
  });

  it("cookie が無ければ 400", async () => {
    const state = `s_${crypto.randomUUID()}`;
    await insertState(state, "the-real-tag");
    const res = await SELF.fetch(
      `${BASE}/api/auth/bluesky/callback?code=x&state=${state}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(400);
  });

  it("期限切れの state はやり直しの案内へ戻す（400 にしない）", async () => {
    const state = `s_${crypto.randomUUID()}`;
    await insertState(state, "tag", Date.now() - 11 * 60 * 1000);
    const res = await SELF.fetch(
      `${BASE}/api/auth/bluesky/callback?code=x&state=${state}`,
      {
        headers: { cookie: "eventer_bluesky_tag=tag" },
        redirect: "manual",
      },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "http://localhost/login?bluesky_error=expired",
    );
    expect(await stateExists(state)).toBe(false);
  });
});

/** ユーザー1人＋セッション */
async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, NULL, NULL, ?)",
  )
    .bind(uid, `t:${uid}`, `t_${uid.slice(0, 8)}`, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

async function linkIdentity(
  userId: string,
  provider: string,
  providerUserId: string,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO identity (id, user_id, provider, provider_user_id, email, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(crypto.randomUUID(), userId, provider, providerUserId, Date.now())
    .run();
}

/** finishIdentityLogin を Context 付きで呼ぶための最小のアプリ */
const probe = new Hono();
probe.get("/probe", async (c) => {
  const did = c.req.query("did")!;
  const result = await finishIdentityLogin(c, {
    provider: "bluesky",
    providerUserId: did,
    profile: {
      username: "bsky_user",
      globalName: null,
      avatarUrl: null,
      email: null,
    },
  });
  return c.json(result);
});

async function runFinish(
  did: string,
  cookie?: string,
): Promise<Record<string, unknown>> {
  bindEnv(env as unknown as Env);
  const res = await probe.request(
    `http://localhost/probe?did=${encodeURIComponent(did)}`,
    cookie ? { headers: { cookie } } : {},
  );
  return (await res.json()) as Record<string, unknown>;
}

describe("Bluesky の引き取り規則は既存と同じ (#381)", () => {
  it("未ログイン・未知の DID は新規作成してログインになる", async () => {
    const did = `did:plc:${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const result = await runFinish(did);
    expect(result.kind).toBe("logged_in");
    expect(result.pendingDeletion).toBe(false);
    const row = await env.DB.prepare(
      "SELECT user_id FROM identity WHERE provider='bluesky' AND provider_user_id = ?",
    )
      .bind(did)
      .first<{ user_id: string }>();
    expect(row).toBeTruthy();
  });

  it("ログイン中なら連携になる", async () => {
    const me = await makeUser();
    const did = `did:plc:${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const result = await runFinish(did, me.cookie);
    expect(result.kind).toBe("linked");
    const row = await env.DB.prepare(
      "SELECT user_id FROM identity WHERE provider='bluesky' AND provider_user_id = ?",
    )
      .bind(did)
      .first<{ user_id: string }>();
    expect(row?.user_id).toBe(me.userId);
  });

  it("空アカウントに連携済みなら引き取る（相手の行ごと消える）", async () => {
    const me = await makeUser();
    const orphan = await makeUser();
    const did = `did:plc:${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    await linkIdentity(orphan.userId, "bluesky", did);

    const result = await runFinish(did, me.cookie);
    expect(result.kind).toBe("linked");
    const row = await env.DB.prepare(
      "SELECT user_id FROM identity WHERE provider='bluesky' AND provider_user_id = ?",
    )
      .bind(did)
      .first<{ user_id: string }>();
    expect(row?.user_id).toBe(me.userId);
    const gone = await env.DB.prepare("SELECT id FROM user WHERE id = ?")
      .bind(orphan.userId)
      .first();
    expect(gone).toBeNull();
  });

  it("連携が2つ以上あるアカウントは引き取らない（already_linked）", async () => {
    const me = await makeUser();
    const other = await makeUser();
    const did = `did:plc:${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    await linkIdentity(other.userId, "bluesky", did);
    await linkIdentity(other.userId, "nostr", crypto.randomUUID());

    const result = await runFinish(did, me.cookie);
    expect(result).toEqual({ kind: "link_error", code: "already_linked" });
  });
});

describe("Bluesky の連携解除 (#381)", () => {
  it("bluesky を解除できる（unknown_provider にならない）", async () => {
    const me = await makeUser();
    await linkIdentity(me.userId, "bluesky", `did:plc:${crypto.randomUUID()}`);
    await linkIdentity(me.userId, "nostr", crypto.randomUUID());
    const res = await SELF.fetch(`${BASE}/api/auth/identities/bluesky`, {
      method: "DELETE",
      headers: { cookie: me.cookie },
    });
    expect(res.status).toBe(200);
    const left = await env.DB.prepare(
      "SELECT provider FROM identity WHERE user_id = ?",
    )
      .bind(me.userId)
      .all<{ provider: string }>();
    expect(left.results.map((r) => r.provider)).toEqual(["nostr"]);
  });

  it("最後の1つは外せない（409）", async () => {
    const me = await makeUser();
    await linkIdentity(me.userId, "bluesky", `did:plc:${crypto.randomUUID()}`);
    const res = await SELF.fetch(`${BASE}/api/auth/identities/bluesky`, {
      method: "DELETE",
      headers: { cookie: me.cookie },
    });
    expect(res.status).toBe(409);
  });
});
