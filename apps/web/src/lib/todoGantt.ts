import {
  TODO_GANTT_WINDOW_DAYS,
  addDays,
  dayOfWeek,
  diffDays,
  type EventTodo,
  type EventTodoDep,
} from "@eventer/shared";

/**
 * 準備 TODO のガント (#393)。**純関数だけ。DOM を測らない。**
 *
 * 列幅と行高を定数にすれば、帯の位置も依存の線の座標も入力だけから決まる。
 * `ResizeObserver` も ref も要らず、そのまま単体テストできる
 * （`timetableLayout.ts` (#338) と同じ型）。
 *
 * 「待ち」と「遅れ」もここで導出する。**サーバーは列として持たない** (設計 3.7)。
 * 遅れの判定は**見ている人の「今日」**で行うので、`today` は必ず引数で受ける
 * （サーバーで判定すると、サーバーのタイムゾーンを1つ決めることになる）。
 */

/* ── 見た目の定数（layout が座標を決めるのに使う） ──────────── */

/** 行の高さ(px)。一覧の行と対応させるための唯一の値 */
export const TODO_ROW_PX = 34;
/** 見出し列（題名）の幅(px)。sticky で左に貼り付く */
export const TODO_LABEL_PX = 200;

/**
 * 1日あたりの列幅(px)。**窓の広さから決める**。
 * 短い窓なら日付が読める広い列、長い窓なら細い列＋週・月の目盛りだけ。
 * 規則が2つになるわけではなく、1つの関数が窓の広さを受けて返す。
 */
export function dayColPx(span: number): number {
  if (span <= 21) return 40;
  if (span <= 60) return 18;
  return 9;
}

/* ── 導出（待ち・遅れ・循環） ─────────────────────────── */

export interface TodoDerived {
  todo: EventTodo;
  /** 待ち。`open` かつ**依存先に `done` でないものがある**。
   * 依存は1種類しかないので述語も1つで済む（設計 3.3） */
  blocked: boolean;
  /** 遅れ。`open` かつ `dueOn < today`。
   * **期限が今日ちょうどは遅れではない。`done` は期限を過ぎていても遅れではない** */
  overdue: boolean;
  /** 依存の循環に含まれる。サーバーが書き込みで弾いているので普通は出ないが、
   * **壊れていることを黙って隠さない**ための印 (設計 3.4) */
  inCycle: boolean;
  /** この項目が待っている項目の id */
  dependsOn: string[];
  /** この項目を待っている項目の id */
  blocking: string[];
}

/**
 * 依存の循環に含まれる id を返す。
 *
 * 前後2方向から Kahn の手順で「順序が付く項目」を削っていき、**両方に残った**
 * ものが循環に含まれる項目。前向きだけだと循環の**下流**（自分は循環していないが
 * 永久に待たされる項目）まで巻き込む。
 *
 * **必ず終わる。** 訪問済み（= `removed`）を持ち、どの項目もキューに入るのは
 * 高々1回なので、辺がどう繋がっていても反復回数は項目数で頭打ちになる。
 * 深さを持って再帰する形にすると循環データで戻ってこないので、その形にしない。
 */
