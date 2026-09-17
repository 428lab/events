import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client.js";
import { EventManagePage } from "./EventManagePage.js";

// Real management children and query hooks: only the HTTP boundary is replaced.
let role: string | null;
let access: boolean;
let visibility: string;
let contest: boolean;
let eventResult: (() => Promise<unknown>) | undefined;
beforeEach(() => {
  vi.restoreAllMocks();
  role = "staff"; access = false; visibility = "public"; contest = false; eventResult = undefined;
  vi.spyOn(api, "get").mockImplementation(async (path) => {
    if (path === "/auth/me") return { user: { id: "me", username: "me" }, isAdmin: true } as never;
    if (path === "/events/e") return (eventResult ? await eventResult() : {
      event: { id: "e", title: "夏の発表会", status: "draft", visibility, contestMode: contest,
        attendanceCheck: true, scheduling: false, chatEnabled: false, qaEnabled: true, participationType: "individual" },
      myRole: role, canManageAccess: access,
    }) as never;
    if (path.endsWith("/members")) return { members: [{ id: "m", userId: "other", role: "participant", status: "confirmed", attended: true,
      user: { id: "other", username: "other", globalName: "参加者A" } }] } as never;
    if (path.endsWith("/slots")) return { slots: [] } as never;
    if (path.endsWith("/entries")) return { entries: [] } as never;
    if (path.endsWith("/state")) return { mode: "normal" } as never;
    if (path.endsWith("/staff-invites")) return { invites: [] } as never;
    if (path === "/me/following") return { following: [] } as never;
    if (path.endsWith("/access-invites")) return { invites: [], accessRevision: 0 } as never;
    throw new Error(`Unexpected GET ${path}`);
  });
  vi.spyOn(api, "post").mockResolvedValue({} as never);
});
function draw(hash = "") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[`/events/e/manage${hash}`]}>
    <Routes><Route path="/events/:id/manage" element={<EventManagePage />} /></Routes>
  </MemoryRouter></QueryClientProvider>);
}
it("noncontest staff land on links, not a mounted public-content dashboard; hash opens real member controls", async () => {
  draw();
  await screen.findByRole("heading", { name: "夏の発表会 / 管理" });
  expect(screen.getByRole("link", { name: "イベント情報へ戻る" })).toHaveAttribute("href", "/events/e");
  expect(screen.getByRole("button", { name: "公開する" })).toBeEnabled();
  expect(screen.getByRole("link", { name: "編集" })).toHaveAttribute("href", "/events/e/edit");
  expect(screen.getByRole("link", { name: "QR受付" })).toHaveAttribute("href", "/events/e/checkin");
  expect(screen.queryByRole("heading", { name: "コンテスト運営" })).toBeNull();
  expect(vi.mocked(api.get).mock.calls.some(([p]) => /entries|state|questions|photos|slots|access-invites/.test(p))).toBe(false);
  expect(screen.queryByTitle("ロールを変更")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "参加者" }));
  await screen.findByTitle("ロールを変更");
  expect(screen.getByRole("checkbox")).toBeChecked();
  expect(document.activeElement).toHaveAttribute("id", "members");
  fireEvent.click(screen.getByRole("button", { name: "参加者" }));
  await waitFor(() => expect(screen.queryByTitle("ロールを変更")).toBeNull());
  expect(api.post).not.toHaveBeenCalled();
});
it("contest staff get exactly one existing participation control and award destination", async () => {
  contest = true; draw();
  expect(await screen.findByRole("heading", { name: "コンテスト運営" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "賞・賞品を設定" })).toHaveAttribute("href", "/events/e/control#awards");
  expect(screen.getAllByRole("checkbox", { name: "自分も採点対象として参加する" })).toHaveLength(1);
});
it("private nonstaff access manager gets only the existing private invite controls, even at a direct hash", async () => {
  role = null; access = true; visibility = "private"; contest = true; draw("#invites");
  await screen.findByLabelText("登録済みのユーザー名（@handle）");
  expect(screen.queryByText("一般運営")).toBeNull();
  expect(screen.queryByRole("button", { name: "公開する" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "コンテスト運営" })).toBeNull();
  expect(vi.mocked(api.get).mock.calls.every(([p]) => ["/auth/me", "/events/e", "/events/e/access-invites"].includes(p))).toBe(true);
});
it.each([null, "participant"])("denies %s (including site admin) before mounting any management children", async (value) => {
  role = value; draw("#members");
  await screen.findByText("このイベントを管理する権限がありません。");
  expect(screen.getByRole("link", { name: "イベント情報へ戻る" })).toBeInTheDocument();
  expect(vi.mocked(api.get).mock.calls.every(([p]) => ["/auth/me", "/events/e"].includes(p))).toBe(true);
});
it("canManageAccess is not a grant for a public event", async () => {
  role = null; access = true; draw("#invites");
  await screen.findByText("このイベントを管理する権限がありません。");
  expect(api.get).not.toHaveBeenCalledWith("/events/e/access-invites");
});
it("loading and failed event lookup never mount operation children", async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise((_, no) => { reject = no; });
  eventResult = () => pending;
  draw("#invites");
  expect(screen.queryByRole("heading")).toBeNull();
  await act(async () => reject(new Error("missing")));
  await screen.findByRole("alert");
  expect(vi.mocked(api.get).mock.calls.every(([p]) => ["/auth/me", "/events/e"].includes(p))).toBe(true);
});


it("staff private invitations still require canManageAccess, while staff-invite controls remain available", async () => {
  visibility = "private"; access = false; draw("#invites");
  await screen.findByRole("heading", { name: "運営に招く" });
  expect(screen.queryByLabelText("登録済みのユーザー名（@handle）")).toBeNull();
  expect(api.get).not.toHaveBeenCalledWith("/events/e/access-invites");
});
