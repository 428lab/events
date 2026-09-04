import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import type { EventStaffingPayload } from "@eventer/shared";
import { bindEnv, type Env } from "../src/runtime.js";
import { buildEventExtraHtml } from "../src/lib/email.js";
import { accountDeletionRepo } from "../src/db/repositories/accountDeletion.js";
import { accountMergeRepo } from "../src/db/repositories/accountMerge.js";
import { eventMembersRepo } from "../src/db/repositories/eventMembers.js";
import {
  BASE,
  HOUR,
  addAssignee,
  createDuty,
  getStaffing,
  loginDev,
  makeMember,
  makePublicItem,
  makeUser,
  putSlots,
  setupBoard,
  setupEvent,
  type TestUser,
} from "./lib/staffDutyHelpers.js";

/**
 * スタッフの役割タグと持ち場 (#384)。
 *
 * 主眼は3つ。
 *
 * 1. **参加者に1バイトも漏れないこと。** 専用 GET の 403 と、参加者向けの
 *    既存経路（イベント詳細・タイムテーブル・メール・CSV・フィード・公開ページ）の
 *    両側から押さえる。**公開セッションに持ち場を当てたケース**を必ず含める
 *    （設計 3.3 で範囲を広げた分の担保）
 * 2. **担当者が外れたときに名前が残らないこと。** 退会申請 (#250) は
 *    `event_member` の staff 行が残るので、メンバー行だけを見る実装だと
 *    退会した人の名前が出続ける（#393 9.5 と同型）
 * 3. **完全削除は行ごと消える**（CASCADE。TODO の SET NULL と逆にした証拠）
 *
 * 所有チェック・上限・CASCADE は `staff-duty-slots.test.ts`、
 * 3表を触る SQL が1か所に閉じていることは `staff-duty-sql-audit.test.ts`、
 * アカウント統合の登録漏れは `merge-user-columns.test.ts` が見張る。
 */

beforeAll(() => {
  bindEnv(env as unknown as Env);
});

/* ===== 9.1 参加者に漏れない（最重要）===== */

describe("スタッフ以外は持ち場に触れない (#384 9.1)", () => {
  /** 役割ごとに**1本ずつ**書く。まとめない（#383 の
   * 「4か所のうち1か所だけ直っていた」事故の再発防止） */
  for (const role of ["participant", "judge", "observer"] as const) {
    it(`${role} は一覧を取れない`, async () => {
      const { eventId } = await setupBoard();
      const other = await makeMember(eventId, role);
      const res = await SELF.fetch(`${BASE}/api/events/${eventId}/staffing`, {
        headers: { cookie: other.cookie },
      });
      expect(res.status).toBe(403);
    });
  }

  it("そのイベントのメンバーでない利用者は一覧を取れない", async () => {
    const { eventId } = await setupBoard();
    const stranger = await makeUser();
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/staffing`, {
      headers: { cookie: stranger.cookie },
    });
    expect(res.status).toBe(403);
  });

  it("未ログインは 401", async () => {
    const { eventId } = await setupBoard();
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/staffing`);
    expect(res.status).toBe(401);
  });

  it("そのイベントの staff には全部返る（絞りすぎていない）", async () => {
    const { eventId, dutyId, slotId } = await setupBoard("受付ヒミツ");
    // **アプリ運営管理者ではない**、そのイベントの staff で確かめる
    const staff = await makeMember(eventId, "staff");
    const seen = await getStaffing(eventId, staff.cookie);
    expect(seen.duties.map((d) => d.name)).toEqual(["受付ヒミツ"]);
    expect(seen.slots).toHaveLength(1);
    expect(seen.slots[0]).toMatchObject({
      id: slotId,
      dutyId,
      requiredCount: 2,
    });
    expect(seen.assignable.map((a) => a.id)).toContain(staff.userId);
  });

  /** **書き込み7本すべて**を1本ずつ。1つにまとめない */
  it("participant は書き込み7本すべてが 403", async () => {
    const { cookie, eventId, itemId, dutyId, slotId } = await setupBoard();
    const staff = await makeMember(eventId, "staff");
    const added = await addAssignee(eventId, cookie, slotId, staff.userId);
    expect(added.status).toBe(201);
    const p = await makeMember(eventId, "participant");
    const json = { "content-type": "application/json", cookie: p.cookie };
    const base = `${BASE}/api/events/${eventId}/staffing`;
    const writes: Array<[name: string, res: Promise<Response>]> = [
      [
        "POST /duties",
        SELF.fetch(`${base}/duties`, {
          method: "POST",
          headers: json,
          body: JSON.stringify({ name: "勝手な役割" }),
        }),
      ],
      [
        "PATCH /duties/:id",
        SELF.fetch(`${base}/duties/${dutyId}`, {
          method: "PATCH",
          headers: json,
          body: JSON.stringify({ name: "改名" }),
        }),
      ],
      [
        "PUT /duties/order",
        SELF.fetch(`${base}/duties/order`, {
          method: "PUT",
          headers: json,
          body: JSON.stringify({ ids: [dutyId] }),
        }),
      ],
      [
        "DELETE /duties/:id",
        SELF.fetch(`${base}/duties/${dutyId}`, {
          method: "DELETE",
          headers: { cookie: p.cookie },
        }),
      ],
      [
        "PUT /items/:itemId",
        SELF.fetch(`${base}/items/${itemId}`, {
          method: "PUT",
          headers: json,
          body: JSON.stringify({ slots: [] }),
        }),
      ],
      [
        "POST /slots/:slotId/assignees",
        SELF.fetch(`${base}/slots/${slotId}/assignees`, {
          method: "POST",
          headers: json,
          body: JSON.stringify({ userId: p.userId }),
        }),
      ],
      [
        "DELETE /slots/:slotId/assignees/:assigneeId",
        SELF.fetch(`${base}/slots/${slotId}/assignees/${added.id}`, {
          method: "DELETE",
          headers: { cookie: p.cookie },
        }),
      ],
    ];
    for (const [name, promise] of writes) {
      expect((await promise).status, `${name} が 403 でない`).toBe(403);
    }

    // 実際に何も起きていないこと（403 を返しつつ書いていた、を防ぐ）
    const seen = await getStaffing(eventId, cookie);
    expect(seen.duties).toHaveLength(1);
    expect(seen.duties[0]!.name).toBe("受付");
    expect(seen.slots).toHaveLength(1);
    expect(seen.slots[0]!.assignees).toHaveLength(1);
  });
});