function cycleMembers(
  ids: string[],
  edges: Array<[from: string, to: string]>,
): Set<string> {
  const peel = (out: Map<string, string[]>, degree: Map<string, number>): Set<string> => {
    const removed = new Set<string>();
    const queue = ids.filter((id) => (degree.get(id) ?? 0) === 0);
    for (const id of queue) removed.add(id);
    for (let i = 0; i < queue.length; i++) {
      for (const next of out.get(queue[i]!) ?? []) {
        const left = (degree.get(next) ?? 0) - 1;
        degree.set(next, left);
        if (left === 0 && !removed.has(next)) {
          removed.add(next);
          queue.push(next);
        }
      }
    }
    return removed;
  };

  /** 向き `a → b` の隣接表と、入次数 */
  const build = (
    pairs: Array<[string, string]>,
  ): [Map<string, string[]>, Map<string, number>] => {
    const out = new Map<string, string[]>();
    const degree = new Map<string, number>(ids.map((id) => [id, 0]));
    for (const [a, b] of pairs) {
      if (!degree.has(a) || !degree.has(b)) continue;
      const list = out.get(b);
      if (list) list.push(a);
      else out.set(b, [a]);
      degree.set(a, (degree.get(a) ?? 0) + 1);
    }
    return [out, degree];
  };

  // 前向き: 「依存先がもう無い」ものから剥がす
  const [outF, degF] = build(edges);
  const forward = peel(outF, degF);
  // 後ろ向き: 「自分を待っている人がもう居ない」ものから剥がす
  const [outB, degB] = build(edges.map(([a, b]) => [b, a] as [string, string]));
  const backward = peel(outB, degB);

  const cyclic = new Set<string>();
  for (const id of ids) {
    if (!forward.has(id) && !backward.has(id)) cyclic.add(id);
  }
  return cyclic;
}

/** 一覧の並び（`sortOrder`）のまま、待ち・遅れ・循環を付ける。
 * **並べ替えない**（日付順や依存の順に並べ替えると、依存を1本足しただけで
 * 行が動き、一覧とガントで順序が食い違う） */
export function deriveTodos(
  todos: EventTodo[],
  deps: EventTodoDep[],
  today: string,
): TodoDerived[] {
  const byId = new Map(todos.map((t) => [t.id, t]));
  const dependsOn = new Map<string, string[]>();
  const blocking = new Map<string, string[]>();
  const edges: Array<[string, string]> = [];
  const push = (m: Map<string, string[]>, key: string, value: string): void => {
    const list = m.get(key);
    if (list) list.push(value);
    else m.set(key, [value]);
  };
  for (const d of deps) {
    // 一覧に無い id を指す辺は捨てる（消した項目の辺が残っていても壊れない）
    if (!byId.has(d.todoId) || !byId.has(d.dependsOnId)) continue;
    edges.push([d.todoId, d.dependsOnId]);
    push(dependsOn, d.todoId, d.dependsOnId);
    push(blocking, d.dependsOnId, d.todoId);
  }
  const cyclic = cycleMembers(
    todos.map((t) => t.id),
    edges,
  );
  return todos.map((todo) => {
    const on = dependsOn.get(todo.id) ?? [];
    return {
      todo,
      blocked:
        todo.status === "open" &&
        on.some((id) => byId.get(id)?.status !== "done"),
      overdue:
        todo.status === "open" && todo.dueOn !== null && todo.dueOn < today,
      inCycle: cyclic.has(todo.id),
      dependsOn: on,
      blocking: blocking.get(todo.id) ?? [],
    };
  });
}

/** 「進み具合」。要件4はこの4つの数で見せる（進捗率は持たない） */
export interface TodoCounts {
  open: number;
  overdue: number;
  blocked: number;
  done: number;
}

export function countTodos(derived: TodoDerived[]): TodoCounts {
  return {
    open: derived.filter((d) => d.todo.status === "open").length,
    // **完了したものは遅れに数えない**（overdue の定義そのもの）
    overdue: derived.filter((d) => d.overdue).length,
    blocked: derived.filter((d) => d.blocked).length,
    done: derived.filter((d) => d.todo.status === "done").length,
  };
}

/* ── 帯の配置 ─────────────────────────────────────────── */

/** 描く期間。両方 NULL の項目は帯にならない。
 * 片方だけの項目は**その1日だけの帯**（マイルストーン） */
function rangeOf(todo: EventTodo): [string, string] | null {
  const a = todo.startsOn ?? todo.dueOn;
  const b = todo.dueOn ?? todo.startsOn;
  return a && b ? [a, b] : null;
}

export interface GanttBar {
  todoId: string;
  /** `derived` の並びと同じ行 index */
  rowIndex: number;
  /** 窓の先頭からの日数（0 始まり） */
  startCol: number;
  /** 何日ぶんか（1 以上） */
  span: number;
}

