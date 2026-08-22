import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
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

describe("TimetableGrid（広い画面）", () => {
  it("複数トラックにまたがるコマは、隣の列をつないだ1つの枠として描く", () => {
    const container = drawGrid();
    const blocks = blocksOf(container, "it-panel");

    expect(blocks).toHaveLength(1);
    // 1列目は時刻列なので、A から2列ぶん＝ "2 / span 2"
    expect(blocks[0]!.style.gridColumn).toBe("2 / span 2");
    expect(screen.getAllByText("パネル討論")).toHaveLength(1);
    // どのトラックにまたがっているかを枠の中に添える
    expect(blocks[0]!.textContent).toContain("A（メインホール）・B（小ホール）");
  });

  it("全トラック共通は全列をまたぐ帯として描く", () => {
    const blocks = blocksOf(drawGrid(), "it-open");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.style.gridColumn).toBe("2 / span 3");
    expect(blocks[0]!.textContent).toContain("全トラック共通");
    // トラック名は出さない（どれか1本の予定と読み違えられる）
    expect(blocks[0]!.textContent).not.toContain("メインホール");
  });

  it("1つのトラックだけのコマは、その列にだけ描く", () => {
    const container = drawGrid();

    expect(blocksOf(container, "it-a")[0]!.style.gridColumn).toBe("2 / span 1");
    expect(blocksOf(container, "it-b")[0]!.style.gridColumn).toBe("3 / span 1");
  });

  it("枠の高さは所要時間ぶんの行数になる", () => {
    const container = drawGrid();

    // 10:00 から20分＝4マス（1マス5分）。ヘッダー行があるので行番号は +1
    expect(blocksOf(container, "it-open")[0]!.style.gridRow).toBe("2 / 6");
    // 90分＝18マス
    const panel = blocksOf(container, "it-panel")[0]!.style.gridRow;
    const [from, to] = panel.split(" / ").map(Number);
    expect(to! - from!).toBe(18);
  });

  it("離れたトラック（飛び地）は2つの枠に割れて、どちらも描かれる", () => {
    const container = drawGrid([
      item({
        id: "it-gap",
        title: "飛び地",
        placement: "tracks",
        trackIds: ["tr-a", "tr-c"],
      }),
    ]);
    const blocks = blocksOf(container, "it-gap");

    expect(blocks.map((b) => b.style.gridColumn)).toEqual([
      "2 / span 1",
      "4 / span 1",
    ]);
    // 同じコマだと分かるよう、割れた両方にトラック名を添える
    for (const b of blocks) {
      expect(b.textContent).toContain("A（メインホール）・C（ワークショップ室）");
    }
    // 色は列ではなくコマで決めるので、割れた両方が同じ見た目になる。
    // 見た目が同じなら emotion のクラス名も同じになる（位置だけ inline style）
    expect(blocks[0]!.className).toBe(blocks[1]!.className);
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

    // 役割とラベルが内側に付いていると、外側の器にフォーカスが行かず、
    // マウスやタッチの無い人がトラックの続きを見られない
    expect(region.tabIndex).toBe(0);
    expect(getComputedStyle(region).overflow).toBe("auto");
  });

  it("読み上げ専用のトラック名は、見た目の場所を取らない", () => {
    const solo = blocksOf(drawGrid(), "it-a")[0]!;
    const srOnly = Array.from(solo.querySelectorAll("span")).find((el) =>
      el.textContent?.startsWith("トラック"),
    )!;

    // sx の 0〜1 は割合として読まれるので、1 と書くと 100% になってしまう
    expect(getComputedStyle(srOnly).width).toBe("1px");
    expect(getComputedStyle(srOnly).height).toBe("1px");
  });

  it("どの枠にもトラック名が入っていて、読み上げでどの列か分かる", () => {
    const container = drawGrid();

    // 単独トラックの枠は列を見れば分かるので名前を表に出していないが、
    // 読み上げには列が見えない。目に見えない形で必ず添える
    const solo = blocksOf(container, "it-a")[0]!;
    expect(solo.textContent).toContain("A（メインホール）");

    // 全トラック共通も含め、どの枠にも「どこでやるか」が入っている
    for (const id of ["it-open", "it-a", "it-b", "it-panel"]) {
      for (const b of blocksOf(container, id)) {
        expect(b.textContent).toMatch(/全トラック共通|A（メインホール）|B（小ホール）/);
      }
    }
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
