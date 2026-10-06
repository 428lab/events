import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { EventRequestDetail } from "../api/requestHooks.js";
import { EventRequestDetailPage } from "./EventRequestDetailPage.js";

const detail: EventRequestDetail = {
  request: {
    id: "egg1",
    title: "もくもく会やりたい",
    description: "参考: https://example.com/egg\n危険: javascript:alert(1)",
    venueTypePref: null,
    communityId: null,
    membersOnly: false,
    status: "open",
    createdBy: "creator",
    createdAt: 1,
    attendCount: 0,
    hostCount: 0,
    eventCount: 0,
    slug: "egg1",
    venueWanted: false,
    reactorsAnonymous: false,
  },
  creator: null,
  community: null,
  events: [],
  myReactions: [],
  isMine: false,
  reactors: null,
};

afterEach(() => vi.unstubAllGlobals());

it("たまごの説明文の http(s) URL は新しいタブで開くリンクになり、javascript: はテキストのまま", () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
  });
  qc.setQueryData(["me"], { user: null, isAdmin: false });
  qc.setQueryData(["eventRequest", "egg1"], detail);
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/requests/egg1"]}>
        <Routes>
          <Route path="/requests/:id" element={<EventRequestDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const description = screen.getByText(/参考:/).parentElement!;
  const links = within(description).getAllByRole("link");
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute("href", "https://example.com/egg");
  expect(links[0]).toHaveAttribute("target", "_blank");
  expect(links[0].getAttribute("rel")).toContain("noopener");
  expect(within(description).getByText(/javascript:alert\(1\)/).closest("a")).toBeNull();
  qc.clear();
});
