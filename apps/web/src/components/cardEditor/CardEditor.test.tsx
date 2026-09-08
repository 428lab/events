import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createCardTemplate, resolveCardLayout } from "@eventer/shared";
import { CardEditor } from "./CardEditor.js";
import { api, ApiError } from "../../api/client.js";
import { editPart, removePart, reorderPart, targetLayout } from "./model.js";
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
