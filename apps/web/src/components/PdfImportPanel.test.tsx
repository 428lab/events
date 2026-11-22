import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { PdfDocumentAdapter } from "../lib/pdfImport/pdfPages.js";

const mocks = vi.hoisted(() => ({ importPdf: vi.fn(), navigate: vi.fn() }));
vi.mock("../lib/pdfImport/importPdf.js", async (original) => ({ ...(await original<object>()), importPdf: mocks.importPdf }));
vi.mock("react-router-dom", async (original) => ({ ...(await original<object>()), useNavigate: () => mocks.navigate }));
const { PdfImportPanel } = await import("./PdfImportPanel.js");

const doc = (pageCount: number): PdfDocumentAdapter => ({ pageCount, title: null, renderPage: vi.fn(), destroy: vi.fn() });
function mount(open: (f: File) => Promise<PdfDocumentAdapter>) {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PdfImportPanel open={open} /></MemoryRouter></QueryClientProvider>);
}
const pick = (name = "talk.pdf") => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [new File(["%PDF"], name, { type: "application/pdf" })] } });
};

beforeEach(() => {
  mocks.importPdf.mockReset();
  mocks.navigate.mockReset();
  vi.restoreAllMocks();
});

it("PDF を選ぶとページ数と取り込み方が出て、選んだ方で取り込み、終わったら編集画面を開く", async () => {
  mocks.importPdf.mockResolvedValue({ deck: { id: "d1" }, imagePages: [] });
  mount(async () => doc(3));
  pick();
  expect(await screen.findByText("talk.pdf（3ページ）")).toBeInTheDocument();
  // 既定は見た目そのまま
  expect(screen.getByRole("radio", { name: /見た目そのまま/ })).toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: /文字を直せる形/ }));
  fireEvent.click(screen.getByRole("button", { name: "取り込む" }));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/decks/d1/edit"));
  expect(mocks.importPdf.mock.calls[0]![0]).toMatchObject({ mode: "editable", title: "talk" });
});

it("60ページを超えるときは、最初の60ページでよいか聞いてから取り込む。PDF でなければ断る", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  mocks.importPdf.mockResolvedValue({ deck: { id: "d2" }, imagePages: [] });
  mount(async () => doc(80));
  pick();
  expect(await screen.findByText("このPDFは80ページあります。取り込めるのは最初の60ページまでです。")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "取り込む" }));
  expect(confirm).toHaveBeenCalledWith("最初の60ページを取り込みますか？（80ページ中）");
  expect(mocks.importPdf).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取り込む" }));
  await waitFor(() => expect(mocks.importPdf).toHaveBeenCalledTimes(1));

  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [new File(["x"], "slides.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" })] } });
  expect(await screen.findByText("PDFファイルを選んでください。")).toBeInTheDocument();
});
