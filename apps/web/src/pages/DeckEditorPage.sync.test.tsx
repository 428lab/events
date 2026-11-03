import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Event as NostrEvent, EventTemplate } from "nostr-tools/pure";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import type { Deck, DeckForEdit, DeckSlide, DeckSyncConfig } from "@eventer/shared";
import { ApiError } from "../api/client.js";
import type { DeckSyncTransport } from "../lib/deckSyncChannel.js";

/**
 * チームのスライドの同時編集を、編集画面2つ（同じリレーにつながった別のタブ）で確かめる
 * （docs/team-deck-live-sync.md §10 の画面の結合テスト）。リレーは手元の配り口に差し替える。
 * 守っているのは「起きたら困ること」だけ:
 * - 受け取った変更で保存しない・送り返さない（保存と送信の嵐）
 * - 相手が編集中に Undo しても、相手の変更は消えない
 * - 409 は手元の編集を失わずに当て直して保存し直す
 * - 途切れのあとは、保存済みの中身が勝つ
 * - 打っている文字欄には、相手の文字をフォーカスが外れるまで当てない
 * - 同期の設定が無ければ今の 409 の案内のまま
 */

const mocks = vi.hoisted(() => ({
  decks: new Map<string, unknown>(),
  update: new Map<string, ReturnType<typeof vi.fn>>(),
  /** GET /decks/:id（取り直し）の応答 */
  latest: null as unknown,
  current: "",
}));

