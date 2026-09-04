import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Event as NostrEvent } from "nostr-tools/pure";
import {
  buildChannelCreateTemplate,
  buildChannelMessageTemplate,
  buildChatKeyProofTemplate,
  ChatRelayPool,
} from "./nostrChat.js";
import type { ChatSigner } from "./nostrChat.js";

/**
 * NIP-70 (#460) の回帰テスト。リレーへ発行するイベント（kind:40/42 と、
 * 同じ builder を通るスタッフチャット #382）に `["-"]` が付いていること、
 * リレーへ出ないイベント（所有証明）には付いていないことを守る。
 * これが崩れると、第三者による他リレーへの再放流を仕様レベルで拒否できなくなる
 * （docs/nip70-protected-chat.md）。
 */

const CHANNEL = "ab".repeat(32);
const RELAY = "wss://r.example.com";

describe("リレーへ発行するイベントは protected (#460)", () => {
  it("kind:42（既定）: e タグと [\"-\"] の両方が付く", () => {
    const tmpl = buildChannelMessageTemplate(CHANNEL, "こんにちは", RELAY);
    expect(tmpl.kind).toBe(42);
    expect(tmpl.tags).toContainEqual(["e", CHANNEL, RELAY, "root"]);
    expect(tmpl.tags).toContainEqual(["-"]);
  });

  it("kind 指定（スタッフチャット #382 が通る形）でも [\"-\"] が付く", () => {
    const tmpl = buildChannelMessageTemplate(CHANNEL, "x", RELAY, 9807);
    expect(tmpl.kind).toBe(9807);
    expect(tmpl.tags).toContainEqual(["e", CHANNEL, RELAY, "root"]);
    expect(tmpl.tags).toContainEqual(["-"]);
  });

  it("kind:40（主催者 NIP-07 経路のチャンネル作成）: tags は [\"-\"] のみ", () => {
    const tmpl = buildChannelCreateTemplate("イベント名");
    expect(tmpl.kind).toBe(40);
    expect(tmpl.tags).toEqual([["-"]]);
    expect(JSON.parse(tmpl.content)).toMatchObject({ name: "イベント名" });
  });
});

describe("リレーへ出ないイベントには付けない (#460)", () => {
  it("鍵の所有証明（kind 27888。API へ送るだけ）に [\"-\"] は無い", () => {
    const tmpl = buildChatKeyProofTemplate("challenge-value", "event-id");
    expect(tmpl.tags).not.toContainEqual(["-"]);
  });
});

/**
 * NIP-07 の署名ダイアログを拒否・放置されたときに送信が固まらないこと (#464)。
 *
 * NIP-70 (#460) で全発言が protected になり、リレーは毎回 auth-required を返す。
 * nostr-tools 2.24.1 の `relay.auth()` は署名器の例外を握り潰して promise を
 * 宙吊りにしたまま、その promise を接続が生きているあいだ使い回す。
 * しかも AUTH の入り口は2つある: こちらから `auth()` を呼ぶ場合と、リレーが
 * 接続直後に送る `["AUTH", challenge]` で nostr-tools が自分で `onauth` を
 * 呼ぶ場合。後者が先に走ると、こちらの期限も例外処理も素通りされてしまう。
 * 下の FakeRelay はこの2つの入り口と握り潰しをそのまま真似ている。
 */

