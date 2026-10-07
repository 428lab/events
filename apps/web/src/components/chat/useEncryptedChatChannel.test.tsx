import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event as NostrEvent } from "nostr-tools/pure";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { EncryptedChatPayload } from "@eventer/shared";
import { GROUP_CHAT_KIND } from "@eventer/shared";
import { sealGroupChatMessage } from "../../lib/groupChatCrypto.js";
import { useEncryptedChatChannel } from "./useEncryptedChatChannel.js";

/**
 * 参加者の暗号化チャット (#582 設計 4.1 / 9 W2) の接続・復号・送信。
 *
 * 暗号処理は本物（groupChatCrypto / nostr-tools）を使い、リレーだけを偽物にする。
 * 守るのは: 受け取った暗号文が復号されて一覧に出ること、開けないものは出ないこと、
 * 送信の直前に payload を取り直してその最新 version で封をすること。
 */

const { pools } = vi.hoisted(() => ({
  pools: [] as Array<{
    kind?: number;
    roomId?: string;
    deliver?: (ev: NostrEvent) => void;
    published: NostrEvent[];
  }>,
}));

vi.mock("../../lib/nostrChat.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/nostrChat.js")>();
  return {
    ...actual,
    ChatRelayPool: class {
      connected = true;
      onstatus: (() => void) | null = null;
      state: (typeof pools)[number] = { published: [] };
      constructor() {
        pools.push(this.state);
      }
      async connect() {
        this.onstatus?.();
      }
      subscribe(roomId: string, deliver: (ev: NostrEvent) => void, kind?: number) {
        Object.assign(this.state, { roomId, deliver, kind });
        return () => {};
      }
      async publish(ev: NostrEvent) {
        this.state.published.push(ev);
        return true;
      }
      close() {}
    },
  };
});

const RELAY = "wss://relay.example";
const ROOM = "ab".repeat(32);
const hexKey = (fill: number) => fill.toString(16).padStart(2, "0").repeat(32);
const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const mySk = generateSecretKey();
const MY = { secret: bytesToHex(mySk), pubkey: getPublicKey(mySk) };
const otherSk = generateSecretKey();
const OTHER_PK = getPublicKey(otherSk);

function payload(keys: Array<{ version: number; secret: string }>): EncryptedChatPayload {
  return {
    roomId: ROOM,
    keys,
    myKey: MY,
    members: [
      { pubkey: MY.pubkey, userId: "u-me", username: "me", name: "わたし", avatarUrl: null, revokedAt: null, role: "participant" },
      { pubkey: OTHER_PK, userId: "u-2", username: "two", name: "ふたり", avatarUrl: null, revokedAt: null, role: "participant" },
    ],
    hiddenNoteIds: [],
    plaintextChannelId: null,
    encryptedAt: 0,
    relays: [RELAY],
    writeWindow: { opensAt: null, closesAt: 1_700_003_600_000 },
  };
}

/** 相手の発言（指定の鍵束の最新 version で封をして相手の鍵で署名） */
function sealedFromOther(keys: Array<{ version: number; secret: string }>, text: string, at: number): NostrEvent {
  const tmpl = sealGroupChatMessage(ROOM, keys, text, RELAY)!;
  return finalizeEvent({ ...tmpl, created_at: at }, otherSk);
}

beforeEach(() => {
  pools.length = 0;
});

