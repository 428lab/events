import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DeckImportPage } from "./DeckImportPage.js";
import { writeImportDraft, emptyImportDraft } from "../lib/deckImportSession.js";
import { i18next } from "../i18n/index.js";
const mocks = vi.hoisted(() => ({ user: null as { id: string } | null, save: vi.fn(), navigate: vi.fn() }));
vi.mock("../api/hooks.js", () => ({ useMe: () => ({ data: mocks.user, isLoading: false }), useLogout: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("../api/deckImport.js", () => ({ saveDeckImport: mocks.save }));
vi.mock("react-router-dom", async (original) => ({ ...(await original<object>()), useNavigate: () => mocks.navigate }));
class WorkerMock {
  static current: WorkerMock;
  onmessage: ((e: { data: object }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { WorkerMock.current = this; }
  terminate() {}
  postMessage(input: { revision: number; raw: string }) {
    const broken = input.raw.startsWith('{"format":') ? JSON.parse(input.raw) as { format: string; slides: { elements: { type: string }[] }[] } : null;
    const badType = broken?.slides?.[0]?.elements?.[0]?.type === "typo";
    this.onmessage?.({ data: input.raw === "bad" || broken ? { revision: input.revision, ok: false, error: "invalid_deck_import", issues: [{ path: broken ? badType ? "slides[0].elements[0].type" : "format" : "slides[0].elements[0].w", code: broken ? badType ? "invalid_enum" : "invalid_literal" : "out_of_bounds", message: "x+w must be at most 960" }], truncated: false } : { revision: input.revision, ok: true, version: input.raw.includes('"version":2') ? 2 : 1, title: "Preview", content: { slides: [{ id: "preview-slide-1", background: "#FFFFFF", elements: [{ id: "preview-element-1-1", type: "image", x: 0, y: 0, w: 100, h: 100, rotation: 0 }] }] } } });
  }
}
function mount() { return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><DeckImportPage /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => {
  mocks.user = null; mocks.save.mockReset(); mocks.navigate.mockReset(); sessionStorage.clear();
  vi.stubGlobal("Worker", WorkerMock);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("DeckImportPage real user entry", () => {
  it("anonymous paste validates and exposes all pages without creating anything", async () => {
    mount(); fireEvent.change(screen.getByLabelText("スライドJSON"), { target: { value: "valid" } });
    fireEvent.click(screen.getByRole("button", { name: "検証してプレビュー" }));
    expect(await screen.findByRole("button", { name: "1ページ目" })).toBeInTheDocument();
    expect(screen.getByLabelText("全ページを確認しました")).toBeEnabled();
    expect(screen.getByRole("button", { name: "ログインして保存" })).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("invalid input focuses actionable errors; repair prompt excludes raw source", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    mount(); fireEvent.change(screen.getByLabelText("スライドJSON"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "検証してプレビュー" }));
    expect(await screen.findByText(/slides\[0\].elements\[0\].w/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "LLMへの修正依頼をコピー" }));
    await waitFor(() => expect(copy).toHaveBeenCalled());
    expect(copy.mock.calls[0][0]).toContain("events-lab-deck version 1");
    expect(copy.mock.calls[0][0]).not.toContain("bad");
    expect(screen.getByLabelText("全ページを確認しました")).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(["ja", "en"])("keeps version-aware format and element-type repair advice in %s", async (language) => {
    await i18next.changeLanguage(language);
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    const cases = [
      { version: 2, path: "format", code: "invalid_literal", expected: "version 2" },
      { version: 2, path: "slides[0].elements[0].type", code: "invalid_enum", expected: "image-url" },
      { version: 1, path: "format", code: "invalid_literal", expected: "version 1" },
      { version: 1, path: "slides[0].elements[0].type", code: "invalid_enum", expected: "image-placeholder" },
    ];
    const view = mount();
    for (const [index, { version, path, code, expected }] of cases.entries()) {
      const raw = JSON.stringify({ format: path === "format" ? "typo" : "events-lab-deck", version, title: "Example", slides: [{ background: "#FFFFFF", elements: [{ type: path === "format" ? "image-placeholder" : "typo", x: 0, y: 0, w: 100, h: 100 }] }] });
      fireEvent.change(screen.getByLabelText(language === "ja" ? "スライドJSON" : "Slide JSON"), { target: { value: raw } });
      fireEvent.click(screen.getByRole("button", { name: language === "ja" ? "検証してプレビュー" : "Validate and preview" }));
      await screen.findByText(new RegExp(code));
      fireEvent.click(screen.getByRole("button", { name: language === "ja" ? "LLMへの修正依頼をコピー" : "Copy repair request for LLM" }));
      await waitFor(() => expect(copy).toHaveBeenCalledTimes(index + 1));
      const advice = copy.mock.lastCall![0] as string;
      const constraint = code === "invalid_literal"
        ? language === "ja" ? `versionは数値${version}にしてください。` : `numeric version ${version}.`
        : language === "ja" ? `要素型はtext/image-placeholder${version === 2 ? "/image-url" : ""}です。` : `element types: text/image-placeholder${version === 2 ? "/image-url" : ""}.`;
      expect(advice).toContain(expected);
      expect(advice).toContain(constraint);
      expect(screen.getByText(new RegExp(code)).textContent).toContain(constraint);
      if (version === 2) expect(advice).not.toMatch(/version 1|数値1|image-placeholderです。|element types: text\/image-placeholder\./);
      else expect(advice).not.toContain("image-url");
    }
    view.unmount();
    await i18next.changeLanguage("ja");
  });
  it("save requires binding and both confirmations; later edits reset all confirmations", async () => {
    mocks.user = { id: "owner" }; mount();
    fireEvent.change(screen.getByLabelText("スライドJSON"), { target: { value: "valid" } });
    fireEvent.click(screen.getByRole("button", { name: "検証してプレビュー" }));
    fireEvent.click(screen.getByRole("button", { name: "この原稿を現在ログイン中のアカウントに結び付ける" }));
    const saveButton = screen.getByRole("button", { name: "新規スライドとして保存" });
    expect(saveButton).toBeDisabled();
    fireEvent.click(screen.getByLabelText("全ページを確認しました"));
    expect(saveButton).toBeDisabled();
    fireEvent.click(screen.getByLabelText("公開範囲の説明を確認し、同意します"));
    expect(saveButton).toBeEnabled();
    fireEvent.change(screen.getByLabelText("スライドJSON"), { target: { value: "changed" } });
    expect(saveButton).toBeDisabled();
    expect(screen.getByLabelText("全ページを確認しました")).not.toBeChecked();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("wrong owner never renders the private input, preview or receipt", () => {
    writeImportDraft(sessionStorage, { ...emptyImportDraft(), raw: "PRIVATE SOURCE", ownerId: "loser", key: "11111111-1111-4111-8111-111111111111", state: "pending" });
    mocks.user = { id: "winner" }; mount();
    expect(screen.queryByLabelText("スライドJSON")).not.toBeInTheDocument();
    expect(screen.queryByText("PRIVATE SOURCE")).not.toBeInTheDocument();
    expect(screen.getByText(/別のアカウントの取り込み記録/)).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("wrong file type preserves current textarea", async () => {
    mount(); fireEvent.change(screen.getByLabelText("スライドJSON"), { target: { value: "keep this" } });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(["new"], "bad.txt")] } });
    expect(await screen.findByText("拡張子.jsonのファイルを1つ選んでください。")).toBeInTheDocument();
    expect(screen.getByLabelText("スライドJSON")).toHaveValue("keep this");
  });
  it("revisiting a successful receipt offers explicit new import without automatic redirect or POST", () => {
    const receipt = { id: "11111111-1111-4111-8111-111111111111", slug: "0123456789", replayed: false };
    mocks.user = { id: "owner" };
    writeImportDraft(sessionStorage, { ...emptyImportDraft(), ownerId: "owner", key: receipt.id, state: "success", receipt });
    mount();
    expect(screen.getByRole("link", { name: "編集を開く" })).toHaveAttribute("href", `/decks/${receipt.id}/edit`);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "別デッキとして取り込む" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByLabelText("スライドJSON")).toHaveValue("");
    expect(sessionStorage.getItem("deck-import-v1")).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("offers a distinct v2 image sample and prompt while retaining all three v1 samples", async () => {
    const fetchAsset = vi.fn(async (path: string) => ({ ok: true, text: async () => path.includes("sample-") ? '{"format":"events-lab-deck","version":2}' : "version 2 prompt" }));
    vi.stubGlobal("fetch", fetchAsset);
    mount();
    expect(screen.getByRole("button", { name: "表紙サンプル" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "箇条書きサンプル" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "比較サンプル" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "仕様を読む" }).map((link) => link.getAttribute("href"))).toEqual(["/deck-import/v1/spec.md", "/deck-import/v2/spec.md"]);
    fireEvent.click(screen.getByRole("button", { name: "events lab の紹介（画像付き・10ページ）" }));
    await waitFor(() => expect(screen.getByLabelText("スライドJSON")).toHaveValue('{"format":"events-lab-deck","version":2}'));
    expect(fetchAsset).toHaveBeenCalledWith("/deck-import/v2/sample-events-lab-intro.json");
    expect(screen.getByText(/画像URLは公開デッキに残り/)).toBeInTheDocument();
  });
  it("ordinary English screen uses translated controls", async () => {
    await i18next.changeLanguage("en"); mount();
    expect(screen.getByText("Create with an LLM / import")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Validate and preview" })).toBeInTheDocument();
  });
});
