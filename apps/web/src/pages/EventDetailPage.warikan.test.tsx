import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { api } from "../api/client.js";
import { EventDetailPage } from "./EventDetailPage.js";

/** 割り勘のオン/オフ (#635)。オフのイベントでは導線もカードも出さず、帳簿の GET も叩かない。
 * オンなら従来どおり（確定メンバーに導線を出し、帳簿を取りに行く） */

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("../api/hooks.js", () => ({
  useMe: () => ({ data: { id: "me" } }),
  useEvent: () => ({ data: state.data }),
  usePublishEvent: () => ({ isPending: false, mutate: vi.fn() }),
  eventImageUrl: () => null,
}));
vi.mock("../api/scoringHooks.js", () => ({ useEventState: () => ({ data: undefined }) }));
vi.mock("../api/bingoHooks.js", () => ({ useBingoState: () => ({ data: undefined }) }));
vi.mock("../lib/useEventChatAccess.js", () => ({
  useEventChatAccess: () => ({ canChat: true, chatAvailable: false }),
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
vi.mock("../components/EventChat.js", () => ({ EventChat: () => null }));
vi.mock("../components/MeetRanking.js", () => ({ MeetRankingPanel: () => null }));
vi.mock("../components/MeetPrizes.js", () => ({ MeetPrizePanel: () => null }));
vi.mock("../components/VenueOffers.js", () => ({ OfferVenueButton: () => null, VenueOfferPanel: () => null }));
vi.mock("../components/EventStaffInvitesCard.js", () => ({ EventStaffInvitesCard: () => null }));
vi.mock("../components/EventAwards.js", () => ({ EventAwards: () => null }));
vi.mock("../components/EventJoinPanel.js", () => ({ EventJoinPanel: () => null }));
vi.mock("../components/EventMemberList.js", () => ({ EventMemberList: () => null }));
vi.mock("../components/EventSubmissions.js", () => ({ EventSubmissions: () => null }));
vi.mock("../components/TeamPicker.js", () => ({ TeamPicker: () => null }));
vi.mock("../components/EventDetailSidebar.js", () => ({ EventDetailSidebar: () => null }));

const event = {
  id: "event", slug: "abc12345", title: "イベント", description: "説明", status: "published",
  startsAt: 1_800_000_000_000, endsAt: 1_800_003_600_000,
  venueType: "online", venueOffline: null, venueAddress: null, venueOnline: null,
  registrationDeadline: null, visibility: "public", scheduling: false, contestMode: false,
  meetRanking: "off", meetPrizes: false, warikanEnabled: false,
};

const emptyLedger = {
  expenses: [], members: [], balances: [], settlements: [], payouts: [],
  me: { userId: "me", canAddExpense: true, isStaff: false },
};

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>
    <MemoryRouter initialEntries={["/events/event"]}>
      <Routes><Route path="/events/:id" element={<EventDetailPage />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>);
}

const warikanLink = () => screen.queryByRole("link", { name: "割り勘" });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("イベント詳細の割り勘の導線 (#635)", () => {
  it("オフのイベントでは「割り勘」ボタンが出ず、帳簿の GET も呼ばれない", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue(emptyLedger as never);
    state.data = { event, myRole: "participant", canManageAccess: false, community: null };
    draw();
    expect(await screen.findByRole("heading", { name: "イベント" })).toBeInTheDocument();
    expect(warikanLink()).toBeNull();
    expect(get).not.toHaveBeenCalledWith("/events/event/warikan");
  });

  it("オンのイベントでは確定メンバーに「割り勘」ボタンが出て、帳簿を取りに行く", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue(emptyLedger as never);
    state.data = { event: { ...event, warikanEnabled: true }, myRole: "participant", canManageAccess: false, community: null };
    draw();
    await waitFor(() => expect(get).toHaveBeenCalledWith("/events/event/warikan"));
    expect(warikanLink()).toHaveAttribute("href", "/events/event/warikan");
  });
});
