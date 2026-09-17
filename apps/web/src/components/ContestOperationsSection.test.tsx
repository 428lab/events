import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { Event, EventRole } from "@eventer/shared";
import { ApiError } from "../api/client.js";
import { ContestOperationsSection } from "./ContestOperationsSection.js";
import { EventSubmissions } from "./EventSubmissions.js";

const mock = vi.hoisted(() => ({
  entries: [] as { id: string; kind: string; name: string; memberUserIds: string[] }[] | undefined,
  participation: { mutate: vi.fn(), isPending: false, isError: false, error: null as unknown },
}));
vi.mock("../api/hooks.js", () => ({
  useMe: () => ({ data: { id: "self" } }),
  useEventEntries: () => ({ data: mock.entries }),
  useSelfEntryParticipation: () => mock.participation,
  useUpdateSubmission: () => ({ mutate: vi.fn() }),
}));
vi.mock("../api/scoringHooks.js", () => ({ useEventState: () => ({ data: { mode: "awards" } }) }));
const event = { contestMode: true, participationType: "individual", venueType: "online" } as Event;
function draw(myRole: EventRole | null = "staff", override: Partial<Event> = {}) {
  return render(<MemoryRouter initialEntries={["/events/e#contest-operations"]}>
    <ContestOperationsSection eventId="e" event={{ ...event, ...override }} myRole={myRole} />
    <EventSubmissions eventId="e" event={{ ...event, ...override }} contest={Boolean(override.contestMode ?? true)} myRole={myRole} />
  </MemoryRouter>);
}
beforeEach(() => {
  mock.entries = []; mock.participation.mutate.mockReset();
  mock.participation.isPending = false; mock.participation.isError = false; mock.participation.error = null;
});
it("puts award setup and selection at the same real anchor, scoring separate from self-entry", () => {
  draw();
  expect(screen.getByRole("link", { name: "賞・賞品を設定" })).toHaveAttribute("href", "/events/e/control#awards");
  expect(screen.getByRole("link", { name: "集計を見て受賞者を選ぶ" })).toHaveAttribute("href", "/events/e/control#awards");
  expect(screen.getByRole("link", { name: "自分で採点する" })).toHaveAttribute("href", "/events/e/scoring");
  expect(screen.getAllByRole("checkbox", { name: "自分も採点対象として参加する" })).toHaveLength(1);
  expect(screen.getByText("進行中: 表彰")).toBeInTheDocument();
  expect(document.activeElement).toHaveAttribute("id", "contest-operations");
  fireEvent.click(screen.getByRole("checkbox"));
  expect(mock.participation.mutate).toHaveBeenCalledExactlyOnceWith(true);
});
it.each(["participant", "judge", null] as const)("no operations card for %s (including an admin without staff role)", (role) => {
  draw(role);
  expect(screen.queryByText("コンテスト運営")).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
it("non-contests hide the card; team entries keep their submission link without the individual switch", () => {
  const view = draw("staff", { contestMode: false });
  expect(screen.queryByText("コンテスト運営")).not.toBeInTheDocument();
  view.unmount();
  mock.entries = [{ id: "team", name: "Team", kind: "team", memberUserIds: ["self"] }];
  draw("staff", { participationType: "team" });
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "自分の提出物へ" })).toHaveAttribute("href", "/events/e#submissions");
  expect(screen.getByText("あなたの成果物").closest("#submissions")).not.toBeNull();
});
it("preserves removal confirmation and scored-entry failure", () => {
  mock.entries = [{ id: "self-entry", kind: "individual", name: "Self", memberUserIds: ["self"] }];
  mock.participation.isError = true;
  mock.participation.error = new ApiError(409, { error: "entry_already_scored" });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  draw();
  expect(screen.getByRole("checkbox")).toBeChecked();
  expect(screen.getByRole("alert")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(mock.participation.mutate).not.toHaveBeenCalled();
  confirm.mockReturnValue(true); fireEvent.click(screen.getByRole("checkbox"));
  expect(mock.participation.mutate).toHaveBeenCalledExactlyOnceWith(false);
  confirm.mockRestore();
});
it("disables self-entry while entries load or a change is pending", () => {
  mock.entries = undefined; const view = draw();
  expect(screen.getByRole("checkbox")).toBeDisabled();
  view.unmount(); mock.entries = []; mock.participation.isPending = true; draw();
  expect(screen.getByRole("checkbox")).toBeDisabled();
});
