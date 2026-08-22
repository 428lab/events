import {
  EVENT_TODO_LIMIT,
  TODO_DEPS_PER_ITEM,
  type EventTodo,
  type EventTodoDep,
  type TodoAssignee,
} from "@eventer/shared";
import { batch, many, one, run } from "../client.js";

/**
 * スタッフ向けの準備 TODO (#393)。
 *
 * **`event_todo` / `event_todo_dep` を読み書きする SQL は、このファイルの中にしか無い。**
 * これが本機能の不変条件で、`test/staff-todo-sql-audit.test.ts` が機械で守る。
 *
 * #383 は「絞り込みは1か所」と書いてあったのに実際は8か所だった、というところから
 * 始めなければならなかった。こちらは参加者向けの読み手が**ゼロ**から始まるので、
 * `audience` のような引数を配り歩く代わりに「経路を1本も作らない」を守る。
 * 「イベント詳細にも出そう」と思ったら、まず監査テストの許可リストに理由を書くこと。
 */

interface TodoRow {
  id: string;
  title: string;
  note: string | null;
  starts_on: string | null;
  due_on: string | null;
  status: string;
  done_at: number | null;
  assignee_user_id: string | null;
  sort_order: number;
  /** 担当がいまも「このイベントの確定スタッフ」で退会していないか（1/0）。
   * SQL 側で解いておく。ここを呼び出し側に判断させると、
   * `event_member` だけ見る実装が現れて**退会者の名前が出続ける** */
  assignee_active: number;
  a_username: string | null;
  a_global_name: string | null;
  a_avatar_url: string | null;
}

/**
 * 担当の解決。**`user.deleted_at IS NULL` を必ず通す** (#250)。
 *
 * 退会申請では `event_member` の staff 行が**残る**ので、メンバー行だけを見ると
 * 退会した人の名前がスタッフの画面に出続ける（#250 の目的が果たされない）。
 * ここが本機能でいちばん落ちやすい場所なので、条件を1つの断片に閉じて
 * 取得系すべてがこれを通る形にする。
 */
const ASSIGNEE_JOIN = `
  LEFT JOIN user au ON au.id = t.assignee_user_id AND au.deleted_at IS NULL
  LEFT JOIN event_member am ON am.event_id = t.event_id
       AND am.user_id = t.assignee_user_id
       AND am.role = 'staff' AND am.status = 'confirmed'`;

const SELECT_TODOS = `SELECT t.id, t.title, t.note, t.starts_on, t.due_on, t.status,
         t.done_at, t.assignee_user_id, t.sort_order,
         CASE WHEN au.id IS NOT NULL AND am.user_id IS NOT NULL THEN 1 ELSE 0 END
           AS assignee_active,
         au.username AS a_username, au.global_name AS a_global_name,
         au.avatar_url AS a_avatar_url
    FROM event_todo t${ASSIGNEE_JOIN}`;

function toTodo(r: TodoRow): EventTodo {
  const active = r.assignee_active === 1;
  return {
    id: r.id,
    title: r.title,
    note: r.note,
    startsOn: r.starts_on,
    dueOn: r.due_on,
    status: r.status === "done" ? "done" : "open",
    doneAt: r.done_at,
    // 完全削除 (#244) では FK の SET NULL で列が NULL に落ちるので "unassigned"。
    // "left" と区別が付かないが、それが正しい（痕跡を残さない）
    assigneeState: !r.assignee_user_id
      ? "unassigned"
      : active
        ? "active"
        : "left",
    // **"left" では必ず null**。除名・降格・退会申請が混ざっており、
    // 退会は「他の利用者から見えなくなる」ことが目的なので名前を出せない
    assignee:
      active && r.a_username
        ? {
            id: r.assignee_user_id!,
            username: r.a_username,
            globalName: r.a_global_name,
            avatarUrl: r.a_avatar_url,
          }
        : null,
    sortOrder: r.sort_order,
  };
}

/** 更新で「送られたキーだけ変える」ための入力。
 * `undefined` = 保つ / `null` = 消す（この区別が崩れると担当が黙って消える） */
export interface TodoPatch {
  title?: string;
  note?: string | null;
  startsOn?: string | null;
  dueOn?: string | null;
  assigneeUserId?: string | null;
  status?: "open" | "done";
}

/** 列名と、`TodoPatch` のキーの対応。SQL を組み立てるのはここだけ */
const PATCH_COLUMNS: Array<[keyof TodoPatch, string]> = [
  ["title", "title"],
  ["note", "note"],
  ["startsOn", "starts_on"],
  ["dueOn", "due_on"],
  ["assigneeUserId", "assignee_user_id"],
];

