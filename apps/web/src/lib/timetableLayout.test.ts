import { describe, expect, it } from "vitest";
import type { EventTrack, ScheduleItem } from "@eventer/shared";
import {
  buildTimetableLayout,
  entriesForTrack,
  nowRow,
  timeState,
  type TimetableCard,
  type TimetableLayout,
} from "./timetableLayout.js";

/**
 * マルチトラックのタイムテーブルの下敷き (#338)。
 *
 * 「どの行からどの行までか・本筋か細い列か・何番目に並ぶか」を決めるのはここ1か所で、
 * 広い画面のタイムラインもスマホのタブもこの結果を使う。描画に頼らず直接確かめる。
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

const cardOf = (got: TimetableLayout, id: string): TimetableCard =>
  got.cards.find((c) => c.entry.item.id === id)!;
const idsOf = (got: TimetableLayout) => got.cards.map((c) => c.entry.item.id).sort();

describe("buildTimetableLayout (#338)", () => {
  it("1つのコマは、トラックをまたいでも飛び地でも1枚のカード（場所の札で全部のトラックを示す）", () => {
    const got = layout();

    expect(got.cards.filter((c) => c.entry.item.id === "it-panel")).toHaveLength(1);
    expect(cardOf(got, "it-panel").trackIndexes).toEqual([0, 1]);
    expect(got.cards.filter((c) => c.entry.item.id === "it-gap")).toHaveLength(1);
    expect(cardOf(got, "it-gap").trackIndexes).toEqual([0, 2]);
  });

  it("全トラック共通は場所の札が付かない共通のカード", () => {
    const open = cardOf(layout(), "it-open");

    expect(open.common).toBe(true);
    expect(open.trackIndexes).toEqual([]);
  });

  it("行はコマの始まる時刻だけで、昇順・重複なし（時間の長さには比例しない）", () => {
    const got = layout();
    const open = cardOf(got, "it-open");
    const a = cardOf(got, "it-a");

    expect(got.rows).toEqual([...new Set(got.rows)].sort((x, y) => x - y));
    // 開会(10:00-10:20) の次の行が、その後に始まるコマ
    expect(got.rows[open.rowStart - 1]).toBe(START);
    expect(a.rowStart).toBe(open.rowStart + 1);
  });

  it("未割り当ては置かず、別枠で持つ", () => {
    const { cards, entries, unassigned } = layout();

    expect(cards.some((c) => c.entry.item.id === "it-idea")).toBe(false);
    expect(entries.some((e) => e.item.id === "it-idea")).toBe(false);
    expect(unassigned.map((i) => i.id)).toEqual(["it-idea"]);
  });

  it("日程調整中（開始時刻が未定）でも壊れず、時刻未定として並ぶ", () => {
    const got = buildTimetableLayout(ITEMS, TRACKS, null);

    expect(got.cards).toEqual([]);
    expect(got.rows).toEqual([]);
    // 未割り当てを除く全部が「時刻未定」に落ちる（消えない）
    expect(got.undated.map((e) => e.item.id)).toEqual([
      "it-open",
      "it-a",
      "it-b",
      "it-panel",
      "it-gap",
    ]);
  });

  it("3日間のイベントでも、どの日のコマも1つ残らず載る (#346)", () => {
    const days = [
      new Date("2026-08-11T09:00:00+09:00").getTime(),
      new Date("2026-08-12T09:00:00+09:00").getTime(),
      new Date("2026-08-13T09:00:00+09:00").getTime(),
    ];
    const items = days.flatMap((startsAt, d) => [
      item({ id: `d${d}-open`, title: `${d + 1}日目 開会`, startsAt }),
      item({ id: `d${d}-a`, title: `${d + 1}日目 A`, placement: "tracks", trackIds: ["tr-a"] }),
      item({ id: `d${d}-b`, title: `${d + 1}日目 B`, placement: "tracks", trackIds: ["tr-b"] }),
    ]);
    const got = buildTimetableLayout(items, TRACKS, days[0]!);

    expect(got.outOfRange).toEqual([]);
    expect(got.undated).toEqual([]);
    expect(idsOf(got)).toEqual(items.map((i) => i.id).sort());
  });

  it("6日間の合宿は全部載り、月を打ち間違えた1件だけが落ちる (#346)", () => {
    const first = new Date("2026-08-11T09:00:00+09:00").getTime();
    const items = [
      ...[0, 1, 2, 3, 4, 5].map((d) =>
        item({ id: `d${d}`, title: `${d + 1}日目`, startsAt: first + d * 24 * 60 * 60_000, placement: "tracks", trackIds: ["tr-a"] }),
      ),
      item({
        id: "it-typo",
        title: "日を打ち間違い",
        startsAt: new Date("2026-09-11T09:00:00+09:00").getTime(),
        placement: "tracks",
        trackIds: ["tr-b"],
      }),
    ];
    const got = buildTimetableLayout(items, TRACKS, first);

    expect(got.outOfRange.map((e) => e.item.id)).toEqual(["it-typo"]);
    expect(idsOf(got)).toEqual(["d0", "d1", "d2", "d3", "d4", "d5"]);
  });

  it("10日ずれた打ち間違いは、月をまたがなくても弾かれる (#346)", () => {
    const first = new Date("2026-08-11T09:00:00+09:00").getTime();
    const items = [
      ...[0, 1, 2].map((d) =>
        item({ id: `d${d}`, title: `${d + 1}日目`, startsAt: first + d * 24 * 60 * 60_000, placement: "tracks", trackIds: ["tr-a"] }),
      ),
      item({ id: "it-typo", title: "日を打ち間違い", startsAt: first + 10 * 24 * 60 * 60_000, placement: "tracks", trackIds: ["tr-b"] }),
    ];
    const got = buildTimetableLayout(items, TRACKS, first);

    expect(got.outOfRange.map((e) => e.item.id)).toEqual(["it-typo"]);
    expect(idsOf(got)).toEqual(["d0", "d1", "d2"]);
  });

  it("開始時刻の打ち間違いで行が膨らまず、外れた1件だけが落ちる", () => {
    // 年を1桁打ち間違えた1件
    const typo = item({ id: "it-typo", title: "打ち間違い", startsAt: new Date("2126-08-11T10:00:00+09:00").getTime(), placement: "tracks", trackIds: ["tr-b"] });
    const got = buildTimetableLayout([...ITEMS, typo], TRACKS, START);

    expect(got.outOfRange.map((e) => e.item.id)).toEqual(["it-typo"]);
    expect(got.undated).toEqual([]);
    expect(idsOf(got)).toEqual(["it-a", "it-b", "it-gap", "it-open", "it-panel"]);
    expect(got.rows.length).toBeLessThan(10);
  });

  it("打ち間違いが過去側でも、正しいコマの方を残す", () => {
    // 最も早いコマを基準にすると、正しいコマが全部範囲外に落ちてしまう
    const typo = item({ id: "it-typo", title: "打ち間違い", startsAt: new Date("1926-08-11T10:00:00+09:00").getTime(), placement: "tracks", trackIds: ["tr-b"] });
    const got = buildTimetableLayout([typo, ...ITEMS], TRACKS, START);

    expect(got.outOfRange.map((e) => e.item.id)).toContain("it-typo");
    expect(got.cards.some((c) => c.entry.item.id === "it-open")).toBe(true);
  });

  it("トラックが1本も無いイベントでも壊れない", () => {
    const got = buildTimetableLayout(ITEMS, [], START);

    expect(got.cards).toEqual([]);
    expect(got.entries.every((e) => e.common)).toBe(true);
  });

  it("消えたトラックだけに載っていたコマは全トラック共通として扱う", () => {
    const orphan = item({ id: "it-orphan", placement: "tracks", trackIds: ["tr-zzz"] });
    const got = buildTimetableLayout([orphan], TRACKS, START);

    expect(got.cards).toHaveLength(1);
    expect(got.cards[0]!.common).toBe(true);
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

/**
 * Nostrasia 2026 の実際のタイムテーブル（本番のデータを写したもの）。
 * オーナー 2026-11-27「メイントラックのコンテンツは灰色になってるし、それぞれが詰まりすぎてて見づらい」
 * 「nostrasia.com のタイムテーブルを参考に」「縦書きはスマホ向けだよ」。並行して長く続く企画は
 * 右の並行の列（本筋と同じ幅・横書き）、本筋の登壇は空いている列のぶんまで広がる、行は始まる時刻だけ。
 */
