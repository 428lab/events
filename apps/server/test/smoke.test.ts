import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

/** dev-login してセッションcookieを返す */
async function login(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";")[0];
}

describe("smoke", () => {
  it("GET /api/health returns ok", async () => {
    const res = await SELF.fetch(`${BASE}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("未認証の /api/auth/me は 401", async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/me`);
    expect(res.status).toBe(401);
  });

  it("dev-login → イベント作成 → 取得", async () => {
    const cookie = await login();
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        title: "E2Eテストイベント",
        venueType: "offline",
        startsAt: 1,
        endsAt: 99999999999999,
      }),
    });
    expect(create.status).toBe(201);
    const { event } = (await create.json()) as { event: { id: string; title: string } };
    expect(event.title).toBe("E2Eテストイベント");

    const got = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      headers: { cookie },
    });
    expect(got.status).toBe(200);
  });
});
