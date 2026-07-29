import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

describe("X ログイン (#45)", () => {
  it("providers 一覧に x が出る（テスト環境は X のみ設定済み）", async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/providers`);
    const { providers } = (await res.json()) as { providers: string[] };
    expect(providers).toContain("x");
    // 未設定のプロバイダは出ない
    expect(providers).not.toContain("discord");
  });

  it("/api/auth/x/login は PKCE(S256) 付きで authorize へリダイレクトする", async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/x/login`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(loc.searchParams.get("client_id")).toBe("test-x-client");
    expect(loc.searchParams.get("response_type")).toBe("code");
    expect(loc.searchParams.get("scope")).toBe("users.read tweet.read");
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    // base64url（43文字前後・パディングなし）
    expect(loc.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(loc.searchParams.get("state")).toBeTruthy();

    // state と PKCE verifier の両方が cookie に保存される
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((v) => v.startsWith("eventer_oauth_state="))).toBe(true);
    expect(cookies.some((v) => v.startsWith("eventer_oauth_verifier="))).toBe(
      true,
    );
  });

  it("未設定プロバイダの login は 503", async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/discord/login`, {
      redirect: "manual",
    });
    expect(res.status).toBe(503);
  });

  it("PKCE verifier cookie なしの callback は 400", async () => {
    // state cookie だけ揃えても verifier が無ければ弾く
    const login = await SELF.fetch(`${BASE}/api/auth/x/login`, {
      redirect: "manual",
    });
    const cookies = login.headers.getSetCookie();
    const stateCookie = cookies
      .find((v) => v.startsWith("eventer_oauth_state="))!
      .split(";")[0];
    const state = new URL(login.headers.get("location")!).searchParams.get(
      "state",
    );
    const res = await SELF.fetch(
      `${BASE}/api/auth/x/callback?code=dummy&state=${state}`,
      { headers: { cookie: stateCookie }, redirect: "manual" },
    );
    expect(res.status).toBe(400);
  });
});
