import { Box, Checkbox, Chip, IconButton, Stack, Typography } from "@mui/material";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import EditIcon from "@mui/icons-material/Edit";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import { useTranslation } from "react-i18next";
import type { EventTodo } from "@eventer/shared";
import type { TodoDerived } from "../lib/todoGantt.js";
import { i18next } from "../i18n/index.js";

/**
 * 準備 TODO の1行 (#393)。チェック・題名・日付・担当・先に終わらせる仕事。
 *
 * **利用者向けの文言に実装上の語を出さない。** 「待ち」「担当者が外れています」の
 * ように振る舞いで書く（`blocked` / `assigneeState` は読む人の語彙ではない）。
 */

/**
 * 担当の見せ方。**担当を外れた人の名前は絶対に出さない**（設計 6.3）。
 *
 * 「外れた」には退会申請 (#250) が混ざり、退会は他の利用者から見えなくなるのが
 * 目的なので名前を出せない。サーバーもその場合 `assignee` に `null` を返すが、
 * 判断をここ1か所に閉じ込めて、一覧とガントの両方がこれを引く。
 */
export function todoAssigneeLabel(todo: EventTodo): string {
  if (todo.assigneeState === "left") {
    return i18next.t("staffOps.todoAssigneeLeft");
  }
  if (todo.assigneeState === "active" && todo.assignee) {
    return todo.assignee.globalName ?? todo.assignee.username;
  }
  return i18next.t("staffOps.todoUnassigned");
}

/** 日付の見せ方。`'YYYY-MM-DD'` はどの言語でも同じ綴りなので、整形せずそのまま出す。
 * 片方しか無いときは、どちらの日付なのかが分かるよう欄の名前を添える */
export function todoDateLabel(todo: EventTodo): string {
  const { startsOn, dueOn } = todo;
  if (startsOn && dueOn) {
    return startsOn === dueOn
      ? dueOn
      : i18next.t("common.dateRange", { start: startsOn, end: dueOn });
  }
  if (dueOn) return `${i18next.t("staffOps.todoFieldDueOn")} ${dueOn}`;
  if (startsOn) return `${i18next.t("staffOps.todoFieldStartsOn")} ${startsOn}`;
  return i18next.t("staffOps.todoNoDates");
}

export function TodoRow({
  derived,
  first,
  last,
  selected,
  busy,
  titleOf,
  onSelect,
  onToggleDone,
  onEdit,
  onDelete,
  onMove,
}: {
  derived: TodoDerived;
  first: boolean;
  last: boolean;
  selected: boolean;
  busy: boolean;
  /** 依存先の題名を引く。id しか持っていない辺を読める形にするため */
  titleOf: (id: string) => string;
  onSelect: () => void;
  onToggleDone: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** -1 で1つ上、+1 で1つ下。ドラッグは入れない（設計 10.） */
  onMove: (delta: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const { todo, blocked, overdue, inCycle, dependsOn } = derived;
  const done = todo.status === "done";

  return (
    <Stack
      direction="row"
      alignItems="flex-start"
      spacing={0.5}
      sx={{
        py: 0.5,
        pr: 0.5,
        borderRadius: 1,
        // 遅れは左端に赤。色だけに頼らないよう「遅れ」のチップも並べる
        borderLeft: "3px solid",
        borderLeftColor: overdue ? "error.main" : "transparent",
        bgcolor: selected ? "action.selected" : undefined,
      }}
    >
      <Checkbox
        size="small"
        checked={done}
        disabled={busy}
        onChange={onToggleDone}
        inputProps={{ "aria-label": todo.title }}
      />
      {/* 選ぶとガントに依存の線が出る (設計 8.3 の案D3)。行そのものを押せる
          ようにすると、上下ボタンや削除まで選択の巻き添えになるのでここだけ */}
      <Box
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        sx={{ flex: 1, minWidth: 0, cursor: "pointer", pt: 0.5 }}
      >
        <Stack
          direction="row"
          spacing={0.75}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <Typography
            fontWeight={600}
            sx={{
              fontSize: "0.9rem",
              overflowWrap: "anywhere",
              textDecoration: done ? "line-through" : undefined,
              color: done ? "text.secondary" : undefined,
            }}
          >
            {todo.title}
          </Typography>
          {overdue && (
            <Chip
              size="small"
              color="error"
              variant="outlined"
              label={t("staffOps.todoOverdueChip")}
            />
          )}
          {blocked && (
            <Chip
              size="small"
              icon={<LockOutlinedIcon sx={{ fontSize: 13 }} />}
              label={t("staffOps.todoBlockedChip")}
            />
          )}
          {/* サーバーが書き込みで輪を弾いているので普通は出ない。
              出たときに黙って隠さないための印 (設計 3.4) */}
          {inCycle && (
            <Chip
              size="small"
              color="warning"
              label={t("staffOps.todoCycleChip")}
            />
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {[todoDateLabel(todo), todoAssigneeLabel(todo)].join(
            t("common.dotSeparator"),
          )}
        </Typography>
        {dependsOn.length > 0 && (
          <Stack
            direction="row"
            spacing={0.5}
            flexWrap="wrap"
            useFlexGap
            sx={{ mt: 0.25 }}
          >
            {dependsOn.map((id) => (
              <Chip
                key={id}
                size="small"
                variant="outlined"
                title={t("staffOps.todoDepsField")}
                label={t("staffOps.todoDependsOnChip", { title: titleOf(id) })}
                sx={{ height: 20, fontSize: "0.7rem" }}
              />
            ))}
          </Stack>
        )}
      </Box>
      <Stack direction="row" sx={{ flex: "none" }}>
        <IconButton
          size="small"
          aria-label={t("common.moveUp")}
          disabled={first || busy}
          onClick={() => onMove(-1)}
        >
          <ArrowUpwardIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          aria-label={t("common.moveDown")}
          disabled={last || busy}
          onClick={() => onMove(1)}
        >
          <ArrowDownwardIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          aria-label={t("common.edit")}
          disabled={busy}
          onClick={onEdit}
        >
          <EditIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          aria-label={t("common.delete")}
          disabled={busy}
          onClick={onDelete}
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Stack>
  );
}
