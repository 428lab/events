import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EncryptedChatPayload, EventLiveState } from "@eventer/shared";
import { GROUP_CHAT_KIND } from "@eventer/shared";
import type { Event as NostrEvent } from "nostr-tools/pure";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { sealGroupChatMessage } from "../lib/groupChatCrypto.js";
import { useLiveEventChat } from "./LiveEventChat.js";

/**
 * 配信画面 (#562) の参加者のみ（暗号化）(#582 設計 4.4 / 9 W5)。
 * useEncryptedChat の鍵で復号した本文が行になり、鮮度切れ・403 で消える。
 */

const { subscriptions } = vi.hoisted(() => ({
  subscriptions: [] as Array<{ channel: string; kind?: number; deliver: (event: NostrEvent) => void }>,
}));
vi.mock("../lib/useEventChatAccess.js", () => ({
  useEventChatAccess: () => ({ chatAvailable: true, isError: false, event: { chatEncrypted: true } }),
}));
const chatMembersEnabled: boolean[] = [];
vi.mock("../api/eventChatHooks.js", () => ({
  useChatMembers: (_id: string, enabled: boolean) => {
    chatMembersEnabled.push(enabled);
    return { data: undefined, dataUpdatedAt: 0, isError: false };
  },
}));
let encrypted: { data?: EncryptedChatPayload; dataUpdatedAt: number; isError: boolean };
vi.mock("../api/encryptedChatHooks.js", () => ({ useEncryptedChat: () => encrypted }));
vi.mock("../lib/nostrChat.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/nostrChat.js")>()),
  randomLocalSigner: () => ({}),
  ChatRelayPool: class {
    connected = true;
    onstatus?: () => void;
    connect() { this.onstatus?.(); return Promise.resolve(); }
    subscribe(channel: string, deliver: (event: NostrEvent) => void, kind?: number) { subscriptions.push({ channel, kind, deliver }); return () => {}; }
    close() {}
  },
}));

const RELAY = "wss://relay.example";
const ROOM = "ef".repeat(32);
const KEYS = [{ version: 1, secret: "22".repeat(32) }];
const authorSk = generateSecretKey();
const AUTHOR = getPublicKey(authorSk);
const PAYLOAD: EncryptedChatPayload = {
  roomId: ROOM,
  keys: KEYS,
  myKey: null,
  members: [{ pubkey: AUTHOR, userId: "u-2", username: "two", name: "ふたり", avatarUrl: null, revokedAt: null, role: "participant" }],
  hiddenNoteIds: [],
  plaintextChannelId: null,
  encryptedAt: 0,
  relays: [RELAY],
  writeWindow: { opensAt: null, closesAt: 1_700_003_600_000 },
};
const state = { chatSource: "event" } as EventLiveState;

function Stage() {
  const chat = useLiveEventChat("e-1", state, Date.now(), false, Date.now(), true);
  return <div>{chat.rows.map(row => <div key={row.id}>{row.name}: {row.plainText}</div>)}<span>status:{chat.status}</span></div>;
}

function sealed(text: string, keys = KEYS): NostrEvent {
  const tmpl = sealGroupChatMessage(ROOM, keys, text, RELAY)!;
  return finalizeEvent({ ...tmpl, created_at: Math.floor(Date.now() / 1000) }, authorSk);
}

beforeEach(() => {
  subscriptions.length = 0;
  chatMembersEnabled.length = 0;
  encrypted = { data: PAYLOAD, dataUpdatedAt: Date.now(), isError: false };
});

describe("useLiveEventChat 参加者のみ（暗号化）(#582 W5)", () => {
  it("暗号化の部屋を購読し、配られた鍵で復号した本文が行になる（開けないものは出ない）", async () => {
    render(<Stage />);
    await act(async () => {});
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toMatchObject({ channel: ROOM, kind: GROUP_CHAT_KIND });
    // 平文の chat-members は取らない
    expect(chatMembersEnabled.every(e => e === false)).toBe(true);
    act(() => {
      subscriptions[0].deliver(sealed("会場への声援"));
      subscriptions[0].deliver(sealed("読めない", [{ version: 1, secret: "99".repeat(32) }]));
    });
    expect(screen.getByText(/ふたり: 会場への声援/)).toBeTruthy();
    expect(screen.queryByText(/読めない/)).toBeNull();
    expect(screen.getByText("status:on")).toBeTruthy();
  });

  it("鍵配布の鮮度切れ・403 で行が消える", async () => {
    const view = render(<Stage />);
    await act(async () => {});
    act(() => subscriptions[0].deliver(sealed("消えるべき発言")));
    expect(screen.getByText(/消えるべき発言/)).toBeTruthy();

    encrypted = { ...encrypted, dataUpdatedAt: Date.now() - 7000 };
    view.rerender(<Stage />);
    expect(screen.queryByText(/消えるべき発言/)).toBeNull();
    expect(screen.getByText("status:unavailable")).toBeTruthy();

    // react-query は失敗しても直前の data を保持する。それでも出さない
    encrypted = { data: PAYLOAD, dataUpdatedAt: Date.now(), isError: true };
    view.rerender(<Stage />);
    expect(screen.queryByText(/消えるべき発言/)).toBeNull();
    expect(screen.getByText("status:unavailable")).toBeTruthy();
  });
});
