import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { AwardsView, EventState } from "@eventer/shared";
import { api } from "../api/client.js";
import { ControlPage } from "./ControlPage.js";

const fixture = vi.hoisted(() => ({ role: "staff", contest: true, entries: [{ id: "entry", name: "作品A", memberUserIds: ["u"] }] }));
vi.mock("../api/hooks.js", () => ({
  useEvent: () => ({ data: { event: { title: "Contest", contestMode: fixture.contest }, myRole: fixture.role } }),
  useEventEntries: () => ({ data: fixture.entries }),
  useIsAdmin: () => false,
}));
vi.mock("../lib/entryUser.js", () => ({ useEntryUserResolver: () => () => null }));
let awards: AwardsView;
let state: EventState;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/events/e/control#awards"]}>
    <Routes><Route path="/events/:id/control" element={<ControlPage />} />
      <Route path="/events/:id/awards" element={<div>Ceremony destination</div>} /></Routes>
  </MemoryRouter></QueryClientProvider>);
}
async function ready() { await screen.findByLabelText("賞の名前"); }
const switchMode = () => screen.getByRole("button", { name: "参加者の画面を表彰式に切り替える" });
const openCeremony = () => screen.getByRole("link", { name: "表彰式を開く" });
async function selectWinner() {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "受賞者" }));
  fireEvent.click(await screen.findByRole("option", { name: "作品A" }));
}
function savedWinner() {
  awards.results = [{ id: "result", awardRankId: "rank", specialAwardId: null, entryId: "entry", entryName: "作品A", total: 4, perCriterion: {} }];
}
beforeEach(() => {
  vi.restoreAllMocks();
  fixture.role = "staff"; fixture.contest = true;
  fixture.entries = [{ id: "entry", name: "作品A", memberUserIds: ["u"] }];
  state = { mode: "normal", scoringLocked: false, presentingEntryId: null, awardsRevealCursor: 0, eventId: "e", updatedAt: 0 };
  awards = { ranks: [{ id: "rank", eventId: "e", name: "最優秀賞", content: "賞品", rankOrder: 1 }], specials: [], results: [], criteria: [] };
  vi.spyOn(api, "get").mockImplementation(async (path) => {
    if (path.endsWith("/awards")) return structuredClone(awards) as never;
    if (path.endsWith("/state")) return { ...state } as never;
    if (path.endsWith("/progress")) return { judges: [] } as never;
    if (path.endsWith("/summary")) return { criteria: [], entries: [] } as never;
    throw new Error(path);
  });
  vi.spyOn(api, "put").mockImplementation(async () => { savedWinner(); return { ok: true } as never; });
  vi.spyOn(api, "patch").mockImplementation(async (path, input) => {
    if (path.endsWith("/mode")) { state = { ...state, mode: "awards" }; return state as never; }
    Object.assign(awards.ranks[0], input); return {} as never;
  });
  vi.spyOn(api, "post").mockResolvedValue({} as never);
});

it("waits for winner PUT AND re-fetch, then explicitly switches mode and navigates without another write", async () => {
  const write = deferred<unknown>(); const read = deferred<AwardsView>();
  vi.mocked(api.put).mockImplementationOnce(() => write.promise as never);
  draw(); await ready();
  const get = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation((path) => path.endsWith("/awards") ? read.promise as never : get(path));
  await selectWinner();
  expect(switchMode()).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "受賞者" })).toHaveTextContent("作品A");
  expect(screen.getByText("保存中…")).toBeInTheDocument();
  await act(async () => write.resolve({ ok: true }));
  expect(switchMode()).toBeDisabled();
  savedWinner(); await act(async () => read.resolve(structuredClone(awards)));
  await screen.findByText("保存済み");
  expect(switchMode()).toBeEnabled();
  expect(openCeremony()).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(switchMode());
  await waitFor(() => expect(openCeremony()).not.toHaveAttribute("aria-disabled"));
  fireEvent.click(openCeremony());
  await screen.findByText("Ceremony destination");
  expect(api.put).toHaveBeenCalledTimes(1);
  expect(api.patch).toHaveBeenCalledExactlyOnceWith("/events/e/state/mode", { mode: "awards" });
  expect(api.post).not.toHaveBeenCalled();
  expect(state.scoringLocked).toBe(false);
  expect(state.awardsRevealCursor).toBe(0);
});

it("keeps the failed candidate and retries the same winner only on request", async () => {
  vi.mocked(api.put).mockRejectedValueOnce(new Error("offline"));
  draw(); await ready(); await selectWinner();
  await screen.findByText("保存できませんでした。入力内容は未保存です。");
  expect(screen.getByRole("combobox", { name: "受賞者" })).toHaveTextContent("作品A");
  expect(switchMode()).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "再試行" }));
  await screen.findByText("保存済み");
  expect(api.put).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.put).mock.calls[0]).toEqual(vi.mocked(api.put).mock.calls[1]);
  expect(switchMode()).toBeEnabled();
});

it("a failed confirmation GET offers reload, not a second PUT", async () => {
  draw(); await ready();
  const get = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementationOnce(async () => { throw new Error("read failed"); });
  await selectWinner();
  await screen.findAllByText("保存内容を確認できませんでした");
  expect(switchMode()).toBeDisabled();
  expect(screen.getByLabelText("賞の名前")).toBeDisabled();
  expect(screen.getByRole("button", { name: "賞を追加" })).toBeDisabled();
  vi.mocked(api.get).mockImplementation(get);
  fireEvent.click(screen.getAllByRole("button", { name: "再読み込み" })[0]);
  await waitFor(() => expect(switchMode()).toBeEnabled());
  expect(api.put).toHaveBeenCalledTimes(1);
});