export const eventTodosRepo = {
  /** 一覧（`sort_order` 順）。件数は上限で頭打ちなのでページングしない */
  async listByEvent(eventId: string): Promise<EventTodo[]> {
    const rows = await many<TodoRow>(
      `${SELECT_TODOS} WHERE t.event_id = ? ORDER BY t.sort_order ASC, t.created_at ASC`,
      eventId,
    );
    return rows.map(toTodo);
  },

  /** そのイベントの依存の辺を全部。**平らに返す**（グラフ全体が要るため） */
  async listDeps(eventId: string): Promise<EventTodoDep[]> {
    const rows = await many<{ todo_id: string; depends_on_id: string }>(
      `SELECT d.todo_id, d.depends_on_id
         FROM event_todo_dep d
         JOIN event_todo t ON t.id = d.todo_id
        WHERE t.event_id = ?
        ORDER BY d.created_at ASC`,
      eventId,
    );
    return rows.map((r) => ({ todoId: r.todo_id, dependsOnId: r.depends_on_id }));
  },

  /**
   * 担当に指定できる人。**確定スタッフかつ退会していない人だけ**。
   *
   * `deleted_at` を落とすと退会者が選択肢に並ぶ。`ASSIGNEE_JOIN` と同じ条件で
   * なければならない（ここが緩いと「選べるのに `left` になる」人が出る）。
   */
  async assignableStaff(eventId: string): Promise<TodoAssignee[]> {
    const rows = await many<{
      id: string;
      username: string;
      global_name: string | null;
      avatar_url: string | null;
    }>(
      `SELECT u.id, u.username, u.global_name, u.avatar_url
         FROM event_member m
         JOIN user u ON u.id = m.user_id AND u.deleted_at IS NULL
        WHERE m.event_id = ? AND m.role = 'staff' AND m.status = 'confirmed'
        ORDER BY m.created_at ASC`,
      eventId,
    );
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      globalName: r.global_name,
      avatarUrl: r.avatar_url,
    }));
  },

  /**
   * そのイベントに属する TODO を1件。**所有チェックと現在値の取得を兼ねる。**
   *
   * 「他イベントの id ではないか」と「送られなかったキーの現在値は何か」は
   * 部分更新のたびに両方要る。2つのメソッドに分けると呼び出し側が必ず
   * 2回問い合わせるので、1つにして `null` が所有チェックの答えを兼ねる。
   */
  async findInEvent(todoId: string, eventId: string): Promise<EventTodo | null> {
    const row = await one<TodoRow>(
      `${SELECT_TODOS} WHERE t.id = ? AND t.event_id = ?`,
      todoId,
      eventId,
    );
    return row ? toTodo(row) : null;
  },

  async countByEvent(eventId: string): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM event_todo WHERE event_id = ?",
      eventId,
    );
    return row?.n ?? 0;
  },

  async create(input: {
    eventId: string;
    createdBy: string;
    title: string;
    note: string | null;
    startsOn: string | null;
    dueOn: string | null;
    assigneeUserId: string | null;
  }): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const row = await one<{ n: number | null }>(
      "SELECT MAX(sort_order) AS n FROM event_todo WHERE event_id = ?",
      input.eventId,
    );
    await run(
      `INSERT INTO event_todo
         (id, event_id, title, note, starts_on, due_on, status,
          assignee_user_id, created_by, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
      id,
      input.eventId,
      input.title,
      input.note,
      input.startsOn,
      input.dueOn,
      input.assigneeUserId,
      input.createdBy,
      (row?.n ?? -1) + 1,
      now,
      now,
    );
    return id;
  },

  /**
   * 部分更新。**送られたキーだけ**を書く。
   *
   * `status` を `done` にした時だけ `done_at` を入れ、`open` へ戻すと消す。
   * 状態と時刻を別々に受けると、片方だけ送られたときに矛盾する。
   */
  async update(todoId: string, patch: TodoPatch): Promise<void> {
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [key, col] of PATCH_COLUMNS) {
      if (patch[key] === undefined) continue;
      sets.push(`${col} = ?`);
      args.push(patch[key]);
    }
    if (patch.status !== undefined) {
      sets.push("status = ?", "done_at = ?");
      args.push(patch.status, patch.status === "done" ? Date.now() : null);
    }
    if (sets.length === 0) return;
    sets.push("updated_at = ?");
    args.push(Date.now(), todoId);
    await run(`UPDATE event_todo SET ${sets.join(", ")} WHERE id = ?`, ...args);
  },

  /** 削除。依存の辺は FK CASCADE で消える */
  async remove(todoId: string): Promise<void> {
    await run("DELETE FROM event_todo WHERE id = ?", todoId);
  },

  /** 並べ替え。**そのイベントの行しか動かさない**（他イベントの id が混ざっても効かない） */
  async reorder(eventId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = Date.now();
    await batch(
      ids.map((id, i) => ({
        sql: "UPDATE event_todo SET sort_order = ?, updated_at = ? WHERE id = ? AND event_id = ?",
        args: [i, now, id, eventId],
      })),
    );
  },

  /** その TODO が待っている本数（上限判定） */
  async countDeps(todoId: string): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM event_todo_dep WHERE todo_id = ?",
      todoId,
    );
    return row?.n ?? 0;
  },

  /**
   * `from` から辺をたどって `target` に到達できるか（**辺を足す前**に呼ぶ）。
   *
   * `A → B`（A が B を待つ）を足すとき、**B から A へ既に到達できるか**を見る。
   * 到達できるなら循環になるので書かせない。自己参照 (`A → A`) も同じ判定で落ちる。
   *
   * イベント1つぶんの辺を全部読んで JS で BFS する。`WITH RECURSIVE` でも書けるが、
   * 終了条件を SQL で正しく書くより JS のほうが読めてテストしやすい。
   * 件数は `EVENT_TODO_LIMIT` × `TODO_DEPS_PER_ITEM` で上限が付く。
   *
   * **訪問済み集合を持つので、既に循環が入っているデータでも必ず終わる。**
   */
  async canReach(eventId: string, from: string, target: string): Promise<boolean> {
    if (from === target) return true;
    const edges = await this.listDeps(eventId);
    const next = new Map<string, string[]>();
    for (const e of edges) {
      const list = next.get(e.todoId);
      if (list) list.push(e.dependsOnId);
      else next.set(e.todoId, [e.dependsOnId]);
    }
    const seen = new Set<string>([from]);
    const queue = [from];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const to of next.get(cur) ?? []) {
        if (to === target) return true;
        if (seen.has(to)) continue;
        seen.add(to);
        queue.push(to);
      }
    }
    return false;
  },

  async addDep(todoId: string, dependsOnId: string): Promise<void> {
    await run(
      `INSERT OR IGNORE INTO event_todo_dep (todo_id, depends_on_id, created_at)
       VALUES (?, ?, ?)`,
      todoId,
      dependsOnId,
      Date.now(),
    );
  },

  async removeDep(todoId: string, dependsOnId: string): Promise<void> {
    await run(
      "DELETE FROM event_todo_dep WHERE todo_id = ? AND depends_on_id = ?",
      todoId,
      dependsOnId,
    );
  },

  /**
   * イベントの複製で TODO を持ち越す (#393 設計 7.)。
   *
   * コピーするのは題名・補足・依存の辺・並び順。
   * **日付・担当・状態はコピーしない。** 複製は開催日時を 0 に戻すので、
   * 期限を持ち越すと「作った瞬間に全部が遅れになった段取り」ができる
   * （募集締切と抽選日時を複製しない既存の判断とまったく同じ理由）。
   *
   * 辺の張り替え（旧 id → 新 id）はこの中に閉じる。呼び出し側に
   * 対応表を持たせると、この表を触る SQL がリポジトリの外に出る。
   */
  async copyForDuplicate(
    srcEventId: string,
    destEventId: string,
    createdBy: string,
  ): Promise<void> {
    const rows = await many<{ id: string; title: string; note: string | null; sort_order: number }>(
      `SELECT id, title, note, sort_order FROM event_todo
        WHERE event_id = ? ORDER BY sort_order ASC, created_at ASC
        LIMIT ?`,
      srcEventId,
      EVENT_TODO_LIMIT,
    );
    if (rows.length === 0) return;
    const now = Date.now();
    const idMap = new Map<string, string>();
    for (const r of rows) idMap.set(r.id, crypto.randomUUID());
    await batch(
      rows.map((r) => ({
        sql: `INSERT INTO event_todo
                (id, event_id, title, note, starts_on, due_on, status,
                 assignee_user_id, created_by, sort_order, created_at, updated_at)
              VALUES (?, ?, ?, ?, NULL, NULL, 'open', NULL, ?, ?, ?, ?)`,
        args: [idMap.get(r.id)!, destEventId, r.title, r.note, createdBy, r.sort_order, now, now],
      })),
    );
    const deps = await this.listDeps(srcEventId);
    const mapped = deps
      .filter((d) => idMap.has(d.todoId) && idMap.has(d.dependsOnId))
      .slice(0, EVENT_TODO_LIMIT * TODO_DEPS_PER_ITEM);
    if (mapped.length === 0) return;
    await batch(
      mapped.map((d) => ({
        sql: `INSERT OR IGNORE INTO event_todo_dep (todo_id, depends_on_id, created_at)
              VALUES (?, ?, ?)`,
        args: [idMap.get(d.todoId)!, idMap.get(d.dependsOnId)!, now],
      })),
    );
  },
};
