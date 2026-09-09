import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createCardTemplate, resolveCardLayout } from "@eventer/shared";
import { CardEditor } from "./CardEditor.js";
import { api, ApiError } from "../../api/client.js";
import { editPart, movePart, newPart, removePart, reorderPart, targetLayout } from "./model.js";
import { designHistory } from "./useDesignHistory.js";
import { fitCardText } from "../licenseCard/eventCardText.js";

describe("card editor operations (#506)", () => {
  it("edits and hides a staff part without changing the common design; undo restores it", () => {
    const original = createCardTemplate("name");
    const name = original.common.parts.find(p => p.id === "name")!;
    const edited = editPart(original, "staff", { ...name, x: 88 });
    expect(original.common.parts.find(p => p.id === "name")!.x).toBe(56);
    expect(targetLayout(edited, "staff").parts.find(p => p.id === "name")!.x).toBe(88);
    const removed = removePart(edited, "staff", "name");
    expect(targetLayout(removed, "staff").parts.some(p => p.id === "name")).toBe(false);
    const state = designHistory({ past: [], present: edited, future: [] }, { type: "edit", design: removed });
    expect(designHistory(state, { type: "undo" }).present).toEqual(edited);
    expect(resolveCardLayout(removed, "participant", null)).toEqual(original.common);
  });

  it("snaps absolute move coordinates, keeps bounds and leaves resizing and clicks unchanged", () => {
    const part = newPart("rect");
    expect(movePart(part, 11, 15, false, 16)).toMatchObject({ x: 64, y: 176 });
    expect(movePart(part, 11, 15, false)).toMatchObject({ x: 67, y: 175 });
    expect(movePart(part, 9999, 9999, false, 16)).toMatchObject({ x: 1074 - part.width, y: 650 - part.height });
    expect(movePart(part, -9999, -9999, false, 16)).toMatchObject({ x: 0, y: 0 });
    expect(movePart(part, 0, 0, false, 16)).toBe(part);
    expect(movePart(part, 11, 15, true, 16)).toMatchObject({ width: 331, height: 111 });
  });

  it("changes layer order for staff only", () => {
    const original = createCardTemplate("name");
    const changed = reorderPart(original, "staff", "name", 1);
    expect(targetLayout(changed, "staff").parts[4].id).toBe("name");
    expect(original.common.parts[3].id).toBe("name");
  });

  it("wraps a long name without losing characters or squeezing glyphs", () => {
    const text = "長い表示名でもカードからはみ出さないか確認する参加者";
    const fitted = fitCardText(text, 730, 132, 104);
    expect(fitted.lines.length).toBeGreaterThan(1);
    expect(fitted.lines.join("")).toBe(text);
    expect(fitted.size).toBeGreaterThan(30);
    expect(fitted.lines.length * fitted.size * 1.25).toBeLessThanOrEqual(132);
    const wideMeasure = (line: string) => [...line].length * 4;
    const wide = fitCardText(text, 730, 132, 104, wideMeasure);
    expect(wide.lines.join("")).toBe(text);
    expect(Math.max(...wide.lines.map(wideMeasure)) * wide.size).toBeLessThanOrEqual(730);
    expect(wide.size).toBeLessThan(fitted.size);
  });

  it("keeps grid preferences out of saved cards and persists a rectangle's radius", async () => {
    const design = createCardTemplate("name"), expected = structuredClone(design);
    const band = expected.common.parts.find(p => p.id === "role-band");
    if (band?.kind !== "rect") throw new Error("missing rectangle fixture");
    band.radius = 32;
    const put = vi.spyOn(api, "put").mockResolvedValue({ revision: 2, design: expected });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      const { container } = render(<QueryClientProvider client={qc}><MemoryRouter><CardEditor initial={{ revision: 1, design }}
        context={{ eventId: "event", title: "Event", eventUrl: "https://example.com/events/event", origin: "https://example.com", communityName: "", communityLogo: null }}
        members={[]} assets={[]} slots={[]} /></MemoryRouter></QueryClientProvider>);
      fireEvent.click(screen.getByRole("checkbox", { name: "グリッドに吸着" }));
      fireEvent.change(screen.getByRole("spinbutton", { name: "グリッド間隔" }), { target: { value: "32" } });
      expect(container.querySelector("pattern")).toHaveAttribute("width", "32");
      expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "9. 帯・四角形" }));
      fireEvent.change(screen.getByRole("spinbutton", { name: "角丸半径（R）" }), { target: { value: "32" } });
      expect(container.querySelector('[data-card-part="role-band"] rect')).toHaveAttribute("rx", "32");
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await screen.findByText("保存しました");
      expect(put).toHaveBeenCalledWith("/events/event/name-card-design", { revision: 1, design: expected });
    } finally { put.mockRestore(); }
  });

  it.each([false, true])("returns to printing and confirms only unsaved edits: dirty=%s", async dirty => {
    const qc = new QueryClient();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    try {
      render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/events/event/name-cards/design"]}><Routes>
        <Route path="/events/:id/name-cards/design" element={<CardEditor initial={{ revision: 1, design: createCardTemplate("name") }}
          context={{ eventId: "event", title: "Event", eventUrl: "https://example.com/events/event", origin: "https://example.com", communityName: "", communityLogo: null }}
          members={[]} assets={[]} slots={[]} />} />
        <Route path="/events/:id/name-cards" element={<h1>印刷画面</h1>} />
      </Routes></MemoryRouter></QueryClientProvider>);
      const back = screen.getByRole("button", { name: "名札印刷へ戻る" });
      if (dirty) {
        fireEvent.click(screen.getByRole("button", { name: "4. 表示名" }));
        fireEvent.change(screen.getByRole("spinbutton", { name: "X" }), { target: { value: "88" } });
        expect(back).toBeEnabled();
        fireEvent.click(back);
        expect(screen.getByRole("spinbutton", { name: "X" })).toHaveValue(88);
        expect(screen.queryByText("印刷画面")).toBeNull();
      }
      fireEvent.click(back);
      await screen.findByText("印刷画面");
      expect(confirm).toHaveBeenCalledTimes(dirty ? 2 : 0);
    } finally { confirm.mockRestore(); }
  });

  it("keeps conflicted edits until the owner explicitly reloads the latest document", async () => {
    const design = createCardTemplate("name");
    const put = vi.spyOn(api, "put").mockRejectedValueOnce(new ApiError(409, { error: "card_design_conflict" }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><CardEditor initial={{ revision: 1, design }}
      context={{ eventId: "event", title: "Event", eventUrl: "https://example.com/events/event", origin: "https://example.com", communityName: "", communityLogo: null }}
      members={[]} assets={[]} slots={[]} /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "4. 表示名" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "X" }), { target: { value: "88" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText(/別のスタッフが更新しました/);
    expect(screen.getByRole("spinbutton", { name: "X" })).toHaveValue(88);
    expect(design.common.parts.find(p => p.id === "name")!.x).toBe(56);
    const edited = put.mock.calls[0][1] as { revision: number; design: typeof design };
    expect(edited.revision).toBe(1);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(screen.getByRole("spinbutton", { name: "X" })).toHaveValue(88);
    const latest = editPart(design, "common", { ...design.common.parts.find(p => p.id === "name")!, x: 100 });
    const get = vi.spyOn(api, "get").mockResolvedValueOnce({ revision: 2, design: latest }).mockResolvedValueOnce({ assets: [] });
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    await waitFor(() => expect(qc.getQueryData(["eventCardDesign", "event"])).toEqual({ revision: 2, design: latest }));
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    put.mockRestore(); get.mockRestore(); confirm.mockRestore();
  });
});
