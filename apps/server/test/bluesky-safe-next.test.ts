import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { safeRedirectPath } from "@eventer/shared";
import { bindEnv, type Env } from "../src/runtime.js";
import { safeNext } from "../src/routes/authBluesky.js";

/**
 * ログイン後の戻り先の検証 (#381)。
 *
 * **画面側と同じ規則**（`@eventer/shared` の `safeRedirectPath`）を通していること。
 * もとはサーバー側だけ「先頭が `/` か」しか見ておらず、`/\evil.com` が通っていた。
 *
 * いちばん怖いのは**改行**。素通りさせると `c.redirect()` が Location ヘッダの
 * 検証で落ちて 500 になり、**セッションは発行済みなのに cookie が飛ばない**
 * ——利用者から見ると「ログインしたのに未ログイン」になる。
 */

beforeAll(() => {
  bindEnv(env as unknown as Env);
});

/** 実際に 302 を組んでみる（Location が不正なら Response の構築で投げる） */
function buildRedirect(path: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location: `${env.APP_BASE_URL}${path}` },
  });
}

describe("Bluesky の戻り先 (#381)", () => {
  it("自サイト内のパスは通す", () => {
    expect(safeNext("/me")).toBe("/me");
    expect(safeNext("/events/1?tab=x#y")).toBe("/events/1?tab=x#y");
  });

  it("外部へ飛ばす書き方をすべて弾く", () => {
    expect(safeNext("//evil.example")).toBeUndefined();
    expect(safeNext("//evil.example/path")).toBeUndefined();
    // 一部のブラウザが "//" と同一視する。**旧実装はこれを通していた**
    expect(safeNext("/\\evil.example")).toBeUndefined();
    expect(safeNext("/\\/evil.example")).toBeUndefined();
    expect(safeNext("https://evil.example/x")).toBeUndefined();
    expect(safeNext("javascript:alert(1)")).toBeUndefined();
    expect(safeNext("me")).toBeUndefined();
    expect(safeNext("")).toBeUndefined();
    expect(safeNext(undefined)).toBeUndefined();
  });

  /**
   * 改行・タブ入りの値。URL の解析器がこれらを取り除くので、返る値は
   * ヘッダに載せられる形になっている（**素通りしない**）。
   */
  it("改行やタブが入っていても、Location に載せられる値だけを返す", () => {
    for (const raw of [
      "/me\nSet-Cookie: a=b",
      "/me\r\nLocation: https://evil.example",
      "/me\tx",
      "/\n/evil.example",
    ]) {
      const next = safeNext(raw);
      if (next !== undefined) {
        expect(next, raw).not.toMatch(/[\r\n\t]/);
        // ここで投げるなら、本番では 302 が返らずセッションだけが残る
        expect(() => buildRedirect(next), raw).not.toThrow();
      }
    }
  });

  it("改行入りでも外部オリジンへは飛ばさない", () => {
    // "/\n/evil.example" は解析器が改行を落とすと "//evil.example" になる
    expect(safeNext("/\n/evil.example")).toBeUndefined();
    expect(safeNext("/\r\n\\evil.example")).toBeUndefined();
  });

  it("画面側と同じ関数を通している（規則が2か所に分かれていない）", () => {
    for (const raw of ["/me", "/\\evil.example", "//evil.example", "/a?b=1#c"]) {
      expect(safeNext(raw), raw).toBe(
        safeRedirectPath(raw, env.APP_BASE_URL) ?? undefined,
      );
    }
  });
});
