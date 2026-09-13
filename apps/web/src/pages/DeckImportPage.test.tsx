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
    this.onmessage?.({ data: input.raw === "bad" ? { revision: input.revision, ok: false, error: "invalid_deck_import", issues: [{ path: "slides[0].elements[0].w", code: "out_of_bounds", message: "x+w must be at most 960" }], truncated: false } : { revision: input.revision, ok: true, title: "Preview", content: { slides: [{ id: "preview-slide-1", background: "#FFFFFF", elements: [{ id: "preview-element-1-1", type: "image", x: 0, y: 0, w: 100, h: 100, rotation: 0 }] }] } } });
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
  it("ordinary English screen uses translated controls", async () => {
    await i18next.changeLanguage("en"); mount();
    expect(screen.getByText("Create with an LLM / import")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Validate and preview" })).toBeInTheDocument();
  });
});
