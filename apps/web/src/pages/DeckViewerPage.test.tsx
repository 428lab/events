import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeckViewerPage } from "./DeckViewerPage.js";

vi.mock("../api/deckHooks.js", () => ({ usePublicDeck: () => ({ data: { title: "Introduction", content: { slides: [
  { id: "one", background: "#0E1426", elements: [] }, { id: "two", background: "#0E1426", elements: [] },
] } }, isLoading: false, isError: false }), useDeckViewCount: () => ({ data: 3 }) }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ slug: "sample" }) }));
afterEach(() => { vi.unstubAllGlobals(); });
it("lets mobile viewers read at original size without slide-tap advancement", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  render(<DeckViewerPage />);
  fireEvent.click(screen.getByRole("button", { name: "拡大して読む" }));
  const region = screen.getByRole("region", { name: "1ページ目" });
  // jsdom は幅を測れない（0）ので、原寸（960px）を下限に 150% で描く
  expect(region.querySelector("div[style*=\"width: 960px\"]")).toBeTruthy();
  expect(screen.getByText("150%")).toBeInTheDocument();
  fireEvent.click(region.firstElementChild!);
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
  region.scrollLeft = 640;
  fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
  expect(screen.getByRole("region", { name: "2ページ目" })).toBeInTheDocument();
  expect(region.scrollLeft).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "拡大表示を閉じる" }));
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});

it("falls back to an in-page full-screen view when the browser has no element full screen (iPhone Safari)", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const original = HTMLElement.prototype.requestFullscreen;
  // iPhone Safari: requestFullscreen は要素に無い
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { value: undefined, configurable: true });
  try {
    render(<DeckViewerPage />);
    fireEvent.click(screen.getByRole("button", { name: "フルスクリーン" }));
    const dialog = screen.getByRole("dialog", { name: "フルスクリーン" });
    expect(dialog).toBeInTheDocument();
    // 右半分をタップすると次のページ
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(dialog, { clientX: 300, clientY: 400 });
    expect(screen.getAllByText("2 / 2").length).toBeGreaterThan(0);
    // 左半分で前のページ
    fireEvent.click(dialog, { clientX: 50, clientY: 400 });
    expect(screen.getAllByText("1 / 2").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "フルスクリーン" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getAllByText("2 / 2").length).toBeGreaterThan(0);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  } finally {
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { value: original, configurable: true, writable: true });
  }
});

it("requests native full screen on the presentation layer where the browser supports it", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const request = vi.fn(function (this: HTMLElement) { return Promise.resolve(); });
  const original = HTMLElement.prototype.requestFullscreen;
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { value: request, configurable: true, writable: true });
  try {
    render(<DeckViewerPage />);
    fireEvent.click(screen.getByRole("button", { name: "フルスクリーン" }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.contexts[0]).toBe(screen.getByRole("dialog", { name: "フルスクリーン" }));
  } finally {
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { value: original, configurable: true, writable: true });
  }
});

it("zoom steps really enlarge the slide from the fitted width (not just the original 960px)", () => {
  // 画面に合わせた幅が 1200px の PC（器が広い）。原寸 960px に切り替えるだけだと小さくなってしまう
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const spy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  render(<DeckViewerPage />);
  fireEvent.click(screen.getByRole("button", { name: "拡大して読む" }));
  const region = screen.getByRole("region", { name: "1ページ目" });
  expect(region.querySelector("div[style*=\"width: 1800px\"]")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "もっと拡大" }));
  expect(screen.getByText("200%")).toBeInTheDocument();
  expect(region.querySelector("div[style*=\"width: 2400px\"]")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "拡大を小さく" }));
  expect(region.querySelector("div[style*=\"width: 1800px\"]")).toBeTruthy();
  spy.mockRestore();
});
