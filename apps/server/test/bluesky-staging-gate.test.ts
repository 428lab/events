import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";

/**
 * staging ゲートの Bluesky 入口 (#381、設計 13.3)。
 *
 * staging は未ログインに中身を見せないので、**ここから入れないと staging で
 * ログインを試せない**。ハンドルが要るぶん他のボタンと形が違うが、
 * 素のフォームの GET で済むので **JavaScript は増やさない**——その約束を
 * 「script の数」で機械的に固定しておく（増えたらここで落ちる）。
 */

const BASE = "https://example.com";

/** staging 相当の env で worker を直接叩く（SELF のバインディングは変えられない） */
async function stagingGate(): Promise<Response> {
  const { default: worker } = await import("../src/worker.js");
  const staging = { ...(env as Record<string, unknown>), ENVIRONMENT: "staging" };
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`${BASE}/`),
    staging as never,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("staging ゲートの Bluesky (#381)", () => {
  it("ハンドル入力欄1つと送信ボタン1つの素の form が出る", async () => {
    const res = await stagingGate();
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/api/auth/bluesky/login"');
    // 送るのは handle だけ。名前が変わるとサーバー側の入力検証に届かない
    expect(html).toContain('name="handle"');
    expect(html).toContain('placeholder="yourname.bsky.social"');
    expect(html).toContain('type="submit"');
    // 入力欄は1つだけ（ゲートの見た目を増やさない）
    expect(html.match(/<input/g)?.length).toBe(1);
  });

  it("JavaScript を増やしていない（script は Nostr のぶんだけ）", async () => {
    const html = await stagingGate();
    const body = await html.text();
    expect(body.match(/<script/g)?.length).toBe(1);
    // ゲートの JS は NIP-07 を呼ぶためのもの。bluesky は素の form なので出てこない
    const script = body.slice(body.indexOf("<script"));
    expect(script).not.toContain("bluesky");
  });

  /** 認可サーバーは未認証で client-metadata.json を取りに来る。
   *  ゲートが `/api/auth/` を通し続けていることを staging の形で確かめる */
  it("client-metadata.json は未ログインでも通る", async () => {
    const { default: worker } = await import("../src/worker.js");
    const staging = {
      ...(env as Record<string, unknown>),
      ENVIRONMENT: "staging",
    };
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(`${BASE}/api/auth/bluesky/client-metadata.json`),
      staging as never,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
  });
});
