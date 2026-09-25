import { describe, it, expect } from "vitest";
import {
  allocateShares,
  formatYen,
  presetShareUserIds,
  settle,
  type CalcExpense,
  type WarikanMember,
} from "@eventer/shared";

/** 割り勘の按分・精算の純関数 (#556)。設計 docs/warikan.md §3.4 / §3.5 / §5.1 */

const amountsOf = (expense: CalcExpense) =>
  Object.fromEntries(allocateShares(expense).shares.map((s) => [s.userId, s.amount]));

const netOf = (balances: { userId: string; net: number }[]) =>
  Object.fromEntries(balances.map((b) => [b.userId, b.net]));

/** 決定的な乱数（テストを再現可能にする） */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("allocateShares: 端数は全部、立て替えた人が持つ (§3.4)", () => {
  it("1,002円を4人（立替者を含む）→ 250・250・250・立替者 252", () => {
    const a = allocateShares({
      id: "e1",
      payerUserId: "A",
      amount: 1002,
      shares: ["A", "B", "C", "D"].map((userId) => ({ userId, weight: 1 })),
    });
    expect(a.shares).toEqual([
      { userId: "A", weight: 1, amount: 252 },
      { userId: "B", weight: 1, amount: 250 },
      { userId: "C", weight: 1, amount: 250 },
      { userId: "D", weight: 1, amount: 250 },
    ]);
    expect(a.remainder).toBe(2);
    expect(a.absorbedByPayer).toBe(0);
  });

  it("1,000円を立替者以外の3人 → 333×3、立替者が1円かぶる", () => {
    const a = allocateShares({
      id: "e1",
      payerUserId: "A",
      amount: 1000,
      shares: ["B", "C", "D"].map((userId) => ({ userId, weight: 1 })),
    });
    expect(a.shares.map((s) => s.amount)).toEqual([333, 333, 333]);
    expect(a.remainder).toBe(1);
    expect(a.absorbedByPayer).toBe(1);
  });

  it("重み 1:2:1 の 1,000円 → B 500・C 250・立替者 250", () => {
    expect(
      amountsOf({
        id: "e1",
        payerUserId: "A",
        amount: 1000,
        shares: [
          { userId: "A", weight: 1 },
          { userId: "B", weight: 2 },
          { userId: "C", weight: 1 },
        ],
      }),
    ).toEqual({ A: 250, B: 500, C: 250 });
  });

  it("1円を3人 → 他の2人は 0、立替者 1（0円の負担者も行に残る）", () => {
    const a = allocateShares({
      id: "e1",
      payerUserId: "B",
      amount: 1,
      shares: ["A", "B", "C"].map((userId) => ({ userId, weight: 1 })),
    });
    expect(a.shares).toEqual([
      { userId: "A", weight: 1, amount: 0 },
      { userId: "B", weight: 1, amount: 1 },
      { userId: "C", weight: 1, amount: 0 },
    ]);
  });

  it("不変条件: Σ負担 + absorbedByPayer = amount、立替者以外 = floor(amount×w/W)（乱数 2,000 件）", () => {
    const rand = rng(556);
    for (let n = 0; n < 2000; n++) {
      const count = 1 + Math.floor(rand() * 12);
      const users = Array.from({ length: count }, (_, i) => `u${i}`);
      const shares = users.map((userId) => ({ userId, weight: 1 + Math.floor(rand() * 100) }));
      const payerUserId = rand() < 0.5 ? users[Math.floor(rand() * count)]! : "payer";
      const amount = 1 + Math.floor(rand() * 10_000_000);
      const a = allocateShares({ id: `e${n}`, payerUserId, amount, shares });
      const W = shares.reduce((s, x) => s + x.weight, 0);

      expect(a.shares.reduce((s, x) => s + x.amount, 0) + a.absorbedByPayer).toBe(amount);
      expect(a.remainder).toBeGreaterThanOrEqual(0);
      expect(a.remainder).toBeLessThan(count);
      expect(a.shares.map((s) => s.userId)).toEqual(users);
      for (const s of a.shares) {
        if (s.userId === payerUserId) continue;
        expect(s.amount).toBe(Math.floor((amount * s.weight) / W));
      }
      if (payerUserId === "payer") expect(a.absorbedByPayer).toBe(a.remainder);
      else expect(a.absorbedByPayer).toBe(0);
    }
  });
});