/* ===== 9.2 参加者向けの既存レスポンスに混ざらない ===== */

describe("参加者向けの経路に役割が1件も出ない (#384 9.2)", () => {
  it("公開セッションに当てても、6経路すべてに役割名の文字列が現れない", async () => {
    const cookie = await loginDev();
    // メールは JST の時刻を出すので開催日時は固定値にする
    const eventId = await setupEvent(cookie, Date.UTC(2026, 8, 12, 1, 0));
    // **公開セッション**（placement all / visibility public）に持ち場を当てる。
    // 3.3 で「公開の項目にも当てられる」に広げた分の担保
    const itemId = await makePublicItem(eventId, cookie, "ホールAの発表");
    const secret = `受付ヒミツ_${crypto.randomUUID().slice(0, 6)}`;
    const dutyId = await createDuty(eventId, cookie, secret);
    expect(
      (await putSlots(eventId, cookie, itemId, [{ dutyId, required: 2 }]))
        .status,
    ).toBe(200);
    const staff = await makeMember(eventId, "staff");
    const seen = await getStaffing(eventId, cookie);
    expect(
      (await addAssignee(eventId, cookie, seen.slots[0]!.id, staff.userId))
        .status,
    ).toBe(201);
    const member = await makeMember(eventId, "participant");

    // **id ではなく役割名の文字列で照合する**（#383 9.1 と同じ理由）
    const routes: Array<[name: string, res: Promise<Response>]> = [
      [
        "イベント詳細",
        SELF.fetch(`${BASE}/api/events/${eventId}`, {
          headers: { cookie: member.cookie },
        }),
      ],
      [
        "タイムテーブル",
        SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
          headers: { cookie: member.cookie },
        }),
      ],
      [
        "出席CSV",
        SELF.fetch(`${BASE}/api/events/${eventId}/attendance.csv`, {
          headers: { cookie },
        }),
      ],
      ["フィード(RSS)", SELF.fetch(`${BASE}/feed/events.rss`)],
      ["フィード(ICS)", SELF.fetch(`${BASE}/feed/events.ics`)],
      ["公開イベント一覧", SELF.fetch(`${BASE}/api/public/events`)],
    ];
    for (const [name, promise] of routes) {
      const text = await (await promise).text();
      expect(text.includes(secret), `${name} に役割名が出ている`).toBe(false);
    }

    // 前日リマインダーのメール本文
    const html = await buildEventExtraHtml(`/events/${eventId}`, true);
    expect(html).not.toContain(secret);

    // 公開セッション自体は参加者にいままでどおり見えている（隠しすぎていない）
    const tt = await SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
      headers: { cookie: member.cookie },
    });
    expect(await tt.text()).toContain("ホールAの発表");
  });
});

