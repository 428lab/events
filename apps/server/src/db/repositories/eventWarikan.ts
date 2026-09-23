import { eventRun, eventWrite, type EventWriter } from "./eventWriteGuard.js";
import type {
  EventRole,
  ExpenseInput,
  PaymentInput,
  PayoutKind,
  PayoutMethodInput,
  WarikanExpense,
  WarikanLedger,
  WarikanMember,
  WarikanPayment,
  WarikanPayout,
} from "@eventer/shared";
import {
  WARIKAN_EXPENSE_MAX,
  WARIKAN_PAYMENT_MAX,
  allocateShares,
  settle,
} from "@eventer/shared";
import { many, one } from "../client.js";
import { DELETED_USER_DISCORD_ID } from "./accountDeletion.js";

/**
 * 割り勘 (#556)。設計は docs/warikan.md。
 *
 * 表は4つ（立替・負担・支払記録・受け取り先）だが、按分と精算という1つの手続きを
 * 共有するので1ファイルに置く。**計算は shared の純関数**（allocateShares / settle）で、
 * ここは行を読んで渡すだけ。各人の負担額・収支・精算の提案は列に持たず、読むたびに導出する。
 *
 * - 帳簿を見られる人の判定は LEDGER_AUDIENCE_SQL の1か所（GET と当事者としての書き込みが共用）
 * - 件数の上限は1文の条件付き INSERT で守る（数えてから入れる2文にしない）
 */

/**
 * 帳簿を見られる人（warikanAudience。設計 §3.7.1）。`event` と `user` は SQL の式。
 * そのイベントの確定メンバー（role 不問）か、帳簿の当事者（立替者・負担者・支払記録の
 * from / to）。閲覧権（canViewEvent）は前段の requireEventAccess と eventWrite の先頭が見る。
 */
export const LEDGER_AUDIENCE_SQL = (event: string, user: string): string => `(
  EXISTS (SELECT 1 FROM event_member am
           WHERE am.event_id = ${event} AND am.user_id = ${user} AND am.status = 'confirmed')
  OR EXISTS (SELECT 1 FROM event_expense ax
              WHERE ax.event_id = ${event} AND ax.payer_user_id = ${user})
  OR EXISTS (SELECT 1 FROM event_expense_share asx
               JOIN event_expense ax ON ax.id = asx.expense_id
              WHERE ax.event_id = ${event} AND asx.user_id = ${user})
  OR EXISTS (SELECT 1 FROM event_settlement_payment ap
              WHERE ap.event_id = ${event}
                AND (ap.from_user_id = ${user} OR ap.to_user_id = ${user})))`;

interface ExpenseRow {
  id: string;
  event_id: string;
  payer_user_id: string;
  amount: number;
  title: string;
  note: string;
  spent_on: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

interface ShareRow {
  expense_id: string;
  user_id: string;
  weight: number;
}

interface PaymentRow {
  id: string;
  event_id: string;
  from_user_id: string;
  to_user_id: string;
  amount: number;
  recorded_by: string | null;
  created_at: number;
}

interface PayoutRow {
  id: string;
  event_id: string;
  user_id: string;
  kind: string;
  value: string;
  created_at: number;
}

interface MemberRow {
  user_id: string;
  username: string;
  global_name: string | null;
  avatar_url: string | null;
  deleted: number;
  role: string | null;
  status: string | null;
  attended: number | null;
  joined_at: number | null;
}

/** 帳簿を読む人の立場。canEdit / canDelete の判定に使う（設計 §3.7.2） */
export interface WarikanViewer {
  userId: string;
  /** そのイベントの confirmed staff（isConfirmedEventStaff） */
  isStaff: boolean;
  /** そのイベントの確定メンバー（role 不問） */
  isConfirmed: boolean;
  /** 確定メンバーのうち observer 以外 */
  canAddExpense: boolean;
}

/** 権限の判定に使う立替の最小形 */
export interface ExpenseMeta {
  id: string;
  eventId: string;
  payerUserId: string;
  createdBy: string | null;
  shareUserIds: string[];
}

export interface PaymentMeta {
  id: string;
  eventId: string;
  fromUserId: string;
  toUserId: string;
  recordedBy: string | null;
}

export interface PayoutMeta {
  id: string;
  eventId: string;
  userId: string;
}

const STANDING_ORDER: Record<WarikanMember["standing"], number> = {
  confirmed: 0,
  former: 1,
  deleted: 2,
};

function toPayment(r: PaymentRow, viewer: WarikanViewer): WarikanPayment {
  return {
    id: r.id,
    fromUserId: r.from_user_id,
    toUserId: r.to_user_id,
    amount: r.amount,
    recordedBy: r.recorded_by,
    createdAt: r.created_at,
    canDelete:
      viewer.isStaff ||
      [r.recorded_by, r.from_user_id, r.to_user_id].includes(viewer.userId),
  };
}

function toPayout(r: PayoutRow, viewer: WarikanViewer): WarikanPayout {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind as PayoutKind,
    value: r.value,
    canDelete: viewer.isStaff || r.user_id === viewer.userId,
  };
}

