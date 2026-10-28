import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, EventRole } from "@eventer/shared";
import { api } from "../api/client.js";
import { EventManagementLinks } from "./EventManagementLinks.js";
import { EventStaffActions, ScheduledPublishNotice } from "./EventStaffActions.js";

/**
 * 詳細ページ見出し直下の運営の入口 (#613)。
 * 時期で変わる主ボタン・編集・「運営」メニュー・限定権限のボタンの出し分けを確かめる。
 */

const publish = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
const cancelSchedule = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }));
vi.mock("../api/hooks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/hooks.js")>()),
  usePublishEvent: () => publish,
  useCancelScheduledPublish: () => cancelSchedule,
}));

const inquiry = vi.hoisted(() => ({ unread: 0 }));
vi.mock("../api/inquiryHooks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/inquiryHooks.js")>()),
  useEventInquiryUnreadCount: () => ({ data: inquiry.unread }),
}));

const HOUR = 3600000;
const NOW = new Date("2026-10-09T12:00:00+09:00").getTime();
const NEXT_WEEK = NOW + 7 * 24 * HOUR;

function ev(over: Partial<Event> = {}): Event {
  return {
    id: "e", title: "夏の発表会", status: "published", visibility: "public", scheduling: false,
    startsAt: NEXT_WEEK, endsAt: NEXT_WEEK + 2 * HOUR, attendanceCheck: true, contestMode: false,
    ...over,
  } as Event;
}

function draw({ event = ev(), myRole = "staff" as EventRole | null, canManageSchedule = false, canManageAccess = false,
  chatAvailable = true, ended = false } = {}) {
  return render(<MemoryRouter>
    <EventStaffActions eventId="e" event={event} myRole={myRole} canManageSchedule={canManageSchedule}
      canManageAccess={canManageAccess} chatAvailable={chatAvailable} timing={{ ended }} />
  </MemoryRouter>);
}

/** contained の主ボタン（リンクかボタン） */
function primaries() {
  return [...document.querySelectorAll(".MuiButton-contained")] as HTMLElement[];
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "運営" }));
  return screen.getByRole("menu");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  publish.mutate.mockClear();
  publish.isPending = false;
  cancelSchedule.mutate.mockClear();
  inquiry.unread = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("スタッフの主ボタン (#613)", () => {
  it("下書きは「公開する」。押すと usePublishEvent で公開する", () => {
    draw({ event: ev({ status: "draft" }) });
    expect(primaries()).toHaveLength(1);
    const button = screen.getByRole("button", { name: "公開する" });
    expect(primaries()[0]).toBe(button);
    fireEvent.click(button);
    expect(publish.mutate).toHaveBeenCalledWith("e");
    expect(screen.getByRole("link", { name: "編集" })).toHaveAttribute("href", "/events/e/edit");
  });

  it("日程調整中は「日程調整」が運営ページの日程調整を開く", () => {
    draw({ event: ev({ scheduling: true, startsAt: 0, endsAt: 0 }) });
    expect(primaries()).toHaveLength(1);
    expect(screen.getByRole("link", { name: "日程調整" })).toHaveAttribute("href", "/events/e/manage#date-poll");
    expect(screen.getByRole("link", { name: "編集" })).toHaveAttribute("href", "/events/e/edit");
  });

  it("開催前は時期のボタンを出さず、編集と運営だけ（編集は主ボタンにしない）", () => {
    draw();
    expect(primaries()).toHaveLength(0);
    const edit = screen.getAllByRole("link", { name: "編集" });
    expect(edit).toHaveLength(1);
    expect(edit[0]).toHaveAttribute("href", "/events/e/edit");
  });

  it("当日は受付があれば「QR受付」", () => {
    draw({ event: ev({ startsAt: NOW + HOUR, endsAt: NOW + 3 * HOUR }) });
    expect(primaries()).toHaveLength(1);
    expect(primaries()[0]).toHaveTextContent("QR受付");
    expect(primaries()[0]).toHaveAttribute("href", "/events/e/checkin");
    expect(screen.getByRole("link", { name: "編集" })).toHaveAttribute("href", "/events/e/edit");
  });

  it("当日で受付が無ければ「配信」", () => {
    draw({ event: ev({ startsAt: NOW - HOUR, endsAt: NOW + HOUR, attendanceCheck: false }) });
    expect(primaries()).toHaveLength(1);
    expect(primaries()[0]).toHaveTextContent("配信");
    expect(primaries()[0]).toHaveAttribute("href", "/events/e/live/control");
  });

  it("終了後は主ボタンを出さず、編集と運営だけ", () => {
    draw({ event: ev({ startsAt: NOW - 3 * HOUR, endsAt: NOW - HOUR }), ended: true });
    expect(primaries()).toHaveLength(0);
    expect(screen.getByRole("link", { name: "編集" })).toHaveAttribute("href", "/events/e/edit");
    expect(screen.getByRole("button", { name: "運営" })).toBeInTheDocument();
  });
});

