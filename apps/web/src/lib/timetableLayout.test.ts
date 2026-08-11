import { describe, expect, it } from "vitest";
import type { EventTrack, ScheduleItem } from "@eventer/shared";
import { buildTimetableLayout, entriesForTrack } from "./timetableLayout.js";

/**
 * マルチトラックのタイムテーブルの下敷き (#338)。
 *
 * 「どの列の何行目から何行目までか」を決めるのはここ1か所で、広い画面の格子も
 * スマホのタブもこの結果を使う。またぎ・全トラック共通・飛び地・時刻未定が
 * 崩れないことを、描画に頼らず直接確かめる。
 */

const TRACKS: EventTrack[] = [
  { id: "tr-a", name: "A（メインホール）", sortOrder: 0 },
  { id: "tr-b", name: "B（小ホール）", sortOrder: 1 },
  { id: "tr-c", name: "C（ワークショップ室）", sortOrder: 2 },
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
    expect(blocks[0]!.colStart).toBe(0);
    expect(blocks[0]!.colSpan).toBe(2);
    expect(blocks[0]!.split).toBe(false);
    expect(blocks[0]!.trackNames).toEqual([TRACKS[0]!.name, TRACKS[1]!.name]);
  });

  it("全トラック共通は全列をまたぐ1つの帯になる", () => {
    const blocks = layout().blocks.filter((b) => b.entry.item.id === "it-open");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.common).toBe(true);
    expect(blocks[0]!.colStart).toBe(0);
    expect(blocks[0]!.colSpan).toBe(TRACKS.length);
  });

  it("枠の高さは所要時間に比例し、空き時間は行の隙間になる", () => {
    const { blocks } = layout();
    const open = blocks.find((b) => b.entry.item.id === "it-open")!;
    const panel = blocks.find((b) => b.entry.item.id === "it-panel")!;

    // 20分＝4マス、90分＝18マス（1マス5分）
    expect(open.rowEnd - open.rowStart).toBe(4);
    expect(panel.rowEnd - panel.rowStart).toBe(18);
    // 開会(10:00-10:20) の後ろに次の枠が来るので、行はぶつからない
    const a = blocks.find((b) => b.entry.item.id === "it-a")!;
    expect(a.rowStart).toBe(open.rowEnd);
  });

  it("離れたトラック（飛び地）は2つの枠に割れるが、どちらも消えない", () => {
    const blocks = layout().blocks.filter((b) => b.entry.item.id === "it-gap");

    expect(blocks.map((b) => [b.colStart, b.colSpan])).toEqual([
      [0, 1],
      [2, 1],
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
    expect(got.blocks[0]!.colSpan).toBe(TRACKS.length);
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
