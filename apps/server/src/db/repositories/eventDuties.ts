import type { DutyAssignee, DutySlot, StaffDuty } from "@eventer/shared";
import { EVENT_DUTY_LIMIT } from "@eventer/shared";
import { batch, many, one, run } from "../client.js";

/**
 * スタッフの役割タグと持ち場 (#384)。
 *
 * **`event_staff_duty` / `event_duty_slot` / `event_duty_assignee` を読み書きする
 * SQL は、このファイルの中にしか無い。** これが本機能の不変条件で、
 * `test/staff-duty-sql-audit.test.ts` が機械で守る（#393 の監査と同じ仕掛け）。
 *
 * 参加者向けの読み手は**ゼロ**から始まる。`audience` のような引数を配り歩く
 * 代わりに「経路を1本も作らない」を守る。「タイムテーブルにも出そう」と
 * 思ったら、まず監査テストの許可リストに理由を書くこと。
 *
 * 持ち場は `event_schedule_item`（#383）にぶら下がるので、ここの SQL は
 * その表に JOIN する。それらは `staff-timeline-sql-audit.test.ts` にも映る
 * （staff 限定ルートからしか呼ばれない旨を ALLOWED に書いてある）。
 */

interface DutyRow {
  id: string;
  name: string;
  sort_order: number;
}

function toDuty(r: DutyRow): StaffDuty {
  return { id: r.id, name: r.name, sortOrder: r.sort_order };
}

interface SlotRow {
  id: string;
  item_id: string;
  duty_id: string;
  required_count: number;
}

interface AssigneeRow {
  id: string;
  slot_id: string;
  user_id: string;
  /** いまも「このイベントの確定スタッフ」で退会していないか（1/0）。
   * SQL 側で解いておく。呼び出し側に判断させると、`event_member` だけ見る
   * 実装が現れて**退会者の名前が出続ける**（eventTodos の TodoRow と同じ注意） */
  active: number;
  a_username: string | null;
  a_global_name: string | null;
  a_avatar_url: string | null;
}

/**
 * 割り当ての解決。**`user.deleted_at IS NULL` を必ず通す** (#250)。
 *
 * 退会申請では `event_member` の staff 行が**残る**ので、メンバー行だけを見ると
 * 退会した人の名前がスタッフの画面に出続ける。条件は eventTodos の
 * `ASSIGNEE_JOIN` と同じ（イベント id はこちらでは item から引く）。
 */
const ASSIGNEE_SELECT = `
  SELECT a.id, a.slot_id, a.user_id,
         CASE WHEN au.id IS NOT NULL AND am.user_id IS NOT NULL THEN 1 ELSE 0 END
           AS active,
         au.username AS a_username, au.global_name AS a_global_name,
         au.avatar_url AS a_avatar_url
    FROM event_duty_assignee a
    JOIN event_duty_slot s ON s.id = a.slot_id
    JOIN event_schedule_item i ON i.id = s.item_id
    LEFT JOIN user au ON au.id = a.user_id AND au.deleted_at IS NULL
    LEFT JOIN event_member am ON am.event_id = i.event_id
         AND am.user_id = a.user_id
         AND am.role = 'staff' AND am.status = 'confirmed'`;

function toAssignee(r: AssigneeRow): DutyAssignee {
  const active = r.active === 1;
  return {
    id: r.id,
    state: active ? "active" : "left",
    // **"left" では必ず null**。除名・降格・退会申請が混ざっており、
    // 退会は「他の利用者から見えなくなる」ことが目的なので名前も id も出せない
    user:
      active && r.a_username
        ? {
            id: r.user_id,
            username: r.a_username,
            globalName: r.a_global_name,
            avatarUrl: r.a_avatar_url,
          }
        : null,
  };
}

