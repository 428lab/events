import { describe, it, expect, vi, afterEach } from "vitest";
import {
  RedirectNotAllowedError,
  blueskyFetch,
} from "../src/auth/bluesky/fetch.js";
import {
  createBlueskyDidResolver,
  didDocumentUrl,
} from "../src/auth/bluesky/didResolver.js";

/** `redirect: 'error'` の回避策（設計 8）。テスト6・6b。
 * workerd は `redirect: 'error'` を Request の構築時点で拒否するので、
 * 「'manual' に読み替える」「3xx は自分で例外にする」の2点が要件 */

const DID = "did:plc:z72i7hdynmk6r22z27h6tvur";

function didDoc(id: string = DID): Record<string, unknown> {
  return {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id,
    alsoKnownAs: ["at://example.test"],
    verificationMethod: [],
    service: [
      {
        id: "#atproto_pds",
        type: "AtprotoPersonalDataServer",
        serviceEndpoint: "https://pds.example.test",
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Bluesky fetch ラッパ (#381)", () => {
  it("redirect: 'error' は 'manual' に置き換えて渡す", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
      seen.push(init);
      return new Response("ok", { status: 200 });
    });
    const res = await blueskyFetch("https://example.test/x", {
      redirect: "error",
      headers: { accept: "text/plain" },
    });
    expect(res.status).toBe(200);
    expect(seen[0].redirect).toBe("manual");
    // 他の init はそのまま渡る
    expect(seen[0].headers).toEqual({ accept: "text/plain" });
  });

  it("3xx が返ったら例外にする（黙って追従しない）", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.test/" },
        }),
    );
    await expect(
      blueskyFetch("https://example.test/x", { redirect: "error" }),
    ).rejects.toBeInstanceOf(RedirectNotAllowedError);
  });

  it("redirect: 'follow' はそのまま素の fetch に渡す（3xx でも例外にしない）", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
      seen.push(init);
      return new Response("ok", { status: 200 });
    });
    await blueskyFetch("https://example.test/x", { redirect: "follow" });
    expect(seen[0].redirect).toBe("follow");
  });

  it("init 未指定でもそのまま通す", async () => {
    vi.stubGlobal("fetch", async () => new Response("ok", { status: 200 }));
    const res = await blueskyFetch("https://example.test/x");
    expect(res.status).toBe(200);
  });
});

describe("Bluesky 自前 didResolver (#381)", () => {
  it("did:plc は plc.directory の URL を組み立てる", () => {
    expect(didDocumentUrl(DID).toString()).toBe(
      `https://plc.directory/${encodeURIComponent(DID)}`,
    );
  });

  it("did:web は /.well-known/did.json（パス付きは <path>/did.json）", () => {
    expect(didDocumentUrl("did:web:example.test").toString()).toBe(
      "https://example.test/.well-known/did.json",
    );
    expect(didDocumentUrl("did:web:example.test:user:alice").toString()).toBe(
      "https://example.test/user/alice/did.json",
    );
  });

  it("未対応の DID メソッドは例外", () => {
    expect(() => didDocumentUrl("did:key:zabc")).toThrow();
  });

  it("DID ドキュメントを検証して返す", async () => {
    const resolver = createBlueskyDidResolver({
      fetch: (async () => jsonResponse(didDoc())) as typeof globalThis.fetch,
    });
    const doc = await resolver.resolve(DID);
    expect(doc.id).toBe(DID);
  });

  it("3xx は例外（追従しない）", async () => {
    const resolver = createBlueskyDidResolver({
      fetch: (async () =>
        new Response(null, {
          status: 301,
          headers: { location: "https://evil.test/" },
        })) as typeof globalThis.fetch,
    });
    await expect(resolver.resolve(DID)).rejects.toThrow(/redirect/i);
  });

  it("doc.id が要求した DID と違えば例外", async () => {
    const resolver = createBlueskyDidResolver({
      fetch: (async () =>
        jsonResponse(
          didDoc("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"),
        )) as typeof globalThis.fetch,
    });
    await expect(resolver.resolve(DID)).rejects.toThrow(/mismatch/i);
  });

  it("DID ドキュメントとして不正なら例外", async () => {
    const resolver = createBlueskyDidResolver({
      fetch: (async () =>
        jsonResponse({ id: "not-a-did" })) as typeof globalThis.fetch,
    });
    await expect(resolver.resolve(DID)).rejects.toThrow();
  });

  it("JSON でない content-type は例外", async () => {
    const resolver = createBlueskyDidResolver({
      fetch: (async () =>
        new Response(JSON.stringify(didDoc()), {
          status: 200,
          headers: { "content-type": "text/html" },
        })) as typeof globalThis.fetch,
    });
    await expect(resolver.resolve(DID)).rejects.toThrow(/content type/i);
  });

  it("2xx 以外は例外", async () => {
    const resolver = createBlueskyDidResolver({
      fetch: (async () =>
        new Response("nope", { status: 404 })) as typeof globalThis.fetch,
    });
    await expect(resolver.resolve(DID)).rejects.toThrow(/404/);
  });
});
