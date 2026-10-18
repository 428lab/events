import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { EventDetailPage } from "./EventDetailPage.js";

/** 共催コミュニティ (#625)。主催の後ろに同じ見た目で並べ、「共催」と添える。
 * 共催が無ければ従来どおり主催だけ */

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("../api/hooks.js", () => ({
  useMe: () => ({ data: null }),
  useEvent: () => ({ data: state.data }),
  usePublishEvent: () => ({ isPending: false, mutate: vi.fn() }),
  eventImageUrl: () => null,
}));
vi.mock("../api/bingoHooks.js", () => ({ useBingoState: () => ({ data: undefined }) }));
vi.mock("../lib/useEventChatAccess.js", () => ({
  useEventChatAccess: () => ({ canChat: false, chatAvailable: false }),
}));
vi.mock("../api/analyticsHooks.js", () => ({ useRecordView: () => {} }));
vi.mock("../components/SchedulePanel.js", () => ({ SchedulePanel: () => null }));
vi.mock("../components/AddToCalendarButton.js", () => ({ AddToCalendarButton: () => null }));
vi.mock("../components/EventPhotos.js", () => ({ EventPhotos: () => null }));
vi.mock("../components/EventComments.js", () => ({ EventComments: () => null }));
vi.mock("../components/EventSchedule.js", () => ({ EventSchedule: () => null }));
vi.mock("../components/EventMaterials.js", () => ({ EventMaterials: () => null }));
vi.mock("../components/EventFeedback.js", () => ({ EventFeedback: () => null }));
vi.mock("../components/EventQa.js", () => ({ EventQa: () => null }));
vi.mock("../components/MeetRanking.js", () => ({ MeetRankingPanel: () => null }));
vi.mock("../components/MeetPrizes.js", () => ({ MeetPrizePanel: () => null }));
vi.mock("../components/VenueOffers.js", () => ({ OfferVenueButton: () => null, VenueOfferPanel: () => null }));
vi.mock("../components/EventStaffInvitesCard.js", () => ({ EventStaffInvitesCard: () => null }));
vi.mock("../components/EventActionButtons.js", () => ({ EventActionButtons: () => null }));
vi.mock("../components/EventAwards.js", () => ({ EventAwards: () => null }));
vi.mock("../components/EventJoinPanel.js", () => ({ EventJoinPanel: () => null }));
vi.mock("../components/EventMemberList.js", () => ({ EventMemberList: () => null }));
vi.mock("../components/EventSubmissions.js", () => ({ EventSubmissions: () => null }));
vi.mock("../components/EventDetailSidebar.js", () => ({ EventDetailSidebar: () => null }));
vi.mock("../components/WarikanSummaryCard.js", () => ({ WarikanSummaryCard: () => null }));
vi.mock("../api/warikanHooks.js", () => ({ useWarikan: () => ({ isSuccess: false }) }));

const event = {
  id: "event", slug: "abc12345", title: "イベント", description: "説明", status: "published",
  startsAt: 1_800_000_000_000, endsAt: 1_800_003_600_000,
  venueType: "online", venueOffline: null, venueAddress: null, venueOnline: null,
  registrationDeadline: null, visibility: "public", scheduling: false, contestMode: false,
  meetRanking: "off", meetPrizes: false, warikanEnabled: false,
};
const host = { id: "c-host", slug: "host", name: "主催コミュ", iconUrl: null };
const cohostA = { id: "c-a", slug: "alpha", name: "共催A", iconUrl: null };
const cohostB = { id: "c-b", slug: "beta", name: "共催B", iconUrl: null };

function draw() {
  return render(<MemoryRouter initialEntries={["/events/event"]}>
    <Routes><Route path="/events/:id" element={<EventDetailPage />} /></Routes>
  </MemoryRouter>);
}

beforeEach(() => {
  state.data = { event, myRole: null, canManageAccess: false, community: host };
});

describe("イベント詳細の共催コミュニティ (#625)", () => {
  it("主催の後ろに共催を順に並べ、それぞれ /c/<slug> へリンクして「共催」と添える", () => {
    state.data = { ...state.data, cohosts: [cohostA, cohostB] };
    draw();
    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/c/"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/c/host", "/c/alpha", "/c/beta"]);
    expect(links[0]).not.toHaveTextContent("共催");
    expect(links[1]).toHaveTextContent("共催A共催");
    expect(links[2]).toHaveTextContent("共催B共催");
  });

  it("共催が無ければ主催だけ（従来どおり）", () => {
    state.data = { ...state.data, cohosts: [] };
    draw();
    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/c/"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/c/host"]);
    expect(links[0]).toHaveTextContent(/^主主催コミュ$/);
  });

  it("旧レスポンス（cohosts が無い）でも主催だけ出る", () => {
    draw();
    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/c/"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/c/host"]);
  });
});
