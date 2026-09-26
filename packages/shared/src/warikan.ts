import { z } from "zod";
import { EVENT_ROLES } from "./constants.js";
import { isDateOnly } from "./dateOnly.js";

/**
 * イベントの割り勘 (#556)。設計は docs/warikan.md。
 *
 * このアプリは送金も金銭の預託も換算もしない。持つのは帳簿（誰が・いくら・何に立て替え、
 * 誰が誰にいくら返すか）と受け取り先の掲示だけ（設計 §3.1）。金額は整数の円のみ（§3.2）。
 *
 * - 各人の負担額・収支・精算の提案は保存せず、読むたびにこのファイルの純関数で導出する
 * - 按分と精算の計算はここ1か所。サーバーはこれを呼ぶだけで、web は結果を表示するだけ
 */

/** 受け取り先の種別。銀行口座は保存しない（§3.6）ので、ここに足さない */
export const PAYOUT_KINDS = ["url", "lightning"] as const;
export type PayoutKind = (typeof PAYOUT_KINDS)[number];

/** 1イベントの立替の上限（1文の条件付き INSERT で守る） */
export const WARIKAN_EXPENSE_MAX = 200;
/** 1件の立替の負担者の上限 */
export const WARIKAN_SHARES_MAX = 500;
/** 1人がイベントごとに登録できる受け取り先の上限 */
export const WARIKAN_PAYOUT_MAX = 5;
/** 金額の上限（円）。打ち間違いを弾くため */
export const WARIKAN_AMOUNT_MAX = 10_000_000;
/** 重みの上限（入力時のみ。統合で合算された行は超えうる） */
export const WARIKAN_WEIGHT_MAX = 100;

/* ---------- 入力 ---------- */

const shareInput = z.object({
  userId: z.string().min(1),
  weight: z.number().int().min(1).max(WARIKAN_WEIGHT_MAX),
});

/** 立替の追加・編集（PATCH も全項目送り。shares ごと置換） */
export const expenseInput = z.object({
  payerUserId: z.string().min(1),
  amount: z.number().int().min(1).max(WARIKAN_AMOUNT_MAX),
  title: z.string().trim().min(1).max(100),
  note: z.string().max(500).default(""),
  spentOn: z.string().refine(isDateOnly).nullable().default(null),
  shares: z
    .array(shareInput)
    .min(1)
    .max(WARIKAN_SHARES_MAX)
    .refine((a) => new Set(a.map((s) => s.userId)).size === a.length, {
      message: "duplicate_share",
    }),
});
export type ExpenseInput = z.infer<typeof expenseInput>;

export const payoutMethodInput = z.discriminatedUnion("kind", [
  // 受け取り用リンク（PayPay / Kyash 等）。https のみ。アプリは開くだけで叩かない（§3.1）
  z.object({
    kind: z.literal("url"),
    value: z
      .string()
      .url()
      .max(500)
      .refine((u) => u.startsWith("https://")),
  }),
  // LN Address（user@domain）/ LNURL（lnurl1...）。解決も invoice 発行もしない
  z.object({
    kind: z.literal("lightning"),
    value: z
      .string()
      .min(3)
      .max(500)
      .regex(/^([^\s@]+@[^\s@.]+\.[^\s@]+|lnurl1[0-9a-z]+)$/i),
  }),
]);
export type PayoutMethodInput = z.infer<typeof payoutMethodInput>;

/** 自分の受け取り先を置換する（他人の userId はパスにも body にも無い） */
export const upsertPayoutMethodsInput = z.object({
  methods: z.array(payoutMethodInput).max(WARIKAN_PAYOUT_MAX),
});
export type UpsertPayoutMethodsInput = z.infer<typeof upsertPayoutMethodsInput>;

/* ---------- GET の応答 ---------- */

export const warikanMemberSchema = z.object({
  userId: z.string(),
  /** 退会申請中・ghost は null（UI が「退会済みユーザー」と出す） */
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  /** いまのロール。非メンバーは null */
  role: z.enum(EVENT_ROLES).nullable(),
  /** §3.7.4 の3分類 */
  standing: z.enum(["confirmed", "former", "deleted"]),
  /** event_member.attended */
  attended: z.boolean(),
  /** 新しく負担者・立替者に指定できるか（§3.7.3） */
  selectable: z.boolean(),
});
export type WarikanMember = z.infer<typeof warikanMemberSchema>;

