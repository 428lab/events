import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AwardsView } from "@eventer/shared";
import { EventAwards } from "./EventAwards.js";

/**
 * 表彰結果の出し方 (#183)。
 *
 * 出す・出さないの条件が3つ重なっている（コンテストか / 授賞式が最後まで進んだか /
 * イベントが終わったか）。ここを間違えると **授賞式の前に結果が漏れる**ので、
 * 「まだ出してはいけない」側を厚めに確かめる。
 */

const { awardsMock, stateMock, entriesMock, membersMock } = vi.hoisted(() => ({
  awardsMock: vi.fn(),
  stateMock: vi.fn(),
  entriesMock: vi.fn(),
  membersMock: vi.fn(),
}));

vi.mock("../api/hooks.js", () => ({
  useMe: () => ({ data: { id: "u-1" } }),
  useEventEntries: () => ({ data: entriesMock() }),
  useEventMembers: () => ({ data: membersMock() }),
}));
vi.mock("../api/scoringHooks.js", () => ({
  useEventState: () => ({ data: stateMock() }),
}));
vi.mock("../api/awardHooks.js", () => ({
  useAwards: () => ({ data: awardsMock() }),
}));

const RANK_RESULT = {
  id: "r-1",
  entryId: "en-1",
  entryName: "チームあ",
  awardRankId: "rank-1",
  specialAwardId: null,
  total: 10,
  perCriterion: {},
};

function awards(over: Partial<AwardsView> = {}): AwardsView {
  return {
    ranks: [
      { id: "rank-1", eventId: "e-1", name: "最優秀賞", content: "賞金", rankOrder: 1 },
    ],
    specials: [],
    criteria: [],
    results: [RANK_RESULT],
    ...over,
  } as AwardsView;
}

function draw(over: { contest?: boolean; ended?: boolean } = {}) {
  return render(
    <MemoryRouter>
      <EventAwards
        eventId="e-1"
        contest={over.contest ?? true}
        ended={over.ended ?? false}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  awardsMock.mockReturnValue(awards());
  stateMock.mockReturnValue({ awardsRevealCursor: 0, scoringLocked: false });
  entriesMock.mockReturnValue([
    { id: "en-1", name: "チームあ", memberUserIds: ["u-9"] },
  ]);
  membersMock.mockReturnValue([
    { id: "m-1", userId: "u-9", user: { id: "u-9", username: "erai", avatarUrl: null } },
  ]);
});

describe("まだ出してはいけないとき", () => {
  it("授賞式の途中（未発表がある）で、まだ終わってもいなければ何も出さない", () => {
    draw();
    expect(screen.queryByText("表彰結果")).not.toBeInTheDocument();
    expect(screen.queryByText("採点結果を見る")).not.toBeInTheDocument();
  });

  it("コンテストでなければ、終了していても出さない", () => {
    draw({ contest: false, ended: true });
    expect(screen.queryByText("表彰結果")).not.toBeInTheDocument();
    expect(screen.queryByText("採点結果を見る")).not.toBeInTheDocument();
  });

  it("受賞が1件も決まっていなければ、終了していても表彰の枠は出さない", () => {
    awardsMock.mockReturnValue(awards({ results: [] }));
    draw({ ended: true });
    expect(screen.queryByText("表彰結果")).not.toBeInTheDocument();
  });
});

describe("出すとき", () => {
  it("授賞式が最後まで進んだら、終了前でも出す", () => {
    stateMock.mockReturnValue({ awardsRevealCursor: 1, scoringLocked: false });
    draw();

    expect(screen.getByText("表彰結果")).toBeInTheDocument();
    expect(screen.getByText("最優秀賞")).toBeInTheDocument();
    expect(screen.getByText("チームあ")).toBeInTheDocument();
    expect(screen.getByText("賞金")).toBeInTheDocument();
  });

  it("授賞式をやらなくても、終了していれば出す", () => {
    draw({ ended: true });
    expect(screen.getByText("表彰結果")).toBeInTheDocument();
  });

  it("受賞者が決まったランキング賞だけ並べる", () => {
    awardsMock.mockReturnValue(
      awards({
        ranks: [
          { id: "rank-1", eventId: "e-1", name: "最優秀賞", content: null, rankOrder: 1 },
          { id: "rank-2", eventId: "e-1", name: "準優秀賞", content: null, rankOrder: 2 },
        ],
      }),
    );
    draw({ ended: true });

    expect(screen.getByText("最優秀賞")).toBeInTheDocument();
    expect(screen.queryByText("準優秀賞")).not.toBeInTheDocument();
  });

  it("特別枠は受賞者がいなくても「該当者なし」として並べる", () => {
    awardsMock.mockReturnValue(
      awards({
        specials: [
          { id: "sp-1", eventId: "e-1", name: "特別賞", content: null, sortOrder: 1 },
        ],
      }),
    );
    draw({ ended: true });

    expect(screen.getByText("特別賞")).toBeInTheDocument();
    expect(screen.getByText("該当者なし")).toBeInTheDocument();
  });

  it("上位から順に並べる", () => {
    awardsMock.mockReturnValue(
      awards({
        ranks: [
          { id: "rank-2", eventId: "e-1", name: "準優秀賞", content: null, rankOrder: 2 },
          { id: "rank-1", eventId: "e-1", name: "最優秀賞", content: null, rankOrder: 1 },
        ],
        results: [
          RANK_RESULT,
          { ...RANK_RESULT, id: "r-2", awardRankId: "rank-2", entryName: "チームい" },
        ],
      }),
    );
    draw({ ended: true });

    const names = screen
      .getAllByText(/優秀賞$/)
      .map((el) => el.textContent);
    expect(names).toEqual(["最優秀賞", "準優秀賞"]);
  });

  it("個人エントリの受賞者はプロフィールへのリンクになる", () => {
    stateMock.mockReturnValue({ awardsRevealCursor: 1, scoringLocked: false });
    draw();

    expect(screen.getByRole("link", { name: /チームあ/ })).toHaveAttribute(
      "href",
      "/users/erai",
    );
  });
});

describe("採点結果への導線", () => {
  it("終了したら出る", () => {
    draw({ ended: true });
    expect(screen.getByRole("link", { name: "採点結果を見る" })).toHaveAttribute(
      "href",
      "/events/e-1/results",
    );
  });

  it("採点が締められていれば、終了前でも出る", () => {
    stateMock.mockReturnValue({ awardsRevealCursor: 0, scoringLocked: true });
    draw();
    expect(screen.getByText("採点結果を見る")).toBeInTheDocument();
  });

  it("採点中は出さない", () => {
    draw();
    expect(screen.queryByText("採点結果を見る")).not.toBeInTheDocument();
  });
});
