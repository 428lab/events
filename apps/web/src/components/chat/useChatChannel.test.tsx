import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event as NostrEvent } from "nostr-tools/pure";
import type { ChatMembersPayload } from "@eventer/shared";
import { MESSAGE_BUFFER_MAX } from "../../lib/chatMessageBuffer.js";
import type { ChatSigner } from "../../lib/nostrChat.js";
import { useChatChannel } from "./useChatChannel.js";

/**
 * 接続・購読・送信 (#199 / #215)。
 *
 * ここで守るのは2つ:
 * - **投影用画面は読むだけ** (#215)。リレーの NIP-42 AUTH に応えるための
 *   使い捨て鍵で購読はするが、その鍵では**決して署名しない**。いまは入力欄を
 *   描かないことでも防いでいるが、それは1枚だけの守り。将来 display に
 *   何かのUIを足したときに投稿できてしまわないよう、鍵の側でも縛る。
 * - 満杯のバッファでも、**入った直後の自分の発言が捨てられない**
 *   （許可リストは〜5秒遅れて届くので、その瞬間の本人は部外者に見える）
 */

/** 購読で受け取ったコールバック（テストから配信する） */
let deliver: ((ev: NostrEvent) => void) | null = null;
let published: NostrEvent[] = [];

vi.mock("../../api/eventChatHooks.js", () => ({
  useRegisterChatChannel: () => ({ mutateAsync: vi.fn() }),
  useCreateChatChannel: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("../../lib/nostrChat.js", () => ({
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
    async publish(ev: NostrEvent) {
      published.push(ev);
      return true;
    }
    close() {}
  },
  buildChannelCreateTemplate: vi.fn(),
  buildChannelMessageTemplate: vi.fn((_channelId: string, text: string) => ({
    kind: 42,
    content: text,
    tags: [],
    created_at: 0,
  })),
}));

const THEM = "pk-them";
const ME = "pk-me";
const READ_ONLY = "pk-readonly";

const CHAT: ChatMembersPayload = {
  members: [
    {
      pubkey: THEM,
      userId: "u-2",
      username: "them",
      name: "だれか",
      avatarUrl: null,
      role: "participant",
    },
  ],
  channelId: "chan-1",
  chatEnabled: true,
  hiddenNoteIds: [],
  relays: ["wss://relay.example"],
};

/** 署名器。signEvent を呼ばれたかどうかを見るために別々の spy を持つ */
function makeSigner(pubkey: string) {
  return {
    pubkey,
    signEvent: vi.fn(async (tmpl: { content?: string } | undefined) => ({
      id: `sent-${pubkey}-${tmpl?.content ?? ""}`,
      pubkey,
      created_at: 9_999,
      kind: 42,
      tags: [],
      content: tmpl?.content ?? "",
      sig: "",
    })),
  };
}

function setup({
  signer,
  activeSigner,
}: {
  signer: ReturnType<typeof makeSigner> | null;
  activeSigner: ReturnType<typeof makeSigner>;
}) {
  return renderHook(() =>
    useChatChannel({
      eventId: "e-1",
      eventTitle: "テストイベント",
      chat: CHAT,
      // 署名の呼ばれ方を見るための偽物（返すのは Nostr イベントの形）
      signer: signer as unknown as ChatSigner | null,
      activeSigner: activeSigner as unknown as ChatSigner,
      isOrganizerNip07: () => false,
      canOpenChannel: false,
      chatUnavailable: false,
    }),
  );
}

beforeEach(() => {
  deliver = null;
  published = [];
});

describe("投影用画面は読み取り専用 (#215)", () => {
  it("参加していない（投影用の使い捨て鍵しかない）と、送信は署名もしない", async () => {
    const readOnly = makeSigner(READ_ONLY);
    const { result } = setup({ signer: null, activeSigner: readOnly });
    // 購読は始まる（読むだけの画面でもメッセージは出る）
    await waitFor(() => expect(deliver).not.toBeNull());
    await waitFor(() => expect(result.current.channelId).toBe("chan-1"));

    let sent: string | undefined;
    await act(async () => {
      sent = await result.current.send("投影から書き込む");
    });

    expect(sent).toBe("failed");
    // 使い捨て鍵で署名していない＝リレーにも何も出ていない
    expect(readOnly.signEvent).not.toHaveBeenCalled();
    expect(published).toHaveLength(0);
    expect(result.current.messages).toHaveLength(0);
  });

  it("参加していれば自分の鍵で署名して送れる（上の確認が空振りでないこと）", async () => {
    const me = makeSigner(ME);
    const { result } = setup({ signer: me, activeSigner: me });
    await waitFor(() => expect(result.current.channelId).toBe("chan-1"));

    let sent: string | undefined;
    await act(async () => {
      sent = await result.current.send("こんにちは");
    });

    expect(sent).toBe("ok");
    expect(me.signEvent).toHaveBeenCalledTimes(1);
    expect(published).toHaveLength(1);
    expect(result.current.messages.map((m) => m.content)).toEqual([
      "こんにちは",
    ]);
  });
});

describe("満杯のバッファでも自分の発言は残る (#335 レビュー指摘)", () => {
  it("許可リストが追いつく前に発言しても、その発言が捨てられない", async () => {
    const me = makeSigner(ME);
    const { result } = setup({ signer: me, activeSigner: me });
    await waitFor(() => expect(deliver).not.toBeNull());

    // 混雑したイベント: 許可リストに載っている人の発言で上限まで埋める
    await act(async () => {
      for (let i = 0; i < MESSAGE_BUFFER_MAX; i++) {
        deliver!({
          id: `real${i}`,
          pubkey: THEM,
          created_at: i,
          kind: 42,
          tags: [],
          content: `発言${i}`,
          sig: "",
        } as unknown as NostrEvent);
      }
    });
    expect(result.current.messages).toHaveLength(MESSAGE_BUFFER_MAX);

    // 入ったばかりの自分（許可リストにはまだ載っていない）が発言する
    await act(async () => {
      await result.current.send("はじめまして");
    });

    expect(
      result.current.messages.some((m) => m.content === "はじめまして"),
    ).toBe(true);
    expect(result.current.messages).toHaveLength(MESSAGE_BUFFER_MAX);
  });
});