/** 立替の編集・削除ができるか（設計 §3.7.2）。入力者本人は確定メンバーである間だけ */
function canEditExpense(createdBy: string | null, viewer: WarikanViewer): boolean {
  return viewer.isStaff || (viewer.isConfirmed && createdBy === viewer.userId);
}

function toExpense(r: ExpenseRow, shares: ShareRow[], viewer: WarikanViewer): WarikanExpense {
  const allocation = allocateShares({
    id: r.id,
    payerUserId: r.payer_user_id,
    amount: r.amount,
    shares: shares.map((s) => ({ userId: s.user_id, weight: s.weight })),
  });
  return {
    id: r.id,
    payerUserId: r.payer_user_id,
    amount: r.amount,
    title: r.title,
    note: r.note,
    spentOn: r.spent_on,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    shares: allocation.shares,
    remainder: allocation.remainder,
    absorbedByPayer: allocation.absorbedByPayer,
    canEdit: canEditExpense(r.created_by, viewer),
  };
}

function groupShares(rows: ShareRow[]): Map<string, ShareRow[]> {
  const out = new Map<string, ShareRow[]>();
  for (const r of rows) {
    const list = out.get(r.expense_id);
    if (list) list.push(r);
    else out.set(r.expense_id, [r]);
  }
  return out;
}

/** 負担行の置換・追加に使う1文。shares は JSON で渡す（D1 のバインド数の上限を避ける） */
function insertSharesSql(ownerOnly: boolean): string {
  return `INSERT INTO event_expense_share (expense_id, user_id, weight)
          SELECT ?1, json_extract(j.value, '$.userId'), json_extract(j.value, '$.weight')
            FROM json_each(?2) j
           WHERE EXISTS (SELECT 1 FROM event_expense
                          WHERE id = ?1${ownerOnly ? " AND created_by = ?3" : ""})`;
}

const sharesJson = (input: ExpenseInput): string =>
  JSON.stringify(input.shares.map((s) => ({ userId: s.userId, weight: s.weight })));

