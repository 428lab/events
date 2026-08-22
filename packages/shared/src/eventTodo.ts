import { z } from "zod";
import { isDateOnly } from "./dateOnly.js";

/**
 * スタッフ向けの準備 TODO とガントチャート (#393)。
 *
 * 扱うのは**イベント当日より前**の仕事（会場を押さえる・告知を出す・備品を買う）で、
 * 単位は日〜週。当日の段取り (#383 の `event_schedule_item`) とは時間軸が違うので
 * **同じ仕組みに載せない**。
 *
 * ここが持つのは型・入力スキーマ・上限の3つ。日付の加減算は `dateOnly.ts`、
 * 「待ち」「遅れ」の導出は画面側（見ている人の「今日」に依存するため）。
 */

/* ── 上限（サーバーが強制する） ──────────────────────────── */

/** 1イベントの TODO の上限。一覧を全件返しガントを全行描く前提で、
 * 循環判定の BFS の計算量もこれで上限が付く（`EVENT_QUESTION_LIMIT` と同じ考え方） */
export const EVENT_TODO_LIMIT = 300;

/** 1つの TODO が待てる本数。10 個も待つ状態は線が読めない＝ガントとして機能していない */
export const TODO_DEPS_PER_ITEM = 10;

/** 題名の上限。ガントの行ラベルに入る長さ */
export const TODO_TITLE_MAX = 120;

/** 補足の上限。ここを手順書を書く場所にしない */
export const TODO_NOTE_MAX = 1000;

/** ガントに描く幅（日）。列数の上限＝画面が固まらないことの保証 */
export const TODO_GANTT_WINDOW_DAYS = 120;

/* ── 日付 ─────────────────────────────────────────────── */

/**
 * 日付は `'YYYY-MM-DD'` の TEXT。**epoch ms にしない。**
 *
 * UTC 0時で保存した 9/1 をローカル整形で描くと 8/31 に見える人が出る
 * （同じ期限が人によって別の日になる）。TEXT の辞書順がそのまま日付順なので
 * `ORDER BY` も比較もそのまま効き、`<input type="date">` の `value` と同じ形なので
 * 画面の端で変換が要らない。
 *
 * 加減算は `dateOnly.ts` が持つ（`addDays` / `diffDays` / `dayOfWeek` /
 * `isDateOnly` / `todayDateOnly`）。**実装をここに書き写さない。**
 */

/* ── 型 ───────────────────────────────────────────────── */

/** 担当に指定できる人／担当している人（イベントメンバーから解決したユーザー情報） */
export const todoAssigneeSchema = z.object({
  id: z.string(),
  username: z.string(),
  globalName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type TodoAssignee = z.infer<typeof todoAssigneeSchema>;

/**
 * 担当の状態。**列としては持たず、取得のたびに導出する**。
 *
 * - `unassigned` … 誰も割り当てていない
 * - `active`     … いまもこのイベントの確定スタッフで、退会していない
 * - `left`       … 担当は入っているが上を満たさない
 *                  （除名・脱退・staff から降格・**退会申請中**）
 *
 * 列にして「外れたとき消して回る」形にすると、メンバーが外れる経路
 * （除名・脱退・降格・退会）の数だけ同じ契約が散る。導出なら1か所で済む。
 */
export type TodoAssigneeState = "unassigned" | "active" | "left";

/** 状態。2値だけ。「待ち」も「遅れ」も**保存しない**（依存先と今日から導出する） */
export type EventTodoStatus = "open" | "done";

export interface EventTodo {
  id: string;
  title: string;
  note: string | null;
  /** 'YYYY-MM-DD'。null なら開始未定 */
  startsOn: string | null;
  /** 'YYYY-MM-DD'。null なら期限未定 */
  dueOn: string | null;
  status: EventTodoStatus;
  doneAt: number | null;
  assigneeState: TodoAssigneeState;
  /** `assigneeState === "active"` のときだけ入る。**`"left"` では必ず null**。
   * `"left"` には退会申請 (#250) が混ざり、退会は「他の利用者から見えなくなる」
   * ことが目的なので名前を出せない。3つを区別して出し分けると、
   * 1つ間違えたときに退会者の名前が出る。1つの規則にする */
  assignee: TodoAssignee | null;
  sortOrder: number;
}

/** 依存の辺。`todoId` の仕事は `dependsOnId` が `done` になるまで着手できない。
 * **種類は1つだけ**（SS / FF / SF もラグも作らない） */
export interface EventTodoDep {
  todoId: string;
  dependsOnId: string;
}

export interface EventTodosPayload {
  todos: EventTodo[];
  /** 辺は項目の中に入れず平らに返す。ガントの線も待ちの判定も
   * 全体のグラフが要るので、項目ごとに切って持たせる意味がない */
  deps: EventTodoDep[];
  /** 担当に指定できる人（このイベントの確定スタッフ・退会者を除く）。
   * **`todos` の中の `assignee` とは別物**で、担当を外れた人はここに居ない */
  assignable: TodoAssignee[];
}

/* ── 入力スキーマ ─────────────────────────────────────── */

const dateOnlyInput = z
  .string()
  .refine(isDateOnly, "日付は YYYY-MM-DD 形式の実在する日で指定してください");

/**
 * **省略されたキーは「いまの値を保つ」。`.default()` を書かない。**
 *
 * #383 は `visibility` に `.default("public")` を書いたせいで、その列を知らない
 * 古いクライアントの保存が裏方を全件公開に戻す穴を作りかけた。ここは部分更新なので
 * 構造的に同じ穴は空かないが、**既定値を埋める書き方をしない**規則自体をそろえる。
 *
 * 日付と担当は `null` を**明示できる**必要がある（日付を消す・担当を外す）。
 * `z.…nullable().optional()` で
 * **「キーが無い＝保つ」/「`null`＝消す」** を区別する。読んだ人が `undefined` と
 * `null` を取り違えると、チェックを外したつもりで担当が消える。
 */
export const createTodoInput = z.object({
  title: z.string().trim().min(1).max(TODO_TITLE_MAX),
  note: z.string().max(TODO_NOTE_MAX).nullable().optional(),
  startsOn: dateOnlyInput.nullable().optional(),
  dueOn: dateOnlyInput.nullable().optional(),
  assigneeUserId: z.string().max(64).nullable().optional(),
});
export type CreateTodoInput = z.infer<typeof createTodoInput>;

/** 更新。**送ったキーだけ変える**（上のコメントの区別がそのまま効く） */
export const updateTodoInput = z.object({
  title: z.string().trim().min(1).max(TODO_TITLE_MAX).optional(),
  note: z.string().max(TODO_NOTE_MAX).nullable().optional(),
  startsOn: dateOnlyInput.nullable().optional(),
  dueOn: dateOnlyInput.nullable().optional(),
  assigneeUserId: z.string().max(64).nullable().optional(),
  status: z.enum(["open", "done"]).optional(),
});
export type UpdateTodoInput = z.infer<typeof updateTodoInput>;

/** 並べ替え。そのイベントの全 id を並べて送る */
export const reorderTodosInput = z.object({
  ids: z.array(z.string().max(64)).max(EVENT_TODO_LIMIT),
});
export type ReorderTodosInput = z.infer<typeof reorderTodosInput>;

/** 依存を足す。`dependsOnId` が**同じイベントの項目であること**はサーバーが確かめる */
export const addTodoDepInput = z.object({
  dependsOnId: z.string().max(64),
});
export type AddTodoDepInput = z.infer<typeof addTodoDepInput>;
