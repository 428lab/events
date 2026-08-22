import { useMemo, useState } from "react";
import { Box, Button, Chip, Divider, Stack, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useTranslation } from "react-i18next";
import { countTodos, type TodoDerived } from "../lib/todoGantt.js";
import { TodoRow } from "./TodoRow.js";

/**
 * 準備 TODO の一覧 (#393)。集計チップ・絞り込み・並べ替え。
 *
 * **絞り込みはすべてここ（画面側）でやる。** サーバーに絞り込みの口を増やすと、
 * この表を読む経路が1本では無くなる（設計 3.5・8.4）。
 *
 * 絞り込みはガントには効かない。ガントの行 index は `derived` の並びそのものなので、
 * 一覧だけを絞る。「一覧で目当ての1件を探し、下の帯で前後関係を見る」使い方になる。
 */

/** 担当で絞る3つ。**この3つは互いに排他**（1つの仕事が「自分の」でも
 * 「未割り当て」でもあることは無い）なので、選んだもののどれかに当てはまれば残す */
type OwnerFilter = "mine" | "unassigned" | "left";

export function TodoList({
  derived,
  meId,
  selectedId,
  busy,
  onSelect,
  onToggleDone,
  onAdd,
  onEdit,
  onDelete,
  onMove,
}: {
  derived: TodoDerived[];
  meId: string | null;
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onToggleDone: (d: TodoDerived) => void;
  onAdd: () => void;
  onEdit: (d: TodoDerived) => void;
  onDelete: (d: TodoDerived) => void;
  onMove: (d: TodoDerived, delta: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const [owners, setOwners] = useState<OwnerFilter[]>([]);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [showDone, setShowDone] = useState(false);

  // 進み具合は**絞り込む前の全件**で数える。絞ったぶんだけ数が減ると、
  // 「未完了が3件になった」のか「3件だけ表示している」のかが読めない
  const counts = countTodos(derived);
  const titles = useMemo(
    () => new Map(derived.map((d) => [d.todo.id, d.todo.title])),
    [derived],
  );

  const ownerOf = (d: TodoDerived): OwnerFilter | null => {
    if (d.todo.assigneeState === "left") return "left";
    if (d.todo.assigneeState === "unassigned") return "unassigned";
    return d.todo.assignee?.id === meId ? "mine" : null;
  };
  const shown = derived.filter((d) => {
    if (!showDone && d.todo.status === "done") return false;
    if (overdueOnly && !d.overdue) return false;
    if (owners.length === 0) return true;
    const owner = ownerOf(d);
    return owner !== null && owners.includes(owner);
  });

  const toggleOwner = (value: OwnerFilter) =>
    setOwners((prev) =>
      prev.includes(value)
        ? prev.filter((v) => v !== value)
        : [...prev, value],
    );
  const ownerChip = (value: OwnerFilter, label: string) => (
    <Chip
      size="small"
      label={label}
      variant={owners.includes(value) ? "filled" : "outlined"}
      color={owners.includes(value) ? "primary" : "default"}
      onClick={() => toggleOwner(value)}
    />
  );

  return (
    <Stack spacing={1.5}>
      {/* 進み具合。百分率は持たない（自己申告の百分率は常に間違っている・設計 3.7） */}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip size="small" label={t("staffOps.todoCountOpen", { n: counts.open })} />
        <Chip
          size="small"
          color={counts.overdue > 0 ? "error" : "default"}
          label={t("staffOps.todoCountOverdue", { n: counts.overdue })}
        />
        <Chip
          size="small"
          label={t("staffOps.todoCountBlocked", { n: counts.blocked })}
        />
        <Chip
          size="small"
          color={counts.done > 0 ? "success" : "default"}
          label={t("staffOps.todoCountDone", { n: counts.done })}
        />
      </Stack>

      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
      >
        {ownerChip("mine", t("staffOps.todoFilterMine"))}
        {ownerChip("unassigned", t("staffOps.todoFilterUnassigned"))}
        {ownerChip("left", t("staffOps.todoFilterLeft"))}
        <Chip
          size="small"
          label={t("staffOps.todoFilterOverdue")}
          variant={overdueOnly ? "filled" : "outlined"}
          color={overdueOnly ? "error" : "default"}
          onClick={() => setOverdueOnly((v) => !v)}
        />
        <Chip
          size="small"
          label={t("staffOps.todoFilterShowDone")}
          variant={showDone ? "filled" : "outlined"}
          color={showDone ? "primary" : "default"}
          onClick={() => setShowDone((v) => !v)}
        />
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="contained"
          startIcon={<AddIcon />}
          disabled={busy}
          onClick={onAdd}
        >
          {t("common.add")}
        </Button>
      </Stack>

      {derived.length === 0 ? (
        <Typography color="text.secondary">{t("staffOps.todoEmpty")}</Typography>
      ) : shown.length === 0 ? (
        <Typography color="text.secondary">
          {t("staffOps.todoFilterNone")}
        </Typography>
      ) : (
        <Stack divider={<Divider />}>
          {shown.map((d) => {
            // 上下ボタンの端の判定は**絞り込む前の並び**で見る。絞った一覧の
            // 端を端として扱うと、隠れている行を飛び越えて動くことになる
            const at = derived.indexOf(d);
            return (
              <TodoRow
                key={d.todo.id}
                derived={d}
                first={at === 0}
                last={at === derived.length - 1}
                selected={selectedId === d.todo.id}
                busy={busy}
                titleOf={(id) => titles.get(id) ?? ""}
                onSelect={() => onSelect(d.todo.id)}
                onToggleDone={() => onToggleDone(d)}
                onEdit={() => onEdit(d)}
                onDelete={() => onDelete(d)}
                onMove={(delta) => onMove(d, delta)}
              />
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
