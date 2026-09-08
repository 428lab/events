import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { i18next } from "../i18n/index.js";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MyEventSummary } from "@eventer/shared";
import { HomeDashboard } from "./HomeDashboard.js";

const NOW = new Date("2026-09-20T15:00:00+09:00").getTime();
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const myPage = vi.hoisted(() => ({ value: undefined as unknown }));
const invites = vi.hoisted(() => ({ value: [] as unknown[] }));
const loading = vi.hoisted(() => ({ value: false }));
const failed = vi.hoisted(() => ({ value: false }));
const refetch = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock("../api/hooks.js", () => ({
  useMyPage: () => ({
    data: failed.value ? undefined : myPage.value,
    isLoading: loading.value,
    isError: failed.value,
    refetch: refetch.fn,
  }),
}));
vi.mock("../api/staffInviteHooks.js", () => ({
  useMyStaffInvites: () => ({ data: invites.value }),
}));
// 一覧カードはコミュニティ名の解決でクエリを引くので、描画だけ差し替える
vi.mock("./EventList.js", () => ({
  EventList: ({ events }: { events: { id: string; title: string }[] }) => (
    <div data-testid="event-list">
      {events.map((e) => (
        <span key={e.id}>{e.title}</span>
      ))}
    </div>
  ),
}));

function ev(over: Partial<MyEventSummary> = {}): MyEventSummary {
  return {
    id: crypto.randomUUID(),
    title: "イベント",
    status: "published",
    scheduling: false,
    startsAt: NOW + DAY,
    endsAt: NOW + DAY + 3 * HOUR,
    venueType: "offline",
    myRole: "participant",
    myStatus: "confirmed",
    attended: false,
    ...over,
  } as MyEventSummary;
}

function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <HomeDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  myPage.value = { ongoing: [], past: [] };
  invites.value = [];
  loading.value = false;
  failed.value = false;
  refetch.fn.mockReset();
});
afterEach(async () => {
  vi.useRealTimers();
  await i18next.changeLanguage("ja");
});

describe("HomeDashboard (#489)", () => {
  it("参加予定が無ければオンボーディングを出す", () => {
    renderDashboard();
    expect(screen.getByText("参加予定のイベントはまだありません")).toBeTruthy();
    expect(screen.getByText("イベントを作る")).toBeTruthy();
  });

  it("次のイベントを見出しつきで出す", () => {
    myPage.value = { ongoing: [ev({ title: "ナイトハッカソン" })], past: [] };
    renderDashboard();
    expect(screen.getByText("次のイベント")).toBeTruthy();
    expect(screen.getByText("ナイトハッカソン")).toBeTruthy();
    // オンボーディングは出ない
    expect(screen.queryByText("参加予定のイベントはまだありません")).toBeNull();
  });

  it("開催中は「開催中」として出し、次のイベントの見出しは立てない", () => {
    myPage.value = {
      ongoing: [
        ev({ title: "いま開催中", startsAt: NOW - HOUR, endsAt: NOW + HOUR }),
        ev({ title: "あしたの予定" }),
      ],
      past: [],
    };
    renderDashboard();
    expect(screen.getByText("開催中")).toBeTruthy();
    expect(screen.getByText("いま開催中")).toBeTruthy();
    expect(screen.queryByText("次のイベント")).toBeNull();
    // 開催中に吸われて未来の予定が消えない
    expect(screen.getByText("あしたの予定")).toBeTruthy();
  });

  it("返事待ちの運営招待があれば最上段に出す", () => {
    invites.value = [{ id: "i-1" }, { id: "i-2" }];
    renderDashboard();
    expect(screen.getByText("運営への招待が 2 件あります")).toBeTruthy();
    expect(screen.getByText("返事をする")).toBeTruthy();
  });

  it("招待が0件なら「要対応」の枠ごと出さない", () => {
    myPage.value = { ongoing: [ev()], past: [] };
    renderDashboard();
    expect(screen.queryByText(/運営への招待/)).toBeNull();
  });

  it("読み込み中は何も描かない（下の一覧を押し下げない）", () => {
    loading.value = true;
    const { container } = renderDashboard();
    expect(container.textContent).toBe("");
  });

  it("開始までの残り時間が二重にならない（ja）", () => {
    myPage.value = { ongoing: [ev({ startsAt: NOW + 5 * HOUR, endsAt: NOW + 8 * HOUR })], past: [] };
    renderDashboard();
    // formatRemaining が「あと5時間」まで組む。辞書で包み直すと「あと あと5時間」
    expect(screen.getByText("あと5時間")).toBeTruthy();
    expect(screen.queryByText(/あと あと/)).toBeNull();
  });

  it("開始までの残り時間が二重にならない（en）", async () => {
    await i18next.changeLanguage("en");
    myPage.value = { ongoing: [ev({ startsAt: NOW + 5 * HOUR, endsAt: NOW + 8 * HOUR })], past: [] };
    renderDashboard();
    expect(screen.getByText("5h left")).toBeTruthy();
    expect(screen.queryByText(/in 5h left/)).toBeNull();
  });

  it("取得に失敗したら「予定なし」ではなくエラーを出す", () => {
    failed.value = true;
    renderDashboard();
    expect(screen.getByText("参加予定を読み込めませんでした。")).toBeTruthy();
    // 正常な空配列と同じ案内を出してはいけない
    expect(screen.queryByText("参加予定のイベントはまだありません")).toBeNull();
  });

  it("エラー時の再読み込みボタンが refetch を呼ぶ", async () => {
    failed.value = true;
    renderDashboard();
    screen.getByText("再読み込み").click();
    expect(refetch.fn).toHaveBeenCalledTimes(1);
  });

  it("参加未確定のイベントしか無ければオンボーディングを出す", () => {
    myPage.value = { ongoing: [ev({ myStatus: "applied" })], past: [] };
    renderDashboard();
    expect(screen.getByText("参加予定のイベントはまだありません")).toBeTruthy();
  });

  it("日程調整中は別の見出しにまとめる", () => {
    myPage.value = {
      ongoing: [ev({ title: "新年会", scheduling: true, startsAt: 0, endsAt: 0 })],
      past: [],
    };
    renderDashboard();
    expect(screen.getByText("日程調整中")).toBeTruthy();
    expect(screen.getByText("新年会")).toBeTruthy();
  });
});
