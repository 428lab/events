import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LiveSetsPage } from "./LiveSetsPage.js";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../api/liveSetHooks.js", () => ({
  useMyLiveSets: () => ({ data: [], isLoading: false }),
  useCreateLiveSet: () => ({ mutate: mocks.create, isPending: false, isError: false }),
  useDeleteLiveSet: () => ({ mutate: vi.fn() }),
}));

describe("LiveSetsPage 白磁 chooser", () => {
  it("shows the distinct light standby/keynote thumbnails and creates only its own template ID", () => {
    render(<MemoryRouter><LiveSetsPage /></MemoryRouter>);
    const card = screen.getByText("白磁 / Hakuji").closest(".MuiCard-root")!;
    expect(card).toHaveTextContent("白い紙面と藍の文字");
    expect(card.querySelectorAll('[style*="background: rgb(246, 242, 234)"]')).toHaveLength(2);
    fireEvent.click(card.querySelector("button")!);
    expect(mocks.create).toHaveBeenCalledWith({ name: "白磁", templateId: "hakuji" }, expect.any(Object));
  });
});
