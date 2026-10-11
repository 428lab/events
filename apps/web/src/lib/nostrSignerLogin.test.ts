import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Amber を NIP-55 の `nostrsigner:` で直接呼ぶ URL と、戻ってきた結果の読み取り
 * (D-NOSTR-SIGNER PR-B)。
 */
const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return { ...actual, api: { ...actual.api, get: (...a: unknown[]) => getMock(...a) } };
});

const {
  NOSTR_SIGNER_INTENT_KEY,
  buildSignEventUrl,
  clearNostrSignerIntent,
  parseSignedEventFromUrl,
  readNostrSignerIntent,
  startNostrSignerLogin,
} = await import("./nostrSignerLogin.js");

const SIGNED = {
  id: "e".repeat(64),
  pubkey: "ab".repeat(32),
  created_at: 1,
  kind: 22242,
  tags: [["challenge", "c"]],
  content: "events lab にログイン",
  sig: "cd".repeat(64),
};

function splitUrl(url: string) {
  const q = url.indexOf("?");
  return {
    head: url.slice(0, q),
    params: new URLSearchParams(url.slice(q + 1)),
  };
}

beforeEach(() => {
  localStorage.clear();
  getMock.mockReset();
});

describe("buildSignEventUrl", () => {
  it("お題の雛形を載せ、署名済みイベント全体を同じオリジンの固定パスに返させる", () => {
    const template = {
      kind: 22242,
      created_at: 100,
      tags: [
        ["relay", "https://events.kojira.io"],
        ["challenge", "abc"],
      ],
      content: "events lab にログイン",
    };
    const { head, params } = splitUrl(
      buildSignEventUrl(template, "https://events.kojira.io"),
    );
    expect(head.startsWith("nostrsigner:")).toBe(true);
    expect(JSON.parse(decodeURIComponent(head.slice("nostrsigner:".length)))).toEqual(template);
    expect(params.get("type")).toBe("sign_event");
    expect(params.get("returnType")).toBe("event");
    expect(params.get("compressionType")).toBe("none");
    expect(params.get("appName")).toBe("events lab");
    expect(params.get("callbackUrl")).toBe(
      "https://events.kojira.io/login/nostr-signer#",
    );
  });

  it("Amber の読み方（全体をデコードして `?` と `&` で区切る）でも、戻り先と名前が崩れない", () => {
    const url = buildSignEventUrl(
      { kind: 22242, created_at: 1, tags: [["challenge", "abc"]], content: "events lab にログイン" },
      "https://events.kojira.io",
    );
    // Amber IntentUtils.decodeData / getIntentDataWithoutExtras と同じ手順
    const decoded = decodeURIComponent(url.replace("nostrsigner:", "").replace(/\+/g, "%2b"));
    const [data, ...rest] = decoded.split("?");
    const read: Record<string, string> = {};
    for (const pair of rest.filter((p) => p.trim() !== "").flatMap((p) => p.split("&"))) {
      const [k, ...v] = pair.split("=");
      read[k] = v.join("=");
    }
    expect(read.callbackUrl).toBe("https://events.kojira.io/login/nostr-signer#");
    expect(read.appName).toBe("events lab");
    expect(read.type).toBe("sign_event");
    expect(read.returnType).toBe("event");
    expect(Object.keys(read).sort()).toEqual(
      ["appName", "callbackUrl", "compressionType", "returnType", "type"],
    );
    expect(JSON.parse(data).tags).toEqual([["challenge", "abc"]]);
  });
});

describe("startNostrSignerLogin", () => {
  it("お題を取り、ログインか連携かを控えてから nostrsigner: に移る", async () => {
    getMock.mockResolvedValue({ challenge: "CH" });
    const hrefSet = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        origin: "https://events.kojira.io",
        set href(v: string) {
          hrefSet(v);
        },
      },
    });
    try {
      await startNostrSignerLogin("link");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
    expect(getMock).toHaveBeenCalledWith("/auth/nostr/challenge");
    expect(localStorage.getItem(NOSTR_SIGNER_INTENT_KEY)).toBe("link");
    const url = hrefSet.mock.calls[0][0] as string;
    const { head } = splitUrl(url);
    const template = JSON.parse(decodeURIComponent(head.slice("nostrsigner:".length)));
    expect(template.kind).toBe(22242);
    expect(template.tags).toEqual([
      ["relay", "https://events.kojira.io"],
      ["challenge", "CH"],
    ]);
    expect(template.pubkey).toBeUndefined();
  });
});

describe("readNostrSignerIntent", () => {
  it("控えが無ければログイン、link なら連携。消すのは別", () => {
    expect(readNostrSignerIntent()).toBe("login");
    localStorage.setItem(NOSTR_SIGNER_INTENT_KEY, "link");
    expect(readNostrSignerIntent()).toBe("link");
    expect(readNostrSignerIntent()).toBe("link");
    clearNostrSignerIntent();
    expect(readNostrSignerIntent()).toBe("login");
  });
});

describe("parseSignedEventFromUrl", () => {
  it("フラグメントにエンコードして付いた署名済みイベントを読む（Amber は Uri.encode で付ける）", () => {
    expect(
      parseSignedEventFromUrl(`#${encodeURIComponent(JSON.stringify(SIGNED))}`),
    ).toEqual(SIGNED);
  });

  it("エンコードされずにそのまま付いていても読む", () => {
    expect(parseSignedEventFromUrl(`#${JSON.stringify(SIGNED)}`)).toEqual(SIGNED);
  });

  it("空・壊れた JSON・署名が無いものは null", () => {
    expect(parseSignedEventFromUrl("")).toBeNull();
    expect(parseSignedEventFromUrl("#")).toBeNull();
    expect(parseSignedEventFromUrl("#%7Bbroken")).toBeNull();
    expect(
      parseSignedEventFromUrl(
        `#${encodeURIComponent(JSON.stringify({ ...SIGNED, sig: undefined }))}`,
      ),
    ).toBeNull();
    // returnType=signature のように署名だけ返ってきた場合
    expect(parseSignedEventFromUrl(`#${"cd".repeat(64)}`)).toBeNull();
  });
});
