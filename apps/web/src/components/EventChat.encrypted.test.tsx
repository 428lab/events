import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Event as NostrEvent } from "nostr-tools/pure";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { ChatMembersPayload, EncryptedChatPayload, Event } from "@eventer/shared";
import { GROUP_CHAT_KIND } from "@eventer/shared";
import { sealGroupChatMessage } from "../lib/groupChatCrypto.js";
import { EventChat } from "./EventChat.js";

/**
 * 参加者のみ（暗号化）(#582 設計 4.2 / 9 W3) の EventChat。
 *
 * - 公開イベント: 平文の過去ログ（encryptedAt 以前のみ）と暗号文が1つの一覧に並び、
 *   境目に「ここから参加者のみ」が出る
 * - 非公開イベント: 平文の部屋を購読しない
 * - チップ「参加者のみ・暗号化」が出る（投影用では出ない）
 * 暗号処理は本物、リレーだけ偽物（購読を kind ごとに記録する）。
 */

const { subs } = vi.hoisted(() => ({
  subs: [] as Array<{ id: string; kind: number; deliver: (ev: NostrEvent) => void }>,
}));

vi.mock("../lib/nostrChat.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/nostrChat.js")>();
  return {
    ...actual,
    ChatRelayPool: class {
      connected = true;
      onstatus: (() => void) | null = null;
      async connect() {
        this.onstatus?.();
      }
      subscribe(id: string, deliver: (ev: NostrEvent) => void, kind = 42) {
        subs.push({ id, kind, deliver });
        return () => {};
      }
      async publish() {
        return true;
      }
      close() {}
    },
  };
});

vi.mock("../lib/nostr.js", () => ({ hasNip07: () => false }));

const ME = { id: "u-1", username: "me", name: "わたし" };
vi.mock("../api/hooks.js", () => ({ useMe: () => ({ data: ME }) }));

const RELAY = "wss://relay.example";
const ROOM = "cd".repeat(32);
const KEYS = [{ version: 1, secret: "11".repeat(32) }];
const ENCRYPTED_AT = 1_700_000_100_000;

const oldSk = generateSecretKey();
const OLD_PK = getPublicKey(oldSk);
const otherSk = generateSecretKey();
const OTHER_PK = getPublicKey(otherSk);
const mySk = generateSecretKey();
const MY_SECRET = Array.from(mySk, (b) => b.toString(16).padStart(2, "0")).join("");
const MY_PK = getPublicKey(mySk);

const PLAIN: ChatMembersPayload = {
  members: [{ pubkey: OLD_PK, userId: "u-old", username: "old", name: "むかしの人", avatarUrl: null, role: "participant" }],
  channelId: "plain-chan",
  chatEnabled: true,
  hiddenNoteIds: [],
  relays: [RELAY],
};

let encPayload: EncryptedChatPayload;
let chatMembersCalls: boolean[] = [];

vi.mock("../api/eventChatHooks.js", () => ({
  useChatMembers: (_id: string, enabled: boolean) => {
    chatMembersCalls.push(enabled);
    return enabled ? { data: PLAIN, error: null } : { data: undefined, error: null };
  },
  useRegisterChatKey: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useCreateEphemeralChatKey: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useRegisterChatChannel: () => ({ mutateAsync: vi.fn() }),
  useResetChatChannel: () => ({ isPending: false, mutate: vi.fn() }),
  useHideChatNote: () => ({ isPending: false, mutate: vi.fn() }),
  fetchEphemeralChatKey: vi.fn(async () => null),
  useCreateChatChannel: () => ({ mutateAsync: vi.fn() }),
}));

const openMutate = vi.fn();
vi.mock("../api/encryptedChatHooks.js", () => ({
  useEncryptedChat: () => ({
    data: encPayload,
    error: null,
    isSuccess: true,
    refetch: async () => ({ data: encPayload, error: null }),
  }),
  useOpenEncryptedChat: () => ({ isPending: false, isError: false, mutate: openMutate }),
}));

function makePayload(plaintextChannelId: string | null): EncryptedChatPayload {
  return {
    roomId: ROOM,
    keys: KEYS,
    myKey: { pubkey: MY_PK, secret: MY_SECRET },
    members: [
      { pubkey: MY_PK, userId: "u-1", username: "me", name: "わたし", avatarUrl: null, revokedAt: null, role: "participant" },
      { pubkey: OTHER_PK, userId: "u-2", username: "two", name: "ふたり", avatarUrl: null, revokedAt: null, role: "participant" },
    ],
    hiddenNoteIds: [],
    plaintextChannelId,
    encryptedAt: ENCRYPTED_AT,
    relays: [RELAY],
  };
}

