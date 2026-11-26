import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { EventTrack, ScheduleItem } from "@eventer/shared";
import { buildTimetableLayout } from "../lib/timetableLayout.js";
import { trackColors, trackColorsForTracks } from "../lib/trackColors.js";
import { TimetableGrid } from "./TimetableGrid.js";
import { TimetableTrackTabs } from "./TimetableTrackTabs.js";

/**
 * マルチトラックのタイムテーブル画面 (#338)。
 *
 * 広い画面（格子）と狭い画面（トラックのタブ＋縦一覧）の両方が、同じ
 * 下敷き（lib/timetableLayout.ts）から崩れずに描けることを確かめる。
 * とくに「またぎが1枠か」「全トラック共通が全列か」は、列の指定が1つずれる
 * だけで別のトラックの予定として読めてしまうので、実際の指定値まで見る。
 */

const TRACKS: EventTrack[] = [
  { id: "tr-a", name: "A（メインホール）", sortOrder: 0, visibility: "public" },
  { id: "tr-b", name: "B（小ホール）", sortOrder: 1, visibility: "public" },
  { id: "tr-c", name: "C（ワークショップ室）", sortOrder: 2, visibility: "public" },
];

const START = new Date("2026-08-11T10:00:00+09:00").getTime();

function item(patch: Partial<ScheduleItem> & { id: string }): ScheduleItem {
  return {
    eventId: "e-1",
    title: "コマ",
    description: "",
    durationMin: 30,
    startsAt: null,
    speaker: null,
    speakerUserId: null,
    speakerName: "",
    materialUrl: "",
    materialOgImage: "",
    sortOrder: 0,
    placement: "all",
    // 既存のコマは全部「参加者にも見せる」(マイグレーションの既定値 #383)
    visibility: "public",
    trackIds: [],
    ...patch,
  };
}

const ITEMS: ScheduleItem[] = [
  item({ id: "it-open", title: "開会", durationMin: 20 }),
  item({ id: "it-a", title: "セッションA", placement: "tracks", trackIds: ["tr-a"] }),
  item({ id: "it-b", title: "セッションB", placement: "tracks", trackIds: ["tr-b"] }),
  item({
    id: "it-panel",
    title: "パネル討論",
    durationMin: 90,
    placement: "tracks",
    trackIds: ["tr-a", "tr-b"],
  }),
  item({ id: "it-idea", title: "ネタ出し", placement: "unassigned" }),
];

const layout = (items: ScheduleItem[] = ITEMS, tracks = TRACKS) =>
  buildTimetableLayout(items, tracks, START);

/** テーマから導いた色。トラックの本数ぶん作る */
const colors = (n: number) => trackColors("#2DD4BF", "#FB923C", n);

function drawGrid(items?: ScheduleItem[]) {
  const got = layout(items);
  const { container } = render(
    <TimetableGrid layout={got} colors={colors(got.tracks.length)} />,
  );
  return container;
}

/** その項目の枠（複数の列に割れていれば複数返る） */
function blocksOf(container: HTMLElement, id: string): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(`[data-timetable-block="${id}"]`),
  );
}

