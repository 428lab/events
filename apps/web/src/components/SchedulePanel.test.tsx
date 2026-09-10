import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SchedulePanel } from "./SchedulePanel.js";

const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("../api/hooks.js", () => ({
  useMe: () => ({ data: null }), useEvent: () => ({ data: null }),
  useUpdateEvent: () => ({ mutate: update }), useUploadEventImage: () => ({}),
}));
vi.mock("../api/scheduleHooks.js", () => ({
  useEventSchedule: () => ({ isLoading: false, data: { myVotes: {}, options: [
    { id: "option", startsAt: 1800000000000, endsAt: 1800003600000, counts: { yes: 1, maybe: 0, no: 0 }, voters: [] },
  ] } }),
  useVoteDateOption: () => ({}), useAddDateOption: () => ({}),
  useDeleteDateOption: () => ({}), useFinalizeDate: () => ({}),
}));
const props = { eventId: "event", isStaff: true, anonymous: false, finalized: true, visible: false,
  eventStartsAt: 1800000000000, eventEndsAt: 1800003600000 };
function setup(overrides = {}) {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <SchedulePanel {...props} {...overrides} />
  </MemoryRouter></QueryClientProvider>);
}
describe("private finalized schedule results", () => {
  it("starts closed, opens via the summary, and preserves the visibility setting control", () => {
    const { container } = setup();
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    const notice = screen.getByText("この結果は現在あなた（スタッフ）にしか表示されていません。");
    expect(notice).not.toBeVisible();
    fireEvent.click(container.querySelector("summary")!);
    expect(details.open).toBe(true);
    expect(notice).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(update).toHaveBeenCalledWith({ scheduleVisible: true });
    fireEvent.click(container.querySelector("summary")!);
    expect(details.open).toBe(false);
  });
  it.each([{ visible: true }, { finalized: false }])("keeps public or active polls expanded: %o", overrides => {
    const { container } = setup(overrides);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByText(overrides.finalized === false ? "日程調整" : "日程調整の結果")).toBeVisible();
  });
  it("still hides private results from participants", () => {
    const { container } = setup({ isStaff: false });
    expect(container).toBeEmptyDOMElement();
  });
});