function eventOf(visibility: "public" | "private"): Event {
  return {
    id: "e-1",
    title: "テストイベント",
    status: "published",
    visibility,
    chatEnabled: true,
    chatEncrypted: true,
    chatUrlsAllowed: false,
    scheduling: false,
    startsAt: 1_700_000_000_000,
    endsAt: 1_700_003_600_000,
    createdBy: "u-9",
  } as unknown as Event;
}

function plainNote(content: string, at: number): NostrEvent {
  return finalizeEvent({ kind: 42, tags: [["e", "plain-chan", RELAY, "root"]], content, created_at: at }, oldSk);
}

async function draw(visibility: "public" | "private", variant: "page" | "display" = "page") {
  render(
    <MemoryRouter>
      <EventChat eventId="e-1" event={eventOf(visibility)} myRole="participant" variant={variant} />
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  subs.length = 0;
  chatMembersCalls = [];
  openMutate.mockReset();
  localStorage.clear();
});

describe("EventChat 参加者のみ（暗号化）(#582 W3)", () => {
  it("公開イベント: 平文の過去ログ（encryptedAt 以前のみ）と暗号文が1つの一覧に、区切り付きで並ぶ", async () => {
    encPayload = makePayload("plain-chan");
    await draw("public");
    await waitFor(() => expect(subs.map((s) => s.kind).sort()).toEqual([42, GROUP_CHAT_KIND]));
    const plain = subs.find((s) => s.kind === 42)!;
    const sealed = subs.find((s) => s.kind === GROUP_CHAT_KIND)!;
    expect(plain.id).toBe("plain-chan");
    expect(sealed.id).toBe(ROOM);

    const tmpl = sealGroupChatMessage(ROOM, KEYS, "参加者だけの話", RELAY)!;
    act(() => {
      plain.deliver(plainNote("暗号化前の発言", ENCRYPTED_AT / 1000 - 10));
      // オンにした後に外部クライアントが平文へ送ったもの（出してはいけない）
      plain.deliver(plainNote("オン後の平文", ENCRYPTED_AT / 1000 + 10));
      sealed.deliver(finalizeEvent({ ...tmpl, created_at: ENCRYPTED_AT / 1000 + 20 }, otherSk));
    });

    expect(await screen.findByText("暗号化前の発言")).toBeInTheDocument();
    expect(screen.getByText("参加者だけの話")).toBeInTheDocument();
    expect(screen.queryByText("オン後の平文")).not.toBeInTheDocument();
    // 区切りは平文の過去ログと暗号文の間に1つ
    const sep = screen.getByText("ここから参加者のみ");
    const before = screen.getByText("暗号化前の発言");
    const after = screen.getByText("参加者だけの話");
    expect(before.compareDocumentPosition(sep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sep.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("参加者のみ・暗号化")).toBeInTheDocument();
    // 参加の操作は出さない（鍵はサーバーが自動で発行する）
    expect(screen.queryByRole("button", { name: "チャットに参加する" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("非公開イベント: 平文の部屋を購読しない（平文の chat-members も取らない）", async () => {
    encPayload = makePayload(null);
    await draw("private");
    await waitFor(() => expect(subs.length).toBeGreaterThan(0));
    expect(subs.map((s) => s.kind)).toEqual([GROUP_CHAT_KIND]);
    expect(chatMembersCalls.every((enabled) => enabled === false)).toBe(true);
    expect(screen.getByText("参加者のみ・暗号化")).toBeInTheDocument();
  });

  it("投影用ではチップも区切りも出さず、入力欄も出さない", async () => {
    encPayload = makePayload("plain-chan");
    await draw("public", "display");
    await waitFor(() => expect(subs.some((s) => s.kind === 42)).toBe(true));
    act(() => subs.find((s) => s.kind === 42)!.deliver(plainNote("暗号化前の発言", ENCRYPTED_AT / 1000 - 10)));
    expect(await screen.findByText("暗号化前の発言")).toBeInTheDocument();
    expect(screen.queryByText("参加者のみ・暗号化")).not.toBeInTheDocument();
    expect(screen.queryByText("ここから参加者のみ")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("自分の鍵が無ければ発行を頼む（参加 UI は出さない）", async () => {
    encPayload = { ...makePayload(null), myKey: null };
    await draw("private");
    await waitFor(() => expect(openMutate).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "チャットに参加する" })).not.toBeInTheDocument();
  });
});