describe("useEncryptedChatChannel (#582 W2)", () => {
  it("受け取った暗号文を復号して一覧に出し、開けないものは出さない", async () => {
    const v1 = [{ version: 1, secret: hexKey(1) }];
    const { result } = renderHook(() =>
      useEncryptedChatChannel({
        eventId: "e-1",
        chat: payload(v1),
        display: false,
        chatUnavailable: false,
        refresh: async () => payload(v1),
      }),
    );
    await waitFor(() => expect(pools[0]?.deliver).toBeDefined());
    expect(pools[0].kind).toBe(GROUP_CHAT_KIND);
    expect(pools[0].roomId).toBe(ROOM);

    const readable = sealedFromOther(v1, "参加者だけの話", 1_700_000_000);
    // 知らない鍵（同じ version 番号でも中身が違う）で封をしたもの
    const unreadable = sealedFromOther([{ version: 1, secret: hexKey(9) }], "読めない", 1_700_000_001);
    act(() => {
      pools[0].deliver!(readable);
      pools[0].deliver!(unreadable);
    });
    expect(result.current.messages.map((m) => m.content)).toEqual(["参加者だけの話"]);
    // 平文がそのままリレーに流れていない（受け取ったのは暗号文）
    expect(readable.content).not.toContain("参加者だけの話");
  });

  it("鍵束が増えた（ローテーション）時点で、先に届いていた新しい世代の発言が開く", async () => {
    const v1 = [{ version: 1, secret: hexKey(1) }];
    const v2 = [...v1, { version: 2, secret: hexKey(2) }];
    const { result, rerender } = renderHook(
      ({ chat }) =>
        useEncryptedChatChannel({ eventId: "e-1", chat, display: false, chatUnavailable: false, refresh: async () => chat }),
      { initialProps: { chat: payload(v1) } },
    );
    await waitFor(() => expect(pools[0]?.deliver).toBeDefined());
    act(() => pools[0].deliver!(sealedFromOther(v2, "新しい世代", 1_700_000_000)));
    expect(result.current.messages).toEqual([]);
    rerender({ chat: payload(v2) });
    expect(result.current.messages.map((m) => m.content)).toEqual(["新しい世代"]);
  });

  it("送信の直前に payload を取り直し、取り直した最新 version で封をする", async () => {
    const v1 = [{ version: 1, secret: hexKey(1) }];
    const v2 = [...v1, { version: 2, secret: hexKey(2) }];
    const refresh = vi.fn(async () => payload(v2));
    const { result } = renderHook(() =>
      useEncryptedChatChannel({ eventId: "e-1", chat: payload(v1), display: false, chatUnavailable: false, refresh }),
    );
    await waitFor(() => expect(result.current.canSend).toBe(true));
    let sent: string | undefined;
    await act(async () => {
      sent = await result.current.send("こんにちは");
    });
    expect(sent).toBe("ok");
    expect(refresh).toHaveBeenCalledTimes(1);
    const ev = pools[0].published[0];
    expect(ev.kind).toBe(GROUP_CHAT_KIND);
    expect(ev.pubkey).toBe(MY.pubkey);
    expect(ev.tags).toContainEqual(["v", "2"]);
    expect(ev.content).not.toContain("こんにちは");
  });

  it("取り直しに失敗した（資格を失った）ら送らない", async () => {
    const v1 = [{ version: 1, secret: hexKey(1) }];
    const { result } = renderHook(() =>
      useEncryptedChatChannel({
        eventId: "e-1",
        chat: payload(v1),
        display: false,
        chatUnavailable: false,
        refresh: async () => {
          throw new Error("forbidden");
        },
      }),
    );
    await waitFor(() => expect(result.current.canSend).toBe(true));
    let sent: string | undefined;
    await act(async () => {
      sent = await result.current.send("送られてはいけない");
    });
    expect(sent).toBe("failed");
    expect(pools[0].published).toEqual([]);
  });

  it("投影用は読むだけ（自分の鍵があっても送信できない）", async () => {
    const v1 = [{ version: 1, secret: hexKey(1) }];
    const { result } = renderHook(() =>
      useEncryptedChatChannel({ eventId: "e-1", chat: payload(v1), display: true, chatUnavailable: false, refresh: async () => payload(v1) }),
    );
    await waitFor(() => expect(pools[0]?.deliver).toBeDefined());
    expect(result.current.canSend).toBe(false);
  });

  it("繋がせない状態ではリレーに接続しない", async () => {
    renderHook(() =>
      useEncryptedChatChannel({ eventId: "e-1", chat: payload([{ version: 1, secret: hexKey(1) }]), display: false, chatUnavailable: true, refresh: async () => null }),
    );
    await act(async () => {});
    expect(pools).toEqual([]);
  });
});
