import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { EventTodo } from "@eventer/shared";
import { deriveTodos, layoutGantt } from "./todoGantt.js";
import { useTodoFilter } from "./todoFilter.js";

/**
 * 絞り込みの判定 (#400)。ページは `useTodoFilter` の `shown` を一覧と
 * `layoutGantt` の両方に渡すので、**ここで `shown` → 帯を確かめれば、
 * ガントも一覧と同じに絞られる**（判定は todoFilter.ts の1か所だけ）。
 *
 * `TodoGantt.tsx` は描くだけなのでここでは触らない。帯になるかは
 * `layoutGantt` の入力（= `shown`）で決まる。
 */

const TODAY = "2026-09-10";
const ME = "me-1";

function todo(id: string, patch: Partial<EventTodo> = {}): EventTodo {
  return {
    id,
    title: id,
    note: null,
    startsOn: "2026-09-08",
    dueOn: "2026-09-12",
    status: "open",
    doneAt: null,
    assigneeState: "unassigned",
    assignee: null,
    sortOrder: 0,
    ...patch,
  };
}

function hook(todos: EventTodo[]) {
  return renderHook(() => useTodoFilter(deriveTodos(todos, [], TODAY), ME));
}

const shownIds = (r: ReturnType<typeof hook>) =>
  r.result.current.shown.map((d) => d.todo.id);
const barIds = (r: ReturnType<typeof hook>) =>
  layoutGantt(r.result.current.shown, TODAY).bars.map((b) => b.todoId);

describe("フィルタは一覧とガントの両方に効く (#400)", () => {
  it("担当で絞ると、ガントの帯も同じに絞られる", () => {
    const r = hook([
      todo("自分の仕事", {
        assigneeState: "active",
        assignee: { id: ME, username: "me", globalName: null, avatarUrl: null },
      }),
      todo("他人の仕事", {
        assigneeState: "active",
        assignee: { id: "u-2", username: "hoka", globalName: null, avatarUrl: null },
      }),
    ]);
    expect(barIds(r)).toEqual(["自分の仕事", "他人の仕事"]);

    act(() => r.result.current.toggleOwner("mine"));
    expect(shownIds(r)).toEqual(["自分の仕事"]);
    expect(barIds(r)).toEqual(["自分の仕事"]);
  });

  it("既定では完了の帯も出ない（一覧と食い違わない）", () => {
    const r = hook([todo("済んだ仕事", { status: "done" }), todo("残る仕事")]);
    expect(shownIds(r)).toEqual(["残る仕事"]);
    expect(barIds(r)).toEqual(["残る仕事"]);

    act(() => r.result.current.toggleShowDone());
    expect(barIds(r)).toEqual(["済んだ仕事", "残る仕事"]);
  });

  it("いま完了にした行は、一覧と同じくガントの帯も残る", () => {
    const r = renderHook(
      (todos: EventTodo[]) => useTodoFilter(deriveTodos(todos, [], TODAY), ME),
      { initialProps: [todo("片づける仕事"), todo("残る仕事")] },
    );
    // チェック（open → done）の取り次ぎ。行を「残す」集合に入れてから…
    act(() =>
      r.result.current.noteToggleDone(
        r.result.current.shown.find((d) => d.todo.id === "片づける仕事")!,
      ),
    );
    // …親が status を done にして渡し直す
    r.rerender([todo("片づける仕事", { status: "done" }), todo("残る仕事")]);

    const shown = r.result.current.shown.map((d) => d.todo.id);
    expect(shown).toEqual(["片づける仕事", "残る仕事"]);
    expect(
      layoutGantt(r.result.current.shown, TODAY).bars.map((b) => b.todoId),
    ).toEqual(["片づける仕事", "残る仕事"]);
  });
});
