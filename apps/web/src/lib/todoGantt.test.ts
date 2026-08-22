import { describe, it, expect } from "vitest";
import {
  TODO_GANTT_WINDOW_DAYS,
  addDays,
  diffDays,
  isDateOnly,
  todayDateOnly,
  type EventTodo,
  type EventTodoDep,
} from "@eventer/shared";
import {
  countTodos,
  dependencyLines,
  deriveTodos,
  layoutGantt,
} from "./todoGantt.js";

/**
 * 準備 TODO のガントと、待ち・遅れの導出 (#393 9.7)。
 *
 * 「待ち」も「遅れ」もサーバーは持たない。**依存先の状態と、見ている人の
 * 「今日」から毎回導出する**（列にすると、依存先を done にした瞬間・
 * 日付が変わった瞬間に更新して回る仕事が生まれ、漏れると古びる）。
 * だからここが唯一の定義であり、ここが唯一のテスト。
 */

const TODAY = "2026-09-10";

function todo(id: string, patch: Partial<EventTodo> = {}): EventTodo {
  return {
    id,
    title: id,
    note: null,
    startsOn: null,
    dueOn: null,
    status: "open",
    doneAt: null,
    assigneeState: "unassigned",
    assignee: null,
    sortOrder: 0,
    ...patch,
  };
}

const dep = (todoId: string, dependsOnId: string): EventTodoDep => ({
  todoId,
  dependsOnId,
});

describe("日付の計算 (packages/shared/dateOnly)", () => {
  it("実在しない日を弾く", () => {
    expect(isDateOnly("2026-09-01")).toBe(true);
    expect(isDateOnly("2026-02-31")).toBe(false);
    expect(isDateOnly("2026-13-01")).toBe(false);
    expect(isDateOnly("2026-9-1")).toBe(false);
    expect(isDateOnly("")).toBe(false);
  });

  it("月と年をまたぐ加減算", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    // 閏年（2028 は閏年、2026 は違う）
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(diffDays("2026-09-01", "2026-09-01")).toBe(0);
    expect(diffDays("2026-09-01", "2026-09-02")).toBe(1);
    expect(diffDays("2026-09-02", "2026-09-01")).toBe(-1);
  });

  it("「今日」はローカルの日付から作る（UTC ではない）", () => {
    // vitest.config.ts が TZ=Asia/Tokyo を固定している。
    // UTC の 9/1 15:00 は JST では 9/2。**epoch で持つとここが割れる**
    const at = new Date(Date.UTC(2026, 8, 1, 15, 0));
    expect(todayDateOnly(at)).toBe("2026-09-02");
  });
});

describe("待ち・遅れの導出 (#393 3.7)", () => {
  it("遅れの境目：今日ちょうどは遅れではない", () => {
    const d = deriveTodos(
      [
        todo("kyou", { dueOn: TODAY }),
        todo("kinou", { dueOn: addDays(TODAY, -1) }),
        todo("asu", { dueOn: addDays(TODAY, 1) }),
        todo("nashi"),
      ],
      [],
      TODAY,
    );
    expect(d.map((x) => x.overdue)).toEqual([false, true, false, false]);
  });

  it("完了したものは、期限を過ぎていても遅れに数えない", () => {
    const d = deriveTodos(
      [todo("done", { dueOn: "2020-01-01", status: "done" })],
      [],
      TODAY,
    );
    expect(d[0]!.overdue).toBe(false);
    expect(countTodos(d)).toEqual({ open: 0, overdue: 0, blocked: 0, done: 1 });
  });

  it("依存先が1つでも done でなければ待ち。全部 done なら待ちでない", () => {
    const todos = [
      todo("A"),
      todo("B", { status: "done" }),
      todo("C", { status: "done" }),
    ];
    const half = deriveTodos(todos, [dep("A", "B"), dep("A", "C")], TODAY);
    expect(half[0]!.blocked).toBe(false); // B も C も done

    const one = deriveTodos(
      [todo("A"), todo("B"), todo("C", { status: "done" })],
      [dep("A", "B"), dep("A", "C")],
      TODAY,
    );
    expect(one[0]!.blocked).toBe(true);
  });

  it("完了した項目は待ちにならない", () => {
    const d = deriveTodos(
      [todo("A", { status: "done" }), todo("B")],
      [dep("A", "B")],
      TODAY,
    );
    expect(d[0]!.blocked).toBe(false);
  });

  it("集計は「未完了 / 遅れ / 待ち / 完了」", () => {
    const d = deriveTodos(
      [
        todo("okure", { dueOn: "2020-01-01" }),
        todo("machi"),
        todo("saki"),
        todo("owari", { status: "done" }),
      ],
      [dep("machi", "saki")],
      TODAY,
    );
    expect(countTodos(d)).toEqual({ open: 3, overdue: 1, blocked: 1, done: 1 });
  });

  it("一覧に無い id を指す辺は捨てる", () => {
    const d = deriveTodos([todo("A")], [dep("A", "kieta")], TODAY);
    expect(d[0]!.blocked).toBe(false);
    expect(d[0]!.dependsOn).toEqual([]);
  });
});

