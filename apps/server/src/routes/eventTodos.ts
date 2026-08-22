import { Hono } from "hono";
import {
  EVENT_TODO_LIMIT,
  TODO_DEPS_PER_ITEM,
  addTodoDepInput,
  createTodoInput,
  reorderTodosInput,
  updateTodoInput,
  type AddTodoDepInput,
  type CreateTodoInput,
  type EventTodosPayload,
  type ReorderTodosInput,
  type UpdateTodoInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventTodosRepo, type TodoPatch } from "../db/repositories/eventTodos.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";

/**
 * スタッフ向けの準備 TODO とガントチャート (#393)。**参加者向けの経路は1本も無い。**
 *
 * 権限は `requireEventRole(["staff"])`。一斉連絡 (#172) が使う
 * `isConfirmedEventStaff`（より狭い）にしないのは、**#383 の「裏方が見える人」と
 * 同じ基準にそろえるため**。準備の段取りは当日の裏方と同じ運営情報なので、
 * 見える範囲が2種類あると「タイムラインは見えるのに TODO は見えない人」が生まれ、
 * どちらが正かを説明できない。一斉連絡が狭いのは**取り消せず全員に届く**操作だから
 * であって、TODO の編集は取り消せる。
 *
 * 代償を1つ明記する。コミュニティの owner/admin とアプリ運営管理者は
 * `event_member` 行を持たないことがあり、**その人たちは見えるが担当には指定できない**
 * （担当は「そのイベントのスタッフとして名前が並んでいる人」に限る）。意図した非対称。
 */
export const eventTodoRoutes = new Hono<AppEnv>();
eventTodoRoutes.use("*", requireAuth);
// 一覧・作成（/:id/todos）と、その配下すべてに同じ権限をかける
// （eventBroadcast.ts と同じ形。2行のうち片方を落とすと配下が素通しになる）
eventTodoRoutes.use("/:id/todos", requireEventRole(["staff"]));
eventTodoRoutes.use("/:id/todos/*", requireEventRole(["staff"]));

/** 担当に指定できるか。**`assignableStaff` と同じ述語を使う**
 * （選択肢の SQL と検査を別々に書くと、選べるのに弾かれる／その逆が起きる）。
 * 実体は eventMembers.ts の1本（持ち場の割り当て #384 と契約を共有する） */
async function assignableCheck(
  eventId: string,
  userId: string,
): Promise<boolean> {
  const staff = await eventMembersRepo.assignableStaff(eventId);
  return staff.some((s) => s.id === userId);
}

/** 期間が逆さまでないか。DB の CHECK でも止まるが、
 * 部分更新では「送られなかった側の現在値」と突き合わせないと判定できない */
function badRange(startsOn: string | null, dueOn: string | null): boolean {
  return startsOn !== null && dueOn !== null && startsOn > dueOn;
}

eventTodoRoutes.get("/:id/todos", async (c) => {
  const eventId = c.req.param("id");
  const payload: EventTodosPayload = {
    todos: await eventTodosRepo.listByEvent(eventId),
    deps: await eventTodosRepo.listDeps(eventId),
    assignable: await eventMembersRepo.assignableStaff(eventId),
  };
  return c.json(payload);
});

eventTodoRoutes.post(
  "/:id/todos",
  zValidator("json", createTodoInput),
  async (c) => {
    const eventId = c.req.param("id");
    const input = valid<CreateTodoInput>(c, "json");
    if ((await eventTodosRepo.countByEvent(eventId)) >= EVENT_TODO_LIMIT) {
      return c.json({ error: "todo_limit", limit: EVENT_TODO_LIMIT }, 400);
    }
    const startsOn = input.startsOn ?? null;
    const dueOn = input.dueOn ?? null;
    if (badRange(startsOn, dueOn)) {
      return c.json({ error: "todo_bad_range" }, 400);
    }
    const assigneeUserId = input.assigneeUserId ?? null;
    if (assigneeUserId && !(await assignableCheck(eventId, assigneeUserId))) {
      return c.json({ error: "todo_assignee_not_staff" }, 400);
    }
    const id = await eventTodosRepo.create({
      eventId,
      createdBy: c.get("user").id,
      title: input.title,
      note: input.note ?? null,
      startsOn,
      dueOn,
      assigneeUserId,
    });
    return c.json({ id }, 201);
  },
);

