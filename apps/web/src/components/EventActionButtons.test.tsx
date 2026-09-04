import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EventActionButtons } from "./EventActionButtons.js";

/**
 * イベント配下への導線 (#466 で表にまとめた)。
 *
 * 同じ形のボタンが十数個あるので表にして1回で描いている。表に落とすと
 * 「どの行にどの条件が付いていたか」が壊れても見た目では気づけないので、
 * 誰に何が出るかを遷移先で押さえておく。
 */

// 進行状態はテストごとに差し替える（進行中モードで出る行があるため）
const { stateMock } = vi.hoisted(() => ({
  stateMock: vi.fn(() => ({ mode: "normal", scoringLocked: false })),
}));

vi.mock("../api/hooks.js", () => ({
  useMe: () => ({ data: { id: "u-1" } }),
}));
vi.mock("../api/scoringHooks.js", () => ({
  useEventState: () => ({ data: stateMock() }),
}));

beforeEach(() => {
  stateMock.mockReturnValue({ mode: "normal", scoringLocked: false });
});

function draw(
  over: Partial<Parameters<typeof EventActionButtons>[0]> = {},
) {
  return render(
    <MemoryRouter>
      <EventActionButtons
        eventId="e-1"
        isMember
        isStaff={false}
        contest={false}
        attendanceCheck={false}
        {...over}
      />
    </MemoryRouter>,
  );
}

/** 描かれた導線の遷移先（/events/e-1/ の後ろ）を並べる */
function paths(): string[] {
  return screen
    .queryAllByRole("link")
    .map((a) => a.getAttribute("href") ?? "")
    .map((href) => href.replace("/events/e-1/", ""));
}

describe("誰に出るか", () => {
  it("参加者本人でなければ何も出ない", () => {
    draw({ isMember: false, isStaff: true, contest: true });
    expect(paths()).toEqual([]);
  });

  it("一般参加者には運営の導線を出さない", () => {
    draw();
    expect(paths()).toEqual([]);
  });

  it("スタッフには運営の導線が出る", () => {
    draw({ isStaff: true });
    expect(paths()).toContain("edit");
    expect(paths()).toContain("staff-chat");
    expect(paths()).toContain("todos");
    expect(paths()).toContain("name-cards");
  });
});

describe("行ごとの条件", () => {
  it("出席チェックがオフなら受付の導線は出ない", () => {
    draw({ isStaff: true, attendanceCheck: false });
    expect(paths()).not.toContain("checkin");
  });

  it("出席チェックがオンなら受付の導線が出る", () => {
    draw({ isStaff: true, attendanceCheck: true });
    expect(paths()).toContain("checkin");
  });

  it("コンテストでなければ採点も審査の設定も出ない", () => {
    draw({ isStaff: true, contest: false });
    expect(paths()).not.toContain("scoring");
    expect(paths()).not.toContain("criteria");
    expect(paths()).not.toContain("control");
  });

  it("コンテストなら参加者にも採点の導線が出る（審査の設定はスタッフだけ）", () => {
    draw({ isStaff: false, contest: true });
    expect(paths()).toContain("scoring");
    expect(paths()).not.toContain("criteria");
  });

  it("コンテストのスタッフには審査の設定が出る", () => {
    draw({ isStaff: true, contest: true });
    expect(paths()).toContain("criteria");
    expect(paths()).toContain("control");
    expect(paths()).toContain("awards");
  });
});

describe("進行中のモード（表の中で唯一 props だけでは決まらない行）", () => {
  it("プレゼン中は飛び込み口と進行中のバッジが出る", () => {
    stateMock.mockReturnValue({ mode: "presentation", scoringLocked: false });
    draw({ contest: true });

    expect(paths()).toContain("present");
    expect(paths()).not.toContain("awards");
    expect(screen.getByText("進行中: プレゼン")).toBeInTheDocument();
  });

  it("表彰中は表彰式への飛び込み口が出る（プレゼンのほうは出ない）", () => {
    stateMock.mockReturnValue({ mode: "awards", scoringLocked: false });
    draw({ contest: true });

    expect(paths()).toContain("awards");
    expect(paths()).not.toContain("present");
    expect(screen.getByText("進行中: 表彰")).toBeInTheDocument();
  });

  it("集計中はバッジだけで、飛び込み口は出ない", () => {
    stateMock.mockReturnValue({ mode: "aggregation", scoringLocked: false });
    draw({ contest: true });

    expect(paths()).not.toContain("present");
    expect(paths()).not.toContain("awards");
    expect(screen.getByText("進行中: 集計")).toBeInTheDocument();
  });

  it("通常進行ではバッジを出さない", () => {
    draw({ contest: true });
    expect(screen.queryByText(/進行中:/)).not.toBeInTheDocument();
  });

  it("コンテストでなければ、進行中でもバッジも飛び込み口も出ない", () => {
    stateMock.mockReturnValue({ mode: "presentation", scoringLocked: false });
    draw({ contest: false, isStaff: true });

    expect(paths()).not.toContain("present");
    expect(screen.queryByText(/進行中:/)).not.toBeInTheDocument();
  });

  it("表彰中のスタッフには、飛び込み口と表彰の設定が別々に出る", () => {
    stateMock.mockReturnValue({ mode: "awards", scoringLocked: false });
    draw({ contest: true, isStaff: true });

    // 同じ /awards でも「表彰式へ」と「表彰の設定」で役割が違うので2つ出る
    expect(paths().filter((p) => p === "awards")).toHaveLength(2);
    expect(screen.getByText("表彰式へ")).toBeInTheDocument();
  });
});