export const eventDutiesRepo = {
  /* ── 役割の定義 ─────────────────────────────────────── */

  async listDuties(eventId: string): Promise<StaffDuty[]> {
    const rows = await many<DutyRow>(
      `SELECT id, name, sort_order FROM event_staff_duty
        WHERE event_id = ? ORDER BY sort_order ASC, created_at ASC`,
      eventId,
    );
    return rows.map(toDuty);
  },

  async countDuties(eventId: string): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM event_staff_duty WHERE event_id = ?",
      eventId,
    );
    return row?.n ?? 0;
  },

  /** 所有チェックを兼ねる（`null` = このイベントの役割ではない → 404） */
  async findDutyInEvent(
    dutyId: string,
    eventId: string,
  ): Promise<StaffDuty | null> {
    const row = await one<DutyRow>(
      "SELECT id, name, sort_order FROM event_staff_duty WHERE id = ? AND event_id = ?",
      dutyId,
      eventId,
    );
    return row ? toDuty(row) : null;
  },

  /** 同名の役割が既に無いか（UNIQUE (event_id, name) を 400 で返すための事前確認） */
  async findDutyByName(
    eventId: string,
    name: string,
  ): Promise<StaffDuty | null> {
    const row = await one<DutyRow>(
      "SELECT id, name, sort_order FROM event_staff_duty WHERE event_id = ? AND name = ?",
      eventId,
      name,
    );
    return row ? toDuty(row) : null;
  },

  async createDuty(eventId: string, name: string): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const row = await one<{ n: number | null }>(
      "SELECT MAX(sort_order) AS n FROM event_staff_duty WHERE event_id = ?",
      eventId,
    );
    await run(
      `INSERT INTO event_staff_duty
         (id, event_id, name, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      eventId,
      name,
      (row?.n ?? -1) + 1,
      now,
      now,
    );
    return id;
  },

  async renameDuty(dutyId: string, name: string): Promise<void> {
    await run(
      "UPDATE event_staff_duty SET name = ?, updated_at = ? WHERE id = ?",
      name,
      Date.now(),
      dutyId,
    );
  },

  /** 並べ替え。**そのイベントの行しか動かさない**（他イベントの id が混ざっても効かない） */
  async reorderDuties(eventId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = Date.now();
    await batch(
      ids.map((id, i) => ({
        sql: "UPDATE event_staff_duty SET sort_order = ?, updated_at = ? WHERE id = ? AND event_id = ?",
        args: [i, now, id, eventId],
      })),
    );
  },

  /** 役割の削除。持ち場・割り当ては FK CASCADE で消える
   * （画面は使用数を出して確認を取ってから呼ぶ） */
  async removeDuty(dutyId: string): Promise<void> {
    await run("DELETE FROM event_staff_duty WHERE id = ?", dutyId);
  },

  /* ── 持ち場 ────────────────────────────────────────── */

  /** その時間帯（項目）がこのイベントのものか。持ち場を置く前の所有チェック。
   * placement / visibility は**問わない**（公開セッションにも裏方にも置ける。設計 3.3） */
  async itemInEvent(itemId: string, eventId: string): Promise<boolean> {
    const row = await one<{ id: string }>(
      "SELECT id FROM event_schedule_item WHERE id = ? AND event_id = ?",
      itemId,
      eventId,
    );
    return row !== null;
  },

  /** そのイベントの持ち場を割り当てごと全部。平らに返す（入れ子にしない） */
  async listSlots(eventId: string): Promise<DutySlot[]> {
    const rows = await many<SlotRow>(
      `SELECT s.id, s.item_id, s.duty_id, s.required_count
         FROM event_duty_slot s
         JOIN event_schedule_item i ON i.id = s.item_id
        WHERE i.event_id = ?
        ORDER BY s.created_at ASC`,
      eventId,
    );
    const assignees = await many<AssigneeRow>(
      `${ASSIGNEE_SELECT} WHERE i.event_id = ? ORDER BY a.created_at ASC`,
      eventId,
    );
    const bySlot = new Map<string, DutyAssignee[]>();
    for (const a of assignees) {
      const list = bySlot.get(a.slot_id);
      const mapped = toAssignee(a);
      if (list) list.push(mapped);
      else bySlot.set(a.slot_id, [mapped]);
    }
    return rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      dutyId: r.duty_id,
      requiredCount: r.required_count,
      assignees: bySlot.get(r.id) ?? [],
    }));
  },

  /** 所有チェックを兼ねる（slot → item → event の1本で辿る） */
  async findSlotInEvent(
    slotId: string,
    eventId: string,
  ): Promise<{ id: string; itemId: string; dutyId: string } | null> {
    const row = await one<SlotRow>(
      `SELECT s.id, s.item_id, s.duty_id, s.required_count
         FROM event_duty_slot s
         JOIN event_schedule_item i ON i.id = s.item_id
        WHERE s.id = ? AND i.event_id = ?`,
      slotId,
      eventId,
    );
    return row ? { id: row.id, itemId: row.item_id, dutyId: row.duty_id } : null;
  },

  /**
   * その項目の持ち場一式を、送られた集合に合わせる（宣言型。設計 6.2）。
   *
   * `duty_id` で差分を取る:
   * - 残る持ち場は `required_count` だけ更新（**割り当て行は保持**。
   *   人数だけ変えても人は外れない）
   * - 送られなかった持ち場は削除（割り当ては FK CASCADE で消える。
   *   画面は割り当てが付いた持ち場を消すとき確認を取る）
   *
   * 呼び出し側が済ませていること: item の所有チェック・dutyId の所有チェック・
   * 本数と人数の上限チェック。
   */
  async setSlotsForItem(
    itemId: string,
    slots: Array<{ dutyId: string; required: number }>,
  ): Promise<void> {
    const current = await many<{ id: string; duty_id: string; required_count: number }>(
      "SELECT id, duty_id, required_count FROM event_duty_slot WHERE item_id = ?",
      itemId,
    );
    const wanted = new Map(slots.map((s) => [s.dutyId, s.required]));
    const now = Date.now();
    const stmts: Array<{ sql: string; args: unknown[] }> = [];
    for (const c of current) {
      const required = wanted.get(c.duty_id);
      if (required === undefined) {
        stmts.push({
          sql: "DELETE FROM event_duty_slot WHERE id = ?",
          args: [c.id],
        });
      } else if (required !== c.required_count) {
        stmts.push({
          sql: "UPDATE event_duty_slot SET required_count = ?, updated_at = ? WHERE id = ?",
          args: [required, now, c.id],
        });
      }
    }
    const existing = new Set(current.map((c) => c.duty_id));
    for (const s of slots) {
      if (existing.has(s.dutyId)) continue;
      stmts.push({
        sql: `INSERT INTO event_duty_slot
                (id, item_id, duty_id, required_count, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [crypto.randomUUID(), itemId, s.dutyId, s.required, now, now],
      });
    }
    if (stmts.length > 0) await batch(stmts);
  },

  /* ── 割り当て ──────────────────────────────────────── */

  /** その持ち場の割り当て行の数（上限判定。active かどうかは問わない） */
  async countAssignees(slotId: string): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM event_duty_assignee WHERE slot_id = ?",
      slotId,
    );
    return row?.n ?? 0;
  },

  /** 二重割り当ての事前確認（UNIQUE (slot_id, user_id) を 400 で返すため） */
  async hasAssignee(slotId: string, userId: string): Promise<boolean> {
    const row = await one<{ id: string }>(
      "SELECT id FROM event_duty_assignee WHERE slot_id = ? AND user_id = ?",
      slotId,
      userId,
    );
    return row !== null;
  },

  async addAssignee(slotId: string, userId: string): Promise<string> {
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO event_duty_assignee (id, slot_id, user_id, created_at)
       VALUES (?, ?, ?, ?)`,
      id,
      slotId,
      userId,
      Date.now(),
    );
    return id;
  },

  /** 所有チェックを兼ねる（assignee → slot → item → event の1本で辿る）。
   * 外す操作は行の id で指す（`"left"` の行は user を画面に返していないため） */
  async assigneeInSlot(
    assigneeId: string,
    slotId: string,
    eventId: string,
  ): Promise<boolean> {
    const row = await one<{ id: string }>(
      `SELECT a.id
         FROM event_duty_assignee a
         JOIN event_duty_slot s ON s.id = a.slot_id
         JOIN event_schedule_item i ON i.id = s.item_id
        WHERE a.id = ? AND a.slot_id = ? AND i.event_id = ?`,
      assigneeId,
      slotId,
      eventId,
    );
    return row !== null;
  },

  async removeAssignee(assigneeId: string): Promise<void> {
    await run("DELETE FROM event_duty_assignee WHERE id = ?", assigneeId);
  },

  /* ── イベントの複製 (#384 設計 7.) ──────────────────── */

  /**
   * 複製で役割の定義（名前・並び順）だけをコピーする。
   *
   * 持ち場と割り当てはコピーしない（**できない**）: 複製はタイムテーブルを
   * コピーしないので、ぶら下げる先の項目が複製先に存在しない。
   * これが「既定のテンプレートを持たない」（設計 3.4）の代わり。
   */
  async copyForDuplicate(
    srcEventId: string,
    destEventId: string,
  ): Promise<void> {
    const rows = await many<{ name: string; sort_order: number }>(
      `SELECT name, sort_order FROM event_staff_duty
        WHERE event_id = ? ORDER BY sort_order ASC, created_at ASC
        LIMIT ?`,
      srcEventId,
      EVENT_DUTY_LIMIT,
    );
    if (rows.length === 0) return;
    const now = Date.now();
    await batch(
      rows.map((r) => ({
        sql: `INSERT INTO event_staff_duty
                (id, event_id, name, sort_order, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [crypto.randomUUID(), destEventId, r.name, r.sort_order, now, now],
      })),
    );
  },
};
