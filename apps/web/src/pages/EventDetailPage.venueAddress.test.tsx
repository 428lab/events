import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { EventDetailPage } from "./EventDetailPage.js";

/** イベントの会場の住所と地図。住所があるとき（オフライン・ハイブリッド）だけ地図を出す */

const ADDRESS = "東京都千代田区丸の内1-9-1";
const state = vi.hoisted(() => ({ event: {} as Record<string, unknown> }));
vi.mock("../api/hooks.js", () => ({
  useMe: () => ({ data: null }),
  useEvent: () => ({ data: { event: state.event, myRole: null, canManageAccess: false } }),
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

function makeEvent(over: Record<string, unknown> = {}) {
  return {
    id: "event", slug: "abc12345", title: "イベント", description: "説明", status: "published",
    startsAt: 1_800_000_000_000, endsAt: 1_800_003_600_000,
    venueType: "offline", venueOffline: "丸の内ホール", venueAddress: ADDRESS, venueOnline: null,
    registrationDeadline: null, visibility: "public", scheduling: false, contestMode: false,
    meetRanking: "off", meetPrizes: false,
    ...over,
  };
}

function draw() {
  return render(<MemoryRouter initialEntries={["/events/event"]}>
    <Routes><Route path="/events/:id" element={<EventDetailPage />} /></Routes>
  </MemoryRouter>);
}

const map = () => screen.queryByTitle("会場の地図");
const mapLink = () => screen.queryByRole("link", { name: "Googleマップで開く" });

beforeEach(() => {
  state.event = makeEvent();
});

describe("イベント詳細の会場の住所と地図", () => {
  it("住所があれば会場名の下に住所、住所だけで引く地図と Google マップへのリンクを出す", () => {
    draw();
    expect(screen.getByText("会場: 丸の内ホール")).toBeInTheDocument();
    expect(screen.getByText(`住所: ${ADDRESS}`)).toBeInTheDocument();
    const q = encodeURIComponent(ADDRESS);
    expect(map()).toHaveAttribute("src", `https://maps.google.com/maps?q=${q}&z=16&output=embed`);
    // 開いた時点で読み込む（lazy にしない）
    expect(map()).not.toHaveAttribute("loading", "lazy");
    expect(mapLink()).toHaveAttribute("href", `https://www.google.com/maps/search/?api=1&query=${q}`);
    expect(mapLink()).toHaveAttribute("target", "_blank");
    expect(mapLink()).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("ハイブリッドでも出す", () => {
    state.event = makeEvent({ venueType: "hybrid", venueOnline: "https://meet.example.com/x" });
    draw();
    expect(map()).toBeInTheDocument();
    expect(mapLink()).toBeInTheDocument();
  });

  it("住所が無ければ地図もリンクも出さない（会場名の表示は従来どおり）", () => {
    state.event = makeEvent({ venueAddress: null });
    draw();
    expect(screen.getByText("会場: 丸の内ホール")).toBeInTheDocument();
    expect(screen.queryByText(/^住所:/)).not.toBeInTheDocument();
    expect(map()).not.toBeInTheDocument();
    expect(mapLink()).not.toBeInTheDocument();
  });

  it("オンラインに変えて住所が残っていても出さない", () => {
    state.event = makeEvent({ venueType: "online", venueOnline: "https://meet.example.com/x" });
    draw();
    expect(map()).not.toBeInTheDocument();
    expect(screen.queryByText(/^住所:/)).not.toBeInTheDocument();
  });

  it("説明が空でも住所があれば地図を出す", () => {
    state.event = makeEvent({ description: "" });
    draw();
    expect(map()).toBeInTheDocument();
  });
});
