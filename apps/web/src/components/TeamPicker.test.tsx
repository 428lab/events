import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Event, EventRole } from "@eventer/shared";
import { ApiError } from "../api/client.js";
import { TeamPicker } from "./TeamPicker.js";

/** 参加者がチームを選ぶ (#9) */
const mock = vi.hoisted(() => ({
  entries: [] as unknown[],
  members: [] as unknown[],
  state: { scoringLocked: false },
  join: { mutate: vi.fn(), isPending: false, isError: false, error: null as unknown },
  leave: { mutate: vi.fn(), isPending: false, isError: false, error: null as unknown },
}));
vi.mock("../api/hooks.js", () => ({
  useMe: () => ({ data: { id: "me" } }),
  useEventEntries: () => ({ data: mock.entries }),
  useEventMembers: () => ({ data: mock.members }),
}));
vi.mock("../api/scoringHooks.js", () => ({ useEventState: () => ({ data: mock.state }) }));
vi.mock("../api/teamHooks.js", () => ({
  teamApi: () => ({ join: "join", leave: "leave" }),
  useTeamAction: (_: string, call: string) => (call === "join" ? mock.join : mock.leave),
}));

const member = (userId: string, name: string, status = "confirmed") => ({
  id: `m-${userId}`, userId, role: "participant", status, user: { id: userId, username: name, globalName: name },
});
const team = (id: string, name: string, memberUserIds: string[], extra: Record<string, unknown> = {}) => ({
  id, kind: "team", name, memberUserIds, description: "", capacity: null, leaderUserId: null, submission: null, ...extra,
});
const event = { contestMode: true, participationType: "team" } as Event;
const draw = (myRole: EventRole | null = "participant", override: Partial<Event> = {}) =>
  render(<TeamPicker eventId="e" event={{ ...event, ...override }} myRole={myRole} />);
const card = (name: string) => screen.getByText(name).closest("div[class*=MuiBox]") as HTMLElement;

beforeEach(() => {
  mock.state = { scoringLocked: false };
  mock.members = [member("me", "わたし"), member("lead", "リーダーさん"), member("x", "エックス")];
  mock.entries = [
    team("red", "赤チーム", ["lead"], { leaderUserId: "lead", description: "フロント担当" }),
    team("blue", "青チーム", ["x"], { capacity: 1 }),
  ];
  for (const action of [mock.join, mock.leave]) {
    action.mutate.mockReset(); action.isPending = false; action.isError = false; action.error = null;
  }
});

it("チームの一覧（リーダー・人数・満員）を出し、好きなチームに入れる", () => {
  draw();
  expect(screen.getByText("チームを選ぶ")).toBeInTheDocument();
  expect(within(card("赤チーム")).getByText("リーダーさん（リーダー）")).toBeInTheDocument();
  expect(within(card("赤チーム")).getByText("フロント担当")).toBeInTheDocument();
  expect(within(card("青チーム")).getByText("満員")).toBeInTheDocument();
  expect(within(card("青チーム")).getByRole("button", { name: "このチームに入る" })).toBeDisabled();
  fireEvent.click(within(card("赤チーム")).getByRole("button", { name: "このチームに入る" }));
  expect(mock.join.mutate).toHaveBeenCalledExactlyOnceWith("red");
});

it("自分のチームには印が付き、抜けられる。ほかのチームへは「移る」", () => {
  mock.entries = [team("red", "赤チーム", ["lead", "me"]), team("blue", "青チーム", [])];
  draw();
  expect(within(card("赤チーム")).getByText("あなたのチーム")).toBeInTheDocument();
  fireEvent.click(within(card("赤チーム")).getByRole("button", { name: "チームを抜ける" }));
  expect(mock.leave.mutate).toHaveBeenCalledOnce();
  fireEvent.click(within(card("青チーム")).getByRole("button", { name: "このチームに移る" }));
  expect(mock.join.mutate).toHaveBeenCalledExactlyOnceWith("blue");
});

it("採点の締切後はボタンを出さず、運営だけが変えられると案内する", () => {
  mock.state = { scoringLocked: true };
  draw();
  expect(screen.getByText("採点が始まったので、チームを変えられるのは運営だけです。")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("サーバーの team_locked / team_full をそのまま案内する", () => {
  mock.join.isError = true;
  mock.join.error = new ApiError(409, { error: "team_full" });
  draw();
  expect(screen.getByText("満員のため入れませんでした。")).toBeInTheDocument();
});

it("参加確定でない人・運営には選ぶボタンを出さない。個人参加・非コンテスト・チームなしでは何も出さない", () => {
  mock.members = [member("me", "わたし", "waitlist")];
  const waiting = draw();
  expect(screen.getByText("参加が確定するとチームを選べます。")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  waiting.unmount();
  const staff = draw("staff");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  staff.unmount();
  for (const override of [{ participationType: "individual" }, { contestMode: false }] as Partial<Event>[]) {
    const view = draw("participant", override);
    expect(screen.queryByText("チームを選ぶ")).not.toBeInTheDocument();
    view.unmount();
  }
  mock.entries = [];
  draw();
  expect(screen.queryByText("チームを選ぶ")).not.toBeInTheDocument();
});
