import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { LiveScene, LiveSet } from "@eventer/shared";
import { LiveSetEditorPage } from "./LiveSetEditorPage.js";

/**
 * 配信セット編集画面の結線 (#466 で責務ごとに分けた)。
 *
 * ページ本体に残したのは「いま何を編集しているか」と各部への結線だけなので、
 * 壊れるとしたらそこ。一覧・キャンバス・設定欄・履歴・自動保存が互いに繋がって
 * いることを、実際に描いて確かめる。
 *
 * この画面には要素の一覧が無く、**選ぶ手段がキャンバスしかない**。jsdom には
 * 寸法が無いので、幅だけ与えて描かれる状態を作ってから選ぶ。掴んで動かす操作
 * そのものは追えないので、その中身の式は collection / resizeCorner で押さえてある。
 */

const mocks = vi.hoisted(() => ({
  liveSet: null as LiveSet | null,
  update: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("../api/liveSetHooks.js", () => ({
  useLiveSet: () => ({
    data: mocks.liveSet,
    isLoading: mocks.liveSet === null,
    isError: false,
  }),
  useUpdateLiveSet: () => ({ mutate: mocks.update, isPending: false }),
  useUploadLiveSetImage: () => ({
    mutateAsync: mocks.upload,
    isPending: false,
  }),
}));

vi.mock("../api/bgmHooks.js", () => ({
  useBgmTracks: () => ({
    data: [
      { id: "bgm-1", ownerId: null, name: "祭ばやし", creditText: "", createdAt: 0 },
    ],
  }),
}));

function text(id: string, body: string) {
  return {
    id,
    type: "text" as const,
    x: 10,
    y: 20,
    w: 100,
    h: 50,
    rotation: 0,
    text: body,
  };
}

/** 2シーン。1つ目に文字が2つ */
const twoScenes = (): LiveScene[] => [
  {
    id: "sc1",
    name: "開始前",
    background: "#0E1426",
    elements: [text("e1", "ようこそ"), text("e2", "本文")],
  },
  { id: "sc2", name: "OP", background: "#000000", elements: [] },
];

function draw(scenes: LiveScene[]) {
  mocks.liveSet = {
    id: "l-1",
    ownerId: "u-1",
    communityId: null,
    name: "テスト",
    content: { scenes },
    createdAt: 0,
    updatedAt: 0,
  };
  return render(
    <MemoryRouter>
      <LiveSetEditorPage />
    </MemoryRouter>,
  );
}

const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByText(name));

/**
 * キャンバスの中だけを見る。要素の文字はシーン一覧のサムネイルにも出るので、
 * 範囲を絞らないと取り違える。
 */
const canvas = () =>
  within(screen.getByTestId("live-canvas") as HTMLElement);
/** キャンバス上の要素を選ぶ。選択は mousedown で確定する */
const selectOnCanvas = (body: string) =>
  fireEvent.mouseDown(canvas().getByText(body));
/** 待ち時間を過ぎさせる（履歴の 500ms・保存の 800ms） */
const settle = () => act(() => void vi.advanceTimersByTime(1500));
/** 最後に保存された中身 */
const savedScenes = (): LiveScene[] => {
  const calls = mocks.update.mock.calls;
  return calls[calls.length - 1][0].content.scenes;
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.update.mockReset();
  // jsdom には無いので、幅を測る仕掛けだけ差し替える
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // 幅が 0 だとキャンバスが描かれず、要素を選ぶ手段が無くなる
  Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 960,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (HTMLDivElement.prototype as { clientWidth?: number }).clientWidth;
});

describe("シーンの一覧", () => {
  it("シーンの名前が並ぶ", () => {
    draw(twoScenes());
    expect(screen.getByText("開始前")).toBeInTheDocument();
    expect(screen.getByText("OP")).toBeInTheDocument();
  });

  it("シーンを足すと編集中の直後に入り、そこへ移る", () => {
    draw(twoScenes());
    click("＋ シーン追加");
    // 名前欄はいま編集しているシーンのもの
    expect(screen.getByLabelText("シーン名")).toHaveValue("シーン 3");
    settle();
    expect(savedScenes().map((s) => s.name)).toEqual([
      "開始前",
      "シーン 3",
      "OP",
    ]);
  });

  it("最後の1つは消させない", () => {
    draw([{ id: "sc1", name: "唯一", background: "#000", elements: [] }]);
    expect(
      screen.getByTestId("DeleteOutlineIcon").closest("button"),
    ).toBeDisabled();
  });

  it("別のシーンへ移ると、そのシーンの要素に入れ替わる", () => {
    draw(twoScenes());
    expect(canvas().getByText("ようこそ")).toBeInTheDocument();
    click("OP");
    expect(canvas().queryByText("ようこそ")).not.toBeInTheDocument();
  });

  it("シーンを移ると選択は外れる（戻ってきても選ばれたままにしない）", () => {
    draw(twoScenes());
    selectOnCanvas("ようこそ");
    expect(screen.getByText("この要素を削除")).toBeInTheDocument();
    click("OP");
    expect(screen.queryByText("この要素を削除")).not.toBeInTheDocument();
    // 選択の記録が残っていると、戻ってきた時に選び直していない要素が選ばれる
    click("開始前");
    expect(screen.queryByText("この要素を削除")).not.toBeInTheDocument();
  });
});

describe("設定欄", () => {
  it("何も選んでいなければ選び方の案内を出す", () => {
    draw(twoScenes());
    expect(screen.getByText(/要素を選ぶと編集できます/)).toBeInTheDocument();
  });

  it("選ぶとその要素の設定が出る", () => {
    draw(twoScenes());
    selectOnCanvas("ようこそ");
    expect(screen.getByLabelText("内容")).toHaveValue("ようこそ");
    expect(
      screen.queryByText(/要素を選ぶと編集できます/),
    ).not.toBeInTheDocument();
  });

  it("設定欄の書き換えは選んだ要素だけに効く", () => {
    draw(twoScenes());
    selectOnCanvas("ようこそ");
    fireEvent.change(screen.getByLabelText("内容"), {
      target: { value: "書き換えた" },
    });
    settle();
    expect(savedScenes()[0].elements.map((e) => e.text)).toEqual([
      "書き換えた",
      "本文",
    ]);
  });
});

describe("編集した結果", () => {
  it("消した要素はキャンバスから消え、保存にも乗る", () => {
    draw(twoScenes());
    selectOnCanvas("ようこそ");
    click("この要素を削除");
    expect(canvas().queryByText("ようこそ")).not.toBeInTheDocument();
    settle();
    expect(savedScenes()[0].elements.map((e) => e.id)).toEqual(["e2"]);
  });

  it("複製すると少しずらした写しが増え、選択が写しへ移る", () => {
    draw(twoScenes());
    selectOnCanvas("ようこそ");
    click("複製");
    settle();
    const els = savedScenes()[0].elements;
    expect(els.map((e) => e.text)).toEqual(["ようこそ", "本文", "ようこそ"]);
    expect([els[2].x, els[2].y]).toEqual([30, 40]);
    expect(els[2].id).not.toBe("e1");
    // 写しの側が選ばれているので、続けて消すと写しだけが減る
    click("この要素を削除");
    settle();
    expect(savedScenes()[0].elements.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("最前面へ出すと並びの末尾へ移る", () => {
    draw(twoScenes());
    selectOnCanvas("ようこそ");
    click("最前面");
    settle();
    expect(savedScenes()[0].elements.map((e) => e.id)).toEqual(["e2", "e1"]);
  });

  it("矢印キーで選んだ要素だけが動く", () => {
    draw(twoScenes());
    selectOnCanvas("ようこそ");
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    settle();
    const els = savedScenes()[0].elements;
    expect([els[0].x, els[0].y]).toEqual([20, 20]);
    expect([els[1].x, els[1].y]).toEqual([10, 20]);
  });

  it("シーンのBGMは「変更しない」と「停止」を別のものとして持つ", () => {
    draw(twoScenes());
    // 既定は「変更しない」＝ bgmTrackId を持たない
    expect(screen.getByLabelText("このシーンのBGM")).toHaveTextContent(
      "変更しない",
    );
    fireEvent.mouseDown(screen.getByLabelText("このシーンのBGM"));
    fireEvent.click(screen.getByRole("option", { name: "BGMを停止" }));
    settle();
    expect(savedScenes()[0].bgmTrackId).toBeNull();
  });

  it("開いただけでは保存しない", () => {
    draw(twoScenes());
    settle();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("Ctrl+Z で戻せる", () => {
    draw(twoScenes());
    selectOnCanvas("ようこそ");
    click("この要素を削除");
    settle();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(canvas().getByText("ようこそ")).toBeInTheDocument();
  });

  it("戻したあとは選択が外れる（戻した先に無い要素を選んだままにしない）", () => {
    draw(twoScenes());
    selectOnCanvas("ようこそ");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    settle();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByText(/要素を選ぶと編集できます/)).toBeInTheDocument();
  });
});
