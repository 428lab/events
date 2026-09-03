import { describe, it, expect } from "vitest";
import {
  publishOverSocket,
  publishToRelaysVia,
} from "../src/lib/nostrRelay.js";
import type { RelaySocketLike, SignAuth } from "../src/lib/nostrRelay.js";
import type { NostrEvent } from "../src/auth/nostr.js";

/**
 * リレー発行の状態機械 (#460 docs/nip70-protected-chat.md 3.3 / 4.1)。
 * 外向きの実 WebSocket はテスト環境で張らず、WebSocket 互換の最小
 * インターフェースを実装したフェイクに対して会話ロジックを検証する。
 * 実リレーとの噛み合わせは staging の実機確認で見る。
 */

type Listener = (ev: { data?: unknown }) => void;

/** send / close / addEventListener だけの「ソケットらしきもの」 */
class FakeSocket implements RelaySocketLike {
  sent: unknown[][] = [];
  closed = false;
  /** send のたびに呼ばれる（自動応答するリレーの振り付け用） */
  onSend: ((frame: unknown[]) => void) | null = null;
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, fn: Listener): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }

  send(data: string): void {
    const frame = JSON.parse(data) as unknown[];
    this.sent.push(frame);
    this.onSend?.(frame);
  }

  close(): void {
    this.closed = true;
  }

  /** リレーからのフレーム受信を演じる */
  receive(frame: unknown): void {
    for (const fn of this.listeners.get("message") ?? []) {
      fn({ data: JSON.stringify(frame) });
    }
  }

  emit(type: "close" | "error"): void {
    for (const fn of this.listeners.get(type) ?? []) fn({});
  }
}

const URL1 = "wss://one.example.com";
const URL2 = "wss://two.example.com";

const EVENT: NostrEvent = {
  id: "e1".repeat(32),
  pubkey: "ab".repeat(32),
  created_at: 1_700_000_000,
  kind: 40,
  tags: [["-"]],
  content: "{}",
  sig: "cd".repeat(64),
};

const AUTH_ID = "0a".repeat(32);

/** 渡されたテンプレートを記録して、固定 id の署名済み風イベントを返す */
function recordingSignAuth(
  templates: Parameters<SignAuth>[0][],
): SignAuth {
  return (template) => {
    templates.push(template);
    return {
      ...template,
      id: AUTH_ID,
      pubkey: "ef".repeat(32),
      sig: "01".repeat(64),
    };
  };
}

describe("1リレーの会話 (publishOverSocket)", () => {
  it("OK true 即応: EVENT を送り、受理で決着してソケットを閉じる", async () => {
    const s = new FakeSocket();
    const p = publishOverSocket(s, URL1, EVENT, recordingSignAuth([]), 1_000);
    expect(s.sent).toEqual([["EVENT", EVENT]]);
    s.receive(["OK", EVENT.id, true, ""]);
    await expect(p).resolves.toEqual({ url: URL1, outcome: "ok" });
    expect(s.closed).toBe(true);
  });

  it("AUTH 先行→EVENT 受理: 接続直後のチャレンジは保持するだけでよい", async () => {
    const s = new FakeSocket();
    const templates: Parameters<SignAuth>[0][] = [];
    const p = publishOverSocket(s, URL1, EVENT, recordingSignAuth(templates), 1_000);
    s.receive(["AUTH", "challenge-early"]);
    s.receive(["OK", EVENT.id, true, ""]);
    await expect(p).resolves.toEqual({ url: URL1, outcome: "ok" });
    // auth-required が来ていないので AUTH 応答はしない
    expect(templates).toEqual([]);
    expect(s.sent).toHaveLength(1);
  });

  it("EVENT→auth-required→AUTH→再送→OK: 22242 は verifyNostrLogin の形で組み立てる", async () => {
    const s = new FakeSocket();
    const templates: Parameters<SignAuth>[0][] = [];
    const p = publishOverSocket(s, URL1, EVENT, recordingSignAuth(templates), 1_000);
    s.receive(["AUTH", "challenge-1"]);
    s.receive(["OK", EVENT.id, false, "auth-required: need auth"]);
    // NIP-42 応答: relay/challenge タグ（auth/nostr.ts の検証と同じ形）。
    // リレーに保存されないイベントなので ["-"] は付けない
    expect(templates).toHaveLength(1);
    expect(templates[0]!.kind).toBe(22242);
    expect(templates[0]!.tags).toEqual([
      ["relay", URL1],
      ["challenge", "challenge-1"],
    ]);
    expect(templates[0]!.content).toBe("");
    expect(s.sent[1]![0]).toBe("AUTH");
    // AUTH が通ったら EVENT を1回だけ再送
    s.receive(["OK", AUTH_ID, true, ""]);
    expect(s.sent[2]).toEqual(["EVENT", EVENT]);
    s.receive(["OK", EVENT.id, true, ""]);
    await expect(p).resolves.toEqual({ url: URL1, outcome: "ok" });
  });

  it("auth-required がチャレンジより先に来たら、AUTH メッセージの到着を待つ", async () => {
    const s = new FakeSocket();
    const templates: Parameters<SignAuth>[0][] = [];
    const p = publishOverSocket(s, URL1, EVENT, recordingSignAuth(templates), 1_000);
    s.receive(["OK", EVENT.id, false, "auth-required: need auth"]);
    expect(templates).toEqual([]); // まだ応答できない
    s.receive(["AUTH", "challenge-late"]);
    expect(templates[0]!.tags).toContainEqual(["challenge", "challenge-late"]);
    s.receive(["OK", AUTH_ID, true, ""]);
    s.receive(["OK", EVENT.id, true, ""]);
    await expect(p).resolves.toEqual({ url: URL1, outcome: "ok" });
  });

  it("AUTH 後の再送も拒否されたら rejected（再送は1回で打ち切り）", async () => {
    const s = new FakeSocket();
    const p = publishOverSocket(s, URL1, EVENT, recordingSignAuth([]), 1_000);
    s.receive(["AUTH", "challenge-1"]);
    s.receive(["OK", EVENT.id, false, "auth-required: need auth"]);
    s.receive(["OK", AUTH_ID, true, ""]);
    s.receive(["OK", EVENT.id, false, "auth-required: still refused"]);
    await expect(p).resolves.toEqual({
      url: URL1,
      outcome: "rejected",
      message: "auth-required: still refused",
    });
    // EVENT の送信は初回＋再送の2回だけ（無限ループしない）
    expect(s.sent.filter((f) => f[0] === "EVENT")).toHaveLength(2);
  });

  it("auth-required 以外の OK false は rejected（NIP-70 非対応リレーの拒否もここ）", async () => {
    const s = new FakeSocket();
    const p = publishOverSocket(s, URL1, EVENT, recordingSignAuth([]), 1_000);
    s.receive(["OK", EVENT.id, false, "blocked: event marked as protected"]);
    await expect(p).resolves.toEqual({
      url: URL1,
      outcome: "rejected",
      message: "blocked: event marked as protected",
    });
  });

  it("応答が無ければ期限で timeout", async () => {
    const s = new FakeSocket();
    const p = publishOverSocket(s, URL1, EVENT, recordingSignAuth([]), 30);
    await expect(p).resolves.toEqual({ url: URL1, outcome: "timeout" });
    expect(s.closed).toBe(true);
  });

  it("初回 send が同期 throw（open 直後に CLOSING/CLOSED）なら unreachable で決着する", async () => {
    const s = new FakeSocket();
    s.onSend = () => {
      throw new Error("socket already closing");
    };
    const p = publishOverSocket(s, URL1, EVENT, recordingSignAuth([]), 1_000);
    await expect(p).resolves.toEqual({
      url: URL1,
      outcome: "unreachable",
      message: "socket already closing",
    });
    expect(s.closed).toBe(true);
  });

  it("決着前の切断は unreachable", async () => {
    const s = new FakeSocket();
    const p = publishOverSocket(s, URL1, EVENT, recordingSignAuth([]), 1_000);
    s.emit("close");
    await expect(p).resolves.toEqual({
      url: URL1,
      outcome: "unreachable",
      message: "connection closed",
    });
  });
});

