import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventAccessInvitesCard } from "./EventAccessInvitesCard.js";
import { ApiError } from "../api/client.js";
const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../api/client.js", async (original) => {
  const actual = await original<typeof import("../api/client.js")>();
  return { ...actual, api: { ...actual.api, get, post } };
});
function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><EventAccessInvitesCard eventId="e" /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  get.mockReset(); post.mockReset();
  get.mockImplementation(async (path: string) => {
    if (path === "/auth/me") return { user: { id: "host" }, isAdmin: false };
    if (path.endsWith("/access-invites")) return { invites: [], accessRevision: 4 };
    if (path === "/public/users/guest") return { id: "confirmed-id", handle: "guest", name: "ゲスト" };
    throw new Error(`Unexpected ${path}`);
  });
});
describe("EventAccessInvitesCard identity confirmation", () => {
  it("clears confirmed identity when the handle changes, and sends only after another explicit confirmation", async () => {
    draw(); await screen.findByText("閲覧招待はまだありません。");
    fireEvent.change(screen.getByLabelText("登録済みのユーザー名（@handle）"), { target: { value: "guest" } });
    fireEvent.click(screen.getByText("相手を確認")); await screen.findByText("招待先: ゲスト (@guest)");
    fireEvent.change(screen.getByLabelText("登録済みのユーザー名（@handle）"), { target: { value: "guest2" } });
    expect(screen.queryByText("閲覧に招待")).toBeNull(); expect(post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("登録済みのユーザー名（@handle）"), { target: { value: "guest" } });
    fireEvent.click(screen.getByText("相手を確認")); await screen.findByText("招待先: ゲスト (@guest)");
    post.mockResolvedValue({}); fireEvent.click(screen.getByText("閲覧に招待"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/events/e/access-invites", { handle: "guest", expectedUserId: "confirmed-id", expectedAccessRevision: 4 }));
  });
  it("handle_changed explains the mismatch, discards confirmation and never retries or retargets", async () => {
    draw(); await screen.findByText("閲覧招待はまだありません。");
    fireEvent.change(screen.getByLabelText("登録済みのユーザー名（@handle）"), { target: { value: "guest" } });
    fireEvent.click(screen.getByText("相手を確認")); await screen.findByText("招待先: ゲスト (@guest)");
    post.mockRejectedValue(new ApiError(409, { error: "handle_changed" }));
    fireEvent.click(screen.getByText("閲覧に招待"));
    await screen.findByText("確認した相手と現在のユーザー名の持ち主が異なります。相手をもう一度確認してください。");
    expect(screen.queryByText("閲覧に招待")).toBeNull(); expect(post).toHaveBeenCalledTimes(1);
    expect(get.mock.calls.filter(([p]) => p === "/public/users/guest")).toHaveLength(1);
  });
});
