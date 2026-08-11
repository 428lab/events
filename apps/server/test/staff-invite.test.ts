import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import type { MyStaffInvite, StaffInvite } from "@eventer/shared";
import { bindEnv, type Env } from "../src/runtime.js";

/**
 * 運営スタッフへの招待 (#339)。
 *
 * 主眼は「承諾するまで運営ではない」こと。招待された時点では公開前イベントが
 * 見えず、運営の操作も通らないこと、承諾で初めて両方が通ることを確かめる。
 * あわせて、他人の招待に手を出せないこと・取り消せること・参加枠と必須の
 * 事前アンケートがこの経路の邪魔をしないことを見る。
 */

const BASE = "https://example.com";
const HOUR = 3600_000;

beforeAll(() => {
  bindEnv(env as unknown as Env);
});

interface TestUser {
  userId: string;
  username: string;
  cookie: string;
}

/** アプリ運営管理者ではない一般ユーザー（roles.ts のバイパスに引っかからない）。
 * 管理者で試すと requireEventRole を素通りしてしまい、権限の検査にならない */
async function makeUser(): Promise<TestUser> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `u_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, username, `表示_${uid.slice(0, 4)}`, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, username, cookie: `eventer_session=${sid}` };
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** 下書きのイベントを作る（作成者は自動で staff になる） */
async function createDraftEvent(owner: TestUser): Promise<string> {
  const startsAt = Date.now() + 24 * HOUR;
  const res = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: owner.cookie },
    body: JSON.stringify({
      title: "運営招待の検証",
      venueType: "offline",
      startsAt,
      endsAt: startsAt + 4 * HOUR,
    }),
  });
  expect(res.status).toBe(201);
  const { event } = await json<{ event: { id: string; status: string } }>(res);
  expect(event.status).toBe("draft");
  return event.id;
}

async function invite(
  eventId: string,
  by: TestUser,
  handle: string,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/staff-invites`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: by.cookie },
    body: JSON.stringify({ handle }),
  });
}

async function listInvites(eventId: string, by: TestUser): Promise<StaffInvite[]> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/staff-invites`, {
    headers: { cookie: by.cookie },
  });
  expect(res.status).toBe(200);
  return (await json<{ invites: StaffInvite[] }>(res)).invites;
}

async function myInvites(user: TestUser): Promise<MyStaffInvite[]> {
  const res = await SELF.fetch(`${BASE}/api/me/staff-invites`, {
    headers: { cookie: user.cookie },
  });
  expect(res.status).toBe(200);
  return (await json<{ invites: MyStaffInvite[] }>(res)).invites;
}

function respond(
  inviteId: string,
  user: TestUser,
  action: "accept" | "decline",
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/me/staff-invites/${inviteId}/${action}`, {
    method: "POST",
    headers: { cookie: user.cookie },
  });
}

