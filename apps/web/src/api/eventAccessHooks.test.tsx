import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMyEventAccess, useMyEventInvites } from "./eventAccessHooks.js";
import { useEvent, useLogout, useMe } from "./hooks.js";
const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("./client.js", async (original) => {
  const actual = await original<typeof import("./client.js")>();
  return { ...actual, api: { ...actual.api, get, post } };
});
function Harness() {
  const me = useMe(), invites = useMyEventInvites(), access = useMyEventAccess(), event = useEvent("event");
  const logout = useLogout();
  if (!me.data) return <div>Signed out</div>;
  return <><button onClick={() => logout.mutate()}>Log out</button>
    <div>{invites.data?.pages.flatMap(p => p.invites).map(i => i.title).join(",")}</div>
    <div>{access.data?.pages.flatMap(p => p.accesses).map(i => i.id).join(",")}</div>
    <div>{event.data?.event.title}</div></>;
}
function populatedClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } } });
  qc.setQueryData(["me"], { user: { id: "old-user" }, isAdmin: false });
  qc.setQueryData(["eventInvites", "old-user"], { pages: [{ invites: [{ id: "pending", title: "SECRET receipt" }], nextCursor: null }], pageParams: [undefined] });
  qc.setQueryData(["eventAccess", "old-user"], { pages: [{ accesses: [{ id: "SECRET accepted" }], nextCursor: null }], pageParams: [undefined] });
  qc.setQueryData(["event", "event", "viewer", "old-user"], { event: { title: "SECRET detail" } });
  // Deliberately never resolve new responses: old content cannot be hidden by
  // quickly replacing it with the next account's empty server results.
  get.mockReset(); get.mockImplementation(() => new Promise(() => {}));
  post.mockReset(); post.mockResolvedValue({});
  return qc;
}
afterEach(() => focusManager.setFocused(undefined));
describe("populated invitation cache without rebuilding the application", () => {
  it("logout destroys populated receipt/access/detail caches before new responses arrive", async () => {
    const qc = populatedClient();
    render(<QueryClientProvider client={qc}><Harness /></QueryClientProvider>);
    expect(screen.getAllByText(/SECRET/)).toHaveLength(3);
    fireEvent.click(screen.getByText("Log out"));
    await screen.findByText("Signed out");
    expect(screen.queryByText(/SECRET/)).toBeNull();
    expect(qc.getQueryData(["eventInvites", "old-user"])).toBeUndefined();
    expect(qc.getQueryData(["eventAccess", "old-user"])).toBeUndefined();
    expect(qc.getQueryData(["event", "event", "viewer", "old-user"])).toBeUndefined();
    await act(async () => { qc.setQueryData(["me"], { user: { id: "new-user" }, isAdmin: false }); });
    await screen.findByText("Log out");
    expect(screen.queryByText(/SECRET/)).toBeNull();
    qc.clear();
  });
  it("a known account change immediately switches keys even with new responses stalled", async () => {
    const qc = populatedClient();
    render(<QueryClientProvider client={qc}><Harness /></QueryClientProvider>);
    expect(screen.getAllByText(/SECRET/)).toHaveLength(3);
    await act(async () => { qc.setQueryData(["me"], { user: { id: "new-user" }, isAdmin: false }); });
    await waitFor(() => expect(screen.queryByText(/SECRET/)).toBeNull());
    expect(qc.getQueryState(["eventInvites", "new-user"])?.fetchStatus).toBe("fetching");
    qc.clear();
  });
  it("reauthorizes on focus despite global false and fresh cached data", async () => {
    const qc = populatedClient();
    focusManager.setFocused(false);
    render(<QueryClientProvider client={qc}><Harness /></QueryClientProvider>);
    expect(get).not.toHaveBeenCalled();
    await act(async () => { focusManager.setFocused(true); });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith("/me/event-invites");
      expect(get).toHaveBeenCalledWith("/me/event-access");
      expect(get).toHaveBeenCalledWith("/events/event");
    });
    qc.clear();
  });
});