/* ===== 9.3 「登壇 N 回」に影響しない ===== */

describe("持ち場の割り当ては登壇に数えない (#384 9.3)", () => {
  it("公開セッションの持ち場に割り当てられても spoken は増えない", async () => {
    const { cookie, eventId, itemId, slotId } = await setupBoard("司会");
    const staff = await makeMember(eventId, "staff");
    expect((await addAssignee(eventId, cookie, slotId, staff.userId)).status).toBe(
      201,
    );
    // spoken は「終了済みの公開イベント」だけを数えるので、開催日時を過去に倒す
    const past = Date.now() - 30 * 24 * HOUR;
    await env.DB.prepare("UPDATE event SET starts_at = ?, ends_at = ? WHERE id = ?")
      .bind(past, past + 8 * HOUR, eventId)
      .run();

    const now = Date.now();
    const stats = await eventMembersRepo.participationStats(staff.userId, now);
    expect(stats.spoken, "割り当てただけで登壇に数えられている").toBe(0);

    // 数え方そのものが生きていることの対照実験:
    // 同じ項目の speaker_user_id に入れたときは 1 になる
    await env.DB.prepare(
      "UPDATE event_schedule_item SET speaker_user_id = ? WHERE id = ?",
    )
      .bind(staff.userId, itemId)
      .run();
    const after = await eventMembersRepo.participationStats(staff.userId, now);
    expect(after.spoken).toBe(1);
  });
});

/* ===== 9.5 担当者が外れる4通り（#393 9.5 と同型）===== */