describe("並列発行と grace 打ち切り (publishToRelaysVia)", () => {
  it("片方 OK・片方無応答: grace で打ち切り、全体は成功・残った socket は閉じる", async () => {
    const sockets = new Map<string, FakeSocket>();
    const open = async (url: string) => {
      const s = new FakeSocket();
      sockets.set(url, s);
      if (url === URL1) {
        // EVENT を受けたら即 OK（もう片方は何も応答しない）
        s.onSend = (frame) => {
          if (frame[0] === "EVENT") {
            queueMicrotask(() => s.receive(["OK", EVENT.id, true, ""]));
          }
        };
      }
      return s;
    };
    const report = await publishToRelaysVia(
      open,
      [URL1, URL2],
      EVENT,
      recordingSignAuth([]),
      { publishTimeoutMs: 5_000, graceMs: 30 },
    );
    expect(report.ok).toBe(true);
    expect(report.relays).toEqual([
      { url: URL1, outcome: "ok" },
      { url: URL2, outcome: "timeout" },
    ]);
    expect(sockets.get(URL2)!.closed).toBe(true);
  });

  it("send が throw するリレーは unreachable としてハングせず決着する（reject が pending に乗る）", async () => {
    // 修正を戻す（publishOverSocket 末尾の try/catch を外す）と、
    // Promise が reject して pending が減らず、このテストがタイムアウトする
    const open = async () => {
      const s = new FakeSocket();
      s.onSend = () => {
        throw new Error("socket already closing");
      };
      return s;
    };
    const report = await publishToRelaysVia(
      open,
      [URL1, URL2],
      EVENT,
      recordingSignAuth([]),
      { publishTimeoutMs: 1_000, graceMs: 30 },
    );
    expect(report.ok).toBe(false);
    expect(report.relays).toEqual([
      { url: URL1, outcome: "unreachable", message: "socket already closing" },
      { url: URL2, outcome: "unreachable", message: "socket already closing" },
    ]);
  });

  it("接続できないリレーは unreachable。全滅なら ok: false", async () => {
    const open = async () => {
      throw new Error("connect failed");
    };
    const report = await publishToRelaysVia(
      open,
      [URL1, URL2],
      EVENT,
      recordingSignAuth([]),
      { publishTimeoutMs: 1_000, graceMs: 30 },
    );
    expect(report.ok).toBe(false);
    expect(report.relays).toEqual([
      { url: URL1, outcome: "unreachable", message: "connect failed" },
      { url: URL2, outcome: "unreachable", message: "connect failed" },
    ]);
  });
});