describe("Nostrasia 2026 のタイムライン", () => {
  const at = (h: number, m: number) =>
    new Date(`2026-11-29T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+09:00`).getTime();
  const NOSTRASIA_TRACKS: EventTrack[] = [
    { id: "main", name: "メイン", sortOrder: 0, visibility: "public" },
    { id: "l1", name: "Lounge 1", sortOrder: 1, visibility: "public" },
    { id: "l2", name: "Lounge 2", sortOrder: 2, visibility: "public" },
    { id: "l3", name: "Lounge 3", sortOrder: 3, visibility: "public" },
  ];
  const row = (id: string, title: string, durationMin: number, startsAt: number | null, trackIds: string[] = []) =>
    item({
      id,
      title,
      durationMin,
      startsAt,
      placement: trackIds.length ? "tracks" : "all",
      trackIds,
    });
  // 本番の並び（sort_order 順）・所要時間・開始時刻・トラック。null は前のコマから続く
  const NOSTRASIA: ScheduleItem[] = [
    row("open", "開場", 30, at(12, 30)),
    row("hello", "開始あいさつ", 5, null),
    row("s1", "Nostrの可能性", 10, null),
    row("s2", "AI時代のNostrアプリの作り方", 10, null),
    row("flea-intro", "フリーマーケットの紹介", 5, at(13, 25)),
    row("s3", "MY FAVORITE NOSTR CLIENTS 2026", 15, at(13, 30)),
    row("s4", "Nostrで動くオープンソースのメッセージアプリ", 10, null),
    row("flea", "フリーマーケット", 270, at(13, 30), ["l3"]),
    row("games", "ボードゲーム", 240, at(14, 0), ["l1"]),
    row("hangout", "交流スペース", 240, at(14, 0), ["main"]),
    row("zap1", "じゃんけんzapタイム1", 10, at(15, 0)),
    row("lt1", "高機能Nostrクライアントと最適化とAIの話", 5, at(16, 0), ["main"]),
    row("lt2", "Nostrを小さくしよう", 5, at(16, 5), ["main"]),
    row("zap2", "じゃんけんzapタイム2", 10, at(17, 0)),
    row("magic", "マジックショー", 60, at(18, 0)),
    row("hangout2", "交流タイム", 60, null, ["main"]),
    row("ranking", "出会いランキンググッズプレゼント", 10, at(19, 30)),
    row("bye", "締めのあいさつ", 5, at(19, 55)),
  ].map((it, i) => ({ ...it, sortOrder: i }));
  const got = () => buildTimetableLayout(NOSTRASIA, NOSTRASIA_TRACKS, at(12, 30));

  it("フリーマーケット・ボードゲーム・交流スペース・交流タイムは右の並行の列、登壇は本筋", () => {
    const g = got();
    const side = g.cards.filter((c) => c.side).map((c) => c.entry.item.id).sort();

    expect(side).toEqual(["flea", "games", "hangout", "hangout2"].sort());
    for (const id of ["hello", "s1", "s2", "s3", "s4", "zap1", "lt1", "lt2", "zap2", "magic", "ranking", "bye"]) {
      expect(cardOf(g, id).side).toBe(false);
    }
    // 並行の列どうしは重ならない（同じ番号の列で行が重なっていない）
    const sides = g.cards.filter((c) => c.side);
    for (const a of sides)
      for (const b of sides)
        if (a !== b && a.lane === b.lane) expect(a.rowEnd <= b.rowStart || b.rowEnd <= a.rowStart).toBe(true);
  });

  it("行はコマの始まる時刻の順で、短い登壇もそれぞれ自分の行を持つ", () => {
    const g = got();
    const starts = [...new Set(NOSTRASIA.map((it) => it.id).map((id) => cardOf(g, id).startsAt))].sort((a, b) => a - b);

    expect(g.rows).toEqual(starts);
    for (let i = 1; i < g.rows.length; i++) expect(g.rows[i]!).toBeGreaterThan(g.rows[i - 1]!);
    // 13:00〜13:15 の3つの登壇は別々の行
    const rowsOf = ["hello", "s1", "s2"].map((id) => cardOf(g, id).rowStart);
    expect(new Set(rowsOf).size).toBe(3);
  });

  it("nostrasia.com の広い画面と同じ並べ方: 列は本筋＋並行の列。フリマは右端、ボードゲームはその左。本筋の幅は 全部→2→1→全部", () => {
    const g = got();
    const lanes = 1 + g.sideLanes;
    // 本筋のカードが占める列の数（本筋の列 1 ＋ 広がった並行の列）
    const span = (id: string) => 1 + cardOf(g, id).extendSide;

    // フリーマーケット（いちばん早く始まる長い企画）が右端（lane 0）、同時刻に始まる交流スペース・ボードゲームはその左
    expect(cardOf(g, "flea").lane).toBe(0);
    expect(cardOf(g, "games").lane).toBeGreaterThan(0);
    expect(cardOf(g, "hangout").lane).toBeGreaterThan(0);
    // 開場〜13:25 は長い企画の前なので全部の列
    for (const id of ["open", "hello", "s1", "s2", "flea-intro"]) expect(span(id)).toBe(lanes);
    // 13:30〜13:45 はフリマの最中。本筋はフリマの左まで
    for (const id of ["s3", "s4"]) expect(span(id)).toBe(lanes - 1);
    // 15:00〜17:00 はフリマ・交流スペース・ボードゲームの最中。本筋は1列
    for (const id of ["zap1", "lt1", "lt2", "zap2"]) expect(span(id)).toBe(1);
    // 18:00 のマジックショーは長い企画が終わったあと。また全部の列
    expect(span("magic")).toBe(lanes);
  });

  it("登壇は、その時間に空いている並行の列のぶんまで広がる（並行の列と重ならない）", () => {
    const g = got();
    // 13:00 の時点ではまだ長い企画が始まっていないので、並行の列ぜんぶに広がる
    expect(cardOf(g, "hello").extendSide).toBe(g.sideLanes);
    // 本筋のカードが広がった並行の列（番号の大きい側から extendSide 本）は、その行で空いている
    for (const c of g.cards.filter((x) => !x.side)) {
      const used = new Set(Array.from({ length: c.extendSide }, (_v, k) => g.sideLanes - 1 - k));
      const clash = g.cards.some(
        (s) => s.side && used.has(s.lane) && s.rowStart < c.rowEnd && c.rowStart < s.rowEnd,
      );
      expect(clash).toBe(false);
    }
  });

  it("全トラック共通のコマは共通のカード（色は描画側でテーマの主色。灰色にしない）", () => {
    const g = got();

    expect(cardOf(g, "magic").common).toBe(true);
    expect(cardOf(g, "magic").trackIndexes).toEqual([]);
    expect(cardOf(g, "lt1").common).toBe(false);
    expect(cardOf(g, "lt1").trackIndexes).toEqual([0]);
  });
});