describe("循環に印を付ける（黙って隠さない） (#393 3.4)", () => {
  it("循環に含まれる項目だけに印が付き、走査は必ず終わる", () => {
    // A→B→A の輪と、その輪を待つだけの C（C は循環に「含まれて」いない）
    const d = deriveTodos(
      [todo("A"), todo("B"), todo("C"), todo("D")],
      [dep("A", "B"), dep("B", "A"), dep("C", "B")],
      TODAY,
    );
    const byId = new Map(d.map((x) => [x.todo.id, x]));
    expect(byId.get("A")!.inCycle).toBe(true);
    expect(byId.get("B")!.inCycle).toBe(true);
    // 循環の**下流**は循環そのものではない（巻き込むと印の意味が薄まる）
    expect(byId.get("C")!.inCycle).toBe(false);
    expect(byId.get("D")!.inCycle).toBe(false);
  });

  it("長い輪でも戻ってくる（深さで再帰する実装はここで止まらない）", () => {
    const n = 300; // EVENT_TODO_LIMIT と同じ規模
    const todos = Array.from({ length: n }, (_, i) => todo(`t${i}`));
    const deps = Array.from({ length: n }, (_, i) =>
      dep(`t${i}`, `t${(i + 1) % n}`),
    );
    const started = Date.now();
    const d = deriveTodos(todos, deps, TODAY);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(d.every((x) => x.inCycle)).toBe(true);
  });

  it("循環が無ければ誰にも印は付かない（絞りすぎていない）", () => {
    const d = deriveTodos(
      [todo("A"), todo("B"), todo("C"), todo("D")],
      // 分岐と合流。循環ではない
      [dep("A", "B"), dep("A", "C"), dep("B", "D"), dep("C", "D")],
      TODAY,
    );
    expect(d.some((x) => x.inCycle)).toBe(false);
  });
});