eventTodoRoutes.patch(
  "/:id/todos/:todoId",
  zValidator("json", updateTodoInput),
  async (c) => {
    const eventId = c.req.param("id");
    const todoId = c.req.param("todoId");
    // 他イベントの id は **403 ではなく 404**（存在を教えない）。
    // 同じ問い合わせで、送られなかったキーの現在値も受け取る
    const current = await eventTodosRepo.findInEvent(todoId, eventId);
    if (!current) return c.json({ error: "not_found" }, 404);
    const input = valid<UpdateTodoInput>(c, "json");
    // **キーが無い＝いまの値を保つ / null＝消す。** ここを取り違えると、
    // チェックを付けただけのつもりで担当や日付が消える
    const startsOn =
      input.startsOn === undefined ? current.startsOn : input.startsOn;
    const dueOn = input.dueOn === undefined ? current.dueOn : input.dueOn;
    if (badRange(startsOn, dueOn)) {
      return c.json({ error: "todo_bad_range" }, 400);
    }
    if (
      input.assigneeUserId !== undefined &&
      input.assigneeUserId !== null &&
      !(await assignableCheck(eventId, input.assigneeUserId))
    ) {
      return c.json({ error: "todo_assignee_not_staff" }, 400);
    }
    const patch: TodoPatch = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.note !== undefined) patch.note = input.note;
    if (input.startsOn !== undefined) patch.startsOn = input.startsOn;
    if (input.dueOn !== undefined) patch.dueOn = input.dueOn;
    if (input.assigneeUserId !== undefined) {
      patch.assigneeUserId = input.assigneeUserId;
    }
    if (input.status !== undefined) patch.status = input.status;
    await eventTodosRepo.update(todoId, patch);
    return c.json({ ok: true });
  },
);

eventTodoRoutes.delete("/:id/todos/:todoId", async (c) => {
  const eventId = c.req.param("id");
  const todoId = c.req.param("todoId");
  if (!(await eventTodosRepo.findInEvent(todoId, eventId))) {
    return c.json({ error: "not_found" }, 404);
  }
  await eventTodosRepo.remove(todoId);
  return c.json({ ok: true });
});

/** 並べ替え。`reorder` が `event_id` も条件に入れるので、
 * 他イベントの id が混ざっても他所の行は動かない */
eventTodoRoutes.put(
  "/:id/todos/order",
  zValidator("json", reorderTodosInput),
  async (c) => {
    const eventId = c.req.param("id");
    const input = valid<ReorderTodosInput>(c, "json");
    await eventTodosRepo.reorder(eventId, input.ids);
    return c.json({ ok: true });
  },
);

/** 依存を足す。`todoId` は `dependsOnId` が `done` になるまで着手できない */
eventTodoRoutes.post(
  "/:id/todos/:todoId/deps",
  zValidator("json", addTodoDepInput),
  async (c) => {
    const eventId = c.req.param("id");
    const todoId = c.req.param("todoId");
    const { dependsOnId } = valid<AddTodoDepInput>(c, "json");
    // **両端がこのイベントの項目であることを必ず確かめる。**
    // 確かめないと依存グラフがイベントをまたぐ（子リソースの所有チェック）
    if (
      !(await eventTodosRepo.findInEvent(todoId, eventId)) ||
      !(await eventTodosRepo.findInEvent(dependsOnId, eventId))
    ) {
      return c.json({ error: "not_found" }, 404);
    }
    if (todoId === dependsOnId) {
      return c.json({ error: "todo_dep_self" }, 400);
    }
    if ((await eventTodosRepo.countDeps(todoId)) >= TODO_DEPS_PER_ITEM) {
      return c.json({ error: "todo_dep_limit", limit: TODO_DEPS_PER_ITEM }, 400);
    }
    // `todoId → dependsOnId` を足すので、**`dependsOnId` から `todoId` へ
    // 既に到達できるか**を見る。推移的な循環 (A→B→C→A) もこれで落ちる
    if (await eventTodosRepo.canReach(eventId, dependsOnId, todoId)) {
      return c.json({ error: "todo_dep_cycle" }, 400);
    }
    await eventTodosRepo.addDep(todoId, dependsOnId);
    return c.json({ ok: true }, 201);
  },
);

eventTodoRoutes.delete(
  "/:id/todos/:todoId/deps/:dependsOnId",
  async (c) => {
    const eventId = c.req.param("id");
    const todoId = c.req.param("todoId");
    if (!(await eventTodosRepo.findInEvent(todoId, eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    await eventTodosRepo.removeDep(todoId, c.req.param("dependsOnId"));
    return c.json({ ok: true });
  },
);
