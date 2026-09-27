import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { updateLiveSetInput, visualLiveSetContent } from "@eventer/shared";
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
  useUpdateLiveSet: () => ({ mutateAsync: mocks.update, isPending: false }),
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
const settle = async () => act(async () => { vi.advanceTimersByTime(1500); await Promise.resolve(); });
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

describe("完成部品の一操作", () => {
  it("50要素を超えるカードは丸ごと拒否し理由を表示する", async () => {
    draw([{ id: "full", name: "満杯", background: "#0E1426", elements: Array.from({ length: 49 }, (_, i) => text(`filled-${i}`, "")) }]);
    click("部品を追加");
    click(/琥珀の氏名帯/);
    expect(screen.getByRole("alert")).toHaveTextContent("最大50要素");
    await settle();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("白磁の4カードは個別レイヤーの編集・Undo/Redo・保存と再読込に乗る", async () => {
    const view = draw(visualLiveSetContent("hakuji").scenes);
    click("部品を追加");
    const original = visualLiveSetContent("hakuji").scenes[0].elements.length;
    for (const title of ["藍の氏名札", "紙縁カメラ", "章の短冊", "休憩の案内"]) {
      click(new RegExp(title));
      await settle();
    }
    expect(savedScenes()[0].elements).toHaveLength(original + 17);
    const ids = savedScenes()[0].elements.map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    selectOnCanvas("氏名を入力");
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "山田 花子" } });
    await settle();
    expect(savedScenes()[0].elements.find(element => element.text === "山田 花子")).toBeTruthy();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await settle();
    expect(savedScenes()[0].elements.find(element => element.text === "氏名を入力")).toBeTruthy();
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    await settle();
    expect(savedScenes()[0].elements.find(element => element.text === "山田 花子")).toBeTruthy();
    const saved = structuredClone(savedScenes());
    view.unmount();
    draw(saved);
    expect(canvas().getByText("山田 花子")).toBeInTheDocument();
    expect(canvas().getByText("休憩中")).toBeInTheDocument();
  });
  it("白磁講演の氏名札をカメラ下の独立帯に置く", async () => {
    draw(visualLiveSetContent("hakuji").scenes);
    fireEvent.click(screen.getAllByText("講演").find(element => element.tagName === "SPAN")!);
    click("部品を追加");
    click(/藍の氏名札/);
    await settle();
    const name = savedScenes()[2].elements.find(element => element.text === "氏名を入力");
    expect(name).toMatchObject({ x: 640, y: 359, w: 269, fontSize: 22, maxLines: 2 });
    expect(name!.x + name!.w).toBeLessThanOrEqual(912);
    expect(name!.y + name!.h).toBeLessThan(451);
  });
  it("白磁のカードは50要素を超える前に拒否される", () => {
    draw([{ ...visualLiveSetContent("hakuji").scenes[0], elements: Array.from({ length: 47 }, (_, i) => text(`filled-${i}`, "")) }]);
    click("部品を追加");
    click(/藍の氏名札/);
    expect(screen.getByRole("alert")).toHaveTextContent("最大50要素");
    expect(canvas().queryByText("氏名を入力")).not.toBeInTheDocument();
  });
  it.each(["glow", "signal"] as const)("%s の4部品が別々のレイヤーとして入り、Undo/Redo と保存に乗る", async family => {
    draw(visualLiveSetContent(family).scenes);
    click("部品を追加");
    const titles = family === "glow" ? ["琥珀の氏名帯", "提灯カメラ額", "祭り章リボン", "灯籠の休憩札"] : ["氏名レール", "開放カメラ角", "番号付き章カード", "情報レール"];
    const base = visualLiveSetContent(family).scenes[0].elements.length;
    for (const title of titles) { click(new RegExp(title)); await settle(); }
    expect(canvas().getByText("氏名を入力")).toBeInTheDocument();
    await settle();
    expect(savedScenes()[0].elements.length).toBeGreaterThan(base + 14);
    const ids = savedScenes()[0].elements.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await settle();
    expect(savedScenes()[0].elements).toHaveLength(ids.length - 5);
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    await settle();
    expect(savedScenes()[0].elements).toHaveLength(ids.length);
  });
});

describe("カウントダウンの保存", () => {
  it("指定日時を未確定のまま選んでも自動保存でき、確定後の時刻も保存できる", async () => {
    mocks.update.mockImplementation(async input => updateLiveSetInput.parse(input));
    draw(twoScenes());
    click("開始カウント");
    fireEvent.mouseDown(screen.getByLabelText("目標"));
    fireEvent.click(screen.getByRole("option", { name: "指定日時" }));
    await settle();
    expect(screen.getByText("自動保存")).toBeInTheDocument();
    expect(savedScenes()[0].elements.at(-1)).toMatchObject({ type: "countdown", target: "custom" });
    expect(savedScenes()[0].elements.at(-1)?.targetEpochMs).toBeUndefined();
    fireEvent.change(screen.getByLabelText("現地日時"), { target: { value: "2026-01-01T09:00" } });
    click(/確定: 2026-01-01T00:00:00.000Z/);
    await settle();
    expect(screen.getByText("自動保存")).toBeInTheDocument();
    expect(savedScenes()[0].elements.at(-1)).toMatchObject({ target: "custom", targetEpochMs: Date.UTC(2026, 0, 1) });
  });
});

