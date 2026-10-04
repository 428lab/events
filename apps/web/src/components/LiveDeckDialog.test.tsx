import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleItem } from "@eventer/shared";

/** タイムテーブル行の「この発表で使うスライド」(#571)。
 * 付けられるのは担当者本人だけ、staff は外すだけ、参加者には出さない。 */

const { getMock, putMock } = vi.hoisted(() => ({ getMock: vi.fn(), putMock: vi.fn() }));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...args: unknown[]) => getMock(...args),
      put: (...args: unknown[]) => putMock(...args),
      post: vi.fn().mockResolvedValue({ editor: null, version: 3 }),
      del: vi.fn().mockResolvedValue({ editor: null, version: 3 }),
    },
  };
});

const { EventSchedule } = await import("./EventSchedule.js");

const ME = { id: "u-1", username: "me", globalName: "わたし", avatarUrl: null };

const talk = (over: Partial<ScheduleItem> = {}): ScheduleItem => ({
  id: "it-1",
  eventId: "e-1",
  title: "LT 1",
  description: "",
  durationMin: 10,
  startsAt: null,
  speaker: ME,
  speakerUserId: ME.id,
  speakerName: "",
  materialUrl: "",
  materialOgImage: "",
  sortOrder: 0,
  placement: "all",
  visibility: "public",
  trackIds: [],
  ...over,
});

let items: ScheduleItem[] = [];

function draw(isStaff: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EventSchedule eventId="e-1" eventStartsAt={null} isStaff={isStaff} showManagementActions={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  items = [];
  getMock.mockReset();
  putMock.mockReset();
  getMock.mockImplementation(async (path: string) => {
    if (path === "/auth/me") return { user: ME, isAdmin: false };
    if (path === "/events/e-1/timetable") return { items, tracks: [], version: 3 };
    if (path === "/events/e-1/timetable/editing") return { editor: null, version: 3 };
    if (path === "/events/e-1/members") return { members: [] };
    if (path === "/decks/mine") {
      return {
        decks: [
          { id: "d-1", slug: "s1", title: "社内ツール", slideCount: 12, createdAt: 1, updatedAt: 1 },
          { id: "d-2", slug: "s2", title: "下書き", slideCount: 3, createdAt: 1, updatedAt: 1 },
        ],
      };
    }
    throw new Error(`unexpected path: ${path}`);
  });
  putMock.mockResolvedValue({ liveDeck: { id: "d-1", title: "社内ツール", slideCount: 12 } });
});

describe("配信スライドの紐付け (#571)", () => {
  it("担当者本人は自分のデッキから選んで紐付けられる（同意の説明つき）", async () => {
    items = [talk()];
    draw(false);
    fireEvent.click(await screen.findByRole("button", { name: "この発表で使うスライドを選ぶ" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/運営スタッフが配信コントロールで表示・ページ送り/)).toBeInTheDocument();
    const use = within(dialog).getByRole("button", { name: "このスライドを使う" });
    expect(use).toBeDisabled();
    fireEvent.click(await within(dialog).findByRole("radio", { name: /社内ツール/ }));
    fireEvent.click(use);
    await waitFor(() => expect(putMock).toHaveBeenCalledWith("/events/e-1/timetable/it-1/live-deck", { deckId: "d-1" }));
  });

  it("紐付け済みなら本人にはチップが出て、選び直しと外すができる", async () => {
    items = [talk({ liveDeck: { id: "d-1", title: "社内ツール", slideCount: 12 } })];
    draw(false);
    fireEvent.click(await screen.findByText("配信スライド：社内ツール"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "このスライドを使う" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "紐付けを外す" }));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith("/events/e-1/timetable/it-1/live-deck", { deckId: null }));
  });

  it("staff には他人のコマの紐付けが見えて外せるが、付けるボタンは出ない", async () => {
    const other = { id: "u-2", username: "b", globalName: "B", avatarUrl: null };
    items = [
      talk({ id: "it-1", speaker: other, speakerUserId: other.id, liveDeck: { id: "d-9", title: "B のスライド", slideCount: 4 } }),
      talk({ id: "it-2", title: "LT 2", speaker: other, speakerUserId: other.id }),
    ];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    draw(true);
    expect(await screen.findByText("配信スライド：B のスライド")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "この発表で使うスライドを選ぶ" })).toBeNull();
    fireEvent.click(screen.getByTitle("紐付けを外す"));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith("/events/e-1/timetable/it-1/live-deck", { deckId: null }));
  });

  it("担当者でない参加者には何も出さず、裏方のコマには本人にも出さない", async () => {
    const other = { id: "u-2", username: "b", globalName: "B", avatarUrl: null };
    items = [
      talk({ id: "it-1", speaker: other, speakerUserId: other.id }),
      talk({ id: "it-2", title: "設営", visibility: "staff" }),
    ];
    draw(false);
    expect(await screen.findByText("LT 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "この発表で使うスライドを選ぶ" })).toBeNull();
    expect(screen.queryByText(/配信スライド：/)).toBeNull();
  });
});
