import { SELF, env } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { WarikanLedger } from "@eventer/shared";
import { WARIKAN_EXPENSE_MAX, warikanLedgerSchema } from "@eventer/shared";
import { translations } from "@eventer/shared/i18n";
import { bindEnv, type Env } from "../src/runtime.js";
import { app } from "../src/worker.js";
import { eventWarikanRepo } from "../src/db/repositories/eventWarikan.js";
import { accountMergeRepo } from "../src/db/repositories/accountMerge.js";
import { accountDeletionRepo } from "../src/db/repositories/accountDeletion.js";

/**
 * 割り勘 (#556)。docs/warikan.md §5.2 の契約を固定する。
 *
 * - 門: 確定メンバー ∪ 帳簿の当事者。それ以外は 404（取消した当事者は見られて払える）
 * - 権限: 立替の編集は入力者本人（確定の間）・立替者本人（参加状態を問わない）と confirmed staff だけ。
 *   コミュニティ管理者は通らない
 * - PATCH は新しく加わる人だけを検証する（重みの 100 上限も、新しい／値が変わった share だけ）
 * - 「済み」は行の当事者だけが付け外しでき、記録時の額と導出額が一致するときだけ効く
 * - 上限は1文の条件付き INSERT（並行でも超えない・負担行だけが入らない）
 * - 統合・退会で第三者の負担額と収支が1円も動かない
 */

const BASE = "https://example.com";
const DAY = 86_400_000;

type Actor = { id: string; cookie: string };

async function makeUser(name?: string): Promise<Actor> {
  const id = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `w_${id.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(id, `nostr:${id}`, username, name ?? `表示名_${username}`, Date.now())
    .run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sid, id, Date.now() + DAY)
    .run();
  return { id, cookie: `eventer_session=${sid}` };
}

async function insertEvent(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, scheduling, created_by, created_at)
     VALUES (?, ?, ?, ?, 'offline', 'published', 0, ?, ?)`,
  )
    .bind(id, `割り勘E2E_${id.slice(0, 6)}`, now - 3600_000, now + 3600_000, ownerId, now)
    .run();
  return id;
}

async function addMember(
  eventId: string,
  userId: string,
  role: "participant" | "staff" | "judge" | "observer" = "participant",
  status = "confirmed",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, ?, 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, role, status, Date.now())
    .run();
}

async function setStatus(eventId: string, userId: string, status: string): Promise<void> {
  await env.DB.prepare("UPDATE event_member SET status = ? WHERE event_id = ? AND user_id = ?")
    .bind(status, eventId, userId)
    .run();
}