describe("自動保存の失敗", () => {
  it("失敗を保存済みに見せず再試行できる", async () => {
    mocks.update.mockRejectedValueOnce(new Error("offline"));
    draw(twoScenes());
    fireEvent.change(screen.getByPlaceholderText("配信セット名"), { target: { value: "編集後" } });
    await settle();
    expect(screen.getByText("保存失敗・未保存")).toBeInTheDocument();
    mocks.update.mockResolvedValueOnce(undefined);
    click("保存を再試行");
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });
});

describe("シーンの一覧", () => {
  it("シーンの名前が並ぶ", async () => {
    draw(twoScenes());
    expect(screen.getByText("開始前")).toBeInTheDocument();
    expect(screen.getByText("OP")).toBeInTheDocument();
  });

  it("シーンを足すと編集中の直後に入り、そこへ移る", async () => {
    draw(twoScenes());
    click("＋ シーン追加");
    // 名前欄はいま編集しているシーンのもの
    expect(screen.getByLabelText("シーン名")).toHaveValue("シーン 3");
    await settle();
    expect(savedScenes().map((s) => s.name)).toEqual([
      "開始前",
      "シーン 3",
      "OP",
    ]);
  });

  it("最後の1つは消させない", async () => {
    draw([{ id: "sc1", name: "唯一", background: "#000", elements: [] }]);
    expect(
      screen.getByTestId("DeleteOutlineIcon").closest("button"),
    ).toBeDisabled();
  });

  it("別のシーンへ移ると、そのシーンの要素に入れ替わる", async () => {
    draw(twoScenes());
    expect(canvas().getByText("ようこそ")).toBeInTheDocument();
    click("OP");
    expect(canvas().queryByText("ようこそ")).not.toBeInTheDocument();
  });

  it("シーンを移ると選択は外れる（戻ってきても選ばれたままにしない）", async () => {
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
  it("何も選んでいなければ選び方の案内を出す", async () => {
    draw(twoScenes());
    expect(screen.getByText(/要素を選ぶと編集できます/)).toBeInTheDocument();
  });

  it("選ぶとその要素の設定が出る", async () => {
    draw(twoScenes());
    selectOnCanvas("ようこそ");
    expect(screen.getByLabelText("内容")).toHaveValue("ようこそ");
    expect(
      screen.queryByText(/要素を選ぶと編集できます/),
    ).not.toBeInTheDocument();
  });

  it("設定欄の書き換えは選んだ要素だけに効く", async () => {
    draw(twoScenes());
    selectOnCanvas("ようこそ");
    fireEvent.change(screen.getByLabelText("内容"), {
      target: { value: "書き換えた" },
    });
    await settle();
    expect(savedScenes()[0].elements.map((e) => e.text)).toEqual([
      "書き換えた",
      "本文",
    ]);
  });
});

describe("編集した結果", () => {
  it("消した要素はキャンバスから消え、保存にも乗る", async () => {
    draw(twoScenes());
    selectOnCanvas("ようこそ");
    click("この要素を削除");
    expect(canvas().queryByText("ようこそ")).not.toBeInTheDocument();
    await settle();
    expect(savedScenes()[0].elements.map((e) => e.id)).toEqual(["e2"]);
  });

  it("複製すると少しずらした写しが増え、選択が写しへ移る", async () => {
    draw(twoScenes());
    selectOnCanvas("ようこそ");
    click("複製");
    await settle();
    const els = savedScenes()[0].elements;
    expect(els.map((e) => e.text)).toEqual(["ようこそ", "本文", "ようこそ"]);
    expect([els[2].x, els[2].y]).toEqual([30, 40]);
    expect(els[2].id).not.toBe("e1");
    // 写しの側が選ばれているので、続けて消すと写しだけが減る
    click("この要素を削除");
    await settle();
    expect(savedScenes()[0].elements.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("最前面へ出すと並びの末尾へ移る", async () => {
    draw(twoScenes());
    selectOnCanvas("ようこそ");
    click("最前面");
    await settle();
    expect(savedScenes()[0].elements.map((e) => e.id)).toEqual(["e2", "e1"]);
  });

  it("矢印キーで選んだ要素だけが動く", async () => {
    draw(twoScenes());
    selectOnCanvas("ようこそ");
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    await settle();
    const els = savedScenes()[0].elements;
    expect([els[0].x, els[0].y]).toEqual([20, 20]);
    expect([els[1].x, els[1].y]).toEqual([10, 20]);
  });

  it("シーンのBGMは「変更しない」と「停止」を別のものとして持つ", async () => {
    draw(twoScenes());
    // 既定は「変更しない」＝ bgmTrackId を持たない
    expect(screen.getByLabelText("このシーンのBGM")).toHaveTextContent(
      "変更しない",
    );
    fireEvent.mouseDown(screen.getByLabelText("このシーンのBGM"));
    fireEvent.click(screen.getByRole("option", { name: "BGMを停止" }));
    await settle();
    expect(savedScenes()[0].bgmTrackId).toBeNull();
  });

  it("開いただけでは保存しない", async () => {
    draw(twoScenes());
    await settle();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("Ctrl+Z で戻せる", async () => {
    draw(twoScenes());
    selectOnCanvas("ようこそ");
    click("この要素を削除");
    await settle();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(canvas().getByText("ようこそ")).toBeInTheDocument();
  });

  it("戻したあとは選択が外れる（戻した先に無い要素を選んだままにしない）", async () => {
    draw(twoScenes());
    selectOnCanvas("ようこそ");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await settle();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByText(/要素を選ぶと編集できます/)).toBeInTheDocument();
  });
});
