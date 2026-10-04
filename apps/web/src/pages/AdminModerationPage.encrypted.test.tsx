import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Event as NostrEvent } from "nostr-tools/pure";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { ModerationContentPayload } from "@eventer/shared";
import { GROUP_CHAT_KIND } from "@eventer/shared";
import { sealGroupChatMessage } from "../lib/groupChatCrypto.js";
import { AdminModerationPage } from "./AdminModerationPage.js";

/**
 * 運営のモデレーション画面が参加者のみ（暗号化）(#582 設計 4.5) の発言を
 * 配られた鍵で復号して一覧に出すこと（非表示・締め出しの判断ができること）。
 */

const { subs } = vi.hoisted(() => ({
  subs: [] as Array<{ id: string; kind: number; deliver: (ev: NostrEvent) => void }>,
}));

const RELAY = "wss://relay.example";
const ROOM = "12".repeat(32);
const KEYS = [{ version: 1, secret: "33".repeat(32) }];
const authorSk = generateSecretKey();
const AUTHOR = getPublicKey(authorSk);

const PAYLOAD: ModerationContentPayload = {
  event: { id: "e-1", title: "非公開イベント", status: "published", startsAt: 0, endsAt: 0, hostHandle: "host" },
  items: [],
  chat: { channelId: null, relays: [RELAY], members: [], hidden: [], blocked: [] },
  encryptedChat: {
    roomId: ROOM,
    keys: KEYS,
    members: [{ pubkey: AUTHOR, userId: "u-2", username: "two", name: "ふたり", avatarUrl: null, revokedAt: null, role: "participant" }],
  },
};

vi.mock("../api/hooks.js", () => ({ useIsAdmin: () => true }));
vi.mock("../api/moderationHooks.js", () => ({
  useModerationEvents: () => ({ data: undefined }),
  useModerationContent: () => ({ data: PAYLOAD, isLoading: false }),
  useModerateContent: () => ({ mutate: vi.fn(), isPending: false }),
  useBlockChatAuthor: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../lib/nostrChat.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/nostrChat.js")>()),
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
    close() {}
  },
}));

describe("運営のモデレーション: 参加者のみ（暗号化）(#582)", () => {
  it("暗号化の部屋を購読し、配られた鍵で復号した本文と発言者を出す", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/moderation?eventId=e-1"]}>
        <AdminModerationPage />
      </MemoryRouter>,
    );
    await act(async () => {});
    // 平文の部屋は無いので、暗号化の部屋だけを購読する
    expect(subs.map((s) => [s.id, s.kind])).toEqual([[ROOM, GROUP_CHAT_KIND]]);
    const tmpl = sealGroupChatMessage(ROOM, KEYS, "通報された発言", RELAY)!;
    act(() => {
      subs[0].deliver(finalizeEvent({ ...tmpl, created_at: 1_700_000_000 }, authorSk));
    });
    expect(await screen.findByText("通報された発言")).toBeInTheDocument();
    expect(screen.getByText(/ふたり/)).toBeInTheDocument();
  });
});
