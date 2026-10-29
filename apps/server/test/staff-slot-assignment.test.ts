import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import checkSql from "../../../scripts/check-member-counters.sql?raw";

/**
 * スタッフを参加枠に並べる・運営が割り当てる枠 (migration 0116, docs/staff-slot-assignment.md)。
 *
 * - 参加者以外のロールは assigned_slot_id で好きな枠の下に並べられる。表示だけで、席
 *   （slot_id・定員・抽選・キャンセル待ち・0108 の在籍数）は一切動かない。
 * - staff_only の枠は参加者の申込・自動登録で選べず、イベントの上限にも入れない。
 */

const BASE = "https://example.com/api";
const day = 86400000;
const sql = (query: string, ...args: unknown[]) => env.DB.prepare(query).bind(...args).run();

type Actor = { id: string; cookie: string };

async function user(): Promise<Actor> {
  const id = crypto.randomUUID(), sid = crypto.randomUUID();
  await sql("INSERT INTO user(id,discord_id,username,created_at) VALUES(?,?,?,?)", id, `t:${id}`, `s_${id.slice(0, 8)}`, Date.now());
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)", sid, id, Date.now() + day);
  return { id, cookie: `eventer_session=${sid}` };
}

async function request(path: string, actor: Actor | null, method = "GET", body?: unknown) {
  return SELF.fetch(BASE + path, {
    method,
    headers: { ...(actor ? { cookie: actor.cookie } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(res: Response, status = 200): Promise<any> {
  expect(res.status, await res.clone().text()).toBe(status);
  return res.json();
}

async function setupEvent(host: Actor): Promise<string> {
  const { event } = await json(await request("/events", host, "POST", {
    title: "staff slot", venueType: "offline", startsAt: Date.now() + day, endsAt: Date.now() + 2 * day,
  }), 201);
  await json(await request(`/events/${event.id}`, host, "PATCH", { status: "published" }));
  return event.id as string;
}

async function addSlot(eventId: string, host: Actor, capacity: number, opts: { selectionType?: string; staffOnly?: boolean } = {}) {
  return (await json(await request(`/events/${eventId}/slots`, host, "POST", {
    name: `slot ${crypto.randomUUID().slice(0, 4)}`, capacity,
    selectionType: opts.selectionType ?? "first_come", ...(opts.staffOnly ? { staffOnly: true } : {}),
  }), 201)).slot.id as string;
}

/** 枠を作る前から参加していたスタッフ（枠を作る前の参加はそのまま枠なしになる） */
async function addStaffBeforeSlots(eventId: string, host: Actor): Promise<Actor> {
  const s = await user();
  await json(await request(`/events/${eventId}/join`, s, "POST", {}), 201);
  await json(await request(`/events/${eventId}/members/${s.id}/role`, host, "PATCH", { role: "staff" }));
  return s;
}

async function slots(eventId: string, viewer: Actor) {
  return (await json(await request(`/events/${eventId}/slots`, viewer))).slots as Array<{
    id: string; staffOnly: boolean; confirmedCount: number; waitlistCount: number; appliedCount: number;
  }>;
}

async function memberRow(eventId: string, userId: string) {
  return env.DB.prepare("SELECT role,slot_id,assigned_slot_id,status FROM event_member WHERE event_id=? AND user_id=?")
    .bind(eventId, userId).first<{ role: string; slot_id: string | null; assigned_slot_id: string | null; status: string }>();
}

async function drift(): Promise<unknown[]> {
  const body = checkSql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim().replace(/;$/, "");
  return (await env.DB.prepare(body).all()).results;
}

const assign = (eventId: string, actor: Actor, userId: string, slotId: string | null) =>
  request(`/events/${eventId}/members/${userId}/assigned-slot`, actor, "PATCH", { slotId });

describe("スタッフを参加枠に並べる (assigned_slot_id)", () => {
  it("枠を作る前からいたスタッフを、満員の枠に並べても席は減らない", async () => {
    const host = await user();
    const eventId = await setupEvent(host);
    const staff = await addStaffBeforeSlots(eventId, host);
    const full = await addSlot(eventId, host, 1);
    const p1 = await user();
    await json(await request(`/events/${eventId}/join`, p1, "POST", { slotId: full }), 201);
    const before = await slots(eventId, host);
    const { event: eventBefore } = await json(await request(`/events/${eventId}`, host));

    const { member } = await json(await assign(eventId, host, staff.id, full));
    expect(member).toMatchObject({ role: "staff", slotId: null, assignedSlotId: full, status: "confirmed" });

    // 席・在籍数・上限は変わらない
    expect(await slots(eventId, host)).toEqual(before);
    const { event: eventAfter } = await json(await request(`/events/${eventId}`, host));
    expect(eventAfter.participantCount).toBe(eventBefore.participantCount);
    expect(eventAfter.capacityTotal).toBe(eventBefore.capacityTotal);
    expect(await drift()).toEqual([]);

    // 一覧ではその枠の下に並ぶ（assignedSlotId が返る）
    const { members } = await json(await request(`/events/${eventId}/members`, host));
    expect(members.find((m: any) => m.userId === staff.id)).toMatchObject({ assignedSlotId: full, slotId: null });

    // 満員の先着枠に次の参加者が来ても、スタッフは席を取っていないのでキャンセル待ち（今までどおり）
    const p2 = await user();
    const joined = await json(await request(`/events/${eventId}/join`, p2, "POST", { slotId: full }), 201);
    expect(joined.status).toBe("waitlist");

    // null で枠なしに戻せる
    expect((await json(await assign(eventId, host, staff.id, null))).member.assignedSlotId).toBeNull();
  });

  it("抽選にもキャンセル待ちの繰り上げにも入らない", async () => {
    const host = await user();
    const eventId = await setupEvent(host);
    const staff = await addStaffBeforeSlots(eventId, host);
    const lottery = await addSlot(eventId, host, 1, { selectionType: "lottery" });
    await json(await assign(eventId, host, staff.id, lottery));
    const a = await user();
    await json(await request(`/events/${eventId}/join`, a, "POST", { slotId: lottery }), 201);
    await json(await request(`/events/${eventId}/slots/${lottery}/draw`, host, "POST"));
    // 当選したのは申込者。スタッフは確定のまま・席なしのまま
    expect((await memberRow(eventId, a.id))?.status).toBe("confirmed");
    expect(await memberRow(eventId, staff.id)).toMatchObject({ role: "staff", slot_id: null, assigned_slot_id: lottery, status: "confirmed" });
  });

  it("運営以外は 403、参加者の行・他イベントの枠は断る", async () => {
    const host = await user();
    const eventId = await setupEvent(host);
    const staff = await addStaffBeforeSlots(eventId, host);
    const slot = await addSlot(eventId, host, 5);
    const participant = await user();
    await json(await request(`/events/${eventId}/join`, participant, "POST", { slotId: slot }), 201);

    expect((await assign(eventId, participant, staff.id, slot)).status).toBe(403);
    expect((await json(await assign(eventId, host, participant.id, slot), 409)).error).toBe("participant_slot");
    const otherEvent = await setupEvent(host);
    const foreign = await addSlot(otherEvent, host, 5);
    expect((await assign(eventId, host, staff.id, foreign)).status).toBe(404);
    expect((await memberRow(eventId, staff.id))?.assigned_slot_id).toBeNull();
  });

  it("運営は自分自身の行も並べ替えられる（主催・スタッフとも）。参加者は自分の行でも 403", async () => {
    const host = await user();
    const eventId = await setupEvent(host);
    const staff = await addStaffBeforeSlots(eventId, host);
    const crew = await addSlot(eventId, host, 1, { staffOnly: true });

    expect((await json(await assign(eventId, staff, staff.id, crew))).member)
      .toMatchObject({ role: "staff", slotId: null, assignedSlotId: crew });
    // 作成者は作成時にスタッフとして登録される
    expect((await json(await assign(eventId, host, host.id, crew))).member)
      .toMatchObject({ role: "staff", assignedSlotId: crew });

    const p = await user();
    await json(await request(`/events/${eventId}/join`, p, "POST", {}), 201);
    expect((await assign(eventId, p, p.id, crew)).status).toBe(403);
  });

  it("参加者に戻すと割り当ては消え、枠を消すと割り当ても外れる", async () => {
    const host = await user();
    const eventId = await setupEvent(host);
    const staff = await addStaffBeforeSlots(eventId, host);
    const judge = await addStaffBeforeSlots(eventId, host);
    const slot = await addSlot(eventId, host, 5);
    await json(await assign(eventId, host, staff.id, slot));
    await json(await assign(eventId, host, judge.id, slot));

    // スタッフ→参加者は参加の取消 (#281)。行が消えるか、残っても割り当ては持たない
    await json(await request(`/events/${eventId}/members/${staff.id}/role`, host, "PATCH", { role: "participant" }));
    const row = await memberRow(eventId, staff.id);
    expect(row?.assigned_slot_id ?? null).toBeNull();
    // ロールの書き換えで参加者になった行も、トリガーで割り当てが消える
    await sql("UPDATE event_member SET role='participant' WHERE event_id=? AND user_id=?", eventId, judge.id);
    expect((await memberRow(eventId, judge.id))?.assigned_slot_id).toBeNull();

    // 枠がある状態でスタッフに招待された人（スタッフ招待と同じ形の行）
    const other = await user();
    await sql("INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,'staff','confirmed',?)",
      crypto.randomUUID(), eventId, other.id, Date.now());
    await json(await assign(eventId, host, other.id, slot));
    await json(await request(`/events/${eventId}/slots/${slot}`, host, "DELETE"));
    expect((await memberRow(eventId, other.id))?.assigned_slot_id).toBeNull();
    expect(await drift()).toEqual([]);
  });
});

describe("参加者をスタッフ等にしたとき、申し込んでいた枠の下に並んだままにする", () => {
  it("枠Aの確定参加者をスタッフにすると、席は空き、一覧では枠Aの下に残る。キャンセル待ちは繰り上がる", async () => {
    const host = await user();
    const eventId = await setupEvent(host);
    const slotA = await addSlot(eventId, host, 1);
    const p = await user();
    await json(await request(`/events/${eventId}/join`, p, "POST", { slotId: slotA }), 201);
    const waiting = await user();
    expect((await json(await request(`/events/${eventId}/join`, waiting, "POST", { slotId: slotA }), 201)).status).toBe("waitlist");

    const { member } = await json(await request(`/events/${eventId}/members/${p.id}/role`, host, "PATCH", { role: "staff" }));
    expect(member).toMatchObject({ role: "staff", slotId: null, assignedSlotId: slotA, status: "confirmed" });
    expect(await memberRow(eventId, p.id)).toMatchObject({ role: "staff", slot_id: null, assigned_slot_id: slotA, status: "confirmed" });

    // 席は空いて、キャンセル待ちが繰り上がる（#277 / #281 のまま）
    expect((await memberRow(eventId, waiting.id))?.status).toBe("confirmed");
    const a = (await slots(eventId, host)).find((s) => s.id === slotA)!;
    expect(a.confirmedCount).toBe(1);
    expect(a.waitlistCount).toBe(0);
    expect(await drift()).toEqual([]);
  });

  it("枠なしの参加者をスタッフにすると、割り当ても無し（その他）", async () => {
    const host = await user();
    const eventId = await setupEvent(host);
    const staff = await addStaffBeforeSlots(eventId, host);
    expect(await memberRow(eventId, staff.id)).toMatchObject({ role: "staff", slot_id: null, assigned_slot_id: null });
  });

  it("スタッフから審査員にしても、並べた枠はそのまま。参加者に戻すと消える", async () => {
    const host = await user();
    const eventId = await setupEvent(host);
    const keep = await addStaffBeforeSlots(eventId, host);
    const slotB = await addSlot(eventId, host, 5);
    await json(await assign(eventId, host, keep.id, slotB));
    await json(await request(`/events/${eventId}/members/${keep.id}/role`, host, "PATCH", { role: "judge" }));
    expect(await memberRow(eventId, keep.id)).toMatchObject({ role: "judge", slot_id: null, assigned_slot_id: slotB });
    await sql("UPDATE event_member SET role='participant' WHERE event_id=? AND user_id=?", eventId, keep.id);
    expect((await memberRow(eventId, keep.id))?.assigned_slot_id).toBeNull();
  });

  it("枠Aの参加者がスタッフ招待を受けても、枠Aの下に残る", async () => {
    const host = await user();
    const eventId = await setupEvent(host);
    const slotA = await addSlot(eventId, host, 3);
    const p = await user();
    await json(await request(`/events/${eventId}/join`, p, "POST", { slotId: slotA }), 201);
    const handle = (await env.DB.prepare("SELECT username FROM user WHERE id=?").bind(p.id).first<{ username: string }>())!.username;
    await json(await request(`/events/${eventId}/staff-invites`, host, "POST", { handle }), 201);
    const { invites } = await json(await request("/me/staff-invites", p));
    await json(await request(`/me/staff-invites/${invites[0].id}/accept`, p, "POST"));
    expect(await memberRow(eventId, p.id)).toMatchObject({ role: "staff", slot_id: null, assigned_slot_id: slotA, status: "confirmed" });
    expect(await drift()).toEqual([]);
  });
});

describe("運営が割り当てる枠 (staff_only)", () => {
  it("参加者は選べず（409 slot_staff_only）、スタッフは並べられる", async () => {
    const host = await user();
    const eventId = await setupEvent(host);
    const staff = await addStaffBeforeSlots(eventId, host);
    const open = await addSlot(eventId, host, 5);
    const staffOnly = await addSlot(eventId, host, 1, { staffOnly: true });
    expect((await slots(eventId, host)).find((s) => s.id === staffOnly)?.staffOnly).toBe(true);

    const p = await user();
    expect((await json(await request(`/events/${eventId}/join`, p, "POST", { slotId: staffOnly }), 409)).error).toBe("slot_staff_only");
    expect(await memberRow(eventId, p.id)).toBeNull();
    // 参加者が選べる枠は今までどおり
    await json(await request(`/events/${eventId}/join`, p, "POST", { slotId: open }), 201);

    await json(await assign(eventId, host, staff.id, staffOnly));
    expect((await memberRow(eventId, staff.id))?.assigned_slot_id).toBe(staffOnly);
  });

  it("運営の枠しかないイベントは、枠なしで参加でき、上限は付かない", async () => {
    const host = await user();
    const eventId = await setupEvent(host);
    const staffOnly = await addSlot(eventId, host, 3, { staffOnly: true });
    const p = await user();
    const { member } = await json(await request(`/events/${eventId}/join`, p, "POST", {}), 201);
    expect(member).toMatchObject({ slotId: null, status: "confirmed" });
    expect((await json(await request(`/events/${eventId}/join`, (await user()), "POST", { slotId: staffOnly }), 409)).error).toBe("slot_staff_only");
    const { event } = await json(await request(`/events/${eventId}`, host));
    expect(event.capacityTotal).toBeNull();
    expect(await drift()).toEqual([]);
  });

  it("イベントの上限には運営の枠の定員を入れない。オンにしても前からいた参加者は残る", async () => {
    const host = await user();
    const eventId = await setupEvent(host);
    const open = await addSlot(eventId, host, 10);
    const later = await addSlot(eventId, host, 4);
    const early = await user();
    await json(await request(`/events/${eventId}/join`, early, "POST", { slotId: later }), 201);
    const before = (await json(await request(`/events/${eventId}`, host))).event;
    // host(staff, 枠なし) 1 + 10 + 4
    expect(before.capacityTotal).toBe(15);

    await json(await request(`/events/${eventId}/slots/${later}`, host, "PATCH", { staffOnly: true }));
    // 上限は open の 10 + 枠なしの確定 1 + 運営の枠にいる確定 1（分子と母集団を揃える）
    const after = (await json(await request(`/events/${eventId}`, host))).event;
    expect(after.capacityTotal).toBe(12);
    expect(after.participantCount).toBe(before.participantCount);
    // 前からいた参加者はそのまま
    expect(await memberRow(eventId, early.id)).toMatchObject({ slot_id: later, status: "confirmed" });
    // 新しい申込は止まる
    expect((await request(`/events/${eventId}/join`, await user(), "POST", { slotId: later })).status).toBe(409);
    await json(await request(`/events/${eventId}/join`, await user(), "POST", { slotId: open }), 201);
    expect(await drift()).toEqual([]);
  });

  it("日程確定の自動登録は運営の枠を選ばない", async () => {
    const host = await user();
    const eventId = await setupEvent(host);
    await addSlot(eventId, host, 3, { staffOnly: true });
    const open = await addSlot(eventId, host, 3);
    // 参加者が選べる枠が1つだけなら、自動登録はその枠に入れる（運営の枠は数えない）
    const option = crypto.randomUUID(), voter = await user();
    await sql("UPDATE event SET scheduling=1 WHERE id=?", eventId);
    await sql("INSERT INTO event_date_option(id,event_id,starts_at,ends_at,sort_order,created_at) VALUES(?,?,?,?,0,?)",
      option, eventId, Date.now() + day, Date.now() + 2 * day, Date.now());
    await sql("INSERT INTO event_date_vote(id,option_id,user_id,choice,created_at) VALUES(?,?,?,'yes',?)",
      crypto.randomUUID(), option, voter.id, Date.now());
    const { event } = await json(await request(`/events/${eventId}`, host));
    await json(await request(`/events/${eventId}/finalize-date`, host, "POST", {
      optionId: option, expectedAccessRevision: event.accessRevision,
    }));
    expect(await memberRow(eventId, voter.id)).toMatchObject({ role: "participant", slot_id: open });
  });
});