/** 時期で変わるボタンの塊と、どの時期でも同じ「編集」「運営」の塊 */
function groups() {
  return {
    phase: document.querySelector('[data-testid="event-phase-actions"]'),
    fixed: document.querySelector('[data-testid="event-fixed-actions"]') as HTMLElement,
  };
}

describe("並び（オーナー決定 2026-10-14）", () => {
  const phases: [string, Parameters<typeof draw>[0]][] = [
    ["下書き", { event: ev({ status: "draft" }) }],
    ["予約中の下書き", { event: ev({ status: "draft", publishAt: NOW + 24 * HOUR, accessRevision: 2 }) }],
    ["日程調整中", { event: ev({ scheduling: true, startsAt: 0, endsAt: 0 }) }],
    ["開催前", {}],
    ["当日", { event: ev({ startsAt: NOW + HOUR, endsAt: NOW + 3 * HOUR }) }],
    ["終了後", { event: ev({ startsAt: NOW - 3 * HOUR, endsAt: NOW - HOUR }), ended: true }],
  ];

  it.each(phases)("%s でも「編集」「運営」は同じ塊に同じ順で、時期のボタンはその塊に入らない", (_name, opts) => {
    draw(opts);
    const { phase, fixed } = groups();
    const labels = [...fixed.querySelectorAll("a, button")].map((el) => el.textContent);
    expect(labels).toEqual(["編集", "運営"]);
    expect(within(fixed).queryAllByRole("button").filter((b) => b.classList.contains("MuiButton-contained"))).toHaveLength(0);
    // 時期のボタンは「編集」より前（DOM 順でシェアの直後に来る）
    if (phase) expect(phase.compareDocumentPosition(fixed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("時期のボタンと「編集」「運営」は外側の行にそのまま並ぶ（1つの箱に包まない）", () => {
    const view = draw({ event: ev({ status: "draft" }) });
    const { phase, fixed } = groups();
    expect(phase!.parentElement).toBe(view.container);
    expect(fixed.parentElement).toBe(view.container);
  });
});

describe("予約公開との整合 (#624)", () => {
  const at = NOW + 24 * HOUR;
  it("予約中の下書きは時期のボタンが「今すぐ公開」になり、「公開する」は出さない", () => {
    draw({ event: ev({ status: "draft", publishAt: at, accessRevision: 7 }) });
    expect(screen.queryByRole("button", { name: "公開する" })).toBeNull();
    expect(groups().phase).toHaveTextContent("今すぐ公開");
    fireEvent.click(screen.getByRole("button", { name: "今すぐ公開" }));
    expect(publish.mutate).toHaveBeenCalledWith("e");
  });

  it("公開予定の案内は運営ページと同じ文言で、「予約を取り消す」が revision 付きで取り消す", () => {
    render(<ScheduledPublishNotice event={ev({ status: "draft", publishAt: at, accessRevision: 7 })} date="2026/10/10 12:00" />);
    expect(screen.getByRole("alert")).toHaveTextContent("このイベントは 2026/10/10 12:00 に自動で公開されます。");
    fireEvent.click(screen.getByRole("button", { name: "予約を取り消す" }));
    expect(cancelSchedule.mutate).toHaveBeenCalledWith({ id: "e", expectedAccessRevision: 7 });
    expect(publish.mutate).not.toHaveBeenCalled();
  });

  it("予約中の下書きのメニューも同じ2択で、「公開する」は無い", () => {
    draw({ event: ev({ status: "draft", publishAt: at, accessRevision: 7 }) });
    const menu = openMenu();
    expect(within(menu).queryByRole("menuitem", { name: "公開する" })).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "予約を取り消す" }));
    expect(cancelSchedule.mutate).toHaveBeenCalledWith({ id: "e", expectedAccessRevision: 7 });
  });

  it("予約が無い下書きには「今すぐ公開」「予約を取り消す」を出さない", () => {
    draw({ event: ev({ status: "draft", publishAt: null }) });
    expect(screen.queryByRole("button", { name: "今すぐ公開" })).toBeNull();
    expect(within(openMenu()).queryByRole("menuitem", { name: "予約を取り消す" })).toBeNull();
  });
});

describe("「運営」メニュー (#613)", () => {
  it("文字ラベル付きで設定アイコンを使わず、#contest-operations のアンカーを持つ", () => {
    draw();
    const button = screen.getByRole("button", { name: "運営" });
    expect(button).toHaveTextContent("運営");
    expect(button).toHaveAttribute("id", "contest-operations");
    expect(within(button).queryByTestId("SettingsIcon")).toBeNull();
    expect(document.querySelector('[data-testid="SettingsIcon"]')).toBeNull();
  });

  it("運営ページのボタン列と同じ項目に「運営ページを開く」を足したものが出る", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ count: 0 } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const links = render(<QueryClientProvider client={qc}><MemoryRouter>
      <EventManagementLinks eventId="e" isStaff attendanceCheck chatAvailable />
    </MemoryRouter></QueryClientProvider>);
    const expected = within(links.container).getAllByRole("link").map((link) => link.getAttribute("href")).sort();
    links.unmount();

    draw();
    const menu = openMenu();
    const hrefs = within(menu).getAllByRole("menuitem").map((item) => item.getAttribute("href")).filter(Boolean);
    expect(hrefs).toHaveLength(expected.length + 1);
    expect(hrefs.filter((href) => href !== "/events/e/manage").sort()).toEqual(expected);
    expect(within(menu).getByRole("menuitem", { name: "運営ページを開く" })).toHaveAttribute("href", "/events/e/manage");
    // 区切り見出し
    for (const group of ["内容", "連絡", "当日", "準備・振り返り"]) expect(within(menu).getByText(group)).toBeInTheDocument();
  });

  it("受付なしで QR受付、チャットが使えないとチャット管理を出さない", () => {
    draw({ event: ev({ attendanceCheck: false }), chatAvailable: false });
    const menu = openMenu();
    expect(within(menu).queryByRole("menuitem", { name: "QR受付" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "チャット管理" })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "配信" })).toHaveAttribute("href", "/events/e/live/control");
  });

  it("受付ありでチャットが使えるときは QR受付とチャット管理を出す", () => {
    draw();
    const menu = openMenu();
    expect(within(menu).getByRole("menuitem", { name: "QR受付" })).toHaveAttribute("href", "/events/e/checkin");
    expect(within(menu).getByRole("menuitem", { name: "チャット管理" })).toHaveAttribute("href", "/events/e/chat");
  });

  it("下書きのときだけメニューにも「公開する」を出す", () => {
    draw({ event: ev({ status: "draft" }) });
    fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "公開する" }));
    expect(publish.mutate).toHaveBeenCalledWith("e");
  });

  it("公開済みのメニューに「公開する」は無い", () => {
    draw();
    expect(within(openMenu()).queryByRole("menuitem", { name: "公開する" })).toBeNull();
  });

  it("コンテストのときだけ「コンテスト運営」を出す", () => {
    const view = draw();
    expect(within(openMenu()).queryByRole("menuitem", { name: "コンテスト運営" })).toBeNull();
    view.unmount();
    draw({ event: ev({ contestMode: true }) });
    expect(within(openMenu()).getByRole("menuitem", { name: "コンテスト運営" }))
      .toHaveAttribute("href", "/events/e/manage#contest-operations");
  });

  it("問い合わせの未読があればメニューの問い合わせ項目に件数を出す", () => {
    inquiry.unread = 3;
    draw();
    const item = within(openMenu()).getAllByRole("menuitem").find((el) => el.getAttribute("href") === "/events/e/inquiries")!;
    expect(item).toHaveTextContent("3");
  });
});