const { fakeRelays, relayConfig, FakeRelay } = vi.hoisted(() => {
  type Template = {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  };
  type SignFn = (t: Template) => Promise<unknown>;
  type SubParams = { onevent: (ev: unknown) => void; onclose: (r: string) => void };
  /** 実物のリレー（strfry）は接続直後にチャレンジを送ることがある */
  const relayConfig = { challengeOnConnect: true };
  const fakeRelays: FakeRelay[] = [];
  class FakeRelay {
    connected = false;
    onauth: SignFn | null = null;
    onclose: (() => void) | null = null;
    authed = false;
    subParams: SubParams | null = null;
    subscribeCalls = 0;
    private challenge: string | null = null;
    private authPromise: Promise<string> | null = null;
    constructor(public url: string) {
      fakeRelays.push(this);
    }
    async connect(): Promise<void> {
      this.connected = true;
      if (relayConfig.challengeOnConnect) {
        // 接続の1 tick 後に届く。nostr-tools は onauth があれば自分で auth() を
        // 呼び、その promise を authPromise として抱え込む
        setTimeout(() => this.receiveChallenge(), 0);
      }
    }
    receiveChallenge(): void {
      this.challenge = "challenge";
      if (this.onauth) void this.auth(this.onauth).catch(() => undefined);
    }
    /** NIP-70 の protected イベントは AUTH 前だと必ずこれで拒否される */
    async publish(): Promise<string> {
      if (this.authed) return "ok";
      this.receiveChallenge();
      throw new Error("auth-required: we only accept events from authed users");
    }
    /** nostr-tools 2.24.1 と同じ形: 署名器が投げたら resolve も reject もせず、
     * その宙吊りの promise を使い回す（これが #464 の固まりの原因） */
    async auth(sign: SignFn): Promise<string> {
      // nostr-tools と同じく、チャレンジが来ていなければ AUTH できない
      if (!this.challenge) throw new Error("can't perform auth, no challenge");
      if (this.authPromise) return this.authPromise;
      this.authPromise = new Promise<string>((resolve) => {
        void (async () => {
          try {
            await sign({ kind: 22242, created_at: 0, tags: [], content: "" });
            this.authed = true;
            resolve("ok");
          } catch {
            /* nostr-tools はここで warn するだけ（settle しない） */
          }
        })();
      });
      return this.authPromise;
    }
    subscribe(_filters: unknown, params: SubParams): { close: () => void } {
      this.subscribeCalls++;
      this.subParams = params;
      return { close: () => undefined };
    }
    close(): void {
      this.connected = false;
      this.onclose?.();
    }
  }
  return { fakeRelays, relayConfig, FakeRelay };
});

vi.mock("nostr-tools/relay", () => ({ Relay: FakeRelay }));

const RELAY_URL = "wss://relay.test";
const SIGNED_EVENT = {
  id: "cd".repeat(32),
  pubkey: "ef".repeat(32),
  kind: 42,
  created_at: 0,
  tags: [["-"]],
  content: "こんにちは",
  sig: "00".repeat(64),
} as unknown as NostrEvent;

/** 署名ダイアログの代わり。calls が「利用者に出したダイアログの数」になる */
function makeSigner(
  behave: (call: number) => Promise<unknown>,
): ChatSigner & { calls: number } {
  const signer = {
    calls: 0,
    pubkey: "ab".repeat(32),
    signEvent: (() => {
      signer.calls++;
      return behave(signer.calls);
    }) as ChatSigner["signEvent"],
  };
  return signer;
}

const REJECT = () => Promise.reject(new Error("user rejected"));
const NEVER = () => new Promise<never>(() => undefined);
const SIGNED = () => Promise.resolve(SIGNED_EVENT as never);

