import { fireEvent, render, screen, within } from "@testing-library/react";
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
  viewerIsCommunityMember: false,
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

/** コミュニティのたまご（公開）。閲覧者のメンバー有無だけ差し替えて使う */
function communityEgg(viewerIsCommunityMember: boolean): EventRequestDetail {
  return {
    ...detail,
    request: { ...detail.request, communityId: "c1" },
    community: { id: "c1", name: "もくもく部", slug: "mokumoku" },
    viewerIsCommunityMember,
  };
}

function renderLoggedIn(data: EventRequestDetail) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
  });
  qc.setQueryData(["me"], { user: { id: "viewer", username: "viewer" }, isAdmin: false });
  qc.setQueryData(["eventRequest", "egg1"], data);
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/requests/egg1"]}>
        <Routes>
          <Route path="/requests/:id" element={<EventRequestDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}

it("コミュニティの非メンバーには「押すと参加します」の注記が出る", () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  const qc = renderLoggedIn(communityEgg(false));
  expect(screen.getByText("押すともくもく部にも参加します")).toBeInTheDocument();
  qc.clear();
});

it("コミュニティのメンバーには注記が出ない", () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  const qc = renderLoggedIn(communityEgg(true));
  expect(screen.queryByText(/にも参加します/)).toBeNull();
  qc.clear();
});

it("賛同と同時に参加したらスナックバーで知らせ、コミュニティの表示を更新する", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/event-requests/egg1/react" && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          request: { ...detail.request, communityId: "c1", attendCount: 1 },
          myReactions: ["attend"],
          joinedCommunity: true,
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const qc = renderLoggedIn(communityEgg(false));
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  fireEvent.click(screen.getByRole("button", { name: /参加したい/ }));
  expect(await screen.findByText("もくもく部にも参加しました")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/event-requests/egg1/react",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ kind: "attend", on: true }) }),
  );
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["community"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["communities"] });
  qc.clear();
});
