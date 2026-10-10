import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchFilter, type Filter } from "nostr-tools/filter";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
  type Event,
  type VerifiedEvent,
} from "nostr-tools/pure";
import {
  NostrConnectError,
  buildConnectRequest,
  clearSavedSession,
  loadSavedSession,
  requestSignEvent,
  saveSession,
  waitForConnect,
  type NostrConnectPool,
} from "./nostrConnect.js";

/**
 * NIP-46 の nostrconnect:// のやりとり (D-NOSTR-SIGNER)。
 *
 * 偽のリレー（届いたイベントを残し、購読に filter で配る）と、Amber の代わりの
 * 署名役（テスト用 bunker）で、connect → sign_event を通す。
 */
class FakeRelay implements NostrConnectPool {
  stored: Event[] = [];
  subs = new Set<{ filter: Filter; onevent: (e: Event) => void }>();
  /** true の間は購読に配らない（裏に回って接続が切れた状態の再現） */
  offline = false;
  subscribeCount = 0;

  subscribeMany(
    _relays: string[],
    filter: Parameters<NostrConnectPool["subscribeMany"]>[1],
    params: { onevent: (event: Event) => void },
  ) {
    this.subscribeCount += 1;
    const sub = { filter, onevent: params.onevent };
    this.subs.add(sub);
    if (!this.offline) {
      for (const e of this.stored) if (matchFilter(filter, e)) sub.onevent(e);
    }
    return { close: () => this.subs.delete(sub) };
  }

  publish(_relays: string[], event: VerifiedEvent) {
    this.stored.push(event);
    if (!this.offline) {
      for (const sub of [...this.subs]) {
        if (matchFilter(sub.filter, event)) sub.onevent(event);
      }
    }
    return [Promise.resolve("ok")];
  }
}

/** Amber の代わり。自分宛ての 24133 を読み、sign_event に本人の鍵で署名して返す */
function startTestBunker(
  relay: FakeRelay,
  opts: { reject?: boolean } = {},
) {
  const userSecretKey = generateSecretKey();
  const userPubkey = getPublicKey(userSecretKey);
  const reply = (to: string, body: Record<string, unknown>) => {
    const key = getConversationKey(userSecretKey, to);
    relay.publish(
      [],
      finalizeEvent(
        {
          kind: 24133,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["p", to]],
          content: encrypt(JSON.stringify(body), key),
        },
        userSecretKey,
      ),
    );
  };
  relay.subscribeMany(
    [],
    { kinds: [24133], "#p": [userPubkey], since: 0 },
    {
      onevent: (e) => {
        const key = getConversationKey(userSecretKey, e.pubkey);
        const req = JSON.parse(decrypt(e.content, key)) as {
          id: string;
          method: string;
          params: string[];
        };
        if (req.method !== "sign_event") return;
        if (opts.reject) {
          reply(e.pubkey, { id: req.id, result: "", error: "denied" });
          return;
        }
        const signed = finalizeEvent(JSON.parse(req.params[0]), userSecretKey);
        reply(e.pubkey, { id: req.id, result: JSON.stringify(signed) });
      },
    },
  );
  return {
    userPubkey,
    /** nostrconnect:// の URI を読み取って承認したときの connect 応答 */
    acceptUri(uri: string) {
      const u = new URL(uri);
      const clientPubkey = uri.slice("nostrconnect://".length).split("?")[0];
      reply(clientPubkey, { id: "connect-1", result: u.searchParams.get("secret") });
    },
  };
}

const LOGIN_TEMPLATE = {
  kind: 22242,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["relay", "https://events.kojira.io"],
    ["challenge", "c"],
  ],
  content: "events lab にログイン",
};

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("buildConnectRequest (nostrconnect:// の URI)", () => {
  it("うちのリレー2台・ログインの署名だけの権限・名前と URL が入る", () => {
    const req = buildConnectRequest("https://events.kojira.io");
    const u = new URL(req.uri);
    expect(req.uri.startsWith("nostrconnect://")).toBe(true);
    expect(u.searchParams.getAll("relay").sort()).toEqual([
      "wss://r.kojira.io",
      "wss://x.kojira.io",
    ]);
    expect(u.searchParams.get("perms")).toBe("sign_event:22242");
    expect(u.searchParams.get("name")).toBe("events lab");
    expect(u.searchParams.get("url")).toBe("https://events.kojira.io");
    expect(u.searchParams.get("secret")).toBe(req.secret);
    expect(req.secret).toMatch(/^[0-9a-f]{32}$/);
    // 公開鍵は使い捨ての鍵のもの
    expect(req.uri).toContain(getPublicKey(req.clientSecretKey));
  });

  it("secret と鍵は毎回作り直す", () => {
    const a = buildConnectRequest("https://events.kojira.io");
    const b = buildConnectRequest("https://events.kojira.io");
    expect(a.secret).not.toBe(b.secret);
    expect(a.uri).not.toBe(b.uri);
  });
});