describe("限定権限の人 (#613)", () => {
  it("日程調整の権限だけなら「日程調整」だけ。メニューも編集も出さない", () => {
    draw({ myRole: "participant", canManageSchedule: true });
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "日程調整" })).toHaveAttribute("href", "/events/e/manage#date-poll");
    expect(screen.queryByRole("button", { name: "運営" })).toBeNull();
    expect(screen.queryByRole("link", { name: "編集" })).toBeNull();
    expect(primaries()).toHaveLength(0);
  });

  it("日程調整中なら「日程調整」を contained にする", () => {
    draw({ myRole: null, canManageSchedule: true, event: ev({ scheduling: true, startsAt: 0, endsAt: 0 }) });
    expect(primaries()).toHaveLength(1);
    expect(primaries()[0]).toHaveTextContent("日程調整");
  });

  it("非公開イベントの招待の権限だけなら「招待」だけ", () => {
    draw({ myRole: null, canManageAccess: true, event: ev({ visibility: "private" }) });
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "招待" })).toHaveAttribute("href", "/events/e/manage#invites");
    expect(screen.queryByRole("button", { name: "運営" })).toBeNull();
  });

  it("公開イベントの canManageAccess は招待の入口にならない", () => {
    const view = draw({ myRole: null, canManageAccess: true });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("権限が無ければ何も出さない", () => {
    const view = draw({ myRole: "participant" });
    expect(view.container).toBeEmptyDOMElement();
  });
});
