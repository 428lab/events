import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SchedulePanel } from "./SchedulePanel.js";

const { update, poll } = vi.hoisted(() => ({ update: vi.fn(), poll: { empty: false, loading: false, error: false } }));
beforeEach(() => { poll.empty = false; poll.loading = false; poll.error = false; });
vi.mock("../api/hooks.js", () => ({
  useIsAdmin: () => false, useMe: () => ({ data: null }), useEvent: () => ({ data: null }),
  useUpdateEvent: () => ({ mutate: update }), useUploadEventImage: () => ({}),
}));
vi.mock("../api/scheduleHooks.js", () => ({
  useEventSchedule: () => ({ isLoading: poll.loading, isError: poll.error, data: { myVotes: {}, options: poll.empty ? [] : [
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
  it.each([{ isStaff: true }, { isStaff: false }])("collapses public finalized results for either role: %o", overrides => {
    const { container } = setup({ ...overrides, visible: true });
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(screen.getByText("日程調整の結果")).toBeVisible();
    fireEvent.click(container.querySelector("summary")!);
    expect(details.open).toBe(true);
  });
  it("keeps active polls expanded", () => {
    const { container } = setup({ finalized: false });
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByText("日程調整")).toBeVisible();
  });
  it("hides private finalized results even from staff on information", () => {
    const { container } = setup({ showManagementActions: false });
    expect(container).toBeEmptyDOMElement();
  });
  it("active information poll omits candidate and settings controls", () => {
    setup({ finalized: false, showManagementActions: false });
    expect(screen.getByText("日程調整")).toBeVisible();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText("候補を追加")).toBeNull();
  });
  it("still hides private results from participants", () => {
    const { container } = setup({ isStaff: false });
    expect(container).toBeEmptyDOMElement();
  });
});


it("management distinguishes finalized empty poll from loading/error; detail defaults remain hidden", () => {
  poll.empty = true;
  const legacy = setup({ showManagementActions: false }); expect(legacy.container).toBeEmptyDOMElement(); legacy.unmount();
  const empty = setup({ showEmptyState: true });
  expect(screen.getByText("候補日はまだありません。下のカレンダーから追加してください。")).toBeInTheDocument(); empty.unmount();
  poll.loading = true;
  const loading = setup({ showEmptyState: true });
  expect(screen.getByText("読み込み中…")).toBeInTheDocument(); loading.unmount();
  poll.loading = false; poll.error = true;
  setup({ showEmptyState: true });
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText("日程は確定済みです。日程調整の候補はありません。")).toBeNull();
});
