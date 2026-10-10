import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { EventDetailPage } from "./EventDetailPage.js";

const state = vi.hoisted(() => ({ status: "draft" }));
vi.mock("../api/hooks.js", () => ({
  useMe: () => ({ data: { id: "me", isAdmin: false } }),
  useEvent: () => ({ data: {
    event: {
      id: "event", slug: "abc12345", title: "イベント", description: "", status: state.status,
      startsAt: 1_800_000_000_000, endsAt: 1_800_003_600_000,
      venueType: "online", venueOffline: null, registrationDeadline: null,
      visibility: "public", scheduling: false, contestMode: false, meetRanking: "off", meetPrizes: false,
    }, myRole: "owner", canManageAccess: false,
  } }),
  usePublishEvent: () => ({ isPending: false, mutate: vi.fn() }),
  eventImageUrl: () => null,
}));
vi.mock("../api/bingoHooks.js", () => ({ useBingoState: () => ({ data: undefined }) }));
vi.mock("../lib/useEventChatAccess.js", () => ({
  useEventChatAccess: () => ({ canChat: false, chatAvailable: false }),
}));
vi.mock("../api/analyticsHooks.js", () => ({ useRecordView: () => {} }));
vi.mock("../api/inquiryHooks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/inquiryHooks.js")>()),
  useEventInquiryUnreadCount: () => ({ data: 0 }),
}));
// 検証対象は実ページと実ShareButton。周辺セクションの取得・副作用は置き換える。
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

const writeText = vi.fn(async () => {});
beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

describe("イベント詳細の短いURLコピー", () => {
  it.each(["draft", "published"])("%sでもシェアボタンを出し、/e/:slug をコピーする", async (status) => {
    state.status = status;
    render(<MemoryRouter initialEntries={["/events/event"]}>
      <Routes><Route path="/events/:id" element={<EventDetailPage />} /></Routes>
    </MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "シェア" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/e/abc12345`));
  });
});