it("restoring a failed blur edit resets the local field even if its server initial value is unchanged", async () => {
  vi.mocked(api.patch).mockRejectedValueOnce(new Error("offline"));
  draw(); await ready();
  const name = screen.getByLabelText("賞の名前");
  fireEvent.change(name, { target: { value: "未保存の名前" } }); fireEvent.blur(name);
  await screen.findByText("保存できませんでした。入力内容は未保存です。");
  expect(name).toHaveValue("未保存の名前");
  fireEvent.click(screen.getByRole("button", { name: "保存済みの内容に戻す" }));
  await waitFor(() => expect(screen.getByLabelText("賞の名前")).toHaveValue("最優秀賞"));
  expect(api.patch).toHaveBeenCalledTimes(1);
  expect(switchMode()).toBeEnabled();
});

it.each(["normal", "awards"] as const)("ordinary blur → ceremony click is guarded in %s mode", async (mode) => {
  state.mode = mode;
  const write = deferred<unknown>();
  vi.mocked(api.patch).mockImplementationOnce(() => write.promise as never);
  draw(); await ready();
  const target = mode === "normal" ? switchMode() : openCeremony();
  const name = screen.getByLabelText("賞の名前");
  fireEvent.change(name, { target: { value: "新しい名前" } });
  // Same batch: the click can still see pre-blur props, so a state-only guard is insufficient.
  act(() => { fireEvent.blur(name); fireEvent.click(target); });
  await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("Ceremony destination")).not.toBeInTheDocument();
  await act(async () => { awards.ranks[0].name = "新しい名前"; write.resolve({}); });
  await screen.findByText("保存済み");
});

it("a failed award creation retains the name, while no awards prevents ceremony switching", async () => {
  awards.ranks = []; fixture.entries = [];
  vi.mocked(api.post).mockRejectedValueOnce(new Error("offline"));
  draw();
  const name = await screen.findByLabelText("賞の名前（例: 最優秀賞）");
  expect(screen.getByText("採点対象のエントリーはまだありません")).toBeInTheDocument();
  expect(switchMode()).toBeDisabled();
  fireEvent.change(name, { target: { value: "新しい賞" } });
  fireEvent.click(screen.getByRole("button", { name: "賞を追加" }));
  await screen.findByText("保存できませんでした。入力内容は未保存です。");
  expect(name).toHaveValue("新しい賞");
});

it("keeps all reorder writes busy, even when one fails before the other completes", async () => {
  awards.ranks.push({ ...awards.ranks[0], id: "second", name: "二等賞", rankOrder: 2 });
  const first = deferred<unknown>(); const second = deferred<unknown>();
  vi.mocked(api.patch).mockImplementationOnce(() => first.promise as never).mockImplementationOnce(() => second.promise as never);
  draw(); await screen.findByDisplayValue("二等賞");
  const cards = screen.getAllByLabelText("賞の名前").map((field) => field.closest('[draggable="true"]')!);
  fireEvent.dragStart(cards[0]); fireEvent.dragOver(cards[1]); fireEvent.drop(cards[1]); fireEvent.dragEnd(cards[0]);
  await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
  await act(async () => first.reject(new Error("offline")));
  expect(switchMode()).toBeDisabled();
  expect(screen.getByText("保存中…")).toBeInTheDocument();
  await act(async () => second.resolve({}));
  await screen.findByText("保存できませんでした。入力内容は未保存です。");
  expect(switchMode()).toBeDisabled();
});

it("does not add the editor to non-contests or show controls to participants", async () => {
  fixture.contest = false; const view = draw();
  await screen.findByRole("heading", { name: "コンテスト運営" });
  expect(screen.queryByLabelText("賞の名前")).not.toBeInTheDocument();
  view.unmount(); fixture.role = "participant"; draw();
  await screen.findByText("進行コントロールはスタッフ専用です。");
  expect(screen.queryByRole("button", { name: "参加者の画面を表彰式に切り替える" })).not.toBeInTheDocument();
});

it("mode failure stays local and never enables ceremony navigation", async () => {
  vi.mocked(api.patch).mockRejectedValueOnce(new Error("offline"));
  draw(); await ready(); fireEvent.click(switchMode());
  await screen.findByText("表彰式に切り替えられませんでした。もう一度お試しください。");
  expect(openCeremony()).toHaveAttribute("aria-disabled", "true");
  expect(api.patch).toHaveBeenCalledTimes(1);
});

it("special awards allow no recipient while scoring remains open", async () => {
  awards.ranks = [];
  awards.specials = [{ id: "special", eventId: "e", name: "特別賞", content: null, sortOrder: 1 }];
  draw(); await screen.findByLabelText("特別枠の名前");
  expect(screen.getByRole("combobox", { name: "受賞者" })).toHaveTextContent("該当者なし");
  expect(switchMode()).toBeEnabled();
  fireEvent.click(switchMode());
  await waitFor(() => expect(openCeremony()).not.toHaveAttribute("aria-disabled"));
  expect(api.put).not.toHaveBeenCalled();
});