describe("NIP-07 の署名待ちで送信が固まらない (#464)", () => {
  beforeEach(() => {
    fakeRelays.length = 0;
    relayConfig.challengeOnConnect = true;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("接続直後のチャレンジで拒否されたら、publish は時間を待たず false", async () => {
    const signer = makeSigner(REJECT);
    const pool = new ChatRelayPool(signer, [RELAY_URL]);
    try {
      await pool.connect();
      // リレー発の AUTH でダイアログが出て、断られた状態
      await vi.advanceTimersByTimeAsync(0);
      expect(signer.calls).toBe(1);
      let result: boolean | "pending" = "pending";
      const publishing = pool.publish(SIGNED_EVENT).then((ok) => {
        result = ok;
      });
      // 署名の期限（15秒）よりずっと手前で決着する
      await vi.advanceTimersByTimeAsync(1_000);
      expect(result).toBe(false);
      await publishing;
    } finally {
      pool.close();
    }
  });

  it("チャレンジを送らないリレーでも、拒否なら待たず false", async () => {
    relayConfig.challengeOnConnect = false;
    const signer = makeSigner(REJECT);
    const pool = new ChatRelayPool(signer, [RELAY_URL]);
    try {
      await pool.connect();
      let result: boolean | "pending" = "pending";
      const publishing = pool.publish(SIGNED_EVENT).then((ok) => {
        result = ok;
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(result).toBe(false);
      await publishing;
    } finally {
      pool.close();
    }
  });

  it("ダイアログを放置されたら署名の期限で false（ダイアログは1回だけ）", async () => {
    const signer = makeSigner(NEVER);
    const pool = new ChatRelayPool(signer, [RELAY_URL]);
    try {
      await pool.connect();
      await vi.advanceTimersByTimeAsync(0);
      let result: boolean | "pending" = "pending";
      const publishing = pool.publish(SIGNED_EVENT).then((ok) => {
        result = ok;
      });
      // 人がダイアログを操作する時間は待つ（数秒で諦めない）
      await vi.advanceTimersByTimeAsync(5_000);
      expect(result).toBe("pending");
      await vi.advanceTimersByTimeAsync(20_000);
      await publishing;
      expect(result).toBe(false);
      // 送信1回につきダイアログ1回。裏で二重に署名を求めない
      expect(signer.calls).toBe(1);
    } finally {
      pool.close();
    }
  });

  it("拒否のあとの送信は、接続を張り直して署名からやり直す", async () => {
    // 接続直後のダイアログ（1回目）と1通目の送信のダイアログ（2回目）を拒否し、
    // 3回目（2通目の送信）で承認する
    const signer = makeSigner((call) => (call <= 2 ? REJECT() : SIGNED()));
    const pool = new ChatRelayPool(signer, [RELAY_URL]);
    try {
      await pool.connect();
      await vi.advanceTimersByTimeAsync(0);
      expect(signer.calls).toBe(1);
      // 1通目: 断られた接続を捨てて張り直し、その送信の中で署名を求め直す。
      // 断られたので失敗（ダイアログは送信1回につき1回だけ）
      await expect(pool.publish(SIGNED_EVENT)).resolves.toBe(false);
      expect(signer.calls).toBe(2);
      // 2通目: また張り直して署名を求め、今度は承認されるので成功する
      const second = pool.publish(SIGNED_EVENT);
      await vi.advanceTimersByTimeAsync(0);
      await expect(second).resolves.toBe(true);
      expect(signer.calls).toBe(3);
      expect(fakeRelays.length).toBe(3);
    } finally {
      pool.close();
    }
  });

  it("購読が auth-required で閉じられたときも同じ経路を通り、送信で復旧する", async () => {
    const signer = makeSigner((call) => (call === 1 ? REJECT() : SIGNED()));
    const pool = new ChatRelayPool(signer, [RELAY_URL]);
    try {
      await pool.connect();
      pool.subscribe("ab".repeat(32), () => undefined);
      expect(fakeRelays[0].subscribeCalls).toBe(1);
      // 読み取りにも AUTH を要求するリレー。署名は断られる
      fakeRelays[0].subParams?.onclose("auth-required: need auth to read");
      await vi.advanceTimersByTimeAsync(1_000);
      // 断られたまま張り直さない（ダイアログを出し続けないため）
      expect(fakeRelays[0].subscribeCalls).toBe(1);
      expect(fakeRelays.length).toBe(1);
      // 送信すると接続ごと張り直され、購読もその新しい接続で張り直される
      const publishing = pool.publish(SIGNED_EVENT);
      await vi.advanceTimersByTimeAsync(0);
      await expect(publishing).resolves.toBe(true);
      expect(fakeRelays.length).toBe(2);
      expect(fakeRelays[1].subscribeCalls).toBe(1);
    } finally {
      pool.close();
    }
  });
});
