import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { bindEnv, type Env } from "../src/runtime.js";
import {
  BASE,
  addAssignee,
  createDuty,
  getStaffing,
  loginDev,
  makeMember,
  makePublicItem,
  putSlots,
  putTimetable,
  setupBoard,
  setupEvent,
} from "./lib/staffDutyHelpers.js";

/**
 * 役割と持ち場の整合と上限 (#384 設計 9.6)。
 *
 * - **子リソースの所有チェック**（itemId / dutyId / slotId / assigneeId →
 *   すべて event まで辿る。他イベントの id は 404 で、存在も教えない）
 * - 上限（4.2 の5つ）は**ちょうどが通り、1つ超えると理由コードで断られる**
 * - 宣言型 PUT の差分（人数だけ変えても割り当ては外れない）と CASCADE の向き
 * - トラック削除で項目が unassigned に**落ちても**持ち場は残る（設計 3.3）
 *
 * 漏れ（403・参加者向け経路）と担当者が外れる4通りは `staff-duty.test.ts`。
 */

beforeAll(() => {
  bindEnv(env as unknown as Env);
});

/* ===== 9.6 整合と上限 ===== */

describe("所有チェックと整合 (#384 9.6)", () => {
  it("他イベントの itemId / dutyId / slotId / assigneeId は 404（403 ではない）", async () => {
    const a = await setupBoard();
    const b = await setupBoard();
    const staffB = await makeMember(b.eventId, "staff");
    const addedB = await addAssignee(b.eventId, b.cookie, b.slotId, staffB.userId);
    expect(addedB.status).toBe(201);

    // イベント A の口から、イベント B の子リソースを指す
    const otherItem = await putSlots(a.eventId, a.cookie, b.itemId, [
      { dutyId: a.dutyId, required: 1 },
    ]);
    expect(otherItem.status).toBe(404);
    const otherDuty = await putSlots(a.eventId, a.cookie, a.itemId, [
      { dutyId: b.dutyId, required: 1 },
    ]);
    expect(otherDuty.status).toBe(404);
    const staffA = await makeMember(a.eventId, "staff");
    const otherSlot = await addAssignee(a.eventId, a.cookie, b.slotId, staffA.userId);
    expect(otherSlot.status).toBe(404);
    const patchOther = await SELF.fetch(
      `${BASE}/api/events/${a.eventId}/staffing/duties/${b.dutyId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: a.cookie },
        body: JSON.stringify({ name: "乗っ取り" }),
      },
    );
    expect(patchOther.status).toBe(404);
    const delOther = await SELF.fetch(
      `${BASE}/api/events/${a.eventId}/staffing/slots/${a.slotId}/assignees/${addedB.id}`,
      { method: "DELETE", headers: { cookie: a.cookie } },
    );
    expect(delOther.status).toBe(404);
    // 何も起きていない
    const seenB = await getStaffing(b.eventId, b.cookie);
    expect(seenB.duties[0]!.name).toBe("受付");
    expect(seenB.slots[0]!.assignees).toHaveLength(1);
  });

  it("同名の役割は 400 duty_name_taken（作成・改名の両方）", async () => {
    const { cookie, eventId, dutyId } = await setupBoard("受付");
    const dup = await SELF.fetch(`${BASE}/api/events/${eventId}/staffing/duties`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "受付" }),
    });
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as { error: string }).error).toBe("duty_name_taken");

    const other = await createDuty(eventId, cookie, "司会");
    const rename = await SELF.fetch(
      `${BASE}/api/events/${eventId}/staffing/duties/${other}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "受付" }),
      },
    );
    expect(rename.status).toBe(400);
    expect(((await rename.json()) as { error: string }).error).toBe(
      "duty_name_taken",
    );
    // 自分自身への同名の改名（並び替えついでの再送）は通る
    const self = await SELF.fetch(
      `${BASE}/api/events/${eventId}/staffing/duties/${dutyId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "受付" }),
      },
    );
    expect(self.status).toBe(200);
  });

  it("人数だけ変えたとき割り当てが残り、持ち場を外すと割り当てごと消える", async () => {
    const { cookie, eventId, itemId, dutyId, slotId } = await setupBoard();
    const staff = await makeMember(eventId, "staff");
    expect((await addAssignee(eventId, cookie, slotId, staff.userId)).status).toBe(201);

    // 人数だけ 2 → 5。**割り当ては残る**（slot の id も変わらない）
    expect(
      (await putSlots(eventId, cookie, itemId, [{ dutyId, required: 5 }]))
        .status,
    ).toBe(200);
    let seen = await getStaffing(eventId, cookie);
    expect(seen.slots[0]!.id).toBe(slotId);
    expect(seen.slots[0]!.requiredCount).toBe(5);
    expect(seen.slots[0]!.assignees).toHaveLength(1);

    // 持ち場を外す（空集合を送る）→ 割り当てごと消える
    expect((await putSlots(eventId, cookie, itemId, [])).status).toBe(200);
    seen = await getStaffing(eventId, cookie);
    expect(seen.slots).toHaveLength(0);
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM event_duty_assignee WHERE slot_id = ?",
    )
      .bind(slotId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("役割を消すと持ち場・割り当てが CASCADE で消える（定義は残らない）", async () => {
    const { cookie, eventId, dutyId, slotId } = await setupBoard();
    const staff = await makeMember(eventId, "staff");
    expect((await addAssignee(eventId, cookie, slotId, staff.userId)).status).toBe(201);
    const del = await SELF.fetch(
      `${BASE}/api/events/${eventId}/staffing/duties/${dutyId}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(del.status).toBe(200);
    const seen = await getStaffing(eventId, cookie);
    expect(seen.duties).toHaveLength(0);
    expect(seen.slots).toHaveLength(0);
  });

  it("タイムテーブルの保存で項目を消すと、持ち場も消える", async () => {
    const { cookie, eventId, slotId } = await setupBoard();
    // 項目を送らない＝削除 (#340)
    await putTimetable(eventId, cookie, { items: [] });
    const seen = await getStaffing(eventId, cookie);
    expect(seen.slots).toHaveLength(0);
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM event_duty_slot WHERE id = ?",
    )
      .bind(slotId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("トラック削除で項目が unassigned に落ちても、持ち場は残る (#384 3.3)", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const first = await putTimetable(eventId, cookie, {
      tracks: [{ name: "運営動線", visibility: "staff" }],
      items: [
        {
          title: "会場設営",
          durationMin: 60,
          placement: "tracks",
          trackIndexes: [0],
          visibility: "staff",
        },
      ],
    });
    const itemId = first.items[0]!.id;
    const dutyId = await createDuty(eventId, cookie, "設営");
    expect(
      (await putSlots(eventId, cookie, itemId, [{ dutyId, required: 3 }]))
        .status,
    ).toBe(200);

    // トラックを送らない＝削除。項目は unassigned に**落ちる**（0067）
    const after = await putTimetable(eventId, cookie, {
      tracks: [],
      items: [
        {
          id: itemId,
          title: "会場設営",
          durationMin: 60,
          placement: "tracks",
          trackIndexes: [],
          visibility: "staff",
        },
      ],
    });
    expect(after.items[0]!.placement).toBe("unassigned");

    // 持ち場は道連れにならない（運営の入力を捨てない）
    const seen = await getStaffing(eventId, cookie);
    expect(seen.slots).toHaveLength(1);
    expect(seen.slots[0]!.itemId).toBe(itemId);
    expect(seen.slots[0]!.requiredCount).toBe(3);
  });
});

