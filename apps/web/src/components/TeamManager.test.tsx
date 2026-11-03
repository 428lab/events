import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Event } from "@eventer/shared";
import { ApiError } from "../api/client.js";
import { TeamManager } from "./TeamManager.js";

/** 運営のチーム管理 (#9) */
const action = () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null as unknown });
const mock = vi.hoisted(() => ({
  entries: [] as unknown[],
  members: [] as unknown[],
  actions: {} as Record<string, ReturnType<typeof action>>,
  teamDecks: [] as unknown[],
}));
vi.mock("../api/deckHooks.js", () => ({
  useEventTeamDecks: () => ({ data: mock.teamDecks }),
}));
vi.mock("../api/hooks.js", () => ({
  useEventEntries: () => ({ data: mock.entries }),
  useEventMembers: () => ({ data: mock.members }),
}));
vi.mock("../api/teamHooks.js", () => ({
  teamApi: () => ({ setMode: "setMode", create: "create", update: "update", remove: "remove", setLeader: "setLeader", assign: "assign" }),
  useTeamAction: (_: string, call: string) => mock.actions[call],
}));

const member = (userId: string, name: string, role = "participant") => ({
  id: `m-${userId}`, userId, role, status: "confirmed", user: { id: userId, username: name, globalName: name },
});
const team = (id: string, name: string, memberUserIds: string[], extra: Record<string, unknown> = {}) => ({
  id, kind: "team", name, memberUserIds, description: "", capacity: null, leaderUserId: null, submission: null, ...extra,
});
const draw = (participationType = "team") =>
  render(<TeamManager eventId="e" event={{ contestMode: true, participationType } as Event} />);

beforeEach(() => {
  mock.actions = Object.fromEntries(["setMode", "create", "update", "remove", "setLeader", "assign"].map((k) => [k, action()]));
  mock.members = [member("a", "あさひ"), member("b", "ぼたん"), member("c", "ちえ"), member("s", "うんえい", "staff")];
  mock.entries = [team("red", "赤チーム", ["a"], { leaderUserId: "a", capacity: 3 })];
  mock.teamDecks = [];
});

it("チーム参加がオフならスイッチだけ。オンにできる", () => {
  mock.entries = [{ ...team("x", "個人", ["a"]), kind: "individual" }];
  draw("individual");
  expect(screen.queryByText("チームを作る", { selector: "p" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "チームで参加" }));
  expect(mock.actions.setMode.mutate).toHaveBeenCalledExactlyOnceWith(true);
});

it("チームを作れる（定員は空欄で上限なし、数字なら定員）", () => {
  draw();
  fireEvent.change(screen.getByLabelText("チーム名（空欄なら「チーム1」…）"), { target: { value: "  青チーム " } });
  fireEvent.change(screen.getByLabelText("定員（空欄は上限なし）"), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "チームを作る" }));
  expect(mock.actions.create.mutate).toHaveBeenCalledExactlyOnceWith({ name: "青チーム", description: "", capacity: 4 });
});

it("名前を空欄のまま枠だけ作れる（名前はサーバーが付ける）。リーダーは仮と案内する", () => {
  draw();
  const create = screen.getByRole("button", { name: "チームを作る" });
  expect(create).toBeEnabled();
  fireEvent.click(create);
  expect(mock.actions.create.mutate).toHaveBeenCalledExactlyOnceWith({ name: "", description: "", capacity: null });
  expect(screen.getByText("仮のリーダーです。チームの中でほかのメンバーに任せられます。")).toBeInTheDocument();
});

it("チームの人数・リーダーを出し、未所属の参加者（運営は除く）を一覧にする", () => {
  draw();
  expect(screen.getByText("メンバー 1 / 3人")).toBeInTheDocument();
  // リーダーのメンバー行にバッジ（選択欄のラベルとは別）
  expect(within(screen.getByText("あさひ", { selector: "p" }).parentElement!).getByText("リーダー")).toBeInTheDocument();
  expect(screen.getByText("チーム未所属 2人")).toBeInTheDocument();
  expect(screen.getByText("ぼたん", { selector: "p" })).toBeInTheDocument();
  expect(screen.getByText("ちえ", { selector: "p" })).toBeInTheDocument();
  expect(screen.queryByText("うんえい")).not.toBeInTheDocument();
});

it("メンバーがいるチームは削除できない。空のチームは確認のうえ削除する", () => {
  mock.entries = [team("red", "赤チーム", ["a"]), team("blue", "青チーム", [])];
  vi.spyOn(window, "confirm").mockReturnValue(true);
  draw();
  const deletes = screen.getAllByRole("button", { name: "削除" });
  expect(deletes[0]).toBeDisabled();
  fireEvent.click(deletes[1]);
  expect(mock.actions.remove.mutate).toHaveBeenCalledExactlyOnceWith("blue");
});

it("サーバーのエラーを案内する", () => {
  mock.actions.setMode.isError = true;
  mock.actions.setMode.error = new ApiError(409, { error: "team_mode_locked" });
  draw();
  expect(screen.getByText("採点・成果物・受賞が入ったあとは、チーム参加を切り替えられません。")).toBeInTheDocument();
  expect(within(screen.getByRole("alert")).getByText(/切り替えられません/)).toBeInTheDocument();
});

it("チームのスライドは、運営には「見る」だけ出す（編集はそのチームのメンバー）。無ければ「まだありません」", () => {
  mock.entries = [
    team("red", "赤チーム", ["a"], { leaderUserId: "a" }),
    team("blue", "青チーム", ["b"]),
  ];
  mock.teamDecks = [{ entryId: "red", deck: { id: "d1", slug: "abc123", title: "赤チーム", updatedAt: 0 }, canEdit: false }];
  draw();
  const cardOf = (name: string) => screen.getAllByText(name).find((el) => el.tagName === "P" && el.className.includes("MuiTypography"))!.closest("div[class*=MuiBox]") as HTMLElement;
  const red = cardOf("赤チーム");
  const view = within(red).getByRole("link", { name: "見る" });
  expect(view).toHaveAttribute("href", "/d/abc123");
  expect(within(red).queryByRole("link", { name: "編集する" })).toBeNull();
  const blue = cardOf("青チーム");
  expect(within(blue).getByText("まだありません")).toBeInTheDocument();
});
