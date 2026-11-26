import { describe, expect, it } from "vitest";
import type { EventTrack, ScheduleItem } from "@eventer/shared";
import {
  TIMETABLE_MIN_BLOCK_PX,
  TIMETABLE_PX_PER_MIN,
  buildTimetableLayout,
  entriesForTrack,
  timeToOffsetPx,
  type TimetableBlock,
  type TimetableLayout,
} from "./timetableLayout.js";

/**
 * マルチトラックのタイムテーブルの下敷き (#338)。
 *
 * 「どの列の何行目から何行目までか」を決めるのはここ1か所で、広い画面の格子も
 * スマホのタブもこの結果を使う。またぎ・全トラック共通・飛び地・時刻未定が
 * 崩れないことを、描画に頼らず直接確かめる。
 */

const TRACKS: EventTrack[] = [
  { id: "tr-a", name: "A（メインホール）", sortOrder: 0, visibility: "public" },
  { id: "tr-b", name: "B（小ホール）", sortOrder: 1, visibility: "public" },
  { id: "tr-c", name: "C（ワークショップ室）", sortOrder: 2, visibility: "public" },
];

/** vitest.config.ts で TZ を Asia/Tokyo に固定しているので、この時刻は 10:00 */
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
  item({ id: "it-open", title: "開会", durationMin: 20, placement: "all" }),
  item({ id: "it-a", title: "セッションA", placement: "tracks", trackIds: ["tr-a"] }),
  item({ id: "it-b", title: "セッションB", placement: "tracks", trackIds: ["tr-b"] }),
  item({
    id: "it-panel",
    title: "パネル討論",
    durationMin: 90,
    placement: "tracks",
    trackIds: ["tr-a", "tr-b"],
  }),
  item({
    id: "it-gap",
    title: "飛び地",
    placement: "tracks",
    // B を飛ばした組み合わせ。grid の1枠にはできない
    trackIds: ["tr-a", "tr-c"],
  }),
  item({ id: "it-idea", title: "ネタ出し", placement: "unassigned" }),
];

const layout = () => buildTimetableLayout(ITEMS, TRACKS, START);