export const eventWarikanRepo = {
  /** 帳簿を見られる人か（設計 §3.7.1。門は LEDGER_AUDIENCE_SQL の1か所） */
  async isAudience(eventId: string, userId: string): Promise<boolean> {
    const row = await one<{ ok: number }>(
      `SELECT ${LEDGER_AUDIENCE_SQL("?1", "?2")} AS ok`,
      eventId,
      userId,
    );
    return row?.ok === 1;
  },

  /** userIds のうち、新しく負担者・立替者に指定できる人（設計 §3.7.3）:
   * 確定メンバー かつ role <> 'observer' かつ 退会申請中でない */
  async selectableUserIds(eventId: string, userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await many<{ user_id: string }>(
      `SELECT m.user_id FROM event_member m
         JOIN user u ON u.id = m.user_id AND u.deleted_at IS NULL
        WHERE m.event_id = ? AND m.status = 'confirmed' AND m.role <> 'observer'
          AND m.user_id IN (SELECT value FROM json_each(?))`,
      eventId,
      JSON.stringify(userIds),
    );
    return new Set(rows.map((r) => r.user_id));
  },

  async findExpense(id: string): Promise<ExpenseMeta | null> {
    const row = await one<ExpenseRow>("SELECT * FROM event_expense WHERE id = ?", id);
    if (!row) return null;
    const shares = await many<{ user_id: string }>(
      "SELECT user_id FROM event_expense_share WHERE expense_id = ?",
      id,
    );
    return {
      id: row.id,
      eventId: row.event_id,
      payerUserId: row.payer_user_id,
      createdBy: row.created_by,
      shareUserIds: shares.map((s) => s.user_id),
    };
  },

  async findPayment(id: string): Promise<PaymentMeta | null> {
    const row = await one<PaymentRow>("SELECT * FROM event_settlement_payment WHERE id = ?", id);
    return row
      ? {
          id: row.id,
          eventId: row.event_id,
          fromUserId: row.from_user_id,
          toUserId: row.to_user_id,
          recordedBy: row.recorded_by,
        }
      : null;
  },

  async findPayoutMethod(id: string): Promise<PayoutMeta | null> {
    const row = await one<PayoutRow>("SELECT * FROM event_payout_method WHERE id = ?", id);
    return row ? { id: row.id, eventId: row.event_id, userId: row.user_id } : null;
  },

  /** 立替1件の応答形（作成・編集の直後に返す） */
  async expenseView(id: string, viewer: WarikanViewer): Promise<WarikanExpense | null> {
    const row = await one<ExpenseRow>("SELECT * FROM event_expense WHERE id = ?", id);
    if (!row) return null;
    const shares = await many<ShareRow>(
      "SELECT expense_id, user_id, weight FROM event_expense_share WHERE expense_id = ? ORDER BY rowid",
      id,
    );
    return toExpense(row, shares, viewer);
  },

  async paymentView(id: string, viewer: WarikanViewer): Promise<WarikanPayment | null> {
    const row = await one<PaymentRow>("SELECT * FROM event_settlement_payment WHERE id = ?", id);
    return row ? toPayment(row, viewer) : null;
  },

  async payoutMethodsOf(
    eventId: string,
    userId: string,
    viewer: WarikanViewer,
  ): Promise<WarikanPayout[]> {
    const rows = await many<PayoutRow>(
      `SELECT * FROM event_payout_method WHERE event_id = ? AND user_id = ?
        ORDER BY created_at, rowid`,
      eventId,
      userId,
    );
    return rows.map((r) => toPayout(r, viewer));
  },

  /** 立替の追加。件数の上限は1文の条件付き INSERT で守り、負担行は同じ batch に置く
   * （上限で立替が入らなかったときに負担行だけが入らない）。
   * @returns 作成した id。上限で入らなければ null */
  async createExpense(
    eventId: string,
    actorId: string,
    input: ExpenseInput,
    writer: EventWriter,
  ): Promise<string | null> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const [inserted] = await eventWrite(writer, [
      {
        sql: `INSERT INTO event_expense
                (id, event_id, payer_user_id, amount, title, note, spent_on, created_by, created_at, updated_at)
              SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
               WHERE (SELECT COUNT(*) FROM event_expense WHERE event_id = ?) < ?`,
        args: [
          id,
          eventId,
          input.payerUserId,
          input.amount,
          input.title,
          input.note,
          input.spentOn,
          actorId,
          now,
          now,
          eventId,
          WARIKAN_EXPENSE_MAX,
        ],
      },
      { sql: insertSharesSql(false), args: [id, sharesJson(input)] },
    ]);
    return inserted ? id : null;
  },

  /** 立替の編集（全項目・負担行ごと置換）。ownerId を渡すと入力者本人の行だけに当たる。
   * @returns 更新したか */
  async updateExpense(
    id: string,
    eventId: string,
    input: ExpenseInput,
    ownerId: string | null,
    writer: EventWriter,
  ): Promise<boolean> {
    const owner = ownerId ? " AND created_by = ?3" : "";
    const ownerArgs = ownerId ? [ownerId] : [];
    const [updated] = await eventWrite(writer, [
      {
        sql: `UPDATE event_expense
                 SET payer_user_id = ?4, amount = ?5, title = ?6, note = ?7, spent_on = ?8, updated_at = ?9
               WHERE id = ?1 AND event_id = ?2${owner}`,
        args: [
          id,
          eventId,
          ownerId,
          input.payerUserId,
          input.amount,
          input.title,
          input.note,
          input.spentOn,
          Date.now(),
        ],
      },
      {
        sql: `DELETE FROM event_expense_share
               WHERE expense_id = ?1
                 AND EXISTS (SELECT 1 FROM event_expense WHERE id = ?1${ownerId ? " AND created_by = ?2" : ""})`,
        args: [id, ...ownerArgs],
      },
      { sql: insertSharesSql(ownerId !== null), args: [id, sharesJson(input), ...ownerArgs] },
    ]);
    return (updated ?? 0) > 0;
  },

  /** 立替の削除（負担行は CASCADE）。ownerId を渡すと入力者本人の行だけに当たる */
  async deleteExpense(
    id: string,
    eventId: string,
    ownerId: string | null,
    writer: EventWriter,
  ): Promise<boolean> {
    const changed = ownerId
      ? await eventRun(
          writer,
          "DELETE FROM event_expense WHERE id = ? AND event_id = ? AND created_by = ?",
          id,
          eventId,
          ownerId,
        )
      : await eventRun(writer, "DELETE FROM event_expense WHERE id = ? AND event_id = ?", id, eventId);
    return changed > 0;
  },

  async countPayments(eventId: string): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM event_settlement_payment WHERE event_id = ?",
      eventId,
    );
    return row?.n ?? 0;
  },

  /** 支払いの記録（当事者の自己申告）。件数の上限と「from・to の双方が帳簿を見られる人」を
   * 1文の INSERT の WHERE に畳む。partyActorId を渡すと「その人が from か to」も条件に足す
   * （当事者本人としての記録。staff の代理記録では null）。
   * @returns 作成した id。条件で入らなければ null（理由は呼び出し側が数えて区別する） */
  async createPayment(
    eventId: string,
    actorId: string,
    input: PaymentInput,
    partyActorId: string | null,
    writer: EventWriter,
  ): Promise<string | null> {
    const id = crypto.randomUUID();
    const [inserted] = await eventWrite(writer, [
      {
        sql: `INSERT INTO event_settlement_payment
                (id, event_id, from_user_id, to_user_id, amount, recorded_by, created_at)
              SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
               WHERE (SELECT COUNT(*) FROM event_settlement_payment WHERE event_id = ?2) < ?8
                 AND ${LEDGER_AUDIENCE_SQL("?2", "?3")}
                 AND ${LEDGER_AUDIENCE_SQL("?2", "?4")}
                 ${partyActorId ? "AND ?9 IN (?3, ?4)" : ""}`,
        args: [
          id,
          eventId,
          input.fromUserId,
          input.toUserId,
          input.amount,
          actorId,
          Date.now(),
          WARIKAN_PAYMENT_MAX,
          ...(partyActorId ? [partyActorId] : []),
        ],
      },
    ]);
    return inserted ? id : null;
  },

  /** 支払記録の取り消し。partyActorId を渡すと記録者・from・to のどれかがその人の行だけに当たる */
  async deletePayment(
    id: string,
    eventId: string,
    partyActorId: string | null,
    writer: EventWriter,
  ): Promise<boolean> {
    const changed = partyActorId
      ? await eventRun(
          writer,
          `DELETE FROM event_settlement_payment
            WHERE id = ?1 AND event_id = ?2
              AND ?3 IN (recorded_by, from_user_id, to_user_id)`,
          id,
          eventId,
          partyActorId,
        )
      : await eventRun(
          writer,
          "DELETE FROM event_settlement_payment WHERE id = ? AND event_id = ?",
          id,
          eventId,
        );
    return changed > 0;
  },

  /** 自分の受け取り先を置換する（本人だけ。帳簿を見られる人であることを同じ batch で確かめる） */
  async replacePayoutMethods(
    eventId: string,
    userId: string,
    methods: PayoutMethodInput[],
    writer: EventWriter,
  ): Promise<void> {
    const now = Date.now();
    await eventWrite(writer, [
      {
        sql: `DELETE FROM event_payout_method
               WHERE event_id = ?1 AND user_id = ?2 AND ${LEDGER_AUDIENCE_SQL("?1", "?2")}`,
        args: [eventId, userId],
      },
      ...methods.map((m) => ({
        sql: `INSERT INTO event_payout_method (id, event_id, user_id, kind, value, created_at)
              SELECT ?3, ?1, ?2, ?4, ?5, ?6
               WHERE ${LEDGER_AUDIENCE_SQL("?1", "?2")}`,
        args: [eventId, userId, crypto.randomUUID(), m.kind, m.value, now],
      })),
    ]);
  },

  /** 受け取り先の削除。ownerId を渡すと本人の行だけに当たる（帳簿を見られる人である間。staff は null） */
  async deletePayoutMethod(
    id: string,
    eventId: string,
    ownerId: string | null,
    writer: EventWriter,
  ): Promise<boolean> {
    const changed = ownerId
      ? await eventRun(
          writer,
          `DELETE FROM event_payout_method
            WHERE id = ?1 AND event_id = ?2 AND user_id = ?3 AND ${LEDGER_AUDIENCE_SQL("?2", "?3")}`,
          id,
          eventId,
          ownerId,
        )
      : await eventRun(
          writer,
          "DELETE FROM event_payout_method WHERE id = ? AND event_id = ?",
          id,
          eventId,
        );
    return changed > 0;
  },

  /** 帳簿の組み立て（GET の応答）。計算は shared の settle() に任せる */
  async ledger(eventId: string, viewer: WarikanViewer): Promise<WarikanLedger> {
    const expenseRows = await many<ExpenseRow>(
      "SELECT * FROM event_expense WHERE event_id = ? ORDER BY created_at DESC, id DESC",
      eventId,
    );
    const shareRows = await many<ShareRow>(
      `SELECT s.expense_id, s.user_id, s.weight
         FROM event_expense_share s JOIN event_expense x ON x.id = s.expense_id
        WHERE x.event_id = ? ORDER BY s.rowid`,
      eventId,
    );
    const paymentRows = await many<PaymentRow>(
      "SELECT * FROM event_settlement_payment WHERE event_id = ? ORDER BY created_at DESC, id DESC",
      eventId,
    );
    const payoutRows = await many<PayoutRow>(
      "SELECT * FROM event_payout_method WHERE event_id = ? ORDER BY user_id, created_at, rowid",
      eventId,
    );
    // 確定メンバー全員 ∪ 帳簿のどこかに登場する全員（入力者・記録者・受け取り先の持ち主を含む）。
    // 帳簿側の id は読んだ行から集めて JSON で渡す（D1 は UNION の項数に上限があるため）
    const ledgerIds = new Set<string>();
    for (const r of expenseRows) {
      ledgerIds.add(r.payer_user_id);
      if (r.created_by) ledgerIds.add(r.created_by);
    }
    for (const r of shareRows) ledgerIds.add(r.user_id);
    for (const r of paymentRows) {
      ledgerIds.add(r.from_user_id);
      ledgerIds.add(r.to_user_id);
      if (r.recorded_by) ledgerIds.add(r.recorded_by);
    }
    for (const r of payoutRows) ledgerIds.add(r.user_id);
    const memberRows = await many<MemberRow>(
      `SELECT u.id AS user_id, u.username, u.global_name, u.avatar_url,
              CASE WHEN u.deleted_at IS NOT NULL OR u.discord_id = ?2 THEN 1 ELSE 0 END AS deleted,
              m.role, m.status, m.attended, m.created_at AS joined_at
         FROM user u
         LEFT JOIN event_member m ON m.event_id = ?1 AND m.user_id = u.id
        WHERE u.id IN (SELECT user_id FROM event_member WHERE event_id = ?1 AND status = 'confirmed'
                       UNION SELECT value FROM json_each(?3))`,
      eventId,
      DELETED_USER_DISCORD_ID,
      JSON.stringify([...ledgerIds]),
    );

    const members: WarikanMember[] = memberRows
      .map((r): WarikanMember & { joinedAt: number | null } => {
        const deleted = r.deleted === 1;
        const confirmed = r.status === "confirmed";
        const standing = deleted ? "deleted" : confirmed ? "confirmed" : "former";
        return {
          userId: r.user_id,
          // 退会申請中・ghost は名前を出さない（#250。UI が「退会済みユーザー」と出す）
          displayName: deleted ? null : (r.global_name ?? r.username),
          avatarUrl: deleted ? null : r.avatar_url,
          role: (r.role as EventRole | null) ?? null,
          standing,
          attended: r.attended === 1,
          selectable: !deleted && confirmed && r.role !== "observer",
          joinedAt: r.joined_at,
        };
      })
      .sort(
        (a, b) =>
          STANDING_ORDER[a.standing] - STANDING_ORDER[b.standing] ||
          (a.joinedAt ?? Number.MAX_SAFE_INTEGER) - (b.joinedAt ?? Number.MAX_SAFE_INTEGER) ||
          (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
      )
      .map(({ joinedAt: _joinedAt, ...m }) => m);

    const sharesByExpense = groupShares(shareRows);
    const result = settle({
      expenses: expenseRows.map((r) => ({
        id: r.id,
        payerUserId: r.payer_user_id,
        amount: r.amount,
        shares: (sharesByExpense.get(r.id) ?? []).map((s) => ({
          userId: s.user_id,
          weight: s.weight,
        })),
      })),
      payments: paymentRows.map((r) => ({
        id: r.id,
        fromUserId: r.from_user_id,
        toUserId: r.to_user_id,
        amount: r.amount,
      })),
    });

    return {
      members,
      expenses: expenseRows.map((r) => toExpense(r, sharesByExpense.get(r.id) ?? [], viewer)),
      payments: paymentRows.map((r) => toPayment(r, viewer)),
      payoutMethods: payoutRows.map((r) => toPayout(r, viewer)),
      balances: result.balances,
      settlements: result.settlements,
      me: { userId: viewer.userId, canAddExpense: viewer.canAddExpense, isStaff: viewer.isStaff },
    };
  },
};