export const warikanExpenseSchema = z.object({
  id: z.string(),
  payerUserId: z.string(),
  amount: z.number().int(),
  title: z.string(),
  note: z.string(),
  spentOn: z.string().nullable(),
  /** 「入力: ◯◯」の表示に使う */
  createdBy: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  shares: z.array(
    z.object({ userId: z.string(), weight: z.number().int(), amount: z.number().int() }),
  ),
  remainder: z.number().int(),
  absorbedByPayer: z.number().int(),
  /** サーバーが §3.7.2 で判定 */
  canEdit: z.boolean(),
});
export type WarikanExpense = z.infer<typeof warikanExpenseSchema>;

export const warikanPayoutSchema = z.object({
  id: z.string(),
  userId: z.string(),
  kind: z.enum(PAYOUT_KINDS),
  value: z.string(),
  canDelete: z.boolean(),
});
export type WarikanPayout = z.infer<typeof warikanPayoutSchema>;

export const warikanLedgerSchema = z.object({
  /** 確定メンバー全員 ∪ 帳簿のどこかに登場する全員（入力者・受け取り先の持ち主を含む）。
   * 並びは confirmed → former → deleted、その中は参加登録順（表示のためだけ。計算には使わない） */
  members: z.array(warikanMemberSchema),
  /** 新しい順 */
  expenses: z.array(warikanExpenseSchema),
  payoutMethods: z.array(warikanPayoutSchema),
  balances: z.array(
    z.object({
      userId: z.string(),
      paid: z.number().int(),
      owed: z.number().int(),
      net: z.number().int(),
    }),
  ),
  settlements: z.array(
    z.object({
      fromUserId: z.string(),
      toUserId: z.string(),
      amount: z.number().int(),
      breakdown: z.array(
        z.object({ kind: z.literal("expense"), expenseId: z.string(), amount: z.number().int() }),
      ),
    }),
  ),
  me: z.object({ userId: z.string(), canAddExpense: z.boolean(), isStaff: z.boolean() }),
});
export type WarikanLedger = z.infer<typeof warikanLedgerSchema>;

/* ---------- 純関数 ---------- */

export interface CalcShare {
  userId: string;
  weight: number;
}
export interface CalcExpense {
  id: string;
  payerUserId: string;
  amount: number;
  shares: CalcShare[];
}

export interface Allocation {
  /** 入力の shares と同じ順・同じ userId。立替者の行は端数を含む */
  shares: { userId: string; weight: number; amount: number }[];
  /** 全員の切り捨て合計との差（0 ≦ remainder < 負担者数）。表示用 */
  remainder: number;
  /** 立替者が負担者に居ないときにかぶった額（= remainder）。居るときは 0 */
  absorbedByPayer: number;
}

/**
 * §3.4 の按分。割り切れない端数は全部、立て替えた人が持つ。
 * 立替者以外の額は floor(amount × weight / Σweight) で、自分の重みと Σweight だけで決まる
 * （参加登録順などの順序キーに依存しない）。
 * shares は1件以上・userId 重複なしを前提（入力の zod が保証）
 */
export function allocateShares(expense: CalcExpense): Allocation {
  const total = expense.shares.reduce((sum, s) => sum + s.weight, 0);
  const floors = expense.shares.map((s) => Math.floor((expense.amount * s.weight) / total));
  const remainder = expense.amount - floors.reduce((sum, a) => sum + a, 0);
  const payerIncluded = expense.shares.some((s) => s.userId === expense.payerUserId);
  return {
    shares: expense.shares.map((s, i) => ({
      userId: s.userId,
      weight: s.weight,
      amount: s.userId === expense.payerUserId ? floors[i]! + remainder : floors[i]!,
    })),
    remainder,
    absorbedByPayer: payerIncluded ? 0 : remainder,
  };
}

/** 符号付き。正 = from→to の債務を増やす */
export type BreakdownItem = { kind: "expense"; expenseId: string; amount: number };

export interface Settlement {
  fromUserId: string;
  toUserId: string;
  /** > 0 */
  amount: number;
  /** Σ amount = Settlement.amount */
  breakdown: BreakdownItem[];
}

export interface Balance {
  userId: string;
  paid: number;
  owed: number;
  /** paid − owed。正 = 受け取る */
  net: number;
}

/** 辞書順（ロケールに依存させない） */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * §3.5 の精算。立替者への直接返済を積み上げ、双方向の債務を差額に相殺する。
 * 出力の並び: balances は入力に登場した userId の辞書順、settlements は (from, to) の辞書順。
 * 各行の breakdown は立替の id の辞書順（入力の並びに依存しない）
 */