export interface GanttColumn {
  date: string;
  isWeekend: boolean;
  isToday: boolean;
  /** 月が変わる列に入る 'M月' 相当の数値。それ以外は null */
  monthStart: number | null;
}

export interface GanttLayout {
  /** 窓の先頭の日。`days === 0` のときは空文字 */
  from: string;
  /** 列数。0 なら描くものが無い（日付を持つ項目が1つも無い） */
  days: number;
  columns: GanttColumn[];
  bars: GanttBar[];
  /** 窓から外れた項目の id。**消さずに一覧へ落とす** */
  outsideIds: string[];
  /** 帯を窓の端で切った項目の id（下のフォールバックで使う）。
   * 切ったことを画面が注記できるように返す（黙って短く見せない） */
  clippedIds: string[];
  /** 今日の縦線が入る列 index。窓の外なら null */
  todayCol: number | null;
  dayPx: number;
}

/**
 * 帯の配置。**「最も多くの項目が収まる `TODO_GANTT_WINDOW_DAYS` 日間」を描く。**
 *
 * 「最も早い項目を基準」にすると、年を打ち間違えた1件（2026 を 2016 と打つ）で
 * 全部が窓から外れる。窓の広さを固定しないと、同じ1件で列数が数千になり画面が固まる
 * （`timetableLayout.ts` が7日窓を入れているのとまったく同じ問題）。
 */
export function layoutGantt(
  derived: TodoDerived[],
  today: string,
): GanttLayout {
  const ranges: Array<{ id: string; row: number; from: string; to: string }> = [];
  derived.forEach((d, row) => {
    const r = rangeOf(d.todo);
    if (r) ranges.push({ id: d.todo.id, row, from: r[0], to: r[1] });
  });
  if (ranges.length === 0) {
    return {
      from: "",
      days: 0,
      columns: [],
      bars: [],
      outsideIds: [],
      clippedIds: [],
      todayCol: null,
      dayPx: dayColPx(0),
    };
  }

  // 候補は各項目の開始日。そこから WINDOW 日ぶんの窓に**丸ごと**収まる件数を数え、
  // いちばん多い窓を採る（同数なら早いほう）
  const starts = [...new Set(ranges.map((r) => r.from))].sort();
  let best = { start: starts[0]!, count: -1 };
  for (const start of starts) {
    const end = addDays(start, TODO_GANTT_WINDOW_DAYS - 1);
    const count = ranges.filter((r) => r.from >= start && r.to <= end).length;
    if (count > best.count) best = { start, count };
  }
  const windowEnd = addDays(best.start, TODO_GANTT_WINDOW_DAYS - 1);
  let inside = ranges.filter(
    (r) => r.from >= best.start && r.to <= windowEnd,
  );

  /**
   * **日付を持つ項目のすべてが窓より長いと、ここが空になる。**
   *
   * 窓の候補は各項目の開始日なので、窓に丸ごと収まる項目が1件でもあれば
   * 必ず数えられる。裏返すと、空＝全項目が `TODO_GANTT_WINDOW_DAYS` 超え
   * （150日のスポンサー募集1件だけ、のような普通の入力で起きる）。
   * 空のまま進むと `inside[0]!` で落ち、この layout はレンダー中の
   * `useMemo` で呼ばれるので**ページごと描けなくなり、消して復旧もできない**。
   *
   * フォールバック: 最も早い開始日に窓を置き、**帯を窓の端で切って描く**。
   * 「一覧へ落とす」だけにしないのは、唯一の項目が長いだけでガントが
   * 空になるため。切った項目は `clippedIds` で返し、画面が注記する
   * （黙って短く見せない）。窓に1日も触れない項目は従来どおり一覧へ落とす。
   */
  let clippedIds: string[] = [];
  if (inside.length === 0) {
    const start = starts[0]!;
    const end = addDays(start, TODO_GANTT_WINDOW_DAYS - 1);
    const touching = ranges.filter((r) => r.from <= end);
    clippedIds = touching.filter((r) => r.to > end).map((r) => r.id);
    inside = touching.map((r) => (r.to > end ? { ...r, to: end } : r));
  }

  // 実際に要るぶんだけに詰める（3日ぶんの予定に120列を描かない）
  let from = inside.reduce((a, r) => (r.from < a ? r.from : a), inside[0]!.from);
  let to = inside.reduce((a, r) => (r.to > a ? r.to : a), inside[0]!.to);
  // 今日を入れても窓の上限に収まるなら入れる（今日の線は「遅れ」を読む基準）
  if (today < from && diffDays(today, to) + 1 <= TODO_GANTT_WINDOW_DAYS) {
    from = today;
  } else if (today > to && diffDays(from, today) + 1 <= TODO_GANTT_WINDOW_DAYS) {
    to = today;
  }
  const days = Math.min(diffDays(from, to) + 1, TODO_GANTT_WINDOW_DAYS);

  const columns: GanttColumn[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const dow = dayOfWeek(date);
    const day = Number(date.slice(8, 10));
    columns.push({
      date,
      isWeekend: dow === 0 || dow === 6,
      isToday: date === today,
      monthStart: i === 0 || day === 1 ? Number(date.slice(5, 7)) : null,
    });
  }

  const insideIds = new Set(inside.map((r) => r.id));
  return {
    from,
    days,
    columns,
    bars: inside.map((r) => ({
      todoId: r.id,
      rowIndex: r.row,
      startCol: diffDays(from, r.from),
      span: diffDays(r.from, r.to) + 1,
    })),
    outsideIds: ranges.filter((r) => !insideIds.has(r.id)).map((r) => r.id),
    clippedIds,
    todayCol:
      today >= from && today <= addDays(from, days - 1)
        ? diffDays(from, today)
        : null,
    dayPx: dayColPx(days),
  };
}