describe("担当者が外れたとき (#384 9.5)", () => {
  /** 割り当てつきの持ち場（必要2人）を1つ持つイベントを作る */
  async function setupAssigned(): Promise<{
    cookie: string;
    eventId: string;
    slotId: string;
    staff: TestUser;
  }> {
    const { cookie, eventId, slotId } = await setupBoard();
    const staff = await makeMember(eventId, "staff");
    expect((await addAssignee(eventId, cookie, slotId, staff.userId)).status).toBe(
      201,
    );
    const seen = await getStaffing(eventId, cookie);
    expect(seen.slots[0]!.assignees[0]!.state).toBe("active");
    expect(seen.slots[0]!.assignees[0]!.user!.username).toBe(staff.username);
    return { cookie, eventId, slotId, staff };
  }

  it("staff でない人・未確定 staff・退会申請中の人は割り当てられない", async () => {
    const { cookie, eventId, slotId } = await setupBoard();
    const participant = await makeMember(eventId, "participant");
    const pending = await makeMember(eventId, "staff", "applied");
    const leaving = await makeMember(eventId, "staff");
    await accountDeletionRepo.requestDeletion(leaving.userId, Date.now());
    for (const u of [participant, pending, leaving]) {
      const r = await addAssignee(eventId, cookie, slotId, u.userId);
      expect(r.status).toBe(400);
      expect(r.error).toBe("duty_assignee_not_staff");
    }
  });

  it("除名（メンバー行を消す）→ left・名前なし・行は残る", async () => {
    const { cookie, eventId, staff } = await setupAssigned();
    await env.DB.prepare(
      "DELETE FROM event_member WHERE event_id = ? AND user_id = ?",
    )
      .bind(eventId, staff.userId)
      .run();
    const seen = await getStaffing(eventId, cookie);
    expect(seen.slots[0]!.assignees).toHaveLength(1); // 行は消えない
    expect(seen.slots[0]!.assignees[0]!.state).toBe("left");
    expect(seen.slots[0]!.assignees[0]!.user).toBeNull();
  });

  it("降格（staff → participant）→ left・名前なし", async () => {
    const { cookie, eventId, staff } = await setupAssigned();
    await env.DB.prepare(
      "UPDATE event_member SET role = 'participant' WHERE event_id = ? AND user_id = ?",
    )
      .bind(eventId, staff.userId)
      .run();
    const seen = await getStaffing(eventId, cookie);
    expect(seen.slots[0]!.assignees[0]!.state).toBe("left");
    expect(seen.slots[0]!.assignees[0]!.user).toBeNull();
  });

  it("退会申請（メンバー行は残る）— ここが最も落ちやすい", async () => {
    // `event_member` だけを見る実装は、**ここで "active" のまま名前を出す**
    const { cookie, eventId, staff } = await setupAssigned();
    await accountDeletionRepo.requestDeletion(staff.userId, Date.now());
    const member = await env.DB.prepare(
      "SELECT role FROM event_member WHERE event_id = ? AND user_id = ?",
    )
      .bind(eventId, staff.userId)
      .first<{ role: string }>();
    expect(member?.role, "退会申請ではメンバー行が残るのが前提").toBe("staff");

    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/staffing`, {
      headers: { cookie },
    });
    const text = await res.text();
    const seen = JSON.parse(text) as EventStaffingPayload;
    expect(seen.slots[0]!.assignees[0]!.state).toBe("left");
    expect(seen.slots[0]!.assignees[0]!.user).toBeNull();
    // 表示名・ハンドル・user_id が本文のどこにも出ないこと
    expect(text).not.toContain(staff.username);
    expect(text).not.toContain(staff.userId);
    // 選択肢にも並ばない
    expect(seen.assignable.map((a) => a.id)).not.toContain(staff.userId);
  });

  it("完全削除（user 行を消す）— 割り当て行が消え、持ち場は空きに戻る", async () => {
    const { cookie, eventId, staff } = await setupAssigned();
    await env.DB.prepare("DELETE FROM user WHERE id = ?").bind(staff.userId).run();
    const seen = await getStaffing(eventId, cookie);
    // SET NULL にしていたら「誰でもない行」が残ってここで落ちる。CASCADE の証拠
    expect(seen.slots).toHaveLength(1); // 持ち場そのものは残る
    expect(seen.slots[0]!.requiredCount).toBe(2);
    expect(seen.slots[0]!.assignees).toHaveLength(0);
  });

  it("割り当ての選択肢に、退会申請中・未確定・participant が入らない", async () => {
    const { cookie, eventId } = await setupBoard();
    const ok = await makeMember(eventId, "staff");
    const pending = await makeMember(eventId, "staff", "applied");
    const participant = await makeMember(eventId, "participant");
    const leaving = await makeMember(eventId, "staff");
    await accountDeletionRepo.requestDeletion(leaving.userId, Date.now());

    const seen = await getStaffing(eventId, cookie);
    const ids = seen.assignable.map((a) => a.id);
    expect(ids).toContain(ok.userId);
    expect(ids).not.toContain(pending.userId);
    expect(ids).not.toContain(participant.userId);
    // **`deleted_at` を落とすと退会者がここに並ぶ**
    expect(ids).not.toContain(leaving.userId);
  });

  it("アカウント統合: 勝ち側に付け替わり、同じ持ち場の重複は1行に潰れる", async () => {
    // `simple` に書くと、勝ち負け両方が同じ持ち場に居るとき UPDATE が
    // UNIQUE (slot_id, user_id) 違反で落ちる。`uniqueKeyed` の証拠
    const { cookie, eventId, itemId, dutyId, slotId } = await setupBoard();
    const dutyB = await createDuty(eventId, cookie, "配信");
    expect(
      (
        await putSlots(eventId, cookie, itemId, [
          { dutyId, required: 2 },
          { dutyId: dutyB, required: 1 },
        ])
      ).status,
    ).toBe(200);
    const slots = (await getStaffing(eventId, cookie)).slots;
    const slotB = slots.find((s) => s.dutyId === dutyB)!.id;

    const loser = await makeMember(eventId, "staff");
    const winner = await makeMember(eventId, "staff");
    // 両方が同じ持ち場（受付）に居る＋負け側だけの持ち場（配信）
    expect((await addAssignee(eventId, cookie, slotId, loser.userId)).status).toBe(201);
    expect((await addAssignee(eventId, cookie, slotId, winner.userId)).status).toBe(201);
    expect((await addAssignee(eventId, cookie, slotB, loser.userId)).status).toBe(201);

    await accountMergeRepo.mergeUsers(winner.userId, loser.userId);

    const seen = await getStaffing(eventId, cookie);
    const reception = seen.slots.find((s) => s.id === slotId)!;
    const streaming = seen.slots.find((s) => s.id === slotB)!;
    // 重複は1行に潰れる
    expect(reception.assignees).toHaveLength(1);
    expect(reception.assignees[0]!.user!.id).toBe(winner.userId);
    // 負け側だけの持ち場は勝ち側に付け替わる
    expect(streaming.assignees).toHaveLength(1);
    expect(streaming.assignees[0]!.user!.id).toBe(winner.userId);
  });
});

