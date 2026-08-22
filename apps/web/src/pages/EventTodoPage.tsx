import { useMemo, useState } from "react";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EventNoteIcon from "@mui/icons-material/EventNote";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  todayDateOnly,
  type CreateTodoInput,
  type EventTodo,
} from "@eventer/shared";
import { useEvent, useMe } from "../api/hooks.js";
import {
  useAddTodoDep,
  useCreateTodo,
  useDeleteTodo,
  useEventTodos,
  useRemoveTodoDep,
  useReorderTodos,
  useUpdateTodo,
} from "../api/todoHooks.js";
import { deriveTodos, layoutGantt, type TodoDerived } from "../lib/todoGantt.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";
import { TodoList } from "../components/TodoList.js";
import { TodoGantt } from "../components/TodoGantt.js";
import { TodoEditDialog, todoErrorMessage } from "../components/TodoEditDialog.js";

/**
 * スタッフ向けの準備 TODO とガント (#393)。**この画面を束ねるだけ。**
 *
 * 見えるのは `myRole === "staff"` の人だけ。**サイト管理者かどうかは混ぜない**
 * （イベント配下の画面はイベント内の役割だけで判定する）。スタッフでなければ
 * 一覧を取りにも行かない。
 *
 * 当日の段取り (#383 のタイムライン) とはデータで繋がない。行き来のリンクだけ置く
 * （設計 3.6）。日付だけで決める当日より前の仕事がここ、時刻があり当日の段取りに
 * なるものはあちら、という線引きを両方の画面で案内する。
 */
