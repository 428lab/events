import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { MyEventSummary } from "@eventer/shared";
import { ParticipationHistory } from "./ParticipationHistory.js";

/**
 * 公開プロフィールの参加履歴 (#315)。
 *
 * #310 で4分類の一覧を年表に「置き換えて」しまい情報密度が落ちたので、
 * 一覧を主役に戻し、年表はタブで切り替える別枠にした。
 * ここでは既定が一覧であること・切り替えが効くことを確かめる。
 */

const ME = "u-me";
const NOW = new Date("2026-08-09T12:00:00+09:00").getTime();

function ev(over: Partial<MyEventSummary> = {}): MyEventSummary {
  return {
    id: "e-1",
    title: "テストイベント",
    subtitle: "",
    description: "",
    status: "published",
    scheduling: false,
    startsAt: new Date("2024-05-03T13:00:00+09:00").getTime(),
    endsAt: new Date("2024-05-03T18:00:00+09:00").getTime(),
    venueType: "offline",
    venueOffline: "山形",
    venueOnline: null,
    attendanceCheck: false,
    participantCount: 5,
    attendedCount: 0,
    capacityTotal: null,
    createdBy: "u-owner",
    imageUpdatedAt: null,
    myRole: "participant",
    attended: false,
    ...over,
  } as MyEventSummary;
}

const EVENTS = [
  ev({ id: "h-future", title: "主催する回", myRole: "staff", createdBy: ME,
    startsAt: new Date("2026-12-01T10:00:00+09:00").getTime(),
    endsAt: new Date("2026-12-01T18:00:00+09:00").getTime() }),
  ev({ id: "h-past", title: "主催した回", myRole: "staff", createdBy: ME }),
  ev({ id: "j-future", title: "参加予定の回",
    startsAt: new Date("2026-11-01T10:00:00+09:00").getTime(),
    endsAt: new Date("2026-11-01T18:00:00+09:00").getTime() }),
  ev({ id: "j-past", title: "参加した回" }),
];

function renderHistory(events: MyEventSummary[] = EVENTS) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ParticipationHistory
          events={events}
          userId={ME}
          speakerEventIds={[]}
          now={NOW}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("参加履歴（一覧と年表の切り替え）", () => {
  it("既定は4分類の一覧で、分類ごとに件数が出る", () => {
    renderHistory();
    expect(screen.getByText("主催・運営するイベント（1）")).toBeTruthy();
    expect(screen.getByText("参加予定のイベント（1）")).toBeTruthy();
    expect(screen.getByText("主催・運営したイベント（1）")).toBeTruthy();
    expect(screen.getByText("参加したイベント（1）")).toBeTruthy();
    // 年表側のフィルタは出ていない
    expect(screen.queryByText("参加履歴の年表")).toBeNull();
  });

  it("該当が無い分類は見出しごと出さない", () => {
    renderHistory([ev({ id: "only", title: "参加した回だけ" })]);
    expect(screen.getByText("参加したイベント（1）")).toBeTruthy();
    expect(screen.queryByText(/主催・運営するイベント/)).toBeNull();
  });

  it("タブで年表に切り替えられ、一覧に戻せる", () => {
    renderHistory();
    fireEvent.click(screen.getByRole("tab", { name: "年表" }));
    expect(screen.getByText("参加履歴の年表")).toBeTruthy();
    expect(screen.queryByText("主催・運営するイベント（1）")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "一覧" }));
    expect(screen.getByText("主催・運営するイベント（1）")).toBeTruthy();
  });

  it("1件も無ければ何も描かない", () => {
    const { container } = renderHistory([]);
    expect(container.textContent).toBe("");
  });
});
