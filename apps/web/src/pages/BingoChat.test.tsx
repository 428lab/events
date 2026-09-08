import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@eventer/shared";
import { EventBingoPage } from "./EventBingoPage.js";
import { EventBingoControlPage } from "./EventBingoControlPage.js";

// 画面・アクセス判定・チャット描画・入力欄は実物。
// APIの取得値と署名/リレー接続だけを置き換え、外部には送信しない。
const state = vi.hoisted(() => ({
  event: {} as Event,
  role: "staff" as string | null,
  memberStatus: "confirmed",
  error: false,
  loading: false,
  numbers: [] as number[],
  send: vi.fn(),
  channel: vi.fn(),
  draw: vi.fn(),
}));
vi.mock("../api/hooks.js", () => ({
  useMe: () => ({ data: { id: "me", username: "me", isAdmin: true } }),
  useEvent: () => ({
    data: { event: state.event, myRole: state.role },
    isLoading: state.loading,
    isError: state.error,
  }),
  useEventMembers: () => ({ data: [{ userId: "me", status: state.memberStatus }] }),
}));
vi.mock("../api/bingoHooks.js", () => {
  const mutation = () => ({ isPending: false, mutate: vi.fn() });
  const data = () => ({
    status: "running", drawnNumbers: state.numbers,
    counts: { cards: 30, bingo: 0, reach: 0 }, rows: [],
  });
  return {
    useBingoState: () => ({ data: data() }),
    useBingoStatus: () => ({ data: data() }),
    useIssueBingoCard: mutation, useCreateBingo: mutation, useDeleteBingo: mutation,
    useEndBingo: mutation, useResetBingo: mutation, useStartBingo: mutation,
    useUndoBingoDraw: mutation,
    useDrawBingo: () => ({ isPending: false, mutate: state.draw }),
  };
});
vi.mock("../api/eventChatHooks.js", () => ({
  useChatMembers: () => ({ data: {
    channelId: "room", members: [{ pubkey: "key", username: "me", name: "参加者" }],
    hiddenNoteIds: [],
  } }),
  useResetChatChannel: () => ({ isPending: false, mutate: vi.fn() }),
  useHideChatNote: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("../components/chat/useChatSigner.js", () => ({
  useChatSigner: () => ({ signer: {}, activeSigner: {}, isNip07Ref: { current: false } }),
}));
vi.mock("../components/chat/useChatChannel.js", () => ({
  useChatChannel: (options: unknown) => {
    state.channel(options);
    return {
      channelId: "room", relayConnected: true, send: state.send,
      messages: [{ id: "message", pubkey: "key", created_at: Math.floor(Date.now() / 1000), content: "次の番号が楽しみ" }],
    };
  },
}));

beforeEach(() => {
  state.event = {
    id: "event", title: "ビンゴ検証", status: "published", chatEnabled: true,
    scheduling: false, startsAt: Date.now() - 60_000, endsAt: Date.now() + 3_600_000,
    chatUrlsAllowed: false, createdBy: "me",
  } as Event;
  state.role = "staff";
  state.memberStatus = "confirmed";
  state.error = false;
  state.loading = false;
  state.numbers = [];
  state.send.mockReset().mockResolvedValue("ok");
  state.channel.mockReset();
  state.draw.mockReset();
});

function mount(control = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/events/event/bingo${control ? "/control" : ""}`]}>
        <Routes>
          <Route path="/events/:id/bingo" element={<EventBingoPage />} />
          <Route path="/events/:id/bingo/control" element={<EventBingoControlPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(element());
  return { refresh: () => view.rerender(element()) };
}

describe("ビンゴ画面へのチャット併設 (#499)", () => {
  it.each([false, true])("参加者/主催者 control=%s: 受信・入力・抽選更新・送信", async (control) => {
    if (!control) state.role = "participant";
    const view = mount(control);
    expect(await screen.findByText("次の番号が楽しみ")).toBeInTheDocument();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "リーチです" } });
    if (control) {
      fireEvent.click(screen.getByRole("button", { name: "次を引く" }));
      expect(state.draw).toHaveBeenCalledOnce();
    }
    state.numbers = [42];
    view.refresh();
    expect(screen.getAllByText("42").length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox")).toHaveValue("リーチです");
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(state.send).toHaveBeenCalledWith("リーチです"));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(state.channel.mock.calls[0][0].eventId).toBe("event");
  });

  it.each(["disabled", "draft", "scheduling", "undated", "unconfirmed"])("%sでは接続しない", async (reason) => {
    if (reason === "disabled") state.event.chatEnabled = false;
    if (reason === "draft") state.event.status = "draft";
    if (reason === "scheduling") state.event.scheduling = true;
    if (reason === "undated") state.event.startsAt = 0;
    if (reason === "unconfirmed") state.memberStatus = "applied";
    mount();
    expect(screen.getByRole("complementary", { name: "チャット" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(state.channel).not.toHaveBeenCalled();
  });

  it("サイト管理者でもイベントのstaffでなければ抽選操作画面とチャットを出さない", () => {
    state.role = "participant";
    mount(true);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(state.channel).not.toHaveBeenCalled();
  });

  it("投稿時間外は履歴だけ読め、送信できない", async () => {
    state.event.endsAt = Date.now() - 3 * 3_600_000;
    mount();
    expect(await screen.findByText("次の番号が楽しみ")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
    expect(state.send).not.toHaveBeenCalled();
  });

  it("イベント取得失敗時は古いデータが残っていても接続しない", () => {
    state.error = true;
    mount();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(state.channel).not.toHaveBeenCalled();
  });
});