describe("重なりと時刻の状態", () => {
  const at = (h: number, m: number) =>
    new Date(`2026-08-11T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+09:00`).getTime();

  it("同じ時刻に始まって重なる本筋のコマは、横に並べて両方見える (#345)", () => {
    const items = [
      item({ id: "it-x", title: "セッションX", startsAt: at(14, 0), durationMin: 20, placement: "tracks", trackIds: ["tr-a"] }),
      item({ id: "it-y", title: "セッションY", startsAt: at(14, 0), durationMin: 20, placement: "tracks", trackIds: ["tr-a"] }),
    ];
    const got = buildTimetableLayout(items, TRACKS, at(14, 0));
    const x = cardOf(got, "it-x");
    const y = cardOf(got, "it-y");

    expect([x.laneCount, y.laneCount]).toEqual([2, 2]);
    expect(x.lane).not.toBe(y.lane);
  });

  it("過去・開催中・これからを、開始と終わりの時刻で決める", () => {
    const card = { startsAt: at(14, 0), endsAt: at(14, 30) };

    expect(timeState(card, at(13, 59))).toBe("future");
    expect(timeState(card, at(14, 0))).toBe("live");
    expect(timeState(card, at(14, 29))).toBe("live");
    expect(timeState(card, at(14, 30))).toBe("past");
    // 0分のコマも、始まって1分は開催中
    expect(timeState({ startsAt: at(14, 0), endsAt: at(14, 0) }, at(14, 0))).toBe("live");
  });

  it("「いま」の印は、コマのある時間の中だけで、次に始まる行の上に出る", () => {
    const items = [
      item({ id: "it-a", title: "A", startsAt: at(14, 0), durationMin: 60, placement: "tracks", trackIds: ["tr-a"] }),
      item({ id: "it-b", title: "B", startsAt: at(15, 0), durationMin: 60, placement: "tracks", trackIds: ["tr-a"] }),
    ];
    const got = buildTimetableLayout(items, TRACKS, at(14, 0));

    expect(nowRow(got, at(13, 59))).toBeNull();
    expect(nowRow(got, at(16, 1))).toBeNull();
    // 14:30 は B（2行目）の上
    expect(nowRow(got, at(14, 30))).toBe(2);
    // 15:30 は最後の行の最中。末尾の下
    expect(nowRow(got, at(15, 30))).toBe(3);
  });
});
