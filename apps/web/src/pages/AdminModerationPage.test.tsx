import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ModerationContentPayload } from "@eventer/shared";
import { AdminModerationPage } from "./AdminModerationPage.js";

/**
 * 締め出し (#283) の管理画面の退行防止。
 *
 * 鍵が1人1つでなくなった (#332) ので、サーバーが返す「締め出し中」の行は
 * **その人の鍵ぜんぶ**になる（どの発言に印を付けるかは鍵で決まるため、
 * 鍵を全部渡す必要がある）。この一覧をそのまま並べると、同じ人が鍵の数だけ並び、
 * 「締め出している発言者（2 人）」のように件数まで狂う。
 * 運営が解除の判断をする画面なので、人数が合わないのはそのまま誤操作になる。
 */

const BLOCKED_AT = 1_700_000_000_000;

/** 同じ1人 (u-noisy) が2つの鍵を持ち、締め出されている状態 */
const PAYLOAD: ModerationContentPayload = {
  event: {
    id: "e-1",
    title: "テストイベント",
    status: "published",
    startsAt: BLOCKED_AT,
    endsAt: BLOCKED_AT,
    hostHandle: "host",
  },
  items: [],
  chat: {
    channelId: null,
    relays: [],
    members: [
      {
        pubkey: "pk-1",
        userId: "u-noisy",
        username: "noisy",
        name: "うるさい人",
        avatarUrl: null,
        role: "participant",
      },
      {
        pubkey: "pk-2",
        userId: "u-noisy",
        username: "noisy",
        name: "うるさい人",
        avatarUrl: null,
        role: "participant",
      },
    ],
    hidden: [],
    blocked: [
      { pubkey: "pk-1", userId: "u-noisy", blockedAt: BLOCKED_AT, blockedBy: "u-admin" },
      { pubkey: "pk-2", userId: "u-noisy", blockedAt: BLOCKED_AT, blockedBy: "u-admin" },
    ],
  },
};

vi.mock("../api/hooks.js", () => ({
  useIsAdmin: () => true,
}));

vi.mock("../api/moderationHooks.js", () => ({
  useModerationEvents: () => ({ data: undefined }),
  useModerationContent: () => ({ data: PAYLOAD, isLoading: false }),
  useModerateContent: () => ({ mutate: vi.fn(), isPending: false }),
  useBlockChatAuthor: () => ({ mutate: vi.fn(), isPending: false }),
}));

// チャット本文はリレーから直接取る。ここでは締め出し一覧だけを見るので繋がない
vi.mock("../lib/nostrChat.js", () => ({
  ChatRelayPool: class {
    connected = false;
    onstatus: (() => void) | null = null;
    async connect() {}
    subscribe() {
      return () => {};
    }
    close() {}
  },
  randomLocalSigner: () => ({}),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/moderation?eventId=e-1"]}>
      <AdminModerationPage />
    </MemoryRouter>,
  );
}

describe("締め出している発言者の一覧 (#283)", () => {
  it("鍵を複数持っている人は、人ごとに1行・1人として出る (#332)", async () => {
    renderPage();
    // 鍵は2本でも人は1人
    expect(
      await screen.findByText("締め出している発言者（1 人）"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("うるさい人（@noisy）")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "解除する" })).toHaveLength(1);
  });
});
