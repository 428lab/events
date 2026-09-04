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
 * 宙吊りにするので（下の FakeRelay はその振る舞いをそのまま真似ている）、
 * 期限を入れていないと `publish` が永久に待ち、UI は成功も失敗も出せない。
 */

const { fakeRelays, FakeRelay } = vi.hoisted(() => {
  type SignFn = (t: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }) => Promise<unknown>;
  class FakeRelay {
    connected = false;
    onauth: unknown = null;
    onclose: (() => void) | null = null;
    authCalls = 0;
    private authPromise: Promise<string> | null = null;
    constructor(public url: string) {
      fakeRelays.push(this);
    }
    async connect(): Promise<void> {
      this.connected = true;
    }
    /** NIP-70 の protected イベントは未認証だと必ずこれで拒否される */
    async publish(): Promise<string> {
      throw new Error("auth-required: we only accept events from authed users");
    }
    /** nostr-tools 2.24.1 と同じ形: 署名器が投げたら resolve も reject もせず、
     * その宙吊りの promise を使い回す（これが #464 の固まりの原因） */
    auth(sign: SignFn): Promise<string> {
      this.authCalls++;
      if (this.authPromise) return this.authPromise;
      this.authPromise = new Promise<string>((resolve) => {
        void (async () => {
          try {
            await sign({ kind: 22242, created_at: 0, tags: [], content: "" });
            resolve("ok");
          } catch {
            /* nostr-tools はここで warn するだけ（settle しない） */
          }
        })();
      });
      return this.authPromise;
    }
    subscribe(): { close: () => void } {
      return { close: () => undefined };
    }
    close(): void {
      this.connected = false;
    }
  }
  return { fakeRelays: [] as FakeRelay[], FakeRelay };
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

describe("NIP-07 の署名待ちで送信が固まらない (#464)", () => {
  beforeEach(() => {
    fakeRelays.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("署名を拒否されたら publish は待たずに false を返す", async () => {
    const signer: ChatSigner = {
      pubkey: "ab".repeat(32),
      signEvent: async () => {
        throw new Error("user rejected");
      },
    };
    const pool = new ChatRelayPool(signer, [RELAY_URL]);
    try {
      await pool.connect();
      await expect(pool.publish(SIGNED_EVENT)).resolves.toBe(false);
    } finally {
      pool.close();
    }
  });

  it("署名ダイアログを放置されても publish は期限内に false になる", async () => {
    vi.useFakeTimers();
    // 署名がいつまでも返らない署名器（拡張のダイアログを放置した状態）
    const signer: ChatSigner = {
      pubkey: "ab".repeat(32),
      signEvent: () => new Promise(() => undefined),
    };
    const pool = new ChatRelayPool(signer, [RELAY_URL]);
    try {
      await pool.connect();
      let result: boolean | "pending" = "pending";
      const publishing = pool.publish(SIGNED_EVENT).then((ok) => {
        result = ok;
      });
      // 人がダイアログを操作する時間は待つ（数秒で諦めない）
      await vi.advanceTimersByTimeAsync(5_000);
      expect(result).toBe("pending");
      // 放置され続ければ期限で打ち切り、送信は失敗として返る
      await vi.advanceTimersByTimeAsync(60_000);
      await publishing;
      expect(result).toBe(false);
    } finally {
      pool.close();
    }
  });

  it("AUTH に失敗した接続は捨てる（次の送信で署名し直せるように）", async () => {
    const signer: ChatSigner = {
      pubkey: "ab".repeat(32),
      signEvent: async () => {
        throw new Error("user rejected");
      },
    };
    const pool = new ChatRelayPool(signer, [RELAY_URL]);
    try {
      await pool.connect();
      await pool.publish(SIGNED_EVENT);
      // nostr-tools は失敗した authPromise を接続が生きている間ずっと使い回すので、
      // 繋いだままだと次の送信では署名ダイアログすら出ない
      expect(fakeRelays[0].connected).toBe(false);
      expect(fakeRelays[0].authCalls).toBe(1);
    } finally {
      pool.close();
    }
  });
});
