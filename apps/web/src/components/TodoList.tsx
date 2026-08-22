import { useMemo } from "react";
import { Box, Button, Chip, Divider, Stack, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useTranslation } from "react-i18next";
import { countTodos, type TodoDerived } from "../lib/todoGantt.js";
import type { TodoFilter, TodoOwnerFilter } from "../lib/todoFilter.js";
import { TodoRow } from "./TodoRow.js";

/**
 * 準備 TODO の一覧 (#393)。集計チップ・絞り込み・並べ替え。
 *
 * 絞り込みの**判定は持たない**。`useTodoFilter` (#400) が絞った結果
 * (`filter.shown`) をそのまま並べ、チップはその状態を切り替えるだけ。
 * 同じ結果をガントも使うので、一覧とガントの見え方は必ず一致する。
 */
export function TodoList({
  derived,
  filter,
  selectedId,
  busy,
  onSelect,
  onToggleDone,
  onAdd,
  onEdit,
  onDelete,
  onMove,
}: {
  /** 絞り込む前の全件。集計と並べ替えの端の判定はこちらで行う */
  derived: TodoDerived[];
  filter: TodoFilter;
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

  // 進み具合は**絞り込む前の全件**で数える。絞ったぶんだけ数が減ると、
  // 「未完了が3件になった」のか「3件だけ表示している」のかが読めない
  const counts = countTodos(derived);
  const titles = useMemo(
    () => new Map(derived.map((d) => [d.todo.id, d.todo.title])),
    [derived],
  );
  const shown = filter.shown;

  /** チェックの取り次ぎ。完了にする行を「残す」集合へ入れてから親に渡す (#400) */
  const toggleDone = (d: TodoDerived) => {
    filter.noteToggleDone(d);
    onToggleDone(d);
  };

  const ownerChip = (value: TodoOwnerFilter, label: string) => (
    <Chip
      size="small"
      label={label}
      variant={filter.owners.includes(value) ? "filled" : "outlined"}
      color={filter.owners.includes(value) ? "primary" : "default"}
      onClick={() => filter.toggleOwner(value)}
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
          variant={filter.overdueOnly ? "filled" : "outlined"}
          color={filter.overdueOnly ? "error" : "default"}
          onClick={filter.toggleOverdue}
        />
        <Chip
          size="small"
          label={t("staffOps.todoFilterShowDone")}
          variant={filter.showDone ? "filled" : "outlined"}
          color={filter.showDone ? "primary" : "default"}
          onClick={filter.toggleShowDone}
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
                onToggleDone={() => toggleDone(d)}
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
