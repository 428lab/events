import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Deck, EventLiveState, LivePresenter } from "@eventer/shared";
import { LivePresenterSlides } from "./LivePresenterSlides.js";

/** 配信コントロールの発表者とスライド (#571)。
 * 発表者を選ぶと presenterItemId だけを送り、ページ送りは ‹ ›・← →・サムネイルで deckPage を書く。 */

const A = { id: "u-a", username: "a", globalName: "佐藤", avatarUrl: null };
const B = { id: "u-b", username: "b", globalName: "鈴木", avatarUrl: null };

const presenters: LivePresenter[] = [
  { itemId: "it-a", title: "社内ツール", startsAt: null, speaker: A, speakerName: "", linkable: true, deck: { id: "d-a", title: "社内ツール", slideCount: 3 } },
  { itemId: "it-b", title: "趣味の話", startsAt: null, speaker: B, speakerName: "", linkable: true, deck: null },
  { itemId: "it-c", title: "飛び入り", startsAt: null, speaker: null, speakerName: "ゲストさん", linkable: false, deck: null },
];

const deck: Deck = {
  id: "d-a",
  slug: "x",
  ownerId: "u-a",
  title: "社内ツール",
  content: { slides: [0, 1, 2].map((i) => ({ id: `s${i}`, background: "#ffffff", elements: [] })) },
  createdAt: 1,
  updatedAt: 1,
} as unknown as Deck;

const state = (over: Partial<EventLiveState>): EventLiveState => ({
  sceneId: null, deckId: null, deckPage: 0, presenterItemId: null, updatedAt: 1, ...over,
} as unknown as EventLiveState);

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function draw(s: EventLiveState, d: Deck | null) {
  const onUpdate = vi.fn();
  render(<LivePresenterSlides state={s} presenters={presenters} deck={d} myDecks={[]} onUpdate={onUpdate} />);
  return onUpdate;
}

describe("LivePresenterSlides (#571)", () => {
  it("発表者ごとに1行、状態チップつき。フリーテキストの担当者は紐付け不可で選べない", () => {
    const onUpdate = draw(state({}), null);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("スライドあり 3p")).toBeInTheDocument();
    expect(screen.getByText("スライド未登録")).toBeInTheDocument();
    expect(screen.getByText("紐付け不可")).toBeInTheDocument();
    fireEvent.click(screen.getByText("ゲストさん"));
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("佐藤"));
    expect(onUpdate).toHaveBeenCalledWith({ presenterItemId: "it-a" });
  });

  it("選択中の発表者のデッキを ‹ ›・← →・サムネイルでページ送りする", () => {
    const onUpdate = draw(state({ presenterItemId: "it-a", deckId: "d-a", deckPage: 1 }), deck);
    expect(screen.getByText("佐藤 — 社内ツール")).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
    expect(onUpdate).toHaveBeenLastCalledWith({ deckPage: 2 });
    fireEvent.click(screen.getByRole("button", { name: "前のページ" }));
    expect(onUpdate).toHaveBeenLastCalledWith({ deckPage: 0 });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onUpdate).toHaveBeenLastCalledWith({ deckPage: 2 });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onUpdate).toHaveBeenLastCalledWith({ deckPage: 0 });
    fireEvent.click(screen.getByRole("button", { name: "3 ページ目を表示" }));
    expect(onUpdate).toHaveBeenLastCalledWith({ deckPage: 2 });
  });

  it("スライド未登録の発表者を選んでいるときは、その旨を出してページ送りを出さない", () => {
    draw(state({ presenterItemId: "it-b" }), null);
    expect(screen.getByText("鈴木 — スライドなし")).toBeInTheDocument();
    expect(screen.getByText(/この発表にはスライドが紐付いていません/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "次のページ" })).toBeNull();
  });
});
