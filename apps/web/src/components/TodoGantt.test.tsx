import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { EventTodo } from "@eventer/shared";
import { deriveTodos, layoutGantt } from "../lib/todoGantt.js";
import { TodoGantt } from "./TodoGantt.js";

/**
 * ガントの祝日の網掛け (#401)。
 *
 * 判定そのもの（どの列が祝日か・タイムゾーンでずれないか）は
 * `lib/todoGantt.test.ts` が持つ。ここは描画側が layout の `holiday` を
 * 実際に**網掛けとツールチップにしていること**だけを確かめる。
 */

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

describe("TodoGantt の祝日の網掛け (#401)", () => {
  it("祝日の列に網掛けが出て、祝日名がツールチップに付く", () => {
    // 2025-12-31(水)〜2026-01-02(金)。祝日は 2026-01-01（元日）だけで、
    // 土日は窓に入らない＝出る網掛けは祝日の1枚だけ
    const derived = deriveTodos(
      [todo("A", { startsOn: "2025-12-31", dueOn: "2026-01-02" })],
      [],
      "2025-12-31",
    );
    const layout = layoutGantt(derived, "2025-12-31");
    const { container } = render(
      <TodoGantt
        layout={layout}
        derived={derived}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    // 網掛けは全行を貫く gridRow "2 / -1" の敷物。元日の列（2列目＝
    // grid では見出し列の次なので 3）だけに出る
    const shades = container.querySelectorAll('[style*="grid-row: 2 / -1"]');
    expect(shades).toHaveLength(1);
    expect((shades[0] as HTMLElement).style.gridColumn).toBe("3");
    // 祝日名は日付の目盛りの title（日本語のまま。訳さない）
    expect(screen.getByTitle("元日")).toBeInTheDocument();
  });
});