describe("settle: 立替者への直接返済とペア相殺 (§3.5)", () => {
  const venue: CalcExpense = {
    id: "venue",
    payerUserId: "A",
    amount: 3000,
    shares: ["A", "B", "C"].map((userId) => ({ userId, weight: 1 })),
  };
  const party: CalcExpense = {
    id: "party",
    payerUserId: "B",
    amount: 600,
    shares: ["A", "B", "C"].map((userId) => ({ userId, weight: 1 })),
  };

  it("検算例1: A の会場費 3,000円を3人 → A +2,000 / B −1,000 / C −1,000", () => {
    const r = settle({ expenses: [venue] });
    expect(netOf(r.balances)).toEqual({ A: 2000, B: -1000, C: -1000 });
    expect(r.settlements).toEqual([
      { fromUserId: "B", toUserId: "A", amount: 1000, breakdown: [{ kind: "expense", expenseId: "venue", amount: 1000 }] },
      { fromUserId: "C", toUserId: "A", amount: 1000, breakdown: [{ kind: "expense", expenseId: "venue", amount: 1000 }] },
    ]);
    expect(r.allocations.venue!.shares.map((s) => s.amount)).toEqual([1000, 1000, 1000]);
  });

  it("精算は常に全額: 同じ立替なら何度読んでも B→A・C→A の 1,000円ずつのまま", () => {
    const first = settle({ expenses: [venue] });
    const second = settle({ expenses: [venue] });
    expect(second).toEqual(first);
    expect(first.settlements.map((s) => [s.fromUserId, s.toUserId, s.amount])).toEqual([
      ["B", "A", 1000],
      ["C", "A", 1000],
    ]);
  });

  it("検算例3: B の打ち上げ 600円を足す → B→A 800（+1,000 / −200）、C→A 1,000、C→B 200", () => {
    const r = settle({ expenses: [venue, party] });
    expect(netOf(r.balances)).toEqual({ A: 1800, B: -600, C: -1200 });
    expect(r.settlements).toEqual([
      {
        fromUserId: "B",
        toUserId: "A",
        amount: 800,
        breakdown: [
          { kind: "expense", expenseId: "party", amount: -200 },
          { kind: "expense", expenseId: "venue", amount: 1000 },
        ],
      },
      { fromUserId: "C", toUserId: "A", amount: 1000, breakdown: [{ kind: "expense", expenseId: "venue", amount: 1000 }] },
      { fromUserId: "C", toUserId: "B", amount: 200, breakdown: [{ kind: "expense", expenseId: "party", amount: 200 }] },
    ]);
    // B の行は「A に 800 支払う」「C から 200 受け取る」の2行（差引の 600 は行にならない）
    const bRows = r.settlements.filter((s) => s.fromUserId === "B" || s.toUserId === "B");
    expect(bRows.map((s) => s.amount)).toEqual([800, 200]);
    for (const s of r.settlements) {
      expect(s.breakdown.reduce((sum, x) => sum + x.amount, 0)).toBe(s.amount);
    }
  });

  it("相殺: A→B 500・B→A 300 → A→B 200 の1本", () => {
    const r = settle({
      expenses: [
        { id: "x", payerUserId: "B", amount: 500, shares: [{ userId: "A", weight: 1 }] },
        { id: "y", payerUserId: "A", amount: 300, shares: [{ userId: "B", weight: 1 }] },
      ],
    });
    expect(r.settlements).toEqual([
      {
        fromUserId: "A",
        toUserId: "B",
        amount: 200,
        breakdown: [
          { kind: "expense", expenseId: "x", amount: 500 },
          { kind: "expense", expenseId: "y", amount: -300 },
        ],
      },
    ]);
  });

  it("精算行は立替だけから出る: 債務 500 の行は 500 のまま、内訳は立替の1件だけ", () => {
    const r = settle({
      expenses: [{ id: "x", payerUserId: "B", amount: 500, shares: [{ userId: "A", weight: 1 }] }],
    });
    expect(r.settlements).toEqual([
      { fromUserId: "A", toUserId: "B", amount: 500, breakdown: [{ kind: "expense", expenseId: "x", amount: 500 }] },
    ]);
    expect(netOf(r.balances)).toEqual({ A: -500, B: 500 });
  });

  it("端数をかぶった立替者: owed に absorbedByPayer が入り、net が手順4と一致する", () => {
    const r = settle({
      expenses: [
        { id: "x", payerUserId: "A", amount: 1000, shares: ["B", "C", "D"].map((userId) => ({ userId, weight: 1 })) },
      ],
    });
    const a = r.balances.find((b) => b.userId === "A")!;
    expect(a).toEqual({ userId: "A", paid: 1000, owed: 1, net: 999 });
  });

  function randomInput(seed: number): { expenses: CalcExpense[] } {
    const rand = rng(seed);
    const users = Array.from({ length: 2 + Math.floor(rand() * 6) }, (_, i) => `u${i}`);
    const pick = () => users[Math.floor(rand() * users.length)]!;
    const expenses: CalcExpense[] = Array.from({ length: 1 + Math.floor(rand() * 6) }, (_, i) => {
      const shareUsers = users.filter(() => rand() < 0.7);
      if (shareUsers.length === 0) shareUsers.push(pick());
      return {
        id: `e${i}`,
        payerUserId: pick(),
        amount: 1 + Math.floor(rand() * 50_000),
        shares: shareUsers.map((userId) => ({ userId, weight: 1 + Math.floor(rand() * 3) })),
      };
    });
    return { expenses };
  }

  it("Σ net = 0、net = paid − owed = 精算の行から見た受け取り − 支払い（乱数 500 件）", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const r = settle(randomInput(seed));
      expect(r.balances.reduce((s, b) => s + b.net, 0)).toBe(0);
      for (const b of r.balances) {
        expect(b.net).toBe(b.paid - b.owed);
        const fromRows =
          r.settlements.filter((s) => s.toUserId === b.userId).reduce((s, x) => s + x.amount, 0) -
          r.settlements.filter((s) => s.fromUserId === b.userId).reduce((s, x) => s + x.amount, 0);
        expect(fromRows).toBe(b.net);
      }
      for (const s of r.settlements) {
        expect(s.amount).toBeGreaterThan(0);
        expect(s.breakdown.reduce((sum, x) => sum + x.amount, 0)).toBe(s.amount);
      }
    }
  });

  it("並びが決定的: 入力を並べ替えても同じ出力", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const input = randomInput(seed);
      const shuffled = {
        expenses: [...input.expenses].reverse().map((e) => ({ ...e, shares: [...e.shares].reverse() })),
      };
      const a = settle(input);
      const b = settle(shuffled);
      expect(b.balances).toEqual(a.balances);
      expect(b.settlements).toEqual(a.settlements);
      const sortedIds = [...a.balances.map((x) => x.userId)].sort();
      expect(a.balances.map((x) => x.userId)).toEqual(sortedIds);
    }
  });
});

