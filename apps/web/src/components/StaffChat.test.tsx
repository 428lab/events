import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Event as NostrEvent } from "nostr-tools/pure";
import type { StaffChatPayload } from "@eventer/shared";
import { MESSAGE_BUFFER_MAX } from "../lib/chatMessageBuffer.js";
import { StaffChat } from "./StaffChat.js";

/**
 * スタッフチャット (#382) の受信バッファの配線 (#335 レビュー指摘)。
 *
 * 部屋は準備〜振り返りまで生き続ける長命な場なので、バッファが満杯のまま
 * 誰かが発言する状況が普通に起きる。表示許可リストは〜5秒遅れて届くため、
 * **発言した直後の本人は許可リスト上「部外者」に見える**。ここで自分の発言が
 * 真っ先に捨てられると、リレーは再送しないので二度と出ない。
 * イベントチャット側と同じ規則（`bufferAllowPredicate`）で守れていることを、
 * 画面を通して確かめる。
 */

let deliver: ((ev: NostrEvent) => void) | null = null;
const ROOM = "r".repeat(64);
const THEM = "pk-them";
const ME = "pk-me";

/** ポーリングで差し替わる payload。最初は自分がまだ許可リストに載っていない */
let payload: StaffChatPayload;

function member(pubkey: string, name: string) {
  return {
    pubkey,
    userId: `u-${pubkey}`,
    username: name,
    name,
    avatarUrl: null,
    revokedAt: null,
  };
}

vi.mock("../api/staffChatHooks.js", () => ({
  useStaffChat: () => ({ data: payload, error: null, isSuccess: true }),
  useOpenStaffChat: () => ({
    isPending: false,
    isError: false,
    mutate: vi.fn(),
  }),
}));

vi.mock("../lib/nostrChat.js", () => {
  // vi.mock は巻き上げられるので、外の定数は参照しない
  const me = "pk-me";
  let signed = 0;
  const signer = {
    pubkey: me,
    signEvent: vi.fn(async (tmpl: { content?: string } | undefined) => ({
      id: `sent-${++signed}`,
      pubkey: me,
      created_at: 9_999,
      kind: 9807,
      tags: [],
      content: tmpl?.content ?? "",
      sig: "",
    })),
  };
  return {
    ChatRelayPool: class {
      onstatus: (() => void) | null = null;
      connected = true;
      async connect() {}
      subscribe(_roomId: string, onEvent: (ev: NostrEvent) => void) {
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
    localSignerFromHex: () => signer,
  };
});

// 暗号は素通し（本文＝content）。ここで見たいのはバッファの捨て方だけ
vi.mock("../lib/staffChatCrypto.js", () => ({
  sealStaffChatMessage: (_roomId: string, _keys: unknown, text: string) => ({
    kind: 9807,
    content: text,
    tags: [],
    created_at: 0,
  }),
  openStaffChatMessage: (_keys: unknown, ev: NostrEvent) => ev.content,
  visibleAfterRevocation: () => true,
}));

beforeEach(() => {
  deliver = null;
  payload = {
    roomId: ROOM,
    keys: [{ version: 1, secret: "00" }],
    myKey: { pubkey: ME, secret: "00" },
    members: [member(THEM, "だれか")],
    relays: ["wss://relay.example"],
  };
});

describe("満杯のバッファでも自分の発言は残る (#335)", () => {
  it("許可リストが追いつく前に発言しても、追いついた時点で自分の発言が出る", async () => {
    const view = render(
      <MemoryRouter>
        <StaffChat eventId="e-1" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(deliver).not.toBeNull());

    // 長く使われた部屋: 許可リストに載っている人の発言で上限まで埋まっている
    await act(async () => {
      for (let i = 0; i < MESSAGE_BUFFER_MAX; i++) {
        deliver!({
          id: `real${i}`,
          pubkey: THEM,
          created_at: i,
          kind: 9807,
          tags: [],
          content: `発言${i}`,
          sig: "",
        } as unknown as NostrEvent);
      }
    });

    // 自分（まだ許可リストに載っていない）が発言する
    const box = await screen.findByRole("textbox");
    await act(async () => {
      fireEvent.change(box, { target: { value: "いま入りました" } });
    });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });

    // ポーリングが追いついて自分が許可リストに載る（〜5秒後）
    payload = { ...payload, members: [member(THEM, "だれか"), member(ME, "わたし")] };
    view.rerender(
      <MemoryRouter>
        <StaffChat eventId="e-1" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("いま入りました")).toBeInTheDocument();
  });
});