describe("buildTimetableLayout (#338)", () => {
  it("複数トラックにまたがるコマは、またぐ列をつないだ1つの枠になる", () => {
    const blocks = layout().blocks.filter((b) => b.entry.item.id === "it-panel");

    expect(blocks).toHaveLength(1);
    // 先頭は全トラック共通の列なので、A は列 1
    expect(blocks[0]!.colStart).toBe(1);
    expect(blocks[0]!.colSpan).toBe(2);
    expect(blocks[0]!.split).toBe(false);
    expect(blocks[0]!.trackNames).toEqual([TRACKS[0]!.name, TRACKS[1]!.name]);
  });

  it("全トラック共通は、先頭の専用の列に1つの枠で置く", () => {
    const got = layout();
    const blocks = got.blocks.filter((b) => b.entry.item.id === "it-open");

    expect(got.columns[0]).toEqual({ kind: "common" });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.common).toBe(true);
    expect(blocks[0]!.colStart).toBe(0);
    expect(blocks[0]!.colSpan).toBe(1);
  });

  it("枠の高さは所要時間に比例し、次の枠はその下から始まる", () => {
    const { blocks } = layout();
    const open = blocks.find((b) => b.entry.item.id === "it-open")!;
    const panel = blocks.find((b) => b.entry.item.id === "it-panel")!;

    // 20分・90分（1分あたりの高さに比例）
    expect(open.heightPx).toBeCloseTo(20 * TIMETABLE_PX_PER_MIN);
    expect(panel.heightPx).toBeCloseTo(90 * TIMETABLE_PX_PER_MIN);
    // 開会(10:00-10:20) の後ろに次の枠が来る（列は違っても時刻の行はそろう）
    const a = blocks.find((b) => b.entry.item.id === "it-a")!;
    expect(a.rowStart).toBe(open.rowEnd);
  });

  it("離れたトラック（飛び地）は2つの枠に割れるが、どちらも消えない", () => {
    const blocks = layout().blocks.filter((b) => b.entry.item.id === "it-gap");

    // 先頭は全トラック共通の列。A は列 1、C は列 3
    expect(blocks.map((b) => [b.colStart, b.colSpan])).toEqual([
      [1, 1],
      [3, 1],
    ]);
    expect(blocks.every((b) => b.split)).toBe(true);
    // 割れても同じ時刻・同じ高さ
    expect(blocks[0]!.rowStart).toBe(blocks[1]!.rowStart);
    expect(blocks[0]!.rowEnd).toBe(blocks[1]!.rowEnd);
    // どのトラックのものか分かるよう、割れた側にも全部の名前を添える
    expect(blocks[0]!.trackNames).toEqual([TRACKS[0]!.name, TRACKS[2]!.name]);
  });

  it("未割り当ては格子にも一覧にも出さず、別枠で持つ", () => {
    const { blocks, entries, unassigned } = layout();

    expect(blocks.some((b) => b.entry.item.id === "it-idea")).toBe(false);
    expect(entries.some((e) => e.item.id === "it-idea")).toBe(false);
    expect(unassigned.map((i) => i.id)).toEqual(["it-idea"]);
  });

  it("時刻の目盛りは30分ごとで、ちょうどの時が分かる", () => {
    const { ticks, rows } = layout();

    expect(ticks[0]!.ms).toBe(START);
    expect(ticks[0]!.hour).toBe(true);
    expect(ticks[1]!.ms).toBe(START + 30 * 60_000);
    expect(ticks[1]!.hour).toBe(false);
    expect(ticks.every((t) => t.rowEnd <= rows + 1)).toBe(true);
  });

  it("日程調整中（開始時刻が未定）でも壊れず、時刻未定として並ぶ", () => {
    const got = buildTimetableLayout(ITEMS, TRACKS, null);

    expect(got.blocks).toEqual([]);
    expect(got.rows).toBe(0);
    expect(got.ticks).toEqual([]);
    // 未割り当てを除く全部が「時刻未定」に落ちる（消えない）
    expect(got.undated.map((e) => e.item.id)).toEqual([
      "it-open",
      "it-a",
      "it-b",
      "it-panel",
      "it-gap",
    ]);
  });

  it("飛び地で割れた枠は、どちらも同じ色で描ける", () => {
    const blocks = layout().blocks.filter((b) => b.entry.item.id === "it-gap");

    // 色を列 (colStart) から引くと、割れた片割れが別の色になってしまう
    expect(blocks.map((b) => b.colorIndex)).toEqual([0, 0]);
  });

  it("単独のトラックの枠も、どのトラックのものか名前で分かる", () => {
    // 読み上げは列の位置が見えないので、名前が枠に無いとどのトラックか分からない
    const solo = layout().blocks.filter((b) => b.entry.item.id === "it-a");

    expect(solo).toHaveLength(1);
    expect(solo[0]!.trackNames).toEqual([TRACKS[0]!.name]);
  });

  it("3日間のイベントでも、どの日のコマも1つ残らず表に載る (#346)", () => {
    // 描く範囲が狭いと、多数派に入らなかった日のコマが丸ごと格子から消え、
    // 打ち間違い扱いの見出しに並んでしまっていた
    const days = [
      new Date("2026-08-11T09:00:00+09:00").getTime(),
      new Date("2026-08-12T09:00:00+09:00").getTime(),
      new Date("2026-08-13T09:00:00+09:00").getTime(),
    ];
    const items = days.flatMap((startsAt, d) => [
      item({ id: `d${d}-open`, title: `${d + 1}日目 開会`, startsAt }),
      item({
        id: `d${d}-a`,
        title: `${d + 1}日目 A`,
        placement: "tracks",
        trackIds: ["tr-a"],
      }),
      item({
        id: `d${d}-b`,
        title: `${d + 1}日目 B`,
        placement: "tracks",
        trackIds: ["tr-b"],
      }),
    ]);
    const got = buildTimetableLayout(items, TRACKS, days[0]!);

    expect(got.outOfRange).toEqual([]);
    expect(got.undated).toEqual([]);
    expect(got.blocks.map((b) => b.entry.item.id).sort()).toEqual(
      items.map((i) => i.id).sort(),
    );
    // 3日ぶんでも行数は3桁に収まる（1日24時間＝288行）
    expect(got.rows).toBeLessThan(1000);
  });

  it("朝から深夜までの2日間（36時間超）でも、2日目のコマが落ちない (#346)", () => {
    const first = new Date("2026-08-11T09:00:00+09:00").getTime();
    // 1日目の朝から数えて38時間後。1日ぶんの窓では範囲外に落ちていた
    const lateNight = new Date("2026-08-12T23:00:00+09:00").getTime();
    const items = [
      item({ id: "it-d1", title: "1日目 朝", startsAt: first }),
      item({
        id: "it-d2-night",
        title: "2日目 深夜",
        startsAt: lateNight,
        placement: "tracks",
        trackIds: ["tr-a"],
      }),
    ];
    const got = buildTimetableLayout(items, TRACKS, first);

    expect(got.outOfRange).toEqual([]);
    expect(got.blocks.map((b) => b.entry.item.id).sort()).toEqual([
      "it-d1",
      "it-d2-night",
    ]);
  });

  it("6日間の合宿は全部載り、月を打ち間違えた1件だけが落ちる (#346)", () => {
    const first = new Date("2026-08-11T09:00:00+09:00").getTime();
    const days = [0, 1, 2, 3, 4, 5].map((d) => first + d * 24 * 60 * 60_000);
    const items = [
      ...days.map((startsAt, d) =>
        item({
          id: `d${d}`,
          title: `${d + 1}日目`,
          startsAt,
          placement: "tracks",
          trackIds: ["tr-a"],
        }),
      ),
      item({
        id: "it-typo",
        title: "日を打ち間違い",
        // 月を打ち間違えた1件。7日の窓から大きく外れる
        startsAt: new Date("2026-09-11T09:00:00+09:00").getTime(),
        placement: "tracks",
        trackIds: ["tr-b"],
      }),
    ];
    const got = buildTimetableLayout(items, TRACKS, first);

    expect(got.outOfRange.map((e) => e.item.id)).toEqual(["it-typo"]);
    expect(got.blocks.map((b) => b.entry.item.id).sort()).toEqual([
      "d0",
      "d1",
      "d2",
      "d3",
      "d4",
      "d5",
    ]);
    // 6日ぶんでも行数は 24時間×6＋αで、画面が固まる桁には届かない
    expect(got.rows).toBeLessThan(2100);
  });

  it("10日ずれた打ち間違いは、月をまたがなくても弾かれる (#346)", () => {
    // 「2日目を1週間後に打つ」「月末で日を1桁間違える」など、年や月をまたがない
    // ずれ。窓は最頻クラスタの前後ではなく **端から端まで7日** なので、これも外れる
    const first = new Date("2026-08-11T09:00:00+09:00").getTime();
    const items = [
      ...[0, 1, 2].map((d) =>
        item({
          id: `d${d}`,
          title: `${d + 1}日目`,
          startsAt: first + d * 24 * 60 * 60_000,
          placement: "tracks",
          trackIds: ["tr-a"],
        }),
      ),
      item({
        id: "it-typo",
        title: "日を打ち間違い",
        startsAt: first + 10 * 24 * 60 * 60_000,
        placement: "tracks",
        trackIds: ["tr-b"],
      }),
    ];
    const got = buildTimetableLayout(items, TRACKS, first);

    expect(got.outOfRange.map((e) => e.item.id)).toEqual(["it-typo"]);
    expect(got.blocks.map((b) => b.entry.item.id).sort()).toEqual([
      "d0",
      "d1",
      "d2",
    ]);
  });

  it("格子の行数は、いちばん広がっても8日ぶん（7日＋1コマ上限）の目盛りで頭打ちになる", () => {
    // 窓は「端から端まで7日」。**最頻クラスタから前後に7日ずつ（＝14日）ではない**。
    // 最後のコマは所要時間の上限24時間で切られるので、行数はここが最大になる
    const first = new Date("2026-08-11T09:00:00+09:00").getTime();
    const items = [
      item({
        id: "it-first",
        title: "初日",
        startsAt: first,
        placement: "tracks",
        trackIds: ["tr-a"],
      }),
      item({
        id: "it-last",
        title: "ちょうど7日後",
        // 端は含める（7日ちょうどは窓の中）
        startsAt: first + 7 * 24 * 60 * 60_000,
        durationMin: 60 * 24 * 400,
        placement: "tracks",
        trackIds: ["tr-a"],
      }),
    ];
    const got = buildTimetableLayout(items, TRACKS, first);

    expect(got.outOfRange).toEqual([]);
    // 8日 × 24時間 × 30分ごとの目盛り。行は目盛りとコマの境目だけで区切る
    expect(got.ticks).toHaveLength(8 * 24 * 2);
    expect(got.rows).toBe(8 * 24 * 2);
  });

  it("開始時刻の打ち間違いで格子が膨らまず、外れた1件だけが落ちる", () => {
    // 年を1桁打ち間違えた1件。これで行数が数百万になり、参加者を含む
    // 全閲覧者の画面が固まっていた
    const typo = item({
      id: "it-typo",
      title: "打ち間違い",
      startsAt: new Date("2126-08-11T10:00:00+09:00").getTime(),
      placement: "tracks",
      trackIds: ["tr-b"],
    });
    const got = buildTimetableLayout([...ITEMS, typo], TRACKS, START);

    expect(got.blocks.some((b) => b.entry.item.id === "it-typo")).toBe(false);
    expect(got.outOfRange.map((e) => e.item.id)).toEqual(["it-typo"]);
    // 正しいコマは1つも落ちない
    expect(got.undated).toEqual([]);
    expect(got.blocks.map((b) => b.entry.item.id).sort()).toEqual([
      "it-a",
      "it-b",
      "it-gap",
      "it-gap",
      "it-open",
      "it-panel",
    ]);
    // 打ち間違いを含めると10万行を超えていた
    expect(got.rows).toBeLessThan(1000);
  });

  it("打ち間違いが過去側でも、正しいコマの方を表に残す", () => {
    // 最も早いコマを基準にすると、正しいコマが全部範囲外に落ちてしまう
    const typo = item({
      id: "it-typo",
      title: "打ち間違い",
      startsAt: new Date("1926-08-11T10:00:00+09:00").getTime(),
      placement: "tracks",
      trackIds: ["tr-b"],
    });
    const got = buildTimetableLayout([typo, ...ITEMS], TRACKS, START);

    expect(got.outOfRange.map((e) => e.item.id)).toEqual(["it-typo"]);
    expect(got.blocks.some((b) => b.entry.item.id === "it-open")).toBe(true);
    expect(got.rows).toBeLessThan(1000);
  });

  it("所要時間が壊れていても行数が膨らまない", () => {
    const huge = item({
      id: "it-huge",
      title: "壊れた所要時間",
      durationMin: 60 * 24 * 400,
      placement: "tracks",
      trackIds: ["tr-a"],
    });
    const got = buildTimetableLayout([huge], TRACKS, START);

    expect(got.blocks).toHaveLength(1);
    expect(got.rows).toBeLessThan(1000);
  });

  it("トラックが1本も無いイベントでも壊れない", () => {
    const got = buildTimetableLayout(ITEMS, [], START);

    expect(got.blocks).toEqual([]);
    expect(got.entries.every((e) => e.common)).toBe(true);
  });

  it("消えたトラックだけに載っていたコマは全トラック共通として扱う", () => {
    const orphan = item({
      id: "it-orphan",
      placement: "tracks",
      trackIds: ["tr-zzz"],
    });
    const got = buildTimetableLayout([orphan], TRACKS, START);

    expect(got.blocks).toHaveLength(1);
    expect(got.blocks[0]!.common).toBe(true);
    expect(got.blocks[0]!.colStart).toBe(0);
  });
});