describe("ガントの配置 (#393 8.3)", () => {
  const derive = (todos: EventTodo[], deps: EventTodoDep[] = []) =>
    deriveTodos(todos, deps, TODAY);

  it("日付を持たない項目は帯にならない", () => {
    const l = layoutGantt(derive([todo("A"), todo("B")]), TODAY);
    expect(l.days).toBe(0);
    expect(l.bars).toEqual([]);
    expect(l.outsideIds).toEqual([]);
  });

  it("片方だけの項目は1日ぶんの帯になる", () => {
    const l = layoutGantt(
      derive([
        todo("due", { dueOn: "2026-09-10" }),
        todo("start", { startsOn: "2026-09-12" }),
        todo("range", { startsOn: "2026-09-10", dueOn: "2026-09-14" }),
      ]),
      TODAY,
    );
    const bar = new Map(l.bars.map((b) => [b.todoId, b]));
    expect(bar.get("due")!.span).toBe(1);
    expect(bar.get("start")!.span).toBe(1);
    expect(bar.get("range")!.span).toBe(5);
    expect(l.from).toBe("2026-09-10");
    expect(bar.get("start")!.startCol).toBe(2);
    // 行 index は一覧の並びと同じ（並べ替えない）
    expect(bar.get("due")!.rowIndex).toBe(0);
    expect(bar.get("range")!.rowIndex).toBe(2);
  });

  it("年を打ち間違えた1件で列数が爆発せず、その項目だけが窓から落ちる", () => {
    // `timetableLayout.ts` が7日窓を入れているのと同じ問題。
    // 「最も早い項目を基準」にすると、この1件で全部が窓の外へ出る
    const l = layoutGantt(
      derive([
        todo("typo", { startsOn: "2016-09-01", dueOn: "2016-09-02" }),
        todo("A", { startsOn: "2026-09-01", dueOn: "2026-09-03" }),
        todo("B", { startsOn: "2026-09-05", dueOn: "2026-09-08" }),
        todo("C", { startsOn: "2026-09-09", dueOn: "2026-09-12" }),
      ]),
      TODAY,
    );
    expect(l.days).toBeLessThanOrEqual(TODO_GANTT_WINDOW_DAYS);
    expect(l.outsideIds).toEqual(["typo"]);
    expect(l.bars.map((b) => b.todoId)).toEqual(["A", "B", "C"]);
    expect(l.from).toBe("2026-09-01");
  });

  it("窓より長い項目が1件だけでもページが落ちない（150日のスポンサー募集）", () => {
    // 窓の候補は「窓に**丸ごと**収まる件数」で選ぶので、日付を持つ項目の
    // すべてが窓より長いと、どの候補でも件数0のまま進んで落ちる形だった。
    // 最初の1件めがこれだと**一覧ごと描けなくなり、消して復旧もできない**
    const l = layoutGantt(
      derive([
        todo("スポンサー募集", { startsOn: "2026-09-01", dueOn: "2027-01-29" }),
      ]),
      TODAY,
    );
    expect(l.days).toBeLessThanOrEqual(TODO_GANTT_WINDOW_DAYS);
    expect(l.bars).toHaveLength(1);
    // 帯は窓の端で切って描く（一覧に落とすと、唯一の項目なのにガントが空になる）
    expect(l.bars[0]!.startCol).toBe(0);
    expect(l.bars[0]!.span).toBe(TODO_GANTT_WINDOW_DAYS);
    expect(l.clippedIds).toEqual(["スポンサー募集"]);
    expect(l.outsideIds).toEqual([]);
  });

  it("全項目が窓超えでも落ちず、窓に触れない項目は一覧へ落ちる", () => {
    const l = layoutGantt(
      derive([
        todo("長い仕事A", { startsOn: "2026-09-01", dueOn: "2027-03-01" }),
        todo("長い仕事B", { startsOn: "2026-10-01", dueOn: "2027-04-01" }),
        // 窓（最も早い開始日から120日）に1日も触れない
        todo("遠い長い仕事", { startsOn: "2027-06-01", dueOn: "2027-12-31" }),
      ]),
      TODAY,
    );
    expect(l.days).toBeLessThanOrEqual(TODO_GANTT_WINDOW_DAYS);
    expect(l.bars.map((b) => b.todoId)).toEqual(["長い仕事A", "長い仕事B"]);
    expect(l.clippedIds).toEqual(["長い仕事A", "長い仕事B"]);
    expect(l.outsideIds).toEqual(["遠い長い仕事"]);
    // B の帯は自分の開始日から窓の端まで
    const b = l.bars.find((x) => x.todoId === "長い仕事B")!;
    expect(b.startCol).toBe(30); // 9/1 から 10/1 は30日後
    expect(b.startCol + b.span).toBeLessThanOrEqual(l.days);
  });

  it("窓に収まる項目が1件でもあれば、切らずに従来どおり選ぶ", () => {
    const l = layoutGantt(
      derive([
        todo("長い仕事", { startsOn: "2026-09-01", dueOn: "2027-03-01" }),
        todo("普通の仕事", { startsOn: "2026-09-10", dueOn: "2026-09-20" }),
      ]),
      TODAY,
    );
    expect(l.bars.map((b) => b.todoId)).toEqual(["普通の仕事"]);
    expect(l.clippedIds).toEqual([]);
    expect(l.outsideIds).toEqual(["長い仕事"]);
  });

  it("窓は最も多くの項目が収まるところに置く（1件のために多数を落とさない）", () => {
    const far = addDays("2026-09-01", TODO_GANTT_WINDOW_DAYS + 30);
    const l = layoutGantt(
      derive([
        todo("far", { startsOn: far, dueOn: far }),
        todo("A", { startsOn: "2026-09-01", dueOn: "2026-09-02" }),
        todo("B", { startsOn: "2026-09-03", dueOn: "2026-09-04" }),
        todo("C", { startsOn: "2026-09-05", dueOn: "2026-09-06" }),
      ]),
      TODAY,
    );
    expect(l.outsideIds).toEqual(["far"]);
    expect(l.bars).toHaveLength(3);
  });

  it("今日の縦線・週末の網掛け・月の目盛り", () => {
    const l = layoutGantt(
      derive([todo("A", { startsOn: "2026-09-10", dueOn: "2026-09-14" })]),
      TODAY,
    );
    expect(l.todayCol).toBe(0);
    expect(l.columns[0]!.isToday).toBe(true);
    expect(l.columns[0]!.date).toBe("2026-09-10");
    // 2026-09-12 は土曜、13 は日曜
    expect(l.columns.map((c) => c.isWeekend)).toEqual([
      false,
      false,
      true,
      true,
      false,
    ]);
    expect(l.columns[0]!.monthStart).toBe(9);
    expect(l.columns[1]!.monthStart).toBeNull();
    // 2026-09-10〜14 に祝日は無い
    expect(l.columns.every((c) => c.holiday === null)).toBe(true);
  });

  it("祝日の列に祝日名が付く（元日。前後の日にずれない） (#401)", () => {
    // 2026-01-01（元日）は木曜。前後の平日は null のまま＝
    // Date 変換のタイムゾーンずれで隣の日が祝日にならないことの確認
    const l = layoutGantt(
      derive([todo("A", { startsOn: "2025-12-31", dueOn: "2026-01-02" })]),
      "2025-12-31",
    );
    expect(l.columns.map((c) => c.date)).toEqual([
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
    // 祝日名は japanese-holidays の日本語のまま（訳さない）
    expect(l.columns.map((c) => c.holiday)).toEqual([null, "元日", null]);
    // 平日の祝日。isWeekend とは独立に立つ
    expect(l.columns[1]!.isWeekend).toBe(false);
  });

  it("振替休日も祝日として扱う (#401)", () => {
    // 2026-05-03（憲法記念日）は日曜 → 5/6(水) が振替休日
    const l = layoutGantt(
      derive([todo("A", { startsOn: "2026-05-06", dueOn: "2026-05-07" })]),
      "2026-05-06",
    );
    expect(l.columns.map((c) => [c.date, c.holiday])).toEqual([
      ["2026-05-06", "振替休日"],
      ["2026-05-07", null],
    ]);
  });

  it("今日が予定の外でも、窓に収まるなら線を出す", () => {
    const l = layoutGantt(
      derive([todo("A", { startsOn: "2026-09-20", dueOn: "2026-09-22" })]),
      TODAY,
    );
    expect(l.from).toBe(TODAY);
    expect(l.todayCol).toBe(0);
    expect(l.days).toBe(13);
  });

  it("今日が窓から遠すぎるときは線を出さない（列数を守る）", () => {
    const far = addDays(TODAY, TODO_GANTT_WINDOW_DAYS + 10);
    const l = layoutGantt(
      derive([todo("A", { startsOn: far, dueOn: far })]),
      TODAY,
    );
    expect(l.todayCol).toBeNull();
    expect(l.days).toBe(1);
  });

  it("窓が広いほど1日の列は細くなる（規則は1つ）", () => {
    const short = layoutGantt(
      derive([todo("A", { startsOn: "2026-09-10", dueOn: "2026-09-12" })]),
      TODAY,
    );
    const long = layoutGantt(
      derive([
        todo("A", { startsOn: "2026-09-10", dueOn: addDays("2026-09-10", 100) }),
      ]),
      TODAY,
    );
    expect(short.dayPx).toBeGreaterThan(long.dayPx);
    expect(long.days * long.dayPx).toBeLessThan(2000);
  });
});

describe("依存の線は選んだときだけ (#393 8.3 案D3)", () => {
  const todos = [
    todo("A", { startsOn: "2026-09-01", dueOn: "2026-09-03" }),
    todo("B", { startsOn: "2026-09-05", dueOn: "2026-09-07" }),
    todo("C", { startsOn: "2026-09-09", dueOn: "2026-09-10" }),
  ];
  const deps = [dep("B", "A"), dep("C", "B")];
  const derived = deriveTodos(todos, deps, TODAY);
  const layout = layoutGantt(derived, TODAY);

  it("何も選んでいなければ線は0本（常時描かない）", () => {
    expect(dependencyLines(layout, derived, null)).toEqual([]);
  });

  it("選んだ項目の前後だけが線になる", () => {
    const lines = dependencyLines(layout, derived, "B");
    expect(lines.map((l) => l.key).sort()).toEqual(["A->B", "B->C"]);
  });

  it("線の端が帯の端に一致する", () => {
    const [line] = dependencyLines(layout, derived, "B");
    const bar = new Map(layout.bars.map((b) => [b.todoId, b]));
    const a = bar.get("A")!;
    const b = bar.get("B")!;
    // 始点は A の帯の右端、終点は B の帯の左端
    expect(line!.points[0]![0]).toBe((a.startCol + a.span) * layout.dayPx);
    expect(line!.points[3]![0]).toBe(b.startCol * layout.dayPx);
    // 高さは行の中央
    expect(line!.points[0]![1]).toBeLessThan(line!.points[3]![1]);
  });

  it("帯を持たない相手には線を引かない（窓の外・日付なし）", () => {
    const noDate = [todo("A", { startsOn: "2026-09-01", dueOn: "2026-09-03" }), todo("Z")];
    const d = deriveTodos(noDate, [dep("Z", "A")], TODAY);
    const l = layoutGantt(d, TODAY);
    expect(dependencyLines(l, d, "Z")).toEqual([]);
  });
});
