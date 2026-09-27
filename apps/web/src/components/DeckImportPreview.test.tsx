import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeckContent } from "@eventer/shared";
import { DeckImportPreview } from "./DeckImportPreview.js";
import { ElementContent, SlideStage } from "./SlideStage.js";

const url = "https://events.kojira.io/og-default.png";
const image = { id: "img", type: "image" as const, x: 0, y: 0, w: 400, h: 300, rotation: 0, src: url };
const content: DeckContent = { slides: [{ id: "slide-1", background: "#FFFFFF", elements: [image] }] };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("URL image render and preview", () => {
  it("shows loading then failure in viewer without deleting the URL; changing src resets to loading", () => {
    const { rerender } = render(<SlideStage slide={content.slides[0]} width={960} />);
    const img = document.querySelector("img")!;
    expect(img).toHaveAttribute("src", url);
    expect(screen.getByText("画像を読み込み中")).toBeInTheDocument();
    fireEvent.error(img);
    expect(screen.getByText(/画像を表示できません/)).toBeInTheDocument();
    expect(img).toHaveAttribute("src", url);
    const next = "https://example.com/new.png";
    rerender(<SlideStage slide={{ ...content.slides[0], elements: [{ ...image, src: next }] }} width={960} />);
    expect(document.querySelector("img")).toHaveAttribute("src", next);
    expect(screen.getByText("画像を読み込み中")).toBeInTheDocument();
    fireEvent.load(document.querySelector("img")!);
    expect(screen.queryByText("画像を読み込み中")).not.toBeInTheDocument();
  });
  it("keeps src-less placeholders distinct from URL loading", () => {
    render(<ElementContent el={{ ...image, src: undefined }} />);
    expect(screen.getByText("画像URL未設定")).toBeInTheDocument();
    expect(screen.queryByText("画像を読み込み中")).not.toBeInTheDocument();
  });
  it("warns for a nonselected visible thumbnail without removing its URL or preventing review", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(960);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const deck: DeckContent = { slides: [content.slides[0], { id: "slide-2", background: "#FFFFFF", elements: [{ ...image, id: "img-2", src: "https://example.com/photo.png" }] }] };
    render(<DeckImportPreview content={deck} />);
    const thumbnail = screen.getByRole("button", { name: "2ページ目" });
    const img = thumbnail.querySelector("img")!;
    expect(img).toHaveAttribute("src", "https://example.com/photo.png");
    fireEvent.error(img);
    expect(await screen.findByText(/2ページ目 \/ 1番目の要素: 画像を表示できません/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "1ページ目" })).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/photo.png");
    fireEvent.click(thumbnail);
    expect(screen.getByRole("region", { name: "2ページ目" })).toBeInTheDocument();
  });
  it("opens a 960px reading surface with page controls and returns to scaled preview", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const deck: DeckContent = { slides: [content.slides[0], { ...content.slides[0], id: "slide-2" }] };
    render(<DeckImportPreview content={deck} />);
    const region = screen.getByRole("region", { name: "1ページ目" });
    expect(region.querySelector("div[style*=\"width: 320px\"]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "拡大して読む" }));
    expect(region.querySelector("div[style*=\"width: 960px\"]")).toBeTruthy();
    expect(screen.getByText(/左右にスクロール/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
    expect(screen.getByRole("region", { name: "2ページ目" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "拡大表示を閉じる" }));
    expect(screen.getByRole("region", { name: "2ページ目" }).querySelector("div[style*=\"width: 320px\"]")).toBeTruthy();
  });
  it("warns for the exact failed page and element and permits review", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(960);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const deck: DeckContent = { slides: [content.slides[0], { id: "slide-2", background: "#FFFFFF", elements: [{ ...image, id: "img-2", src: "https://example.com/photo.png" }] }] };
    render(<DeckImportPreview content={deck} />);
    const main = screen.getByRole("region", { name: "1ページ目" });
    fireEvent.error(main.querySelector("img")!);
    expect(await screen.findByText(/1ページ目 \/ 1番目の要素: 画像を表示できません/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2ページ目" }));
    expect(screen.getByRole("region", { name: "2ページ目" })).toBeInTheDocument();
    expect(screen.getByText(/1ページ目 \/ 1番目の要素: 画像を表示できません/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "2ページ目" }).querySelector("img")).toHaveAttribute("src", "https://example.com/photo.png");
  });
});