describe("waitForConnect → requestSignEvent", () => {
  it("connect の応答を受けて、署名アプリの鍵で 22242 に署名してもらう", async () => {
    const relay = new FakeRelay();
    const bunker = startTestBunker(relay);
    const req = buildConnectRequest("https://events.kojira.io");
    const waiting = waitForConnect(req, { pool: relay });
    bunker.acceptUri(req.uri);
    const session = await waiting;
    expect(session.remotePubkey).toBe(bunker.userPubkey);

    const signed = await requestSignEvent(session, LOGIN_TEMPLATE, { pool: relay });
    expect(verifyEvent(signed)).toBe(true);
    expect(signed.pubkey).toBe(bunker.userPubkey);
    expect(signed.kind).toBe(22242);
    expect(signed.tags).toEqual(LOGIN_TEMPLATE.tags);
  });

  it("secret が違う応答は受け入れない（ほかの応答に乗っ取られない）", async () => {
    vi.useFakeTimers();
    const relay = new FakeRelay();
    const bunker = startTestBunker(relay);
    const req = buildConnectRequest("https://events.kojira.io");
    const waiting = waitForConnect(req, { pool: relay, timeoutMs: 1000 });
    const forged = buildConnectRequest("https://events.kojira.io");
    // 別の secret の URI を、宛先だけこちらにして承認した応答
    bunker.acceptUri(req.uri.replace(req.secret, forged.secret));
    const result = expect(waiting).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(1000);
    await result;
  });

  it("中止すると aborted で止まり、購読も閉じる", async () => {
    const relay = new FakeRelay();
    const req = buildConnectRequest("https://events.kojira.io");
    const ac = new AbortController();
    const waiting = waitForConnect(req, { pool: relay, signal: ac.signal });
    expect(relay.subs.size).toBe(1);
    ac.abort();
    await expect(waiting).rejects.toBeInstanceOf(NostrConnectError);
    await expect(waiting).rejects.toMatchObject({ code: "aborted" });
    expect(relay.subs.size).toBe(0);
  });

  it("裏に回っている間に届いた応答は、画面に戻ったときの1回の購読し直しで拾う", async () => {
    const relay = new FakeRelay();
    const bunker = startTestBunker(relay);
    const req = buildConnectRequest("https://events.kojira.io");
    const waiting = waitForConnect(req, { pool: relay });
    const before = relay.subscribeCount;
    // ブラウザが裏に回り、接続が切れている間に Amber が応答した
    relay.offline = true;
    bunker.acceptUri(req.uri);
    relay.offline = false;
    // 画面に戻った
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    const session = await waiting;
    expect(session.remotePubkey).toBe(bunker.userPubkey);
    expect(relay.subscribeCount - before).toBe(1);
  });

  it("署名アプリが断ったら rejected", async () => {
    const relay = new FakeRelay();
    const bunker = startTestBunker(relay, { reject: true });
    const req = buildConnectRequest("https://events.kojira.io");
    const waiting = waitForConnect(req, { pool: relay });
    bunker.acceptUri(req.uri);
    const session = await waiting;
    await expect(
      requestSignEvent(session, LOGIN_TEMPLATE, { pool: relay }),
    ).rejects.toMatchObject({ code: "rejected" });
  });

  it("署名の応答が無ければ時間切れ（timeout）", async () => {
    vi.useFakeTimers();
    const relay = new FakeRelay();
    const session = {
      clientSecretKey: "11".repeat(32),
      remotePubkey: getPublicKey(generateSecretKey()),
      relays: ["wss://x.kojira.io"],
    };
    const waiting = requestSignEvent(session, LOGIN_TEMPLATE, {
      pool: relay,
      timeoutMs: 60_000,
    });
    const result = expect(waiting).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(60_000);
    await result;
    expect(relay.subs.size).toBe(0);
  });
});

describe("覚えておく接続", () => {
  it("保存・読み出し・消去", () => {
    expect(loadSavedSession()).toBeNull();
    const s = {
      clientSecretKey: "22".repeat(32),
      remotePubkey: "ab".repeat(32),
      relays: ["wss://x.kojira.io"],
    };
    saveSession(s);
    expect(loadSavedSession()).toEqual(s);
    clearSavedSession();
    expect(loadSavedSession()).toBeNull();
  });

  it("形が崩れていたら覚えていないものとして扱う", () => {
    localStorage.setItem("nostrConnectSession", "{broken");
    expect(loadSavedSession()).toBeNull();
    localStorage.setItem("nostrConnectSession", JSON.stringify({ relays: [] }));
    expect(loadSavedSession()).toBeNull();
  });
});