describe("上限 (#384 9.6 / 4.2)", () => {
  it("役割は 30 個まで。31 個目は duty_limit", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    for (let i = 0; i < 30; i++) {
      await createDuty(eventId, cookie, `役割${i}`);
    }
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/staffing/duties`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "31個目" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("duty_limit");
  });

  it("1つの時間帯の持ち場は 10 まで。11 は duty_slot_limit", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie);
    const itemId = await makePublicItem(eventId, cookie);
    const dutyIds: string[] = [];
    for (let i = 0; i < 11; i++) {
      dutyIds.push(await createDuty(eventId, cookie, `役割${i}`));
    }
    const ten = await putSlots(
      eventId,
      cookie,
      itemId,
      dutyIds.slice(0, 10).map((dutyId) => ({ dutyId, required: 1 })),
    );
    expect(ten.status, "上限ちょうどが通らない").toBe(200);
    const eleven = await putSlots(
      eventId,
      cookie,
      itemId,
      dutyIds.map((dutyId) => ({ dutyId, required: 1 })),
    );
    expect(eleven.status).toBe(400);
    expect(((await eleven.json()) as { error: string }).error).toBe(
      "duty_slot_limit",
    );
  });

  it("必要人数は 1〜50。0 と 51 は duty_required_range", async () => {
    const { cookie, eventId, itemId, dutyId } = await setupBoard();
    const ok = await putSlots(eventId, cookie, itemId, [
      { dutyId, required: 50 },
    ]);
    expect(ok.status, "上限ちょうどが通らない").toBe(200);
    for (const required of [0, 51]) {
      const bad = await putSlots(eventId, cookie, itemId, [
        { dutyId, required },
      ]);
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { error: string }).error).toBe(
        "duty_required_range",
      );
    }
  });

  it("割り当ては1持ち場 50 人まで。51 人目は duty_assignee_limit", async () => {
    const { cookie, eventId, slotId } = await setupBoard();
    // 50 行はリポジトリを通さず直接入れる（user の FK だけ満たせばよい）
    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      const uid = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, NULL, NULL, ?)",
      )
        .bind(uid, `nostr:${uid}`, `bulk_${i}_${uid.slice(0, 6)}`, now)
        .run();
      await env.DB.prepare(
        "INSERT INTO event_duty_assignee (id, slot_id, user_id, created_at) VALUES (?, ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), slotId, uid, now)
        .run();
    }
    const staff = await makeMember(eventId, "staff");
    const r = await addAssignee(eventId, cookie, slotId, staff.userId);
    expect(r.status).toBe(400);
    expect(r.error).toBe("duty_assignee_limit");
  });

  it("同じ人を同じ持ち場へ二重に割り当てると duty_assignee_dup", async () => {
    const { cookie, eventId, slotId } = await setupBoard();
    const staff = await makeMember(eventId, "staff");
    expect((await addAssignee(eventId, cookie, slotId, staff.userId)).status).toBe(201);
    const dup = await addAssignee(eventId, cookie, slotId, staff.userId);
    expect(dup.status).toBe(400);
    expect(dup.error).toBe("duty_assignee_dup");
  });

  it("必要数を超える割り当て（応援）は許す", async () => {
    const { cookie, eventId, slotId } = await setupBoard(); // 必要2人
    for (let i = 0; i < 3; i++) {
      const staff = await makeMember(eventId, "staff");
      expect((await addAssignee(eventId, cookie, slotId, staff.userId)).status).toBe(
        201,
      );
    }
    const seen = await getStaffing(eventId, cookie);
    expect(seen.slots[0]!.assignees).toHaveLength(3);
  });
});

