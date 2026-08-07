import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Event as NostrEvent } from "nostr-tools/pure";
import type { ChatMembersPayload, Event } from "@eventer/shared";
import { EventChat } from "./EventChat.js";

/**
 * 投影用画面 (#215) の退行防止。`variant="display"` は会場のスクリーンに
 * 映る「見せるだけ」の画面なので、
 * - 参加UI（鍵の選び方・「チャットに参加する」）
 * - 入力欄
 * - スタッフ用の操作UI（メッセージの非表示・チャンネルの作り直し）
 * が出てはいけない。同時に、**参加していなくてもメッセージは読める**
 * （NIP-07 で参加している人が開くと signer が決まらず、以前は参加フォームだけが
 * 投影され続けた）ことを確かめる。
 *
 * 比較用に variant="page"（通常のチャット画面）でスタッフ操作が出ることも見て、
 * 「そもそも出ない状態」を通過してしまわないようにしている。
 */

const ME = { id: "u-1", username: "me", name: "わたし" };

/** チャンネルの購読で受け取ったコールバック（テストから配信するため保持する） */
let deliver: ((ev: NostrEvent) => void) | null = null;

/**
 * GET /chat-key/ephemeral の結果。既定は null＝**NIP-07 で参加している人**の状態
 * （サーバーは一時鍵を持っていないので 404 になる）。この人が投影用画面を開くと
 * 自動再参加が成立せず signer が決まらない、というのが直した不具合そのもの。
 */
let ephemeralKey: { secret: string } | null = null;

const CHAT: ChatMembersPayload = {
  members: [
    {
      pubkey: "pk-me",
      userId: "u-1",
      username: "me",
      name: "わたし",
      avatarUrl: null,
      role: "staff",
    },
  ],
  channelId: "chan-1",
  chatEnabled: true,
  hiddenNoteIds: [],
  relays: ["wss://relay.example"],
};

const MESSAGE = {
  id: "note-1",
  pubkey: "pk-me",
  created_at: 1_700_000_000,
  kind: 42,
  tags: [],
  content: "会場からの発言",
  sig: "",
} as unknown as NostrEvent;

const EVENT = {
  id: "e-1",
  title: "テストイベント",
  status: "published",
  chatEnabled: true,
  chatUrlsAllowed: false,
  scheduling: false,
  startsAt: 1_700_000_000_000,
  endsAt: 1_700_003_600_000,
  createdBy: "u-9",
} as unknown as Event;

vi.mock("../api/hooks.js", () => ({
  useMe: () => ({ data: ME }),
}));

vi.mock("../lib/nostr.js", () => ({
  // 拡張がある環境（参加UIの選択肢がいちばん増える状態）で確かめる
  hasNip07: () => true,
}));

vi.mock("../api/eventChatHooks.js", () => ({
  useChatMembers: () => ({ data: CHAT }),
  useRegisterChatKey: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useCreateEphemeralChatKey: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useRegisterChatChannel: () => ({ mutateAsync: vi.fn() }),
  useResetChatChannel: () => ({ isPending: false, mutate: vi.fn() }),
  useHideChatNote: () => ({ isPending: false, mutate: vi.fn() }),
  // 自動再参加 (#223) の一時鍵。投影用画面ではこれに頼らない
  fetchEphemeralChatKey: vi.fn(async () => ephemeralKey),
  createOfficialChannelEvent: vi.fn(),
}));

vi.mock("../lib/nostrChat.js", () => {
  const signer = { pubkey: "pk-me", signEvent: vi.fn() };
  return {
    ChatRelayPool: class {
      onstatus: (() => void) | null = null;
      connected = true;
      async connect() {}
      subscribe(_channelId: string, onEvent: (ev: NostrEvent) => void) {
        deliver = onEvent;
        return () => {
          deliver = null;
        };
      }
      async publish() {
        return true;
      }
      close() {}
    },
    buildChannelCreateTemplate: vi.fn(),
    buildChatKeyProofTemplate: vi.fn(),
    buildChannelMessageTemplate: vi.fn(),
    localSignerFromHex: () => signer,
    nip07Signer: async () => signer,
    randomLocalSigner: () => ({ pubkey: "pk-readonly", signEvent: vi.fn() }),
  };
});

beforeEach(() => {
  deliver = null;
  ephemeralKey = null;
});

/** 描画して、非同期の自動再参加・リレー接続が落ち着くまで待つ */
async function renderChat(variant: "display" | "page") {
  const view = render(
    <MemoryRouter>
      <EventChat
        eventId="e-1"
        event={EVENT}
        myRole="staff"
        canChat
        variant={variant}
      />
    </MemoryRouter>,
  );
  // マイクロタスク（鍵の取得→接続→購読）を一巡させる
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

/** 描画したうえで、メッセージを1件リレーから受け取った状態にする */
async function drawChat(variant: "display" | "page") {
  const view = await renderChat(variant);
  await waitFor(() => expect(deliver).not.toBeNull());
  await act(async () => {
    deliver!(MESSAGE);
  });
  return view;
}

describe('EventChat variant="display"（投影用画面）', () => {
  it("一時鍵が取れない（NIP-07 で参加している）人が開いてもメッセージが読める", async () => {
    await drawChat("display");

    // ここが出ないと「参加フォームだけが投影され続ける」状態になる
    expect(await screen.findByText("会場からの発言")).toBeInTheDocument();
  });

  it("参加UIを出さない", async () => {
    // メッセージが流れてこない状態でも参加UIに切り替わらないこと
    await renderChat("display");

    expect(
      screen.queryByRole("button", { name: "チャットに参加する" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("イベント用の一時鍵で発言"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Nostrアカウントで発言")).not.toBeInTheDocument();
    // 入力欄も出さない（読むだけの画面）
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("スタッフ操作（メッセージの非表示・チャンネルの作り直し）を出さない", async () => {
    await drawChat("display");
    await screen.findByText("会場からの発言");

    expect(
      screen.queryAllByTestId("VisibilityOffOutlinedIcon"),
    ).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "チャンネルを作り直す" }),
    ).not.toBeInTheDocument();
  });
});

describe('EventChat variant="page"（通常のチャット画面）', () => {
  it("スタッフには非表示ボタンと入力欄が出る（display 側の確認が空振りでないこと）", async () => {
    // 一時鍵で参加している人＝自動再参加が成立する状態
    ephemeralKey = { secret: "00" };
    await drawChat("page");
    expect(await screen.findByText("会場からの発言")).toBeInTheDocument();

    expect(
      screen.queryAllByTestId("VisibilityOffOutlinedIcon").length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
