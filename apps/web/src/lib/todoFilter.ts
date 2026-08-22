import { useMemo, useState } from "react";
import type { TodoDerived } from "./todoGantt.js";

/**
 * 準備 TODO の絞り込み (#393 8.4, #400)。**判定はこの1か所だけ。**
 *
 * 絞り込んだ結果 (`shown`) を一覧 (`TodoList`) とガント (`layoutGantt` /
 * `TodoGantt`) の両方が使う。判定を画面ごとに書くと、「帯はあるのに行が無い」
 * のような食い違いが必ず出る。
 *
 * 絞り込みはすべて画面側でやる。サーバーに絞り込みの口を増やすと、
 * この表を読む経路が1本では無くなる（設計 3.5・8.4）。
 */

/** 担当で絞る3つ。**この3つは互いに排他**（1つの仕事が「自分の」でも
 * 「未割り当て」でもあることは無い）なので、選んだもののどれかに当てはまれば残す */
export type TodoOwnerFilter = "mine" | "unassigned" | "left";

export interface TodoFilter {
  owners: TodoOwnerFilter[];
  overdueOnly: boolean;
  showDone: boolean;
  /** 絞り込みの結果。**一覧とガントの両方がこれを使う** */
  shown: TodoDerived[];
  toggleOwner: (value: TodoOwnerFilter) => void;
  toggleOverdue: () => void;
  toggleShowDone: () => void;
  /** チェックの切り替えを親へ取り次ぐ**前**に呼ぶ。これから完了にする行を
   * 「その場に残す」集合へ入れる (#400) */
  noteToggleDone: (d: TodoDerived) => void;
}

export function useTodoFilter(
  derived: TodoDerived[],
  meId: string | null,
): TodoFilter {
  const [owners, setOwners] = useState<TodoOwnerFilter[]>([]);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [showDone, setShowDone] = useState(false);
  /**
   * この画面で自分が完了にした行の id (#400)。既定の「完了を隠す」のまま
   * チェックした瞬間に行が消えると、「1度達成すると消せない・戻せない」ように
   * 見えるので、**いま完了にした行はフィルタに関わらずその場に残す**。
   *
   * - 永続化しない（次にページを開いたときはフィルタに従うのが仕様）。
   *   React の state なので、再マウントで自然に空に戻る
   * - 「完了を含める」チップを明示的に操作したら空にする（フィルタの意思を
   *   自分で示したので、以後はチップの状態にそのまま従う）
   */
  const [justDone, setJustDone] = useState<ReadonlySet<string>>(new Set());

  const shown = useMemo(() => {
    const ownerOf = (d: TodoDerived): TodoOwnerFilter | null => {
      if (d.todo.assigneeState === "left") return "left";
      if (d.todo.assigneeState === "unassigned") return "unassigned";
      return d.todo.assignee?.id === meId ? "mine" : null;
    };
    return derived.filter((d) => {
      if (!showDone && d.todo.status === "done" && !justDone.has(d.todo.id))
        return false;
      if (overdueOnly && !d.overdue) return false;
      if (owners.length === 0) return true;
      const owner = ownerOf(d);
      return owner !== null && owners.includes(owner);
    });
  }, [derived, meId, owners, overdueOnly, showDone, justDone]);

  return {
    owners,
    overdueOnly,
    showDone,
    shown,
    toggleOwner: (value) =>
      setOwners((prev) =>
        prev.includes(value)
          ? prev.filter((v) => v !== value)
          : [...prev, value],
      ),
    toggleOverdue: () => setOverdueOnly((v) => !v),
    toggleShowDone: () => {
      setShowDone((v) => !v);
      // チップを自分で操作した＝フィルタの意思表示。以後は例外なくチップに従う
      setJustDone(new Set());
    },
    noteToggleDone: (d) => {
      if (d.todo.status !== "done") {
        setJustDone((prev) => new Set(prev).add(d.todo.id));
      }
    },
  };
}
