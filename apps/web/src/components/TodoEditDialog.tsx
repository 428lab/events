import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  TODO_NOTE_MAX,
  TODO_TITLE_MAX,
  type CreateTodoInput,
  type EventTodo,
  type TodoAssignee,
} from "@eventer/shared";
import { CounterTextField } from "./CounterTextField.js";
import { i18next } from "../i18n/index.js";
import { errorMessage } from "../lib/errorMessage.js";

/**
 * 準備 TODO の追加・編集 (#393)。
 *
 * 日付は `<input type="date">`。値がそのまま `'YYYY-MM-DD'` なので、画面の端で
 * 変換が要らない（設計 3.2）。**ドラッグで日程を変える口は作らない**（設計 10.）。
 *
 * 空欄は `null` で送る（＝消す）。`undefined` にすると「いまの値を保つ」の意味に
 * なり、日付を消したつもりで消えない（`packages/shared/src/eventTodo.ts` の注）。
 */

/** 保存できなかった理由。コードの綴りをそのまま出さず、その場で直せる形で書く */
export function todoErrorMessage(error: unknown): string {
  return errorMessage(error, {
    todo_limit: i18next.t("staffOps.todoLimitError"),
    todo_dep_limit: i18next.t("staffOps.todoDepLimitError"),
    todo_dep_cycle: i18next.t("staffOps.todoDepCycleError"),
    todo_bad_range: i18next.t("staffOps.todoBadRangeError"),
    todo_assignee_not_staff: i18next.t("staffOps.todoAssigneeNotStaffError"),
    default: i18next.t("staffOps.saveFailed"),
  });
}

export function TodoEditDialog({
  todo,
  currentDeps,
  candidates,
  assignable,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  /** `null` なら追加 */
  todo: EventTodo | null;
  /** 編集中の項目がいま待っている項目の id */
  currentDeps: string[];
  /** 依存に選べる項目（自分自身は呼ぶ側が外す） */
  candidates: EventTodo[];
  assignable: TodoAssignee[];
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (values: CreateTodoInput, depIds: string[]) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(todo?.title ?? "");
  const [note, setNote] = useState(todo?.note ?? "");
  const [startsOn, setStartsOn] = useState(todo?.startsOn ?? "");
  const [dueOn, setDueOn] = useState(todo?.dueOn ?? "");
  // 担当が外れている項目は**空**から始める。名前が分からない以上そのまま
  // 保てないし、この画面の目的が付け直すことなので、選び直しを促す
  const [assigneeId, setAssigneeId] = useState(
    todo?.assigneeState === "active" ? (todo.assignee?.id ?? "") : "",
  );
  const [deps, setDeps] = useState<string[]>(currentDeps);

  const badRange = startsOn !== "" && dueOn !== "" && startsOn > dueOn;
  const canSave = title.trim().length > 0 && !badRange && !busy;

  const submit = () => {
    onSubmit(
      {
        title: title.trim(),
        note: note.trim() === "" ? null : note,
        startsOn: startsOn === "" ? null : startsOn,
        dueOn: dueOn === "" ? null : dueOn,
        assigneeUserId: assigneeId === "" ? null : assigneeId,
      },
      deps,
    );
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{todo ? t("common.edit") : t("common.add")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error !== null && error !== undefined && (
            <Alert severity="error">{todoErrorMessage(error)}</Alert>
          )}
          {todo?.assigneeState === "left" && (
            <Alert severity="warning">{t("staffOps.todoAssigneeLeft")}</Alert>
          )}
          <CounterTextField
            label={t("staffOps.todoFieldTitle")}
            max={TODO_TITLE_MAX}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              type="date"
              fullWidth
              label={t("staffOps.todoFieldStartsOn")}
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              type="date"
              fullWidth
              label={t("staffOps.todoFieldDueOn")}
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
              error={badRange}
              helperText={badRange ? t("staffOps.todoBadRangeError") : undefined}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
          <TextField
            select
            label={t("staffOps.todoFieldAssignee")}
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
          >
            <MenuItem value="">{t("staffOps.todoUnassigned")}</MenuItem>
            {assignable.map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.globalName ?? a.username}
              </MenuItem>
            ))}
          </TextField>
          <CounterTextField
            label={t("staffOps.todoFieldNote")}
            max={TODO_NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            multiline
            minRows={2}
          />
          {candidates.length > 0 && (
            <Box>
              <Typography variant="subtitle2">
                {t("staffOps.todoDepsField")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("staffOps.todoDepsHelp")}
              </Typography>
              <Box
                sx={{
                  mt: 0.5,
                  maxHeight: 180,
                  overflowY: "auto",
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1,
                  px: 1,
                }}
              >
                {candidates.map((c) => (
                  <FormControlLabel
                    key={c.id}
                    sx={{ display: "flex" }}
                    control={
                      <Checkbox
                        size="small"
                        checked={deps.includes(c.id)}
                        onChange={() =>
                          setDeps((prev) =>
                            prev.includes(c.id)
                              ? prev.filter((id) => id !== c.id)
                              : [...prev, c.id],
                          )
                        }
                      />
                    }
                    label={
                      <Typography variant="body2">{c.title}</Typography>
                    }
                  />
                ))}
              </Box>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="contained" disabled={!canSave} onClick={submit}>
          {t("common.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