describe("entriesForTrack (#338)", () => {
  it("全トラック共通はどのトラックにも出て、他トラックのコマは出ない", () => {
    const got = layout();

    expect(entriesForTrack(got, 0).map((e) => e.item.id)).toEqual([
      "it-open",
      "it-a",
      "it-panel",
      "it-gap",
    ]);
    expect(entriesForTrack(got, 2).map((e) => e.item.id)).toEqual([
      "it-open",
      "it-gap",
    ]);
  });
});

/** 行の高さを足して、その枠の上端と下端(px)を出す。描画と同じ計算 */
function edges(got: TimetableLayout, b: TimetableBlock): [number, number] {
  const top = got.rowHeights.slice(0, b.rowStart - 1).reduce((n, h) => n + h, 0);
  return [top, top + b.heightPx];
}
/** 同じ列にかかり、縦にも重なり、同じ位置（lane）に並ぶ枠の組。1つでもあれば文字が重なって読めない */
function collisions(got: TimetableLayout): string[] {
  const out: string[] = [];
  got.blocks.forEach((a, i) => {
    got.blocks.slice(i + 1).forEach((b) => {
      const cols = a.colStart < b.colStart + b.colSpan && b.colStart < a.colStart + a.colSpan;
      const [a0, a1] = edges(got, a);
      const [b0, b1] = edges(got, b);
      const rows = a0 < b1 - 0.01 && b0 < a1 - 0.01;
      const sideBySide = a.laneCount > 1 && b.laneCount > 1 && a.lane !== b.lane;
      if (cols && rows && !sideBySide) out.push(`${a.key} × ${b.key}`);
    });
  });
  return out;
}

