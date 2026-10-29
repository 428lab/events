import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParticipationSlot } from "@eventer/shared";

/** 参加枠の「運営が割り当てる枠（参加者は選べない）」スイッチ (docs/staff-slot-assignment.md) */

const { patchMock, postMock } = vi.hoisted(() => ({ patchMock: vi.fn(), postMock: vi.fn() }));
vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      patch: (...args: unknown[]) => patchMock(...args),
      post: (...args: unknown[]) => postMock(...args),
    },
  };
});

const { EventSlotsEditor } = await import("./EventSlotsEditor.js");

const SLOT: ParticipationSlot = {
  id: "s-1", eventId: "e-1", name: "一般枠", capacity: 10, selectionType: "first_come", sortOrder: 0,
  drawAt: null, staffOnly: false, confirmedCount: 2, waitlistCount: 0, appliedCount: 0,
};

function draw(slots: ParticipationSlot[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, enabled: false } } });
  qc.setQueryData(["event", "e-1", "slots"], slots);
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EventSlotsEditor eventId="e-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  patchMock.mockReset(); patchMock.mockResolvedValue({});
  postMock.mockReset(); postMock.mockResolvedValue({});
});

describe("運営が割り当てる枠のスイッチ", () => {
  it("既存の枠で切り替えると staffOnly を送り、オンの枠には説明を出す", async () => {
    draw([SLOT, { ...SLOT, id: "s-2", name: "運営枠", staffOnly: true }]);
    const switches = screen.getAllByRole("checkbox", { name: "運営が割り当てる枠（参加者は選べない）" });
    // 2つの既存枠 + 追加フォーム
    expect(switches).toHaveLength(3);
    expect(switches[0]).not.toBeChecked();
    expect(switches[1]).toBeChecked();
    expect(screen.getAllByText(/すでにこの枠を選んでいた参加者はそのまま残ります/)).toHaveLength(1);
    fireEvent.click(switches[0]);
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith("/events/e-1/slots/s-1", { staffOnly: true }));
  });

  it("追加するときにオンにできる", async () => {
    draw([]);
    fireEvent.change(screen.getByLabelText(/枠名/), { target: { value: "運営" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "運営が割り当てる枠（参加者は選べない）" }));
    fireEvent.click(screen.getByRole("button", { name: "追加" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/events/e-1/slots",
      { name: "運営", capacity: 10, selectionType: "first_come", staffOnly: true }));
  });
});
