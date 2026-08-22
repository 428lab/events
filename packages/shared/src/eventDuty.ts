import { z } from "zod";
import { todoAssigneeSchema, type TodoAssignee } from "./eventTodo.js";

/**
 * スタッフの役割タグと持ち場 (#384)。
 *
 * 3層: 役割の定義（イベントごと）→ 持ち場（時間帯 × 役割 × 必要人数）→
 * 割り当て（持ち場 × スタッフ）。「この時間帯は受付が2人」を先に置き、
 * あとから人を割り当てる。人数が先にあるから、埋まっていない持ち場が分かる。
 *
 * **`role` の語を使わない。** `event_member.role`（権限: staff/judge/…）と
 * 読み違えるため、こちらは `duty`（担当・持ち場）と呼ぶ。利用者向けの文言は
 * 従来どおり「役割」「持ち場」（実装の語を UI に出さない）。
 *
 * **参加者には1バイトも返さない。** 経路は `GET /:id/staffing` の1本だけで、
 * サブアプリ全体を `requireEventRole(["staff"])` で閉じる（設計 3.5）。
 *
 * 充足（埋まっているか）は**保存せず導出**する（設計 3.7）。導出は
 * `apps/web/src/lib/dutyBoard.ts` の純関数1か所。
 */

/* ── 上限（サーバーが強制する） ──────────────────────────── */

/** 役割の数。受付〜ケータリングの類で十数個が現実の上限 */
export const EVENT_DUTY_LIMIT = 30;

/** 役割名の長さ。タグ（チップ）に収まる長さ */
export const DUTY_NAME_MAX = 30;

/** 1つの時間帯に置ける持ち場の数。10種の役割が要る状態は項目の切り方が粗いサイン */
export const DUTY_SLOTS_PER_ITEM = 10;

/** 必要人数の上限。大規模イベントの受付でもこの内 */
export const DUTY_REQUIRED_MAX = 50;

/** 1つの持ち場への割り当ての数。必要数を超える割り当て（応援）は許すが無限にしない */
export const DUTY_ASSIGNEES_PER_SLOT = 50;

/* ── 型 ───────────────────────────────────────────────── */

/** 割り当てられる人／割り当てられている人。「担当に指定できる人」の契約は
 * TODO (#393) と同一（確定スタッフ・退会者を除く）なので型も1つを共用する。
 * 実体は `eventMembersRepo.assignableStaff` の1本（設計 6.3） */
export const dutyCandidateSchema = todoAssigneeSchema;
export type DutyCandidate = TodoAssignee;

/** 役割の定義。イベントごとに主催者が作る（既定のテンプレートは持たない。
 * #364 が未決のため。イベント複製が名前と並び順をコピーする） */
export interface StaffDuty {
  id: string;
  name: string;
  sortOrder: number;
}

/**
 * 割り当ての1件。**状態は列に持たず、取得のたびに導出する**（#393 6.3 と同じ）。
 *
 * - `active` … いまもこのイベントの確定スタッフで、退会していない
 * - `left`   … 行は残っているが上を満たさない（除名・降格・**退会申請中**）
 *
 * 完全削除 (#244) は FK CASCADE で**行ごと消える**ので、状態としては現れない
 * （持ち場は正しく「空き」に戻る）。
 */
export interface DutyAssignee {
  /** 割り当て行の id。外す操作はこれで指す（`"left"` では `user` を返さない
   * ため、`(slotId, userId)` を鍵にできない） */
  id: string;
  state: "active" | "left";
  /** `state === "active"` のときだけ入る。**`"left"` では必ず null**
   * （名前も userId も返さない。除名・降格・退会申請が混ざり、
   * 退会者の秘匿が最優先。#393 6.3 と同じ規則） */
  user: DutyCandidate | null;
}

/** 持ち場 ＝ 時間帯（#383 の項目）× 役割 × 必要人数。
 * 「受付が2人」は行1本＋ `requiredCount = 2`（人数ぶん行を作らない） */
export interface DutySlot {
  id: string;
  itemId: string;
  dutyId: string;
  requiredCount: number;
  assignees: DutyAssignee[];
}

export interface EventStaffingPayload {
  duties: StaffDuty[];
  /** 持ち場。項目の中に入れ子にせず平らに返す。画面はタイムテーブル
   * （staff audience の useEventSchedule）と itemId で突き合わせて描く */
  slots: DutySlot[];
  /** 割り当てられる人（= confirmed staff、退会者を除く） */
  assignable: DutyCandidate[];
}

/* ── 入力スキーマ ─────────────────────────────────────── */

const dutyName = z.string().trim().min(1).max(DUTY_NAME_MAX);

export const createDutyInput = z.object({ name: dutyName });
export type CreateDutyInput = z.infer<typeof createDutyInput>;

export const renameDutyInput = z.object({ name: dutyName });
export type RenameDutyInput = z.infer<typeof renameDutyInput>;

/** 並べ替え。そのイベントの全 id を並べて送る */
export const reorderDutiesInput = z.object({
  ids: z.array(z.string().max(64)).max(EVENT_DUTY_LIMIT),
});
export type ReorderDutiesInput = z.infer<typeof reorderDutiesInput>;

/**
 * その項目の持ち場一式。**宣言型**（送られた集合に合わせる。設計 6.2）。
 * サーバーは `dutyId` で差分を取り、残る持ち場の割り当て行は保持する
 * （人数だけ変えても人は外れない）。送られなかった持ち場は割り当てごと消える。
 *
 * `required` の 1〜`DUTY_REQUIRED_MAX` と本数の `DUTY_SLOTS_PER_ITEM` は
 * ここで弾かず**ルートが理由コード付きで弾く**（`duty_required_range` /
 * `duty_slot_limit`）。zod で弾くと理由の無い 400 になり、画面が案内できない。
 */
export const putItemSlotsInput = z.object({
  slots: z
    .array(
      z.object({
        dutyId: z.string().max(64),
        required: z.number().int(),
      }),
    )
    // 同じ役割を2行送る入力は宣言として矛盾している（UNIQUE (item_id, duty_id)）
    .refine(
      (slots) => new Set(slots.map((s) => s.dutyId)).size === slots.length,
      "同じ役割の持ち場を2つ送ることはできません",
    ),
});
export type PutItemSlotsInput = z.infer<typeof putItemSlotsInput>;

export const addDutyAssigneeInput = z.object({ userId: z.string().max(64) });
export type AddDutyAssigneeInput = z.infer<typeof addDutyAssigneeInput>;