/**
 * 短いコマ・重なるコマ（Nostrasia 2026 のタイムテーブル、オーナー指摘 2026-11-25）。
 * 5〜10分のコマが続くと1マス9pxの格子では18pxしか無く、時刻と題名が次のコマに
 * はみ出していた。全トラック共通の帯は、長いトラックのコマの上に重ねて描いていた。
 */
describe("短いコマと重なり", () => {
  const at = (h: number, m: number) => new Date(`2026-08-11T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+09:00`).getTime();

  it("5〜10分の共通のコマが6つ続いても、どれも1行ぶんの高さがあり、順に並ぶ", () => {
    const items = [5, 10, 10, 5, 15, 10].map((durationMin, i) =>
      item({ id: `it-${i}`, title: `登壇${i}`, durationMin }),
    );
    const got = buildTimetableLayout(items, TRACKS, at(13, 0));
    const shown = items.map((it) => got.blocks.find((b) => b.entry.item.id === it.id)!);

    for (const b of shown) expect(b.heightPx).toBeGreaterThanOrEqual(TIMETABLE_MIN_BLOCK_PX);
    for (let i = 1; i < shown.length; i++) expect(shown[i]!.rowStart).toBeGreaterThanOrEqual(shown[i - 1]!.rowEnd);
    expect(collisions(got)).toEqual([]);
  });

  it("長いトラックのコマの途中に全トラック共通のコマがあっても、トラックのコマは1つの枠のまま（オーナー 2026-11-26）", () => {
    const items = [
      item({ id: "it-long", title: "交流スペース", startsAt: at(14, 0), durationMin: 240, placement: "tracks", trackIds: ["tr-a"] }),
      item({ id: "it-zap", title: "じゃんけん", startsAt: at(15, 0), durationMin: 10 }),
      item({ id: "it-lt", title: "LT枠2", startsAt: at(16, 5), durationMin: 5 }),
    ];
    const got = buildTimetableLayout(items, TRACKS, at(14, 0));
    const long = got.blocks.filter((b) => b.entry.item.id === "it-long");
    const zap = got.blocks.find((b) => b.entry.item.id === "it-zap")!;

    // 途切れない（以前は帯のたびに「続き」に割れていた）
    expect(long).toHaveLength(1);
    expect(long[0]!.colStart).toBe(1);
    // 全トラック共通は専用の列。同じ時刻でもトラックの列とは別の列
    expect(zap.colStart).toBe(0);
    expect(long[0]!.rowStart).toBeLessThan(zap.rowStart);
    expect(long[0]!.rowEnd).toBeGreaterThan(zap.rowEnd);
    expect(collisions(got)).toEqual([]);
  });

  it("セッションの無いトラックの列は既定で隠し、showEmptyTracks で出す", () => {
    const items = [
      item({ id: "it-a", title: "A", startsAt: at(14, 0), placement: "tracks", trackIds: ["tr-a"] }),
      item({ id: "it-c", title: "C", startsAt: at(14, 0), placement: "tracks", trackIds: ["tr-c"] }),
    ];
    const hidden = buildTimetableLayout(items, TRACKS, at(14, 0));
    const shown = buildTimetableLayout(items, TRACKS, at(14, 0), { showEmptyTracks: true });

    // 共通のコマが無いので全体の列も無い。B は空なので隠れる
    expect(hidden.columns).toEqual([
      { kind: "track", trackIndex: 0 },
      { kind: "track", trackIndex: 2 },
    ]);
    expect(hidden.hiddenTracks.map((t) => t.id)).toEqual(["tr-b"]);
    expect(hidden.blocks.find((b) => b.entry.item.id === "it-c")!.colStart).toBe(1);
    expect(shown.columns).toHaveLength(3);
    expect(shown.hiddenTracks).toEqual([]);
    expect(shown.blocks.find((b) => b.entry.item.id === "it-c")!.colStart).toBe(2);
    // スマホのタブはイベントの全トラックを使う（隠さない）
    expect(hidden.tracks).toHaveLength(3);
  });

  it("「いま」の位置は、コマのある時間の中だけで返り、時刻とともに下がる", () => {
    const items = [
      item({ id: "it-a", title: "A", startsAt: at(14, 0), durationMin: 60, placement: "tracks", trackIds: ["tr-a"] }),
      item({ id: "it-b", title: "B", startsAt: at(15, 0), durationMin: 60, placement: "tracks", trackIds: ["tr-a"] }),
    ];
    const got = buildTimetableLayout(items, TRACKS, at(14, 0));

    expect(timeToOffsetPx(got, at(13, 59))).toBeNull();
    expect(timeToOffsetPx(got, at(16, 1))).toBeNull();
    expect(timeToOffsetPx(got, at(14, 0))).toBe(0);
    const mid = timeToOffsetPx(got, at(14, 30))!;
    const later = timeToOffsetPx(got, at(15, 30))!;
    expect(mid).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(mid);
    expect(timeToOffsetPx(got, at(16, 0))).toBeCloseTo(got.rowHeights.reduce((n, h) => n + h, 0));
  });

  it("同じトラックで時刻が重なる2つのコマは、横に並べて両方見える (#345)", () => {
    const items = [
      item({ id: "it-x", title: "交流スペース", startsAt: at(14, 0), durationMin: 240, placement: "tracks", trackIds: ["tr-a"] }),
      item({ id: "it-y", title: "高機能クライアントの話", startsAt: at(16, 0), durationMin: 5, placement: "tracks", trackIds: ["tr-a"] }),
    ];
    const got = buildTimetableLayout(items, TRACKS, at(14, 0));
    const x = got.blocks.find((b) => b.entry.item.id === "it-x")!;
    const y = got.blocks.find((b) => b.entry.item.id === "it-y")!;

    expect([x.laneCount, y.laneCount]).toEqual([2, 2]);
    expect(x.lane).not.toBe(y.lane);
    expect(y.heightPx).toBeGreaterThanOrEqual(TIMETABLE_MIN_BLOCK_PX);
    expect(collisions(got)).toEqual([]);
  });

  it("時刻の目盛りは上から順に並び、行の高さはどれも正", () => {
    const items = [
      item({ id: "it-open", title: "開場", startsAt: at(12, 30), durationMin: 30 }),
      item({ id: "it-s", title: "短い", durationMin: 5 }),
      item({ id: "it-late", title: "夜", startsAt: at(18, 0), durationMin: 60 }),
    ];
    const got = buildTimetableLayout(items, TRACKS, at(12, 30));

    expect(got.rowHeights).toHaveLength(got.rows);
    expect(got.rowHeights.every((h) => h > 0)).toBe(true);
    for (let i = 1; i < got.ticks.length; i++) {
      expect(got.ticks[i]!.ms).toBeGreaterThan(got.ticks[i - 1]!.ms);
      expect(got.ticks[i]!.rowStart).toBe(got.ticks[i - 1]!.rowEnd);
    }
  });
});