describe("TimetableGrid（広い画面のタイムライン）", () => {
  it("1つのコマは1枚のカード。またぐトラックは場所の札で全部示す", () => {
    const container = drawGrid();
    const cards = blocksOf(container, "it-panel");

    expect(cards).toHaveLength(1);
    expect(screen.getAllByText("パネル討論")).toHaveLength(1);
    expect(cards[0]!.textContent).toContain("A（メインホール）");
    expect(cards[0]!.textContent).toContain("B（小ホール）");
  });

  it("全トラック共通のカードは場所の札が「全体」で、トラック名を出さない", () => {
    const container = drawGrid();
    const open = blocksOf(container, "it-open")[0]!;

    expect(open.textContent).toContain("全体");
    expect(open.textContent).not.toContain("メインホール");
  });

  it("全トラック共通の色はテーマの主色（灰色にしない。オーナー 2026-11-27）", () => {
    const got = layout();
    const { container } = render(
      <ThemeProvider theme={createTheme({ palette: { primary: { main: "#EC4899" } } })}>
        <TimetableGrid layout={got} colors={colors(got.tracks.length)} />
      </ThemeProvider>,
    );
    const open = blocksOf(container, "it-open")[0]!;

    // 左の太い線が主色（#EC4899 = rgb(236, 72, 153)）
    expect(getComputedStyle(open).borderLeft).toContain("rgb(236, 72, 153)");
  });

  it("行は始まる時刻ごと。カードはその行に置き、時刻を左に出す", () => {
    const got = layout();
    const { container } = render(
      <TimetableGrid layout={got} colors={colors(got.tracks.length)} />,
    );
    const open = got.cards.find((c) => c.entry.item.id === "it-open")!;

    expect(blocksOf(container, "it-open")[0]!.style.gridRow).toBe(String(open.rowStart));
    expect(container.querySelectorAll("time")).toHaveLength(got.rows.length);
  });

  it("並行して長く続く企画は、右の細い列に縦書きで置く", () => {
    const at = (h: number, m: number) => START + ((h - 10) * 60 + m) * 60_000;
    const got = buildTimetableLayout(
      [
        item({ id: "it-long", title: "フリーマーケット", startsAt: at(10, 0), durationMin: 240, placement: "tracks", trackIds: ["tr-c"] }),
        item({ id: "it-t1", title: "登壇1", startsAt: at(10, 0), durationMin: 10 }),
        item({ id: "it-t2", title: "登壇2", durationMin: 10 }),
        item({ id: "it-t3", title: "登壇3", durationMin: 10 }),
      ],
      TRACKS,
      at(10, 0),
    );
    const { container } = render(<TimetableGrid layout={got} colors={colors(TRACKS.length)} />);
    const long = blocksOf(container, "it-long")[0]!;

    expect(long.hasAttribute("data-timetable-side")).toBe(true);
    expect(blocksOf(container, "it-t1")[0]!.hasAttribute("data-timetable-side")).toBe(false);
  });

  it("表としてではなく、名前の付いた領域として置く", () => {
    drawGrid();

    // grid で描いているだけで行・セルの構造は持たない。role="table" にすると
    // 読み上げが表として案内したのに中身が読めない状態になる
    expect(screen.getByRole("region", { name: "タイムテーブル" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("横スクロールする器そのものにフォーカスが行き、キーボードだけで動かせる", () => {
    drawGrid();
    const region = screen.getByRole("region", { name: "タイムテーブル" });

    expect(region.tabIndex).toBe(0);
    expect(getComputedStyle(region).overflowX).toBe("auto");
  });

  it("未割り当ては格子に出さない", () => {
    const container = drawGrid();

    expect(blocksOf(container, "it-idea")).toHaveLength(0);
    expect(screen.queryByText("ネタ出し")).not.toBeInTheDocument();
  });

  /**
   * 裏方 (#383)。サーバーが staff にしか返さないので、ここに届いている時点で
   * 見てよい人が見ている。**画面側では絞らない**（絞ると判断が2か所になる）。
   * 代わりに、参加者には出ないコマだと分かる印を必ず付ける。
   */
  it("裏方のコマは、参加者には出ないと分かる印を付けて描く", () => {
    const tracks: EventTrack[] = [
      TRACKS[0]!,
      { id: "tr-s", name: "受付", sortOrder: 1, visibility: "staff" },
    ];
    const got = buildTimetableLayout(
      [
        item({
          id: "it-a",
          title: "セッションA",
          placement: "tracks",
          trackIds: ["tr-a"],
        }),
        item({
          id: "it-prep",
          title: "設営",
          placement: "tracks",
          trackIds: ["tr-a"],
          visibility: "staff",
        }),
      ],
      tracks,
      START,
    );
    const { container } = render(
      <TimetableGrid
        layout={got}
        colors={trackColorsForTracks("#2DD4BF", "#FB923C", got.tracks)}
      />,
    );

    expect(blocksOf(container, "it-prep")[0]!.textContent).toContain("運営のみ");
    // 公開のコマには付けない（付くと全部が裏方に見える）
    expect(blocksOf(container, "it-a")[0]!.textContent).not.toContain(
      "運営のみ",
    );
  });

  it("開催中は「いま」の線を引き、コマの時間の外では引かない", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(START + 15 * 60_000);
      const during = render(<TimetableGrid layout={layout()} colors={colors(TRACKS.length)} />);
      expect(during.container.querySelector("[data-timetable-now]")).not.toBeNull();
      during.unmount();

      vi.setSystemTime(START - 60 * 60_000);
      const before = render(<TimetableGrid layout={layout()} colors={colors(TRACKS.length)} />);
      expect(before.container.querySelector("[data-timetable-now]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("開始時刻が決まらないときは格子を描かない（壊れない）", () => {
    const got = buildTimetableLayout(ITEMS, TRACKS, null);
    const { container } = render(
      <TimetableGrid layout={got} colors={colors(TRACKS.length)} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("TimetableTrackTabs（スマホ幅）", () => {
  function drawTabs(items?: ScheduleItem[]) {
    const got = layout(items);
    return render(
      <MemoryRouter>
        <TimetableTrackTabs layout={got} colors={colors(got.tracks.length)} />
      </MemoryRouter>,
    );
  }

  it("選んだトラックのコマだけを出し、他のトラックのものは出さない", () => {
    drawTabs();

    expect(screen.getByText("セッションA")).toBeInTheDocument();
    expect(screen.queryByText("セッションB")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /B（小ホール）/ }));

    expect(screen.getByText("セッションB")).toBeInTheDocument();
    expect(screen.queryByText("セッションA")).not.toBeInTheDocument();
  });

  it("全トラック共通のコマは、どのタブにも出る", () => {
    drawTabs();

    for (const track of TRACKS) {
      fireEvent.click(screen.getByRole("tab", { name: new RegExp(track.name) }));
      expect(screen.getByText("開会")).toBeInTheDocument();
      // どのタブにも同じ行が出るので、共通だと分かる印を付ける
      expect(screen.getByText("全トラック共通")).toBeInTheDocument();
    }
  });

  it("未割り当てはどのタブにも出さない", () => {
    drawTabs();

    for (const track of TRACKS) {
      fireEvent.click(screen.getByRole("tab", { name: new RegExp(track.name) }));
      expect(screen.queryByText("ネタ出し")).not.toBeInTheDocument();
    }
  });

  it("時刻が決まらないコマも消えず、時刻を伏せて並ぶ", () => {
    const got = buildTimetableLayout(ITEMS, TRACKS, null);
    render(
      <MemoryRouter>
        <TimetableTrackTabs layout={got} colors={colors(TRACKS.length)} />
      </MemoryRouter>,
    );

    expect(screen.getByText("開会")).toBeInTheDocument();
    expect(screen.getAllByText("--:--").length).toBeGreaterThan(0);
  });
});
