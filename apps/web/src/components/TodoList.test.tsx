import { useMemo, useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { EventTodo, EventTodoDep } from "@eventer/shared";
import { deriveTodos, type TodoDerived } from "../lib/todoGantt.js";
import { useTodoFilter } from "../lib/todoFilter.js";
import { TodoList } from "./TodoList.js";

/**
 * 準備 TODO の一覧の見え方 (#393 9.8)。
 *
 * ここで確かめるのは4つだけ。
 *
 * 1. **担当を外れた人の名前が出ないこと**（「外れた」には退会申請 (#250) が
 *    混ざる。名前を出すと「他の利用者から見えなくなる」が破れる）
 * 2. 遅れ・待ちの印が出ること
 * 3. フィルタのチップで一覧が絞られること
 * 4. 実装上の語が画面に出ないこと
 *
 * **参加者に見せてよいかの絞り込みはここでは確かめない**（#383 9.11 と同じ）。
 * あれはサーバーの契約で、画面にも書くと同じ契約が2か所になる。
 */

const TODAY = "2026-09-10";
const ME = "me-1";

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

/** ページ（EventTodoPage）の配線の代わり。絞り込みは useTodoFilter が持つ */
function ListHost({
  todos,
  deps = [],
  onToggleDone = () => {},
}: {
  todos: EventTodo[];
  deps?: EventTodoDep[];
  onToggleDone?: (d: TodoDerived) => void;
}) {
  const derived = useMemo(
    () => deriveTodos(todos, deps, TODAY),
    [todos, deps],
  );
  const filter = useTodoFilter(derived, ME);
  return (
    <TodoList
      derived={derived}
      filter={filter}
      selectedId={null}
      busy={false}
      onSelect={vi.fn()}
      onToggleDone={onToggleDone}
      onAdd={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onMove={vi.fn()}
    />
  );
}

function show(todos: EventTodo[], deps: EventTodoDep[] = []) {
  return render(<ListHost todos={todos} deps={deps} />);
}

/** 一覧に並んでいる TODO の題名（チェックボックスの aria-label が題名） */
function listedTitles(): string[] {
  return screen
    .queryAllByRole("checkbox")
    .map((el) => el.getAttribute("aria-label") ?? "");
}

/** 題名から、その行の要素をたどる（行そのものに名前は付いていない） */
function rowOf(title: string): HTMLElement {
  const label = screen.getByText(title);
  const row = label.closest("div.MuiStack-root")?.parentElement;
  if (!(row instanceof HTMLElement)) throw new Error(`行が見つからない: ${title}`);
  return row;
}

describe("担当者が外れた行 (#393 6.3)", () => {
  it("名前を出さず「担当者が外れています」とだけ出す", () => {
    // サーバーは "left" のとき assignee に null を返す。**画面もそれに頼らず
    // 名前を組み立てない**（3つの状態を出し分ける実装にすると、
    // 1つ間違えたときに退会者の名前が出る）
    show([
      todo("外れた仕事", {
        assigneeState: "left",
        // 万一サーバーが名前を返してしまっても画面が出さないことまで確かめる
        assignee: {
          id: "u-9",
          username: "taikai_shita_hito",
          globalName: "退会した人",
          avatarUrl: null,
        },
      }),
    ]);
    expect(screen.getByText(/担当者が外れています/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("退会した人");
    expect(document.body.textContent).not.toContain("taikai_shita_hito");
  });

  it("担当がいる行には名前が出る（伏せすぎていない）", () => {
    show([
      todo("担当あり", {
        assigneeState: "active",
        assignee: {
          id: ME,
          username: "watashi",
          globalName: "わたし",
          avatarUrl: null,
        },
      }),
    ]);
    expect(document.body.textContent).toContain("わたし");
  });
});

describe("遅れ・待ちの印 (#393 3.7)", () => {
  it("遅れた行にだけ「遅れ」が出る", () => {
    show([
      todo("遅れている", { dueOn: "2020-01-01" }),
      todo("間に合っている", { dueOn: "2026-09-30" }),
    ]);
    expect(rowOf("遅れている").textContent).toContain("遅れ");
    expect(rowOf("間に合っている").textContent).not.toContain("遅れ");
  });

  it("期限を過ぎていても、完了していれば遅れの印は出ない", () => {
    show([todo("済んだ仕事", { dueOn: "2020-01-01", status: "done" })]);
    // 完了を隠さないよう「完了を含める」の既定で消えるので、集計だけを見る
    expect(screen.getByText("遅れ 0")).toBeInTheDocument();
  });

  it("待っている行にだけ「待ち」が出て、待っている相手の題名が読める", () => {
    show(
      [todo("告知を出す"), todo("会場を押さえる")],
      [{ todoId: "告知を出す", dependsOnId: "会場を押さえる" }],
    );
    expect(rowOf("告知を出す").textContent).toContain("待ち");
    // id ではなく題名で出す（id のままだと行を見ても何を待っているか分からない）
    expect(screen.getByText("⟵ 会場を押さえる")).toBeInTheDocument();
    expect(rowOf("会場を押さえる").textContent).not.toContain("待ち");
  });

  it("実装上の語を画面に出さない", () => {
    show(
      [todo("A", { dueOn: "2020-01-01" }), todo("B"), todo("C")],
      [{ todoId: "B", dependsOnId: "C" }],
    );
    for (const word of [
      "blocked",
      "overdue",
      "assigneeState",
      "dependsOn",
      "inCycle",
    ]) {
      expect(document.body.textContent).not.toContain(word);
    }
  });
});

describe("集計チップ (#393 8.4)", () => {
  it("「未完了 / 遅れ / 待ち / 完了」を出す（百分率は持たない）", () => {
    show(
      [
        todo("遅れた仕事", { dueOn: "2020-01-01" }),
        todo("待つ仕事"),
        todo("先の仕事"),
        todo("済んだ仕事", { status: "done" }),
      ],
      [{ todoId: "待つ仕事", dependsOnId: "先の仕事" }],
    );
    expect(screen.getByText("未完了 3")).toBeInTheDocument();
    expect(screen.getByText("遅れ 1")).toBeInTheDocument();
    expect(screen.getByText("待ち 1")).toBeInTheDocument();
    expect(screen.getByText("完了 1")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("%");
  });

  it("絞り込んでも集計の数は変わらない（何件中の何件かが読めなくなるため）", () => {
    show([
      todo("自分の仕事", {
        assigneeState: "active",
        assignee: { id: ME, username: "me", globalName: null, avatarUrl: null },
      }),
      todo("他人の仕事", {
        assigneeState: "active",
        assignee: { id: "u-2", username: "hoka", globalName: null, avatarUrl: null },
      }),
    ]);
    expect(screen.getByText("未完了 2")).toBeInTheDocument();
    fireEvent.click(screen.getByText("自分の担当"));
    expect(listedTitles()).toEqual(["自分の仕事"]);
    expect(screen.getByText("未完了 2")).toBeInTheDocument();
  });
});

describe("フィルタのチップで一覧が絞られる (#393 8.4)", () => {
  const sample = (): EventTodo[] => [
    todo("自分の仕事", {
      assigneeState: "active",
      assignee: { id: ME, username: "me", globalName: null, avatarUrl: null },
    }),
    todo("未割り当ての仕事"),
    todo("外れた仕事", { assigneeState: "left" }),
    todo("遅れた仕事", { dueOn: "2020-01-01" }),
    todo("済んだ仕事", { status: "done" }),
  ];

  it("既定では未完了だけが出る（完了は隠す）", () => {
    show(sample());
    expect(listedTitles()).toEqual([
      "自分の仕事",
      "未割り当ての仕事",
      "外れた仕事",
      "遅れた仕事",
    ]);
  });

  it("「完了を含める」を押すと完了も出る", () => {
    show(sample());
    fireEvent.click(screen.getByText("完了を含める"));
    expect(listedTitles()).toContain("済んだ仕事");
  });

  it("担当の3つは重ねられ、もう一度押すと外れる", () => {
    show(sample());

    fireEvent.click(screen.getByText("自分の担当"));
    expect(listedTitles()).toEqual(["自分の仕事"]);

    // 排他の選択肢にしない（「自分の」と「未割り当て」を同時に見たいことがある）
    fireEvent.click(screen.getByText("未割り当てのみ"));
    expect(listedTitles()).toEqual([
      "自分の仕事",
      "未割り当ての仕事",
      "遅れた仕事",
    ]);

    fireEvent.click(screen.getByText("自分の担当"));
    fireEvent.click(screen.getByText("未割り当てのみ"));
    expect(listedTitles()).toHaveLength(4);
  });

  it("「担当者が外れた」と「遅れだけ」", () => {
    show(sample());

    fireEvent.click(screen.getByText("担当者が外れた"));
    expect(listedTitles()).toEqual(["外れた仕事"]);
    fireEvent.click(screen.getByText("担当者が外れた"));

    fireEvent.click(screen.getByText("遅れだけ"));
    expect(listedTitles()).toEqual(["遅れた仕事"]);
  });

  it("1件も残らないときは、そもそも空っぽとは別の案内を出す", () => {
    show([todo("未割り当ての仕事")]);
    fireEvent.click(screen.getByText("自分の担当"));
    expect(listedTitles()).toEqual([]);
    expect(screen.getByText(/条件に合う/)).toBeInTheDocument();

    // 1件も無い場合の案内とは別の文言（同じにすると、絞り込みで消えているのか
    // まだ何も登録していないのかが読めない）
    expect(screen.queryByText(/まだ登録がありません/)).not.toBeInTheDocument();
  });
});

describe("この画面で完了にした行はその場に残る (#400)", () => {
  /** 親（EventTodoPage）の代わり。チェックで status を切り替えて渡し直す */
  function Harness({ initial }: { initial: EventTodo[] }) {
    const [todos, setTodos] = useState(initial);
    const toggle = (d: TodoDerived) =>
      setTodos((prev) =>
        prev.map((x) =>
          x.id === d.todo.id
            ? { ...x, status: x.status === "done" ? "open" : "done" }
            : x,
        ),
      );
    return <ListHost todos={todos} onToggleDone={toggle} />;
  }

  it("完了にチェックを入れても、行はその場から消えない（打ち消し線つき）", () => {
    render(<Harness initial={[todo("片づける仕事"), todo("残る仕事")]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "片づける仕事" }));

    // 「完了を隠す」既定のままでも、いま自分が完了にした行は残る
    expect(listedTitles()).toEqual(["片づける仕事", "残る仕事"]);
    expect(
      screen.getByRole("checkbox", { name: "片づける仕事" }),
    ).toBeChecked();
    // 打ち消し線（完了の見た目）になっている
    expect(screen.getByText("片づける仕事")).toHaveStyle(
      "text-decoration: line-through",
    );
  });

  it("チェックを外すと元に戻る（開き直せる）", () => {
    render(<Harness initial={[todo("誤操作の仕事")]} />);
    const box = () => screen.getByRole("checkbox", { name: "誤操作の仕事" });
    fireEvent.click(box());
    expect(box()).toBeChecked();

    fireEvent.click(box());
    expect(box()).not.toBeChecked();
    expect(listedTitles()).toEqual(["誤操作の仕事"]);
    expect(screen.getByText("誤操作の仕事")).not.toHaveStyle(
      "text-decoration: line-through",
    );
  });

  it("次の表示（再マウント）ではフィルタに従い、完了は隠れる", () => {
    const { unmount } = render(<Harness initial={[todo("済ませる仕事")]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "済ませる仕事" }));
    expect(listedTitles()).toEqual(["済ませる仕事"]);
    unmount();

    // ページを開き直した状態。完了済みなので既定の「完了を隠す」が効く
    render(<Harness initial={[todo("済ませる仕事", { status: "done" })]} />);
    expect(listedTitles()).toEqual([]);
  });

  it("「完了を含める」チップを明示的に操作したら、以後はチップの状態に従う", () => {
    render(<Harness initial={[todo("済ませる仕事"), todo("残る仕事")]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "済ませる仕事" }));
    expect(listedTitles()).toEqual(["済ませる仕事", "残る仕事"]);

    // チップを点けて消す＝「完了は隠す」を自分で選んだ。例外はもう要らない
    fireEvent.click(screen.getByText("完了を含める"));
    expect(listedTitles()).toEqual(["済ませる仕事", "残る仕事"]);
    fireEvent.click(screen.getByText("完了を含める"));
    expect(listedTitles()).toEqual(["残る仕事"]);
  });
});