/* ── 依存の線（選んだ項目のときだけ描く） ─────────────────── */

/** L字の折れ線1本。座標は layout から決まるので DOM 計測は要らない */
export interface DependencyLine {
  key: string;
  /** `<polyline points>` に渡す座標の並び */
  points: Array<[x: number, y: number]>;
}

/**
 * 選んだ項目に繋がる依存だけを線にする（設計 8.3 の案D3）。
 *
 * **常時描かない。** 狭い画面では線が必ず絡まり、絡まった線は無いのと同じ。
 * 選択中だけなら本数が数本に収まるので、**経路探索も要らない**
 * （帯の上を横切る線が出るが、選択中の数本なら読める）。
 */
export function dependencyLines(
  layout: GanttLayout,
  derived: TodoDerived[],
  selectedId: string | null,
): DependencyLine[] {
  if (!selectedId || layout.days === 0) return [];
  const bar = new Map(layout.bars.map((b) => [b.todoId, b]));
  const selected = derived.find((d) => d.todo.id === selectedId);
  if (!selected) return [];
  const pairs: Array<[from: string, to: string]> = [
    ...selected.dependsOn.map((id) => [id, selectedId] as [string, string]),
    ...selected.blocking.map((id) => [selectedId, id] as [string, string]),
  ];
  const x = (col: number) => col * layout.dayPx;
  const y = (row: number) => row * TODO_ROW_PX + TODO_ROW_PX / 2;
  const out: DependencyLine[] = [];
  for (const [fromId, toId] of pairs) {
    const a = bar.get(fromId);
    const b = bar.get(toId);
    // 片方が窓の外なら線は引けない（帯が無い）。一覧のチップ側で読む
    if (!a || !b) continue;
    const ax = x(a.startCol + a.span);
    const bx = x(b.startCol);
    const midX = Math.max(ax, bx - layout.dayPx / 2);
    out.push({
      key: `${fromId}->${toId}`,
      points: [
        [ax, y(a.rowIndex)],
        [midX, y(a.rowIndex)],
        [midX, y(b.rowIndex)],
        [bx, y(b.rowIndex)],
      ],
    });
  }
  return out;
}
