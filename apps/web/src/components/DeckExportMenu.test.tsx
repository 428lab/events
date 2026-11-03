import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { parseDeckImport, type DeckContent } from "@eventer/shared";
import { DeckExportMenu } from "./DeckExportMenu.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const content: DeckContent = { slides: [{ id: "s1", background: "#0E1426", elements: [
  { id: "t1", type: "text", x: 40, y: 40, w: 600, h: 100, rotation: 0, text: "ATP 入門", fontSize: 40, color: "#F8FAFC" },
  { id: "i1", type: "image", x: 600, y: 200, w: 300, h: 200, rotation: 0, src: "https://events.kojira.io/api/decks/d1/images/x" },
] }] };

it("offers JSON and PDF; JSON downloads a file that the public importer accepts", async () => {
  let blob: Blob | undefined;
  // jsdom には createObjectURL が無い
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: (b: Blob) => { blob = b; return "blob:x"; },
    revokeObjectURL: () => {},
  }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  render(<DeckExportMenu slug="abc" deck={{ title: "ATP 入門", content }} />);
  fireEvent.click(screen.getByRole("button", { name: "書き出す" }));
  // PDF は印刷用の画面を新しいタブで開く
  expect(screen.getByRole("menuitem", { name: "PDFで保存" })).toHaveAttribute("href", "/d/abc/print");
  fireEvent.click(screen.getByRole("menuitem", { name: "JSONで書き出す" }));

  await waitFor(() => expect(click).toHaveBeenCalled());
  // jsdom の Blob には text() が無いので FileReader で読む
  const text = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob!);
  });
  const parsed = parseDeckImport(text);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.value.slides[0].elements[1]).toMatchObject({ type: "image-url", src: "https://events.kojira.io/api/decks/d1/images/x" });
});