/** イベント詳細の見え方（下書きは非メンバーに 404） */
function getEvent(eventId: string, user: TestUser): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}`, {
    headers: { cookie: user.cookie },
  });
}

/** 運営の操作が通るか（下書きの編集） */
function editEvent(eventId: string, user: TestUser): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: user.cookie },
    body: JSON.stringify({ subtitle: "スタッフが編集した" }),
  });
}

/** 招待を1件作り、招待IDを返す */
async function setupPendingInvite(): Promise<{
  owner: TestUser;
  guest: TestUser;
  eventId: string;
  inviteId: string;
}> {
  const owner = await makeUser();
  const guest = await makeUser();
  const eventId = await createDraftEvent(owner);
  expect((await invite(eventId, owner, guest.username)).status).toBe(201);
  const [pending] = await myInvites(guest);
  expect(pending).toBeDefined();
  return { owner, guest, eventId, inviteId: pending!.id };
}

describe("運営スタッフへの招待 (#339)", () => {
  it("招待できるのはそのイベントの運営だけ", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const target = await makeUser();
    const eventId = await createDraftEvent(owner);

    const res = await invite(eventId, outsider, target.username);
    expect(res.status).toBe(403);
    // 一覧も運営以外には見せない
    const list = await SELF.fetch(`${BASE}/api/events/${eventId}/staff-invites`, {
      headers: { cookie: outsider.cookie },
    });
    expect(list.status).toBe(403);
    // 招待自体も作られていない
    expect(await myInvites(target)).toHaveLength(0);
  });

  it("承諾するまでは運営ではなく、公開前のイベントも見えない", async () => {
    const { guest, eventId } = await setupPendingInvite();

    // 下書きは非メンバーには存在しないのと同じ扱い
    expect((await getEvent(eventId, guest)).status).toBe(404);
    // 運営の操作も通らない
    expect((await editEvent(eventId, guest)).status).toBe(403);
    // メンバー行も作られていない
    const member = await env.DB.prepare(
      "SELECT COUNT(1) AS n FROM event_member WHERE event_id = ? AND user_id = ?",
    )
      .bind(eventId, guest.userId)
      .first<{ n: number }>();
    expect(member?.n).toBe(0);
  });

  it("承諾前でも、判断に要る題名と招待者だけは本人に見える", async () => {
    const { owner, guest, eventId } = await setupPendingInvite();
    const [pending] = await myInvites(guest);
    expect(pending?.eventId).toBe(eventId);
    expect(pending?.eventTitle).toBe("運営招待の検証");
    expect(pending?.eventPublished).toBe(false);
    expect(pending?.invitedBy.id).toBe(owner.userId);
    // イベントの本文などは含めない（承諾前に中身を渡さない）
    expect(pending).not.toHaveProperty("description");
  });

  it("承諾すると運営になり、公開前のイベントが見えて編集できる", async () => {
    const { owner, guest, eventId, inviteId } = await setupPendingInvite();

    const accepted = await respond(inviteId, guest, "accept");
    expect(accepted.status).toBe(200);

    const detail = await getEvent(eventId, guest);
    expect(detail.status).toBe(200);
    expect((await json<{ myRole: string }>(detail)).myRole).toBe("staff");
    expect((await editEvent(eventId, guest)).status).toBe(200);

    // 招待の記録は「誰が誰を追加したか」が読める形で残る
    const [record] = await listInvites(eventId, owner);
    expect(record?.status).toBe("accepted");
    expect(record?.user.id).toBe(guest.userId);
    expect(record?.invitedBy.id).toBe(owner.userId);
    // 返事待ちの一覧からは消える
    expect(await myInvites(guest)).toHaveLength(0);
  });

  it("他人宛の招待は承諾も辞退もできない", async () => {
    const { guest, inviteId, eventId } = await setupPendingInvite();
    const stranger = await makeUser();

    expect((await respond(inviteId, stranger, "accept")).status).toBe(404);
    expect((await respond(inviteId, stranger, "decline")).status).toBe(404);
    // 横取りされていないこと（本人の招待は返事待ちのまま、相手は非メンバーのまま）
    expect(await myInvites(guest)).toHaveLength(1);
    expect((await getEvent(eventId, stranger)).status).toBe(404);
  });

  it("辞退できる（運営にならない）", async () => {
    const { guest, eventId, inviteId } = await setupPendingInvite();
    expect((await respond(inviteId, guest, "decline")).status).toBe(200);
    expect((await getEvent(eventId, guest)).status).toBe(404);
    expect(await myInvites(guest)).toHaveLength(0);
    // 一度断った招待はもう承諾できない
    expect((await respond(inviteId, guest, "accept")).status).toBe(404);
  });

  it("招待を取り消せる（取り消したあとは承諾できない）", async () => {
    const { owner, guest, eventId, inviteId } = await setupPendingInvite();

    const del = await SELF.fetch(
      `${BASE}/api/events/${eventId}/staff-invites/${inviteId}`,
      { method: "DELETE", headers: { cookie: owner.cookie } },
    );
    expect(del.status).toBe(200);
    expect(await myInvites(guest)).toHaveLength(0);
    expect((await respond(inviteId, guest, "accept")).status).toBe(404);
    // 取り消したものは運営側の一覧にも残さない
    expect(await listInvites(eventId, owner)).toHaveLength(0);
    // 招き直せる
    expect((await invite(eventId, owner, guest.username)).status).toBe(201);
    expect(await myInvites(guest)).toHaveLength(1);
  });

  it("運営以外は招待を取り消せない", async () => {
    const { guest, eventId, inviteId } = await setupPendingInvite();
    const del = await SELF.fetch(
      `${BASE}/api/events/${eventId}/staff-invites/${inviteId}`,
      { method: "DELETE", headers: { cookie: guest.cookie } },
    );
    expect(del.status).toBe(403);
    expect(await myInvites(guest)).toHaveLength(1);
  });

  it("参加枠が満席でも、必須の事前アンケートが未回答でも承諾できる", async () => {
    const owner = await makeUser();
    const filler = await makeUser();
    const guest = await makeUser();
    const eventId = await createDraftEvent(owner);

    // 定員1の先着枠
    const slotRes = await SELF.fetch(`${BASE}/api/events/${eventId}/slots`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ name: "一般", capacity: 1, selectionType: "first_come" }),
    });
    expect(slotRes.status).toBe(201);
    const { slot } = await json<{ slot: { id: string } }>(slotRes);

    // 必須の事前アンケート
    const survey = await SELF.fetch(`${BASE}/api/events/${eventId}/survey`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({
        questions: [{ question: "氏名", qtype: "text", options: [], required: true }],
      }),
    });
    expect(survey.status).toBe(200);

    // 公開して、枠を1人で埋める（アンケートに答えてから参加）
    expect(
      (
        await SELF.fetch(`${BASE}/api/events/${eventId}/publish`, {
          method: "POST",
          headers: { cookie: owner.cookie },
        })
      ).status,
    ).toBe(200);
    const questions = await json<{ questions: Array<{ id: string }> }>(
      await SELF.fetch(`${BASE}/api/events/${eventId}/survey`, {
        headers: { cookie: filler.cookie },
      }),
    );
    await SELF.fetch(`${BASE}/api/events/${eventId}/survey/my`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: filler.cookie },
      body: JSON.stringify({
        answers: [{ questionId: questions.questions[0]!.id, value: "埋める人" }],
      }),
    });
    expect(
      (
        await SELF.fetch(`${BASE}/api/events/${eventId}/join`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: filler.cookie },
          body: JSON.stringify({ slotId: slot.id }),
        })
      ).status,
    ).toBe(201);

    // この状態では通常の参加は断られる（アンケート未回答）
    const blocked = await SELF.fetch(`${BASE}/api/events/${eventId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: guest.cookie },
      body: JSON.stringify({ slotId: slot.id }),
    });
    expect(blocked.status).toBe(409);
    expect((await json<{ error: string }>(blocked)).error).toBe("survey_required");

    // 招待の経路は POST /join を通らないので、どちらにも邪魔されない
    expect((await invite(eventId, owner, guest.username)).status).toBe(201);
    const [pending] = await myInvites(guest);
    expect((await respond(pending!.id, guest, "accept")).status).toBe(200);

    const member = await env.DB.prepare(
      "SELECT role, status, slot_id FROM event_member WHERE event_id = ? AND user_id = ?",
    )
      .bind(eventId, guest.userId)
      .first<{ role: string; status: string; slot_id: string | null }>();
    // 運営は枠を消費しない (#277)。参加確定なので isConfirmedEventStaff も満たす
    expect(member).toMatchObject({ role: "staff", status: "confirmed", slot_id: null });
  });

  it("すでに参加者だった人が承諾すると、空いた先着枠が繰り上がる", async () => {
    const owner = await makeUser();
    const guest = await makeUser();
    const waiting = await makeUser();
    const eventId = await createDraftEvent(owner);
    const slotRes = await SELF.fetch(`${BASE}/api/events/${eventId}/slots`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ name: "一般", capacity: 1, selectionType: "first_come" }),
    });
    const { slot } = await json<{ slot: { id: string } }>(slotRes);
    await SELF.fetch(`${BASE}/api/events/${eventId}/publish`, {
      method: "POST",
      headers: { cookie: owner.cookie },
    });

    for (const u of [guest, waiting]) {
      await SELF.fetch(`${BASE}/api/events/${eventId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: u.cookie },
        body: JSON.stringify({ slotId: slot.id }),
      });
    }

    expect((await invite(eventId, owner, guest.username)).status).toBe(201);
    const [pending] = await myInvites(guest);
    const res = await respond(pending!.id, guest, "accept");
    expect(res.status).toBe(200);
    expect((await json<{ promotedUserId: string | null }>(res)).promotedUserId).toBe(
      waiting.userId,
    );
  });

  it("同じ相手を二重に招待しない／自分自身とすでに運営の人は招待できない", async () => {
    const { owner, guest, eventId } = await setupPendingInvite();

    const dup = await invite(eventId, owner, guest.username);
    expect(dup.status).toBe(409);
    expect((await json<{ error: string }>(dup)).error).toBe("already_invited");

    const self = await invite(eventId, owner, owner.username);
    expect(self.status).toBe(400);
    expect((await json<{ error: string }>(self)).error).toBe("self_invite");

    const missing = await invite(eventId, owner, "no_such_handle_xyz");
    expect(missing.status).toBe(404);

    // 承諾済み（＝すでに運営）の相手は招待できない
    const [pending] = await myInvites(guest);
    expect((await respond(pending!.id, guest, "accept")).status).toBe(200);
    const again = await invite(eventId, owner, guest.username);
    expect(again.status).toBe(409);
    expect((await json<{ error: string }>(again)).error).toBe("already_staff");
  });

  it("招待と結果はお知らせで届く", async () => {
    const { owner, guest, inviteId } = await setupPendingInvite();

    const invitedNote = await env.DB.prepare(
      "SELECT type, title, link FROM notification WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(guest.userId)
      .first<{ type: string; title: string; link: string }>();
    expect(invitedNote?.type).toBe("staff_invite");
    expect(invitedNote?.title).toContain("運営招待の検証");
    // 承諾前はイベントページが 404 なので、行き止まりに飛ばさない
    expect(invitedNote?.link).toBe("/staff-invites");

    expect((await respond(inviteId, guest, "accept")).status).toBe(200);
    const resultNote = await env.DB.prepare(
      "SELECT type, body FROM notification WHERE user_id = ? AND type = 'staff_invite_result' ORDER BY created_at DESC LIMIT 1",
    )
      .bind(owner.userId)
      .first<{ type: string; body: string }>();
    expect(resultNote?.type).toBe("staff_invite_result");
    expect(resultNote?.body).toContain("運営に加わりました");
  });
});
