import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Deck, DeckSlide } from "@eventer/shared";
import { DeckEditorPage } from "./DeckEditorPage.js";

/**
 * スライド編集画面の結線 (#466 で責務ごとに分けた)。
 *
 * ページ本体に残したのは「いま何を編集しているか」と各部への結線だけなので、
 * 壊れるとしたらそこ。一覧・レイヤー・設定欄・履歴・自動保存が互いに繋がって
 * いることを、実際に描いて確かめる。
 *
 * キャンバス上の掴んで動かす操作は jsdom には寸法が無く（幅が 0 なので描かれない）
 * ここでは追えない。その中身の式は deckSlides / resizeCorner のテストで押さえている。
 */

const mocks = vi.hoisted(() => ({
  deck: null as Deck | null,
  update: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("../api/deckHooks.js", () => ({
  useDeck: () => ({
    data: mocks.deck,
    isLoading: mocks.deck === null,
    isError: false,
  }),
  useUpdateDeck: () => ({ mutate: mocks.update, isPending: false }),
  useUploadDeckImage: () => ({ mutateAsync: mocks.upload, isPending: false }),
}));

function text(id: string, body: string, groupId?: string) {
  return {
    id,
    type: "text" as const,
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    rotation: 0,
    text: body,
    groupId,
  };
}

function draw(slides: DeckSlide[]) {
  mocks.deck = {
    id: "d-1",
    slug: "abc",
    ownerId: "u-1",
    title: "テスト",
    content: { slides },
    createdAt: 0,
    updatedAt: 0,
  };
  return render(
    <MemoryRouter>
      <DeckEditorPage />
    </MemoryRouter>,
  );
}

/** 2ページ。1枚目に文字が2つ */
const twoPages = (groupId?: string): DeckSlide[] => [
  {
    id: "s1",
    background: "#ffffff",
    elements: [text("e1", "ようこそ", groupId), text("e2", "本文", groupId)],
  },
  { id: "s2", background: "#ffffff", elements: [] },
];

const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByText(name));

/**
 * レイヤー一覧の中だけを見る。
 * 要素の文字はサムネイルにも出るので、範囲を絞らないと取り違える。
 */
const layers = () =>
  within(
    screen.getByText("レイヤー（前面が上）").nextElementSibling as HTMLElement,
  );
const clickLayer = (name: string) =>
  fireEvent.click(layers().getByText(name));
/** 待ち時間を過ぎさせる（履歴の 500ms・保存の 800ms） */
const settle = () => act(() => void vi.advanceTimersByTime(1500));

beforeEach(() => {
  vi.useFakeTimers();
  mocks.update.mockReset();
  // jsdom には無いので、幅を測る仕掛けだけ差し替える（測れた幅は 0 のまま）
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ページの一覧", () => {
  it("枚数ぶんの番号が出る", () => {
    draw(twoPages());
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });

  it("ページを足すと増える", () => {
    draw(twoPages());
    click("＋ ページ追加");
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("最後の1枚は消させない", () => {
    draw([{ id: "s1", background: "#ffffff", elements: [] }]);
    // 中身の無いスライドを作らせないための歯止め
    expect(screen.getByTestId("DeleteOutlineIcon").closest("button")).toBeDisabled();
  });
});

describe("レイヤーと設定欄", () => {
  it("編集しているページの要素だけが並ぶ", () => {
    draw(twoPages());
    expect(layers().getByText("ようこそ")).toBeInTheDocument();
    expect(layers().getByText("本文")).toBeInTheDocument();
  });

  it("別のページへ移ると、そのページの要素に入れ替わる", () => {
    draw(twoPages());
    click("2");
    expect(layers().queryByText("ようこそ")).not.toBeInTheDocument();
    expect(layers().getByText("要素なし")).toBeInTheDocument();
  });

  it("何も選んでいなければ選び方の案内を出す", () => {
    draw(twoPages());
    expect(screen.getByText(/要素を選ぶと編集できます/)).toBeInTheDocument();
  });

  it("選ぶとその要素の設定が出る", () => {
    draw(twoPages());
    clickLayer("ようこそ");
    expect(screen.getByText("この要素を削除")).toBeInTheDocument();
    expect(
      screen.queryByText(/要素を選ぶと編集できます/),
    ).not.toBeInTheDocument();
  });

  it("グループの一員を選ぶと相方も一緒に選ばれる", () => {
    draw(twoPages("g1"));
    clickLayer("ようこそ");
    expect(screen.getByText("2個を選択中")).toBeInTheDocument();
    expect(screen.getByText("2個を削除")).toBeInTheDocument();
  });
});

describe("編集した結果", () => {
  it("消した要素は一覧から消える", () => {
    draw(twoPages());
    clickLayer("ようこそ");
    click("この要素を削除");
    expect(layers().queryByText("ようこそ")).not.toBeInTheDocument();
    expect(layers().getByText("本文")).toBeInTheDocument();
  });

  it("しばらくすると自動で保存される", () => {
    draw(twoPages());
    clickLayer("ようこそ");
    click("この要素を削除");
    settle();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const saved = mocks.update.mock.calls[0][0];
    expect(saved.content.slides[0].elements.map((e: { id: string }) => e.id)).toEqual(
      ["e2"],
    );
  });

  it("開いただけでは保存しない", () => {
    draw(twoPages());
    settle();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("Ctrl+Z で戻せる", () => {
    draw(twoPages());
    clickLayer("ようこそ");
    click("この要素を削除");
    settle();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(layers().getByText("ようこそ")).toBeInTheDocument();
  });
});
