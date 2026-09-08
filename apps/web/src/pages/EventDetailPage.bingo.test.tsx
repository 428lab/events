import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18next } from "../i18n/index.js";
import { EventDetailPage } from "./EventDetailPage.js";

const state = vi.hoisted(() => ({
  role: "participant" as string | null,
  canChat: true,
  game: "running" as string | undefined,
  bingo: false,
  reach: false,
}));
vi.mock("../api/hooks.js", () => ({
  useMe: () => ({ data: { id: "me", isAdmin: true } }),
  useEvent: () => ({ data: {
    event: {
      id: "event", title: "イベント", description: "説明の本文", status: "published",
      startsAt: 1_800_000_000_000, endsAt: 1_800_003_600_000,
      venueType: "offline", venueOffline: "確認用会場", registrationDeadline: null,
      scheduling: false, contestMode: false, meetRanking: "off", meetPrizes: false,
    }, myRole: state.role,
  } }),
  usePublishEvent: () => ({ isPending: false, mutate: vi.fn() }),
  eventImageUrl: () => null,
}));
vi.mock("../api/bingoHooks.js", () => ({
  useBingoState: () => ({ data: state.game ? {
    status: state.game, counts: { cards: 30, bingo: 2, reach: 4 },
    me: { bingo: state.bingo, reach: state.reach },
  } : undefined }),
}));
vi.mock("../lib/useEventChatAccess.js", () => ({
  useEventChatAccess: () => ({ canChat: state.canChat, chatAvailable: false }),
}));
vi.mock("../api/analyticsHooks.js", () => ({ useRecordView: () => {} }));
// 配置の検証対象は実ページと実BingoPanel。周辺セクションの取得・副作用は置き換える。
vi.mock("../components/SchedulePanel.js", () => ({ SchedulePanel: () => null }));
vi.mock("../components/ShareButton.js", () => ({ ShareButton: () => null }));
vi.mock("../components/EventPhotos.js", () => ({ EventPhotos: () => null }));
vi.mock("../components/EventComments.js", () => ({ EventComments: () => null }));
vi.mock("../components/EventSchedule.js", () => ({ EventSchedule: () => <section aria-label="タイムテーブル" /> }));
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

beforeEach(() => {
  state.role = "participant";
  state.canChat = true;
  state.game = "running";
  state.bingo = false;
  state.reach = false;
});
function mount() {
  return render(<MemoryRouter initialEntries={["/events/event"]}>
    <Routes><Route path="/events/:id" element={<EventDetailPage />} /></Routes>
  </MemoryRouter>);
}

describe("ビンゴ会場への目立つ入口 (#500)", () => {
  it("説明・会場の直後、タイムテーブルより前に1か所だけ表示する", () => {
    mount();
    const sections = screen.getAllByRole("region", { name: "ビンゴ会場" });
    expect(sections).toHaveLength(1);
    const section = sections[0]!;
    const venue = screen.getByText(/確認用会場/);
    const schedule = screen.getByRole("region", { name: "タイムテーブル" });
    expect(venue.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.compareDocumentPosition(schedule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const button = screen.getByRole("link", { name: "ビンゴ会場へ" });
    expect(button).toHaveAttribute("href", "/events/event/bingo");
    expect(button).toHaveClass("MuiButton-contained", "MuiButton-sizeLarge");
  });

  it.each(["participant", "judge", "observer", null])("%sには抽選操作を出さない（サイト管理者も同じ）", (role) => {
    state.role = role;
    mount();
    expect(screen.queryByRole("link", { name: "抽選を操作する" })).toBeNull();
  });

  it("staffには会場と区別した抽選操作の入口を出す", () => {
    state.role = "staff";
    mount();
    expect(screen.getByRole("link", { name: "抽選を操作する" })).toHaveAttribute("href", "/events/event/bingo/control");
    expect(screen.getAllByRole("link", { name: "ビンゴ会場へ" })).toHaveLength(1);
  });

  it.each([["setup", "受付中"], ["running", "抽選中"], ["ended", "終了"]])("%sの状態を明示する", (status, label) => {
    state.game = status;
    mount();
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it.each([undefined, "none"])("ゲームなし (%s) は表示しない", (status) => {
    state.game = status;
    mount();
    expect(screen.queryByRole("region", { name: "ビンゴ会場" })).toBeNull();
  });

  it("参加確定でなければゲームデータがあっても入口を出さない", () => {
    state.canChat = false;
    mount();
    expect(screen.queryByRole("region", { name: "ビンゴ会場" })).toBeNull();
  });

  it.each(["reach", "bingo"])("自分の%sを残す", (kind) => {
    state.reach = kind === "reach";
    state.bingo = kind === "bingo";
    mount();
    expect(screen.getByText(kind === "reach" ? "リーチ！" : "ビンゴ！")).toBeInTheDocument();
  });

  it("言語切替で見出し・状態・操作も切り替わる", async () => {
    state.role = "staff";
    mount();
    await act(() => i18next.changeLanguage("en"));
    expect(screen.getByRole("region", { name: "Bingo" })).toBeInTheDocument();
    expect(screen.getByText("Drawing numbers")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run the draw" })).toHaveAttribute("href", "/events/event/bingo/control");
    expect(screen.getByRole("link", { name: "Open bingo" })).toHaveAttribute("href", "/events/event/bingo");
  });
});
