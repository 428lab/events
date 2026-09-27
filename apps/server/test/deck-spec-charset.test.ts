import { SELF, env, createExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/worker.js";

const path = "/deck-import/v1/spec.md";

describe("GET /deck-import/v1/spec.md", () => {
  it("serves the asset body and status with explicit UTF-8 and its other headers", async () => {
    const asset = await env.ASSETS.fetch(new Request(`https://example.com${path}`));
    const response = await SELF.fetch(`https://example.com${path}`);

    expect(asset.status).toBe(200);
    expect(response.status).toBe(asset.status);
    expect(await response.text()).toBe(await asset.text());
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    for (const [name, value] of asset.headers) {
      if (name !== "content-type") expect(response.headers.get(name)).toBe(value);
    }
  });

  it("adds UTF-8 when ASSETS omits the charset, preserving the actual response", async () => {
    const fetch = vi.fn(async (_request: Request) => new Response("# 仕様を読む", {
      status: 200,
      headers: { "Content-Type": "text/markdown", "X-Asset-Test": "retained" },
    }));
    const response = await worker.fetch(
      new Request(`https://example.com${path}`),
      { ...env, ASSETS: { fetch } } as typeof env,
      createExecutionContext(),
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0].url).toBe(`https://example.com${path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("x-asset-test")).toBe("retained");
    expect(await response.text()).toBe("# 仕様を読む");
  });

  it.each([
    [404, "text/plain", "not found"],
    [200, "text/html", "<html>SPA fallback</html>"],
  ])("does not misclassify an absent asset (%i %s)", async (status, type, body) => {
    const response = await worker.fetch(
      new Request(`https://example.com${path}`),
      { ...env, ASSETS: { fetch: async () => new Response(body, {
        status,
        headers: { "Content-Type": type, "X-Asset-Test": "retained" },
      }) } } as typeof env,
      createExecutionContext(),
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toBe(type);
    expect(response.headers.get("x-asset-test")).toBe("retained");
    expect(await response.text()).toBe(body);
  });
});