export function EventTodoPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const { data: me } = useMe();
  // イベント配下の表示はイベント内の役割だけで判定する
  const isStaff = eventData?.myRole === "staff";
  const { data, error } = useEventTodos(id, isStaff);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 開いている編集ダイアログ。`todo` が null なら追加 */
  const [editing, setEditing] = useState<{ todo: EventTodo | null } | null>(
    null,
  );
  const [failure, setFailure] = useState<unknown>(null);

  const create = useCreateTodo(id);
  const update = useUpdateTodo(id);
  const remove = useDeleteTodo(id);
  const reorder = useReorderTodos(id);
  const addDep = useAddTodoDep(id);
  const removeDep = useRemoveTodoDep(id);
  const busy =
    create.isPending ||
    update.isPending ||
    remove.isPending ||
    reorder.isPending ||
    addDep.isPending ||
    removeDep.isPending;

  // 遅れの判定は**見ている人の今日**で行う（設計 3.7）。開いている間は固定でよい
  // （日付をまたいで開きっぱなしなら、次に取り直したときに追いつく）
  const today = useMemo(() => todayDateOnly(), []);
  const todos = data?.todos;
  const deps = data?.deps;
  const derived = useMemo(
    () => deriveTodos(todos ?? [], deps ?? [], today),
    [todos, deps, today],
  );
  const layout = useMemo(() => layoutGantt(derived, today), [derived, today]);

  if (!eventData) return <Typography>{t("common.loading")}</Typography>;
  if (!isStaff) {
    return <Alert severity="info">{t("staffOps.todoStaffOnly")}</Alert>;
  }
  if (!data) {
    return (
      <Typography>
        {t(error ? "staffOps.loadFailed" : "common.loading")}
      </Typography>
    );
  }

  const depsOf = (todoId: string) =>
    data.deps.filter((d) => d.todoId === todoId).map((d) => d.dependsOnId);

  /** 追加/編集の保存。依存は別の口なので、本体を保存してから差分だけ足し引きする */
  const save = async (values: CreateTodoInput, depIds: string[]) => {
    const target = editing?.todo ?? null;
    setFailure(null);
    try {
      let todoId: string;
      if (target) {
        await update.mutateAsync({ todoId: target.id, patch: values });
        todoId = target.id;
      } else {
        todoId = (await create.mutateAsync(values)).id;
      }
      const before = target ? depsOf(target.id) : [];
      for (const dependsOnId of depIds.filter((x) => !before.includes(x))) {
        await addDep.mutateAsync({ todoId, dependsOnId });
      }
      for (const dependsOnId of before.filter((x) => !depIds.includes(x))) {
        await removeDep.mutateAsync({ todoId, dependsOnId });
      }
      setEditing(null);
    } catch (e) {
      // 依存の途中で断られた（輪になる・上限）ときは、本体の保存は済んでいる。
      // ダイアログを開いたまま理由を出して、選び直せるようにする
      setFailure(e);
    }
  };

  const toggleDone = (d: TodoDerived) => {
    setFailure(null);
    update.mutate(
      {
        todoId: d.todo.id,
        patch: { status: d.todo.status === "done" ? "open" : "done" },
      },
      { onError: setFailure },
    );
  };

  const del = (d: TodoDerived) => {
    if (!window.confirm(t("staffOps.todoDeleteConfirm", { title: d.todo.title })))
      return;
    setFailure(null);
    remove.mutate(d.todo.id, { onError: setFailure });
  };

  /** 並べ替えは**そのイベントの全 id** を並べて送る。入れ替えるのは隣同士だけ */
  const move = (d: TodoDerived, delta: -1 | 1) => {
    const ids = derived.map((x) => x.todo.id);
    const at = ids.indexOf(d.todo.id);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to]!, ids[at]!];
    setFailure(null);
    reorder.mutate(ids, { onError: setFailure });
  };

  return (
    <Stack spacing={2}>
      <EventBreadcrumbs
        eventId={id}
        eventTitle={eventData.event.title}
        current={t("staffOps.todoTitle")}
      />
      <Box>
        <Button
          component={RouterLink}
          to={`/events/${id}`}
          size="small"
          startIcon={<ArrowBackIcon />}
        >
          {t("staffOps.backToEventLink")}
        </Button>
      </Box>
      <Box>
        <Typography variant="h5" fontWeight={700}>
          {t("staffOps.todoTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("staffOps.todoScopeNote")}
        </Typography>
      </Box>
      {/* #383 との行き来。データでは繋がない（設計 3.6） */}
      <Box>
        <Button
          component={RouterLink}
          to={`/events/${id}/timetable`}
          size="small"
          startIcon={<EventNoteIcon />}
        >
          {t("staffOps.todoToTimetable")}
        </Button>
      </Box>

      {failure !== null && editing === null && (
        <Alert severity="error" onClose={() => setFailure(null)}>
          {todoErrorMessage(failure)}
        </Alert>
      )}

      <TodoList
        derived={derived}
        meId={me?.id ?? null}
        selectedId={selectedId}
        busy={busy}
        onSelect={(todoId) =>
          setSelectedId((prev) => (prev === todoId ? null : todoId))
        }
        onToggleDone={toggleDone}
        onAdd={() => {
          setFailure(null);
          setEditing({ todo: null });
        }}
        onEdit={(d) => {
          setFailure(null);
          setEditing({ todo: d.todo });
        }}
        onDelete={del}
        onMove={move}
      />

      <Box>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("staffOps.todoGanttTitle")}
        </Typography>
        <TodoGantt
          layout={layout}
          derived={derived}
          selectedId={selectedId}
          onSelect={(todoId) =>
            setSelectedId((prev) => (prev === todoId ? null : todoId))
          }
        />
      </Box>

      {editing && (
        <TodoEditDialog
          todo={editing.todo}
          currentDeps={editing.todo ? depsOf(editing.todo.id) : []}
          candidates={data.todos.filter((x) => x.id !== editing.todo?.id)}
          assignable={data.assignable}
          busy={busy}
          error={failure}
          onClose={() => {
            setFailure(null);
            setEditing(null);
          }}
          onSubmit={(values, depIds) => void save(values, depIds)}
        />
      )}
    </Stack>
  );
}
