import { describe, it, expect, afterEach, vi } from "vitest";
import { setupWebAnalytics } from "./webAnalytics.js";

const beacons = () =>
  document.querySelectorAll<HTMLScriptElement>(
    'script[src^="https://static.cloudflareinsights.com/"]',
  );

afterEach(() => {
  vi.unstubAllEnvs();
  beacons().forEach((el) => el.remove());
});

describe("setupWebAnalytics (#328)", () => {
  it("識別子が未設定なら何も読み込まない", () => {
    vi.stubEnv("VITE_WEB_ANALYTICS_TOKEN", "");
    setupWebAnalytics();
    expect(beacons()).toHaveLength(0);
  });

  it("識別子があれば計測タグを足す。画面遷移も拾う設定にする", () => {
    vi.stubEnv("VITE_WEB_ANALYTICS_TOKEN", "test-token");
    setupWebAnalytics();
    const [script] = beacons();
    expect(script).toBeTruthy();
    expect(script.defer).toBe(true);
    expect(
      JSON.parse(script.getAttribute("data-cf-beacon") ?? "{}"),
    ).toStrictEqual({ token: "test-token", spa: true });
  });

  it("二重に呼んでも計測タグは1つだけ（閲覧が二重に数えられない）", () => {
    vi.stubEnv("VITE_WEB_ANALYTICS_TOKEN", "test-token");
    setupWebAnalytics();
    setupWebAnalytics();
    expect(beacons()).toHaveLength(1);
  });

  it("読み込みに失敗しても例外を投げない（画面の表示に影響させない）", () => {
    vi.stubEnv("VITE_WEB_ANALYTICS_TOKEN", "test-token");
    const broken = {
      querySelector: () => null,
      createElement: () => {
        throw new Error("boom");
      },
    } as unknown as Document;
    expect(() => setupWebAnalytics(broken)).not.toThrow();
  });
});