describe("presetShareUserIds (§3.9)", () => {
  const m = (userId: string, over: Partial<WarikanMember>): WarikanMember => ({
    userId,
    displayName: userId,
    avatarUrl: null,
    role: "participant",
    standing: "confirmed",
    attended: false,
    selectable: true,
    ...over,
  });
  const members: WarikanMember[] = [
    m("p-attended", { attended: true }),
    m("p-absent", {}),
    m("staff", { role: "staff" }),
    m("judge", { role: "judge" }),
    m("observer", { role: "observer", attended: true, selectable: false }),
    m("former", { standing: "former", attended: true, selectable: false }),
    m("deleted", { standing: "deleted", role: null, displayName: null, selectable: false }),
  ];

  it("all は selectable な全員", () => {
    expect(presetShareUserIds(members, "all")).toEqual(["p-attended", "p-absent", "staff", "judge"]);
  });

  it("attended は出席した participant ＋ staff・judge。observer・非確定は含まない", () => {
    expect(presetShareUserIds(members, "attended")).toEqual(["p-attended", "staff", "judge"]);
  });
});

describe("formatYen", () => {
  it("ja は 1,200円、en は ¥1,200", () => {
    expect(formatYen(1200, "ja")).toBe("1,200円");
    expect(formatYen(1200, "en")).toBe("¥1,200");
    expect(formatYen(0, "ja")).toBe("0円");
    expect(formatYen(10_000_000, "en")).toBe("¥10,000,000");
  });
});
