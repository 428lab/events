import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { CommunityPage } from "./CommunityPage.js";
import { CommunityMembersPage } from "./CommunityMembersPage.js";
import { EventsBrowser } from "../components/EventsBrowser.js";
import { installEventAccessLifecycle } from "../api/eventAccessLifecycle.js";
import { i18next } from "../i18n/index.js";

const community = { id: "group", slug: "group", name: "Group", description: "", links: [], memberCount: 4, eventCount: 2, requests: [], isMember: false, isOwner: false, likesReceived: 0 };
const hidden = { id: "private-event", title: "Private past gathering", status: "published", visibility: "private", communityId: "group", startsAt: 1, endsAt: 2, venueType: "online", description: "", participantCount: 1 };
const page = (visible: boolean) => ({ events: visible ? [hidden] : [], total: visible ? 1 : 0, page: 1, limit: 10, hasMore: false });
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } } });
  qc.setQueryData(["me"], { user: { id: "viewer" }, isAdmin: false });
  installEventAccessLifecycle(qc);
  let allowed = true;
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input), "https://example.com");
    const path = url.pathname;
    let data: unknown;
    if (path === "/api/auth/me") data = { user: { id: "viewer" }, isAdmin: false };
    else if (path === "/api/public/communities/group") data = { ...community, eventCount: allowed ? 2 : 1 };
    else if (path === "/api/public/communities") data = { communities: [community] };
    else if (path === "/api/public/communities/group/members") data = { members: [{ userId: "public-person", username: "public-person", name: "Public person", role: "member" }] };
    else if (path === "/api/public/communities/group/events") data = page(allowed && url.searchParams.get("phase") === "past");
    else if (path === "/api/public/events/search") data = page(false);
    else throw new Error(`Unexpected request: ${path}`);
    return new Response(JSON.stringify(data));
  });
  vi.stubGlobal("fetch", fetch);
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}><MemoryRouter initialEntries={["/c/group"]}>{children}</MemoryRouter></QueryClientProvider>;
  return { qc, fetch, wrapper, revoke: () => { allowed = false; } };
}
afterEach(() => { vi.unstubAllGlobals(); focusManager.setFocused(undefined); });

it("CommunityPage past tab uses viewer-scoped search, global member count links to the restricted roster", async () => {
  const { qc, fetch, wrapper } = setup();
  const { unmount } = render(<Routes><Route path="/c/:slug" element={<CommunityPage />} /><Route path="/c/:slug/members" element={<CommunityMembersPage />} /></Routes>, { wrapper });
  const memberLink = await screen.findByRole("link", { name: i18next.t("community.memberCount", { n: 4 }) });
  expect(screen.getByText(/2.*イベント|イベント.*2/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: i18next.t("events.tabPast") }));
  await screen.findAllByText(hidden.title);
  const requests = fetch.mock.calls.map(([url]) => String(url));
  expect(requests.some(url => url.includes("/public/communities/group/events?") && url.includes("phase=past"))).toBe(true);
  expect(requests.some(url => url.includes("/public/events/search"))).toBe(false);
  fireEvent.click(memberLink);
  await screen.findByText("Public person");
  expect(screen.getByRole("heading", { name: i18next.t("community.membersHeading", { n: 1 }) })).toBeInTheDocument();
  expect(screen.queryByText(hidden.title)).toBeNull();
  unmount(); qc.clear();
});

it("focus revalidation removes revoked community past events without changing global member count", async () => {
  const { qc, wrapper, revoke } = setup();
  focusManager.setFocused(false);
  const { unmount } = render(<Routes><Route path="/c/:slug" element={<CommunityPage />} /></Routes>, { wrapper });
  await screen.findByRole("link", { name: i18next.t("community.memberCount", { n: 4 }) });
  fireEvent.click(screen.getByRole("tab", { name: i18next.t("events.tabPast") }));
  await screen.findAllByText(hidden.title);
  revoke();
  await act(async () => { focusManager.setFocused(true); });
  await waitFor(() => expect(screen.queryAllByText(hidden.title)).toHaveLength(0));
  expect(screen.getByRole("link", { name: i18next.t("community.memberCount", { n: 4 }) })).toBeInTheDocument();
  unmount(); qc.clear();
});

it("ordinary EventsBrowser communityId filter stays on public discovery", async () => {
  const { qc, fetch, wrapper } = setup();
  const { unmount } = render(<EventsBrowser communityId="group" />, { wrapper });
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes("/public/events/search?") && String(url).includes("communityId=group"))).toBe(true));
  expect(fetch.mock.calls.some(([url]) => String(url).includes("/communities/group/events"))).toBe(false);
  unmount(); qc.clear();
});