function req(path: string, actor: Actor, method = "GET", body?: unknown): Promise<Response> {
  return SELF.fetch(`${BASE}/api${path}`, {
    method,
    headers: { cookie: actor.cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json<T = any>(res: Response, status = 200): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

const ledgerOf = async (eventId: string, actor: Actor) =>
  json<WarikanLedger>(await req(`/events/${eventId}/warikan`, actor));

const expenseBody = (payer: string, amount: number, shareIds: string[], extra: object = {}) => ({
  payerUserId: payer,
  amount,
  title: "会場費",
  shares: shareIds.map((userId) => ({ userId, weight: 1 })),
  ...extra,
});

async function addExpense(
  eventId: string,
  actor: Actor,
  payer: string,
  amount: number,
  shareIds: string[],
): Promise<string> {
  const res = await req(
    `/events/${eventId}/warikan/expenses`,
    actor,
    "POST",
    expenseBody(payer, amount, shareIds),
  );
  return (await json<{ expense: { id: string } }>(res, 201)).expense.id;
}

const netOf = (ledger: WarikanLedger) =>
  Object.fromEntries(ledger.balances.map((b) => [b.userId, b.net]));

async function count(sql: string, ...args: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...args)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** staff 1人 + 参加者3人（A・B・C） */
async function setup() {
  const staff = await makeUser();
  const eventId = await insertEvent(staff.id);
  await addMember(eventId, staff.id, "staff");
  const a = await makeUser("A");
  const b = await makeUser("B");
  const c = await makeUser("C");
  for (const u of [a, b, c]) await addMember(eventId, u.id);
  return { eventId, staff, a, b, c };
}

describe("割り勘の門 (#556 §3.7.1)", () => {
  it("確定メンバーは立替0件でも 200 の空の帳簿を読める", async () => {
    const { eventId, a } = await setup();
    const ledger = await ledgerOf(eventId, a);
    expect(ledger.expenses).toEqual([]);
    expect(ledger.settlements).toEqual([]);
    expect(ledger.me).toEqual({ userId: a.id, canAddExpense: true, isStaff: false });
  });

  it("非メンバー・当事者でない applied / waitlist は 404", async () => {
    const { eventId } = await setup();
    const outsider = await makeUser();
    const applied = await makeUser();
    const waiting = await makeUser();
    await addMember(eventId, applied.id, "participant", "applied");
    await addMember(eventId, waiting.id, "participant", "waitlist");
    for (const u of [outsider, applied, waiting]) {
      expect((await req(`/events/${eventId}/warikan`, u)).status).toBe(404);
    }
  });

  it("当事者だが取消した人は 200 で自分の行が見える", async () => {
    const { eventId, a, b, c } = await setup();
    await addExpense(eventId, a, a.id, 3000, [a.id, b.id, c.id]);
    await setStatus(eventId, b.id, "canceled");

    const ledger = await ledgerOf(eventId, b);
    expect(ledger.settlements.filter((s) => s.fromUserId === b.id)).toMatchObject([
      { toUserId: a.id, amount: 1000 },
    ]);
    expect(ledger.me.canAddExpense).toBe(false);
    expect(ledger.members.find((m) => m.userId === b.id)).toMatchObject({
      standing: "former",
      selectable: false,
    });
  });

  it("§3.5 の検算例: 会場費 3,000円を3人 → 打ち上げ 600円", async () => {
    const { eventId, a, b, c } = await setup();
    const venue = await addExpense(eventId, a, a.id, 3000, [a.id, b.id, c.id]);
    expect(netOf(await ledgerOf(eventId, a))).toEqual({ [a.id]: 2000, [b.id]: -1000, [c.id]: -1000 });

    const party = await addExpense(eventId, b, b.id, 600, [a.id, b.id, c.id]);
    // 同じミリ秒に入ると並びが id 順になるので、会場費を確実に古くしておく
    await env.DB.prepare("UPDATE event_expense SET created_at = created_at - 1000 WHERE id = ?")
      .bind(venue)
      .run();
    const ledger = await ledgerOf(eventId, c);
    expect(netOf(ledger)).toEqual({ [a.id]: 1800, [b.id]: -600, [c.id]: -1200 });
    const bToA = ledger.settlements.find((s) => s.fromUserId === b.id && s.toUserId === a.id)!;
    expect(bToA.amount).toBe(800);
    expect(bToA.breakdown).toEqual(
      expect.arrayContaining([
        { kind: "expense", expenseId: venue, amount: 1000 },
        { kind: "expense", expenseId: party, amount: -200 },
      ]),
    );
    // 立替は新しい順
    expect(ledger.expenses.map((e) => e.id)).toEqual([party, venue]);
  });
});

describe("割り勘の権限 (#556 §3.7.2)", () => {
  it("他人の立替の PATCH は 403、confirmed staff は 200、コミュニティ管理者（非メンバー）は 404", async () => {
    const { eventId, staff, a, b, c } = await setup();
    const id = await addExpense(eventId, a, a.id, 900, [a.id, b.id, c.id]);
    const patch = (actor: Actor) =>
      req(
        `/events/${eventId}/warikan/expenses/${id}`,
        actor,
        "PATCH",
        expenseBody(a.id, 900, [a.id, b.id, c.id], { title: "直した" }),
      );

    expect((await patch(b)).status).toBe(403);
    expect((await json(await patch(staff))).expense.title).toBe("直した");

    // コミュニティの owner（イベントには参加していない）
    const owner = await makeUser();
    const communityId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO community (id, slug, name, description, owner_id, created_at) VALUES (?, ?, ?, '', ?, ?)",
    )
      .bind(communityId, `c-${communityId.slice(0, 8)}`, "コミュ", owner.id, Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
    )
      .bind(crypto.randomUUID(), communityId, owner.id, Date.now())
      .run();
    await env.DB.prepare("UPDATE event SET community_id = ? WHERE id = ?").bind(communityId, eventId).run();
    expect((await patch(owner)).status).toBe(404);
    expect((await req(`/events/${eventId}/warikan`, owner)).status).toBe(404);
  });

  it("入力者本人が取消した後は、自分が入力した（立替者が別人の）立替を編集できない", async () => {
    const { eventId, a, b } = await setup();
    const id = await addExpense(eventId, a, b.id, 1000, [a.id, b.id]);
    await setStatus(eventId, a.id, "canceled");
    const res = await req(
      `/events/${eventId}/warikan/expenses/${id}`,
      a,
      "PATCH",
      expenseBody(b.id, 1000, [a.id, b.id], { title: "直したい" }),
    );
    expect(res.status).toBe(403);
    expect((await req(`/events/${eventId}/warikan/expenses/${id}`, a, "DELETE")).status).toBe(403);
  });

  it("立替者本人は、入力者でなくても・取消した後でも自分名義の立替を編集・削除できる（staff 0 人でも）", async () => {
    const { eventId, staff, a, b, c } = await setup();
    // staff も抜けて staff 0 人のイベントにする
    await setStatus(eventId, staff.id, "canceled");
    // B が入力し、立替者は A
    const id = await addExpense(eventId, b, a.id, 900, [a.id, b.id, c.id]);
    await setStatus(eventId, a.id, "canceled");
    await setStatus(eventId, b.id, "canceled");

    const ledger = await ledgerOf(eventId, a);
    expect(ledger.expenses.find((e) => e.id === id)!.canEdit).toBe(true);
    // 立替者でも入力者でもない C には出ない
    expect((await ledgerOf(eventId, c)).expenses.find((e) => e.id === id)!.canEdit).toBe(false);

    const { expense } = await json(
      await req(
        `/events/${eventId}/warikan/expenses/${id}`,
        a,
        "PATCH",
        expenseBody(a.id, 900, [a.id, b.id, c.id], { title: "立替者が直した" }),
      ),
    );
    expect(expense.title).toBe("立替者が直した");
    expect((await req(`/events/${eventId}/warikan/expenses/${id}`, c, "DELETE")).status).toBe(403);
    await json(await req(`/events/${eventId}/warikan/expenses/${id}`, a, "DELETE"));
    expect(await count("SELECT COUNT(*) AS n FROM event_expense WHERE id = ?", id)).toBe(0);
  });

  it("立替者本人が立替者を別の人に替えると、負担行ごと保存される（以後は本人の資格が外れる）", async () => {
    const { eventId, a, b, c } = await setup();
    const id = await addExpense(eventId, b, a.id, 900, [a.id, b.id, c.id]);
    await setStatus(eventId, a.id, "canceled");
    const { expense } = await json(
      await req(
        `/events/${eventId}/warikan/expenses/${id}`,
        a,
        "PATCH",
        expenseBody(c.id, 900, [b.id, c.id]),
      ),
    );
    expect(expense.payerUserId).toBe(c.id);
    expect(expense.shares.map((s: { userId: string }) => s.userId)).toEqual([b.id, c.id]);
  });

  it("observer は立替を追加できない。observer・非確定の人を負担者にすると 400 invalid_party", async () => {
    const { eventId, a } = await setup();
    const observer = await makeUser();
    const applied = await makeUser();
    await addMember(eventId, observer.id, "observer");
    await addMember(eventId, applied.id, "participant", "applied");

    expect(
      (await req(`/events/${eventId}/warikan/expenses`, observer, "POST", expenseBody(observer.id, 100, [observer.id])))
        .status,
    ).toBe(403);
    expect((await ledgerOf(eventId, observer)).me.canAddExpense).toBe(false);

    for (const bad of [observer.id, applied.id]) {
      const res = await req(`/events/${eventId}/warikan/expenses`, a, "POST", expenseBody(a.id, 100, [a.id, bad]));
      expect(await json(res, 400)).toEqual({ error: "invalid_party" });
    }
  });

  it("入力の形: 重複した負担者は duplicate_share", async () => {
    const { eventId, a } = await setup();
    const dup = await req(`/events/${eventId}/warikan/expenses`, a, "POST", expenseBody(a.id, 100, [a.id, a.id]));
    const body = await json(dup, 400);
    expect(body.error).toBe("validation_error");
    expect(body.issues.map((i: { message: string }) => i.message)).toContain("duplicate_share");
  });

  it("PATCH は新しく加わる人だけを検証する（取消した既存の負担者を残したままタイトルを直せる）", async () => {
    const { eventId, a, b, c } = await setup();
    const id = await addExpense(eventId, a, a.id, 900, [a.id, b.id, c.id]);
    await setStatus(eventId, c.id, "canceled");

    const ok = await req(
      `/events/${eventId}/warikan/expenses/${id}`,
      a,
      "PATCH",
      expenseBody(a.id, 900, [a.id, b.id, c.id], { title: "会場費（訂正）" }),
    );
    const { expense } = await json(ok);
    expect(expense.title).toBe("会場費（訂正）");
    expect(expense.shares.map((s: { userId: string }) => s.userId)).toEqual([a.id, b.id, c.id]);

    const newcomer = await makeUser();
    await addMember(eventId, newcomer.id, "participant", "waitlist");
    const bad = await req(
      `/events/${eventId}/warikan/expenses/${id}`,
      a,
      "PATCH",
      expenseBody(a.id, 900, [a.id, b.id, c.id, newcomer.id]),
    );
    expect(await json(bad, 400)).toEqual({ error: "invalid_party" });
  });

  it("重み: POST は 100 まで。PATCH は既存の (userId, weight) を免除し、新規・変更だけ 100 まで", async () => {
    const { eventId, a, b, c } = await setup();
    const over = await req(
      `/events/${eventId}/warikan/expenses`,
      a,
      "POST",
      { ...expenseBody(a.id, 1000, []), shares: [{ userId: a.id, weight: 1 }, { userId: b.id, weight: 101 }] },
    );
    expect(await json(over, 400)).toEqual({ error: "invalid_weight" });

    const id = await addExpense(eventId, a, a.id, 1000, [a.id, b.id]);
    // 統合で合算された体で、B の重みを 150 にしておく
    await env.DB.prepare("UPDATE event_expense_share SET weight = 150 WHERE expense_id = ? AND user_id = ?")
      .bind(id, b.id)
      .run();
    const patch = (shares: { userId: string; weight: number }[], title = "会場費") =>
      req(`/events/${eventId}/warikan/expenses/${id}`, a, "PATCH", {
        ...expenseBody(a.id, 1000, []),
        title,
        shares,
      });

    // 150 の既存行をそのまま送り返してタイトルだけ直せる
    const ok = await json(await patch([{ userId: a.id, weight: 1 }, { userId: b.id, weight: 150 }], "直した"));
    expect(ok.expense.title).toBe("直した");
    // 新しい share に 101
    expect(
      await json(
        await patch([
          { userId: a.id, weight: 1 },
          { userId: b.id, weight: 150 },
          { userId: c.id, weight: 101 },
        ]),
        400,
      ),
    ).toEqual({ error: "invalid_weight" });
    // 既存行の重みを 100 → 101 に変える
    await json(await patch([{ userId: a.id, weight: 100 }, { userId: b.id, weight: 150 }]));
    expect(
      await json(await patch([{ userId: a.id, weight: 101 }, { userId: b.id, weight: 150 }]), 400),
    ).toEqual({ error: "invalid_weight" });
  });
});

describe("「済み」 (#556 §3.5.1)", () => {
  const donePath = (eventId: string, from: string, to: string) =>
    `/events/${eventId}/warikan/settlements/${from}/${to}/done`;
  const rowOf = (ledger: WarikanLedger, from: string, to: string) =>
    ledger.settlements.find((s) => s.fromUserId === from && s.toUserId === to);

  it("from も to も付けられる。GET で done と canToggle が返り、balances は前後で同じ", async () => {
    const { eventId, a, b, c } = await setup();
    await addExpense(eventId, a, a.id, 3000, [a.id, b.id, c.id]);
    const before = await ledgerOf(eventId, a);

    const res = await json(await req(donePath(eventId, b.id, a.id), b, "PUT", { amount: 1000 }));
    expect(res.done.markedBy).toBe(b.id);
    await json(await req(donePath(eventId, c.id, a.id), a, "PUT", { amount: 1000 }));

    const after = await ledgerOf(eventId, a);
    expect(rowOf(after, b.id, a.id)).toMatchObject({ amount: 1000, done: { markedBy: b.id }, canToggle: true });
    expect(rowOf(after, c.id, a.id)).toMatchObject({ amount: 1000, done: { markedBy: a.id }, canToggle: true });
    expect(after.balances).toEqual(before.balances);
    // C から見ると B→A は自分の行ではない
    expect(rowOf(await ledgerOf(eventId, c), b.id, a.id)!.canToggle).toBe(false);
  });

  it("第三者は confirmed staff でも 403。存在しない行は 404。額が違えば 409 amount_changed", async () => {
    const { eventId, staff, a, b, c } = await setup();
    await addExpense(eventId, a, a.id, 3000, [a.id, b.id, c.id]);
    expect((await req(donePath(eventId, b.id, a.id), staff, "PUT", { amount: 1000 })).status).toBe(403);
    expect((await req(donePath(eventId, b.id, a.id), c, "PUT", { amount: 1000 })).status).toBe(403);
    expect((await req(donePath(eventId, b.id, a.id), c, "DELETE")).status).toBe(403);
    // 向きが逆の行・当事者どうしで行の無い組
    expect(await json(await req(donePath(eventId, a.id, b.id), a, "PUT", { amount: 1000 }), 404)).toEqual({
      error: "not_found",
    });
    expect((await req(donePath(eventId, b.id, c.id), b, "PUT", { amount: 1000 })).status).toBe(404);
    expect(await json(await req(donePath(eventId, b.id, a.id), b, "PUT", { amount: 999 }), 409)).toEqual({
      error: "amount_changed",
    });
    expect((await req(donePath(eventId, b.id, a.id), b, "PUT", { amount: 0 })).status).toBe(400);
    // 帳簿を見られない人は 404
    const outsider = await makeUser();
    expect((await req(donePath(eventId, outsider.id, a.id), outsider, "PUT", { amount: 1000 })).status).toBe(404);
    expect(await count("SELECT COUNT(*) AS n FROM event_settlement_done WHERE event_id = ?", eventId)).toBe(0);
  });

  it("DELETE で外れる。記録が無い DELETE も 200", async () => {
    const { eventId, a, b, c } = await setup();
    await addExpense(eventId, a, a.id, 3000, [a.id, b.id, c.id]);
    await json(await req(donePath(eventId, b.id, a.id), b, "PUT", { amount: 1000 }));
    await json(await req(donePath(eventId, b.id, a.id), a, "DELETE"));
    expect(rowOf(await ledgerOf(eventId, a), b.id, a.id)!.done).toBeNull();
    expect((await req(donePath(eventId, b.id, a.id), b, "DELETE")).status).toBe(200);
  });

  it("立替の編集で額が変わると外れ、元の額に戻ると効く。タイトルだけの編集では外れない", async () => {
    const { eventId, a, b, c } = await setup();
    const id = await addExpense(eventId, a, a.id, 3000, [a.id, b.id, c.id]);
    await json(await req(donePath(eventId, b.id, a.id), b, "PUT", { amount: 1000 }));
    const patch = (amount: number, title = "会場費") =>
      req(
        `/events/${eventId}/warikan/expenses/${id}`,
        a,
        "PATCH",
        expenseBody(a.id, amount, [a.id, b.id, c.id], { title }),
      );

    await json(await patch(3000, "会場費（訂正）"));
    expect(rowOf(await ledgerOf(eventId, b), b.id, a.id)!.done).not.toBeNull();
    await json(await patch(3300));
    const changed = rowOf(await ledgerOf(eventId, b), b.id, a.id)!;
    expect(changed.amount).toBe(1100);
    expect(changed.done).toBeNull();
    await json(await patch(3000));
    expect(rowOf(await ledgerOf(eventId, b), b.id, a.id)!.done).toMatchObject({ markedBy: b.id });
  });

  it("取消した当事者も付けられる。ghost 相手の行に生きている側が付けられる", async () => {
    const { eventId, a, b, c } = await setup();
    await addExpense(eventId, a, a.id, 3000, [a.id, b.id, c.id]);
    await setStatus(eventId, b.id, "canceled");
    await json(await req(donePath(eventId, b.id, a.id), b, "PUT", { amount: 1000 }));

    bindEnv(env as unknown as Env);
    const ghost = await accountDeletionRepo.ensureDeletedUser();
    await accountDeletionRepo.deleteAccount(a.id, ghost.id);
    await json(await req(donePath(eventId, c.id, ghost.id), c, "PUT", { amount: 1000 }));
    expect(rowOf(await ledgerOf(eventId, c), c.id, ghost.id)!.done).toMatchObject({ markedBy: c.id });
  });

  it("応答の settlements に「済み」以外の支払いの状態が無い（strict parse）", async () => {
    const { eventId, a, b } = await setup();
    await addExpense(eventId, a, a.id, 1000, [a.id, b.id]);
    await json(await req(donePath(eventId, b.id, a.id), b, "PUT", { amount: 500 }));
    const ledger = await ledgerOf(eventId, a);
    const strictRow = z
      .object({
        fromUserId: z.string(),
        toUserId: z.string(),
        amount: z.number(),
        breakdown: z.array(z.unknown()),
        done: z.object({ markedBy: z.string().nullable(), markedAt: z.number() }).strict().nullable(),
        canToggle: z.boolean(),
      })
      .strict();
    expect(ledger.settlements).toHaveLength(1);
    for (const s of ledger.settlements) expect(() => strictRow.parse(s)).not.toThrow();
    expect(() => warikanLedgerSchema.strict().parse(ledger)).not.toThrow();
  });
});

describe("受け取り先 (#556 §3.6)", () => {
  it("kind: bank は 400。repo を通さず直接入れても CHECK が拒む", async () => {
    const { eventId, a } = await setup();
    const res = await req(`/events/${eventId}/warikan/payout-methods`, a, "PUT", {
      methods: [{ kind: "bank", value: "000-1234567" }],
    });
    expect(res.status).toBe(400);
    await expect(
      env.DB.prepare(
        "INSERT INTO event_payout_method (id, event_id, user_id, kind, value, created_at) VALUES (?, ?, ?, 'bank', 'x', ?)",
      )
        .bind(crypto.randomUUID(), eventId, a.id, Date.now())
        .run(),
    ).rejects.toThrow(/CHECK/);
  });

  it("http の URL・形の崩れた Lightning・6件以上は 400", async () => {
    const { eventId, a } = await setup();
    for (const methods of [
      [{ kind: "url", value: "http://paypay.ne.jp/x" }],
      [{ kind: "lightning", value: "not an address" }],
      Array.from({ length: 6 }, () => ({ kind: "lightning", value: "a@example.com" })),
    ]) {
      expect((await req(`/events/${eventId}/warikan/payout-methods`, a, "PUT", { methods })).status).toBe(400);
    }
  });

  it("他人の userId を差せない（body に書いても自分の分になる）。value は帳簿を見られる全員に返る", async () => {
    const { eventId, staff, a, b } = await setup();
    const saved = await json(
      await req(`/events/${eventId}/warikan/payout-methods`, a, "PUT", {
        userId: b.id,
        methods: [
          { kind: "url", value: "https://paypay.ne.jp/abc" },
          { kind: "lightning", value: "alice@getalby.com" },
        ],
      }),
    );
    expect(saved.payoutMethods.map((m: { userId: string }) => m.userId)).toEqual([a.id, a.id]);

    const seenByB = await ledgerOf(eventId, b);
    expect(seenByB.payoutMethods.map((m) => [m.userId, m.kind, m.value, m.canDelete])).toEqual([
      [a.id, "url", "https://paypay.ne.jp/abc", false],
      [a.id, "lightning", "alice@getalby.com", false],
    ]);

    // 置換: 空にすると消える
    await json(await req(`/events/${eventId}/warikan/payout-methods`, a, "PUT", { methods: [] }));
    expect(await count("SELECT COUNT(*) AS n FROM event_payout_method WHERE user_id = ?", a.id)).toBe(0);

    // 他人の受け取り先の削除は staff だけ
    await json(
      await req(`/events/${eventId}/warikan/payout-methods`, a, "PUT", {
        methods: [{ kind: "url", value: "https://kyash.me/payments/x" }],
      }),
    );
    const [method] = (await ledgerOf(eventId, a)).payoutMethods;
    expect((await req(`/events/${eventId}/warikan/payout-methods/${method!.id}`, b, "DELETE")).status).toBe(403);
    await json(await req(`/events/${eventId}/warikan/payout-methods/${method!.id}`, staff, "DELETE"));
  });
});

describe("上限と子リソース (#556 §3.3)", () => {
  async function seedExpenses(eventId: string, payer: string, n: number): Promise<void> {
    const now = Date.now();
    const stmts = [];
    for (let i = 0; i < n; i++) {
      const id = crypto.randomUUID();
      stmts.push(
        env.DB.prepare(
          `INSERT INTO event_expense (id, event_id, payer_user_id, amount, title, note, spent_on, created_by, created_at, updated_at)
           VALUES (?, ?, ?, 100, 'seed', '', NULL, ?, ?, ?)`,
        ).bind(id, eventId, payer, payer, now, now),
        env.DB.prepare("INSERT INTO event_expense_share (expense_id, user_id, weight) VALUES (?, ?, 1)").bind(id, payer),
      );
    }
    await env.DB.batch(stmts);
  }

  it("200 件目まで入り 201 件目が 409。弾かれたとき負担行も入らない", async () => {
    const { eventId, a, b } = await setup();
    await seedExpenses(eventId, a.id, WARIKAN_EXPENSE_MAX - 1);
    await addExpense(eventId, a, a.id, 100, [a.id, b.id]);
    const sharesBefore = await count("SELECT COUNT(*) AS n FROM event_expense_share");

    const res = await req(`/events/${eventId}/warikan/expenses`, a, "POST", expenseBody(a.id, 100, [a.id, b.id]));
    expect(await json(res, 409)).toEqual({ error: "too_many_expenses" });
    expect(await count("SELECT COUNT(*) AS n FROM event_expense WHERE event_id = ?", eventId)).toBe(
      WARIKAN_EXPENSE_MAX,
    );
    expect(await count("SELECT COUNT(*) AS n FROM event_expense_share")).toBe(sharesBefore);
  });

  it("並行 2 本でも 200 を超えない（条件付き INSERT）", async () => {
    const { eventId, a, b } = await setup();
    await seedExpenses(eventId, a.id, WARIKAN_EXPENSE_MAX - 1);
    const results = await Promise.all([
      req(`/events/${eventId}/warikan/expenses`, a, "POST", expenseBody(a.id, 100, [a.id])),
      req(`/events/${eventId}/warikan/expenses`, b, "POST", expenseBody(b.id, 100, [b.id])),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await count("SELECT COUNT(*) AS n FROM event_expense WHERE event_id = ?", eventId)).toBe(
      WARIKAN_EXPENSE_MAX,
    );
    // 立替より負担行が多くならない（弾かれた側の負担行は入っていない）
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM event_expense_share s
           JOIN event_expense x ON x.id = s.expense_id WHERE x.event_id = ?`,
        eventId,
      ),
    ).toBe(WARIKAN_EXPENSE_MAX);
  });

  it("別イベントの立替・受け取り先の id は 404", async () => {
    const first = await setup();
    const second = await setup();
    const expenseId = await addExpense(first.eventId, first.a, first.a.id, 100, [first.a.id, first.b.id]);
    const saved = await json(
      await req(`/events/${first.eventId}/warikan/payout-methods`, first.a, "PUT", {
        methods: [{ kind: "lightning", value: "a@example.com" }],
      }),
    );
    // 別イベントの staff が、自分のイベントのパスで first の id を叩く
    const s = second.staff;
    const e = second.eventId;
    expect(
      (await req(`/events/${e}/warikan/expenses/${expenseId}`, s, "PATCH", expenseBody(s.id, 100, [s.id]))).status,
    ).toBe(404);
    expect((await req(`/events/${e}/warikan/expenses/${expenseId}`, s, "DELETE")).status).toBe(404);
    expect(
      (await req(`/events/${e}/warikan/payout-methods/${saved.payoutMethods[0].id}`, s, "DELETE")).status,
    ).toBe(404);
  });

  it("eventWrite の途中で取消されたら 409 access_changed", async () => {
    const { eventId, a, b } = await setup();
    bindEnv(env as unknown as Env);
    const original = eventWarikanRepo.selectableUserIds.bind(eventWarikanRepo);
    const spy = vi
      .spyOn(eventWarikanRepo, "selectableUserIds")
      .mockImplementationOnce(async (ev, ids) => {
        const out = await original(ev, ids);
        await setStatus(eventId, a.id, "canceled"); // 検証の後・書き込みの前に取消
        return out;
      });
    try {
      const res = await app.request(
        `${BASE}/api/events/${eventId}/warikan/expenses`,
        {
          method: "POST",
          headers: { cookie: a.cookie, "content-type": "application/json" },
          body: JSON.stringify(expenseBody(a.id, 100, [a.id, b.id])),
        },
        env,
      );
      expect(await json(res, 409)).toEqual({ error: "access_changed" });
    } finally {
      spy.mockRestore();
    }
    expect(await count("SELECT COUNT(*) AS n FROM event_expense WHERE event_id = ?", eventId)).toBe(0);
  });
});

describe("統合・退会 (#556 §3.3)", () => {
  it("統合: 同じ立替の負担は重みが合算され、第三者の額は変わらない", async () => {
    const { eventId, a, b, c } = await setup();
    const loser = await makeUser();
    await addMember(eventId, loser.id);
    // 1,000円を A・B(winner)・C・loser の4人で
    const id = await addExpense(eventId, a, a.id, 1000, [a.id, b.id, c.id, loser.id]);
    const before = await ledgerOf(eventId, c);
    const cShareBefore = before.expenses[0]!.shares.find((s) => s.userId === c.id)!.amount;

    bindEnv(env as unknown as Env);
    await accountMergeRepo.mergeUsers(b.id, loser.id);

    const after = await ledgerOf(eventId, c);
    const shares = after.expenses.find((e) => e.id === id)!.shares;
    expect(shares.find((s) => s.userId === b.id)).toMatchObject({ weight: 2, amount: 500 });
    expect(shares.some((s) => s.userId === loser.id)).toBe(false);
    expect(shares.find((s) => s.userId === c.id)!.amount).toBe(cShareBefore);
    expect(netOf(after)[c.id]).toBe(netOf(before)[c.id]);
  });

  it("退会（完全削除）: 当事者が ghost になり、第三者の負担額と収支は変わらない。受け取り先は消える", async () => {
    const { eventId, a, b, c } = await setup();
    const d = await makeUser("D");
    await addMember(eventId, d.id);
    const venue = await addExpense(eventId, a, a.id, 1000, [a.id, b.id, c.id, d.id]);
    const taxi = await addExpense(eventId, b, b.id, 700, [b.id, d.id, c.id]);
    await json(
      await req(`/events/${eventId}/warikan/payout-methods`, b, "PUT", {
        methods: [{ kind: "lightning", value: "b@example.com" }],
      }),
    );
    const before = await ledgerOf(eventId, a);

    bindEnv(env as unknown as Env);
    const ghost = await accountDeletionRepo.ensureDeletedUser();
    await accountDeletionRepo.deleteAccount(b.id, ghost.id);
    await accountDeletionRepo.deleteAccount(c.id, ghost.id);

    const after = await ledgerOf(eventId, a);
    const venueAfter = after.expenses.find((e) => e.id === venue)!;
    // 同じ立替に退会者が2人 → ghost の行に重みが合算される
    expect(venueAfter.shares.find((s) => s.userId === ghost.id)).toMatchObject({ weight: 2, amount: 500 });
    const taxiAfter = after.expenses.find((e) => e.id === taxi)!;
    expect(taxiAfter.payerUserId).toBe(ghost.id);
    // 第三者（A・D）の負担額と収支は変わらない
    for (const e of [venue, taxi]) {
      const was = before.expenses.find((x) => x.id === e)!.shares;
      const now = after.expenses.find((x) => x.id === e)!.shares;
      for (const u of [a.id, d.id]) {
        expect(now.find((s) => s.userId === u)?.amount).toBe(was.find((s) => s.userId === u)?.amount);
      }
    }
    expect(netOf(after)[a.id]).toBe(netOf(before)[a.id]);
    expect(netOf(after)[d.id]).toBe(netOf(before)[d.id]);
    // 受け取り先は消える
    expect(await count("SELECT COUNT(*) AS n FROM event_payout_method WHERE event_id = ?", eventId)).toBe(0);
    expect(after.members.find((m) => m.userId === ghost.id)).toMatchObject({
      displayName: null,
      standing: "deleted",
      selectable: false,
    });
  });

  it("統合の「済み」: 負け↔勝ち間は消え、PK が衝突すれば勝ち側が残り、負け側だけなら勝ち側へ移る", async () => {
    const { eventId, a: x, b: w, c: y } = await setup();
    const l = await makeUser("L");
    await addMember(eventId, l.id);
    const done = (actor: Actor, from: string, to: string, amount: number) =>
      req(`/events/${eventId}/warikan/settlements/${from}/${to}/done`, actor, "PUT", { amount });
    // X の立替を X・W・L で → W→X 1,000・L→X 1,000（両方に印）
    await addExpense(eventId, x, x.id, 3000, [x.id, w.id, l.id]);
    await json(await done(w, w.id, x.id, 1000));
    await json(await done(l, l.id, x.id, 1000));
    // W の立替を W・L で → L→W 300（負け→勝ち。統合後は自分→自分）
    await addExpense(eventId, w, w.id, 600, [w.id, l.id]);
    await json(await done(l, l.id, w.id, 300));
    // Y の立替を Y・L で → L→Y 500（負け側だけに印）
    await addExpense(eventId, y, y.id, 1000, [y.id, l.id]);
    await json(await done(l, l.id, y.id, 500));

    bindEnv(env as unknown as Env);
    await accountMergeRepo.mergeUsers(w.id, l.id);

    const rows = await env.DB.prepare(
      `SELECT from_user_id AS f, to_user_id AS t, amount, marked_by AS m
         FROM event_settlement_done WHERE event_id = ? ORDER BY amount`,
    )
      .bind(eventId)
      .all<{ f: string; t: string; amount: number; m: string | null }>();
    expect(rows.results).toEqual([
      { f: w.id, t: y.id, amount: 500, m: w.id },
      { f: w.id, t: x.id, amount: 1000, m: w.id },
    ]);
    const ledger = await ledgerOf(eventId, w);
    const row = (from: string, to: string) =>
      ledger.settlements.find((s) => s.fromUserId === from && s.toUserId === to)!;
    // W→X は重みが合算されて 2,000 になり、記録時の 1,000 と合わないので効かない
    expect(row(w.id, x.id)).toMatchObject({ amount: 2000, done: null });
    // L→Y は W→Y に移り、額が同じなので効いたまま。marked_by は勝ち側
    expect(row(w.id, y.id)).toMatchObject({ amount: 500, done: { markedBy: w.id } });
  });

  it("退会の「済み」: from/to が ghost に移って marked_by は NULL。ghost に合流して額が変わった印は効かない", async () => {
    const { eventId, a, b, c } = await setup();
    const d = await makeUser("D");
    await addMember(eventId, d.id);
    const done = (actor: Actor, from: string, to: string, amount: number) =>
      req(`/events/${eventId}/warikan/settlements/${from}/${to}/done`, actor, "PUT", { amount });
    // A の 1,000円を4人 → B・C・D→A 250。B の 300円を B・C・D → C・D→B 100
    await addExpense(eventId, a, a.id, 1000, [a.id, b.id, c.id, d.id]);
    await addExpense(eventId, b, b.id, 300, [b.id, c.id, d.id]);
    await json(await done(b, b.id, a.id, 250));
    await json(await done(c, c.id, a.id, 250));
    await json(await done(c, c.id, b.id, 100));
    await json(await done(d, d.id, b.id, 100));
    const before = await ledgerOf(eventId, a);

    bindEnv(env as unknown as Env);
    const ghost = await accountDeletionRepo.ensureDeletedUser();
    await accountDeletionRepo.deleteAccount(b.id, ghost.id);
    const row = (l: WarikanLedger, from: string, to: string) =>
      l.settlements.find((s) => s.fromUserId === from && s.toUserId === to)!;
    let ledger = await ledgerOf(eventId, a);
    expect(row(ledger, ghost.id, a.id)).toMatchObject({ amount: 250, done: { markedBy: null } });
    expect(row(ledger, c.id, ghost.id)).toMatchObject({ amount: 100, done: { markedBy: c.id } });
    expect(row(ledger, d.id, ghost.id)).toMatchObject({ amount: 100, done: { markedBy: d.id } });

    // C も退会: C↔ghost の印は消え、C→A は ghost→A と PK が衝突するので C 側を消す
    await accountDeletionRepo.deleteAccount(c.id, ghost.id);
    ledger = await ledgerOf(eventId, a);
    expect(row(ledger, ghost.id, a.id)).toMatchObject({ amount: 500, done: null });
    expect(row(ledger, d.id, ghost.id)).toMatchObject({ amount: 100, done: { markedBy: d.id } });
    expect(await count("SELECT COUNT(*) AS n FROM event_settlement_done WHERE event_id = ?", eventId)).toBe(2);
    // 第三者（A・D）の収支は「済み」を含めて動かない
    expect(netOf(ledger)[a.id]).toBe(netOf(before)[a.id]);
    expect(netOf(ledger)[d.id]).toBe(netOf(before)[d.id]);
  });

  it("hasActivity は「済み」の from / to だけが残った人も実績として数える", async () => {
    const { eventId, a, b } = await setup();
    const id = await addExpense(eventId, a, a.id, 1000, [a.id, b.id]);
    await json(await req(`/events/${eventId}/warikan/settlements/${b.id}/${a.id}/done`, b, "PUT", { amount: 500 }));
    // 立替を消しても「済み」の行は残る（stale）。メンバー行も消す
    await json(await req(`/events/${eventId}/warikan/expenses/${id}`, a, "DELETE"));
    await env.DB.prepare("DELETE FROM event_member WHERE event_id = ?").bind(eventId).run();
    bindEnv(env as unknown as Env);
    expect(await accountDeletionRepo.hasActivity(b.id)).toBe(true);
  });

  it("退会申請中の人は displayName: null。hasActivity が帳簿の当事者を実績として数える", async () => {
    const { eventId, a, b } = await setup();
    await addExpense(eventId, a, a.id, 100, [a.id, b.id]);
    await env.DB.prepare("UPDATE user SET deleted_at = ? WHERE id = ?").bind(Date.now(), b.id).run();
    const ledger = await ledgerOf(eventId, a);
    expect(ledger.members.find((m) => m.userId === b.id)).toMatchObject({
      displayName: null,
      standing: "deleted",
      selectable: false,
    });
    expect(ledger.members.find((m) => m.userId === a.id)!.displayName).toBe("A");

    // メンバー行を消しても、帳簿の当事者として実績が残る
    await env.DB.prepare("DELETE FROM event_member WHERE user_id = ?").bind(b.id).run();
    bindEnv(env as unknown as Env);
    expect(await accountDeletionRepo.hasActivity(b.id)).toBe(true);
  });
});

describe("文言の禁止語 (#556 §3.10)", () => {
  /** docs/warikan.md §3.10 の一覧（ここと設計書の2か所。設計書が正） */
  const FORBIDDEN = [
    "決済",
    "入金",
    "送金",
    "請求",
    "集金",
    "未払い",
    "残高",
    "返金",
    "預り",
    "エスクロー",
    "代行",
    "レート",
  ];

  it("warikan の ja/en の全文字列に禁止語が含まれない", () => {
    for (const lang of ["ja", "en"] as const) {
      const table = translations[lang].warikan as Record<string, string>;
      const values = Object.entries(table);
      expect(values.length, `${lang} の warikan が空（走査が空振りしている）`).toBeGreaterThan(50);
      const hits = values.flatMap(([key, value]) =>
        FORBIDDEN.filter((w) => value.includes(w)).map((w) => `${lang}.${key}: 「${w}」`),
      );
      expect(hits).toEqual([]);
    }
  });

  it("ボタンの文言に「精算する」を使わない", () => {
    const hits = Object.entries(translations.ja.warikan as Record<string, string>)
      .filter(([, v]) => v.includes("精算する"))
      .map(([k]) => k);
    expect(hits).toEqual([]);
  });
});