vi.mock("../api/client.js", async (orig) => {
  const real = await orig<typeof import("../api/client.js")>();
  return { ...real, api: { ...real.api, get: vi.fn(async () => mocks.latest) } };
});
vi.mock("../api/deckHooks.js", () => ({
  useDeck: () => {
    const deck = mocks.decks.get(tabOf());
    return { data: deck, isLoading: !deck, isError: false };
  },
  useUpdateDeck: () => {
    const name = tabOf();
    return { mutateAsync: (...args: unknown[]) => mocks.update.get(name)!(...args), isPending: false };
  },
  useUploadDeckImage: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../lib/signalHub.js", () => ({ useEventSignal: () => ({ synced: true }) }));

// 描画中のタブを見分ける（2つの画面を同じモジュールで描くため）
import { createContext, useContext } from "react";
const TabContext = createContext("A");
function tabOf(): string {
  // フックは描画中にだけ呼ばれる
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useContext(TabContext);
}

/** 同じリレーにつながったタブどうしを手元でつなぐ。送ると、他のタブの購読へそのまま届く */
const statusCbs = new Map<string, () => void>();
function fakeRelay() {
  const subs = new Set<{ topic: string; on: (ev: NostrEvent) => void }>();
  const sk = generateSecretKey();
  let n = 0;
  const transport = (): DeckSyncTransport => {
    let statusCb: () => void = () => {};
    const id = n++ === 0 ? "A" : "B";
    setTimeout(() => statusCb(), 0);
    return {
      subscribe: (topic, _since, on) => {
        const s = { topic, on };
        subs.add(s);
        return () => subs.delete(s);
      },
      publish: async (template: EventTemplate) => {
        const ev = finalizeEvent(template, sk);
        const topic = ev.tags.find((t) => t[0] === "t")?.[1];
        for (const s of [...subs]) if (s.topic === topic) s.on(ev);
        return true;
      },
      connected: () => true,
      onStatus: (cb) => {
        statusCb = cb;
        statusCbs.set(id, cb);
      },
      close: () => undefined,
    };
  };
  return transport;
}

const relay = vi.hoisted(() => ({ transport: undefined as unknown }));
vi.mock("../lib/deckSyncChannel.js", async (orig) => {
  const real = await orig<typeof import("../lib/deckSyncChannel.js")>();
  return { ...real, relayTransport: (relays: readonly string[]) => (relay.transport as (r: readonly string[]) => DeckSyncTransport)(relays) };
});

const { DeckEditorPage } = await import("./DeckEditorPage.js");

const sync = (userId: string, name: string, version = 1): DeckSyncConfig => ({
  kind: 21078,
  relays: ["wss://relay.test"],
  topic: `topic-v${version}`,
  key: { version, secret: "11".repeat(32) },
  me: { userId, name },
  signal: null,
});

const page = (): DeckSlide[] => [
  {
    id: "s1",
    pos: "V",
    background: "#ffffff",
    elements: [
      { id: "x", type: "text", x: 0, y: 0, w: 100, h: 50, rotation: 0, text: "x の文字", pos: "V" },
      { id: "y", type: "text", x: 0, y: 60, w: 100, h: 50, rotation: 0, text: "y の文字", pos: "k" },
    ],
  },
];

function deckFor(userId: string, name: string, extra: Partial<DeckForEdit> = {}): DeckForEdit {
  return {
    id: "d-1", slug: "abc", ownerId: "u-a", title: "チームの発表", content: { slides: page() },
    createdAt: 0, updatedAt: 0, revision: 1, team: { entryId: "t", eventId: "e", name: "赤チーム" },
    sync: sync(userId, name), ...extra,
  } as DeckForEdit;
}

function tab(name: string) {
  const update = vi.fn(async (input: { baseRevision?: number }) => ({ revision: (input.baseRevision ?? 0) + 1, updatedAt: Date.now(), syncVersion: 1 }));
  mocks.update.set(name, update);
  const view = render(
    <TabContext.Provider value={name}>
      <MemoryRouter>
        <DeckEditorPage />
      </MemoryRouter>
    </TabContext.Provider>,
  );
  const q = within(view.container);
  return { update, q, title: () => q.getByPlaceholderText("スライドのタイトル") as HTMLInputElement };
}

/** レイヤー一覧の名前（奥→手前を、手前が上で出す） */
const layerNames = (q: ReturnType<typeof within>) =>
  within(q.getByText("レイヤー（前面が上）").nextElementSibling as HTMLElement).queryAllByText(/の文字|新しい|打っている/).map((e) => e.textContent);

const selectLayer = (q: ReturnType<typeof within>, name: string) =>
  fireEvent.click(within(q.getByText("レイヤー（前面が上）").nextElementSibling as HTMLElement).getByText(name));

/** まとめ待ち（150ms）・履歴の確定（500ms）・保存（800ms）を過ぎさせる */
const settle = (ms = 1500) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  mocks.decks.clear();
  mocks.update.clear();
  mocks.latest = null;
  relay.transport = fakeRelay();
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function twoTabs() {
  mocks.decks.set("A", deckFor("u-a", "あおい"));
  mocks.decks.set("B", deckFor("u-b", "ゆい"));
  const a = tab("A");
  const b = tab("B");
  return { a, b };
}

describe("チームのスライドの同時編集（画面）", () => {
  it("片方の変更がもう片方に出る。受け取った側は保存も送り返しもしない", async () => {
    const { a, b } = twoTabs();
    await settle();
    fireEvent.change(a.title(), { target: { value: "あおいの題" } });
    await settle(3000);
    expect(b.title().value).toBe("あおいの題");
    expect(a.update).toHaveBeenCalledTimes(1);
    // 受け取っただけの B は保存しない。A の画面も変わらない（送り返されていない）
    expect(b.update).not.toHaveBeenCalled();
    expect(b.q.getByText("保存済み")).toBeInTheDocument();
    expect(a.title().value).toBe("あおいの題");
  });

  it("A が x を変え、B が y を変え、A が Undo しても y は残る", async () => {
    const { a, b } = twoTabs();
    await settle();
    selectLayer(a.q, "x の文字");
    fireEvent.change(a.q.getByLabelText("内容"), { target: { value: "x の新しい文字" } });
    await settle();
    selectLayer(b.q, "y の文字");
    fireEvent.change(b.q.getByLabelText("内容"), { target: { value: "y の新しい文字" } });
    await settle();
    // キー操作は両方の画面が拾うので、A のツールバーの「元に戻す」を押す
    fireEvent.click(within(a.q.getAllByLabelText("元に戻す (Ctrl/⌘+Z)")[0]).getByRole("button"));
    await settle(3000);
    expect(layerNames(a.q)).toEqual(expect.arrayContaining(["x の文字", "y の新しい文字"]));
    expect(layerNames(b.q)).toEqual(expect.arrayContaining(["x の文字", "y の新しい文字"]));
  });

  it("409 になっても手元の変更を失わず、取り直した中身と合わせて保存し直す", async () => {
    const { a } = twoTabs();
    await settle();
    // サーバーには、受け取れていない別の人の保存がある（背景が変わっている）
    const server = page();
    server[0] = { ...server[0], background: "#ff0000" };
    mocks.latest = deckFor("u-a", "あおい", { content: { slides: server }, revision: 5 });
    a.update.mockRejectedValueOnce(new ApiError(409, { error: "deck_conflict", revision: 5, updatedAt: Date.now(), lastSavedBy: { id: "u-c", name: "はると" } }));
    fireEvent.change(a.title(), { target: { value: "わたしの題" } });
    await settle(4000);
    const calls = a.update.mock.calls.map((c) => c[0] as { title: string; baseRevision: number; content: { slides: DeckSlide[] } });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ title: "わたしの題", baseRevision: 5 });
    expect(calls[1].content.slides[0].background).toBe("#ff0000");
    expect(a.q.queryByText(/ほかのメンバーが保存しました/)).toBeNull();
  });

  it("途切れ（つなぎ直し）のあとは、受け取っていた古い値ではなく保存済みの中身になる", async () => {
    const { a, b } = twoTabs();
    await settle();
    fireEvent.change(b.title(), { target: { value: "ゆいの古い題" } });
    await settle(3000);
    expect(a.title().value).toBe("ゆいの古い題");
    // 途切れのあいだに別の人が新しい題で保存していた。A はつなぎ直すと取り直す
    mocks.latest = deckFor("u-a", "あおい", { title: "はるとの新しい題", revision: 9 });
    await act(async () => { statusCbs.get("A")!(); });
    await settle(3000);
    expect(a.title().value).toBe("はるとの新しい題");
    // 取り直した結果は、それだけでは保存しない
    expect(a.update).not.toHaveBeenCalled();
  });

  it("打っている文字欄には、相手の文字をフォーカスが外れるまで当てない", async () => {
    const { a, b } = twoTabs();
    await settle();
    selectLayer(a.q, "x の文字");
    const field = a.q.getByLabelText("内容");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "あおいが打っている" } });
    await settle(200);
    // A の打っている文字は B に届いている（B の欄は A の文字になっている）
    selectLayer(b.q, "あおいが打っている");
    fireEvent.change(b.q.getByLabelText("内容"), { target: { value: "ゆいの文字" } });
    await settle();
    expect((a.q.getByLabelText("内容") as HTMLTextAreaElement).value).toBe("あおいが打っている");
    fireEvent.blur(field);
    await settle();
    // フォーカスが外れたら印を比べる。あとに打ったゆいの文字が残る
    expect((a.q.getByLabelText("内容") as HTMLTextAreaElement).value).toBe("ゆいの文字");
  });

  it("同期の設定が無ければ（機能オフ・個人のデッキ）、今の 409 の案内のまま", async () => {
    mocks.decks.set("A", deckFor("u-a", "あおい", { sync: null }));
    const a = tab("A");
    await settle();
    a.update.mockRejectedValue(new ApiError(409, { error: "deck_conflict", revision: 5, updatedAt: Date.now(), lastSavedBy: { id: "u-c", name: "はると" } }));
    fireEvent.change(a.title(), { target: { value: "わたしの題" } });
    await settle(3000);
    expect(a.update).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/ほかのメンバーが保存しました（はるとさん/)).toBeInTheDocument();
  });
});

export type { Deck };