export function settle(input: { expenses: CalcExpense[] }): {
  allocations: Record<string, Allocation>;
  balances: Balance[];
  settlements: Settlement[];
} {
  const allocations: Record<string, Allocation> = {};
  const balances = new Map<string, Balance>();
  const balanceOf = (userId: string): Balance => {
    let b = balances.get(userId);
    if (!b) {
      b = { userId, paid: 0, owed: 0, net: 0 };
      balances.set(userId, b);
    }
    return b;
  };

  // 順序つきの組 (債務者, 債権者) ごとの項目。値は「債務者 → 債権者」の向きで正
  type PairItem = BreakdownItem;
  const pairs = new Map<string, { debtor: string; creditor: string; items: PairItem[] }>();
  const addToPair = (debtor: string, creditor: string, item: PairItem) => {
    const key = `${debtor}\u0000${creditor}`;
    let p = pairs.get(key);
    if (!p) {
      p = { debtor, creditor, items: [] };
      pairs.set(key, p);
    }
    p.items.push(item);
  };

  // 1. 立替ごとに按分し、立替者以外の負担者 → 立替者の債務を積む
  for (const expense of input.expenses) {
    const allocation = allocateShares(expense);
    allocations[expense.id] = allocation;
    const payer = balanceOf(expense.payerUserId);
    payer.paid += expense.amount;
    payer.owed += allocation.absorbedByPayer;
    for (const share of allocation.shares) {
      balanceOf(share.userId).owed += share.amount;
      if (share.userId === expense.payerUserId || share.amount === 0) continue;
      addToPair(share.userId, expense.payerUserId, {
        kind: "expense",
        expenseId: expense.id,
        amount: share.amount,
      });
    }
  }

  // 2. 双方向を相殺する
  const settlements: Settlement[] = [];
  const seen = new Set<string>();
  for (const { debtor, creditor } of pairs.values()) {
    const [x, y] = cmp(debtor, creditor) < 0 ? [debtor, creditor] : [creditor, debtor];
    const unordered = `${x}\u0000${y}`;
    if (seen.has(unordered)) continue;
    seen.add(unordered);
    // x → y の向きに揃えた項目（y → x の項目は符号を反転）
    const xy = pairs.get(`${x}\u0000${y}`)?.items ?? [];
    const yx = (pairs.get(`${y}\u0000${x}`)?.items ?? []).map(
      (item): BreakdownItem => ({ ...item, amount: -item.amount }),
    );
    const items = [...xy, ...yx];
    const d = items.reduce((sum, item) => sum + item.amount, 0);
    if (d === 0) continue;
    const sign = d > 0 ? 1 : -1;
    const breakdown = items
      .map((item): BreakdownItem => ({ ...item, amount: item.amount * sign }))
      .sort((a, b) => cmp(a.expenseId, b.expenseId));
    settlements.push({
      fromUserId: d > 0 ? x : y,
      toUserId: d > 0 ? y : x,
      amount: Math.abs(d),
      breakdown,
    });
  }
  settlements.sort((a, b) => cmp(a.fromUserId, b.fromUserId) || cmp(a.toUserId, b.toUserId));

  // 3. 収支
  const balanceList = [...balances.values()].sort((a, b) => cmp(a.userId, b.userId));
  for (const b of balanceList) b.net = b.paid - b.owed;

  return { allocations, balances: balanceList, settlements };
}

/**
 * 「全員」「出席した人」の初期チェック（§3.9）。selectable な人だけを返す（並びは members の順）。
 * 「出席した人」は participant で attended の人 ＋ staff・judge
 * （出席チェックの対象外になりがちな運営を落とさない）
 */
export function presetShareUserIds(
  members: WarikanMember[],
  preset: "all" | "attended",
): string[] {
  return members
    .filter((m) => {
      if (!m.selectable) return false;
      if (preset === "all") return true;
      if (m.role === "staff" || m.role === "judge") return true;
      return m.role === "participant" && m.attended;
    })
    .map((m) => m.userId);
}

const yenNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 円の表示。ja `1,200円` / en `¥1,200` */
export function formatYen(amount: number, locale: "ja" | "en"): string {
  const sign = amount < 0 ? "-" : "";
  const digits = yenNumber.format(Math.abs(amount));
  return locale === "ja" ? `${sign}${digits}円` : `${sign}¥${digits}`;
}
