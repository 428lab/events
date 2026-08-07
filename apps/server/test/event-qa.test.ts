import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { EventQaPayload, EventQuestion } from "@eventer/shared";

const BASE = "https://example.com";

/** dev-login（DevUser=イベント作成者＝staff・アプリ管理者）してセッションcookieを返す */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** 公開イベントを作って ID を返す。
 * 作成者の staff メンバー行は POST /events が自動で作る（本番と同じ形） */
async function setupEvent(
  cookie: string,
  patch: Record<string, unknown> = {},
): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "Q&A E2E",
      venueType: "offline",
      startsAt: 1,
      endsAt: 99999999999999,
    }),
  });
  expect(create.status).toBe(201);
  const { event } = (await create.json()) as { event: { id: string } };
  const res = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ status: "published", qaEnabled: true, ...patch }),
  });
  expect(res.status).toBe(200);
  return event.id;
}

/** 非adminのユーザーを1人作る（メンバーにはしない） */
async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, `u_${uid.slice(0, 6)}`, `名前${uid.slice(0, 4)}`, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

/** 非adminのメンバーを1人作る */
async function makeMember(
  eventId: string,
  role: "participant" | "staff" | "judge" | "observer",
  status: "confirmed" | "waitlist" = "confirmed",
): Promise<{ userId: string; cookie: string }> {
  const u = await makeUser();
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, ?, 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, u.userId, role, status, Date.now())
    .run();
  return u;
}

function getQa(eventId: string, cookie?: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/questions`, {
    headers: cookie ? { cookie } : undefined,
  });
}

async function qa(eventId: string, cookie: string): Promise<EventQaPayload> {
  const res = await getQa(eventId, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as EventQaPayload;
}

function postQuestion(
  eventId: string,
  cookie: string | null,
  body: unknown,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/questions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** 質問を投稿して ID を返す */
async function ask(
  eventId: string,
  cookie: string,
  text: string,
  anonymous = false,
): Promise<string> {
  const res = await postQuestion(eventId, cookie, { body: text, anonymous });
  expect(res.status).toBe(201);
  return ((await res.json()) as { question: EventQuestion }).question.id;
}

function vote(
  eventId: string,
  qid: string,
  cookie: string | null,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/questions/${qid}/vote`, {
    method: "POST",
    headers: cookie ? { cookie } : undefined,
  });
}

function unvote(eventId: string, qid: string, cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/questions/${qid}/vote`, {
    method: "DELETE",
    headers: { cookie },
  });
}

function patchQuestion(
  eventId: string,
  qid: string,
  cookie: string,
  body: unknown,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/questions/${qid}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

function pick(
  eventId: string,
  cookie: string,
  questionId: string | null,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/qa/pick`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ questionId }),
  });
}

function find(payload: EventQaPayload, id: string): EventQuestion | undefined {
  return payload.questions.find((q) => q.id === id);
}

describe("イベントQ&A (#216)", () => {
  it("投稿・投票・取り消しができ、票数の多い順に並ぶ", async () => {
    const staff = await loginDev();
    const eventId = await setupEvent(staff);
    const a = await makeMember(eventId, "participant");
    const b = await makeMember(eventId, "participant");
    const c = await makeMember(eventId, "participant");

    const q1 = await ask(eventId, a.cookie, "1つめの質問");
    const q2 = await ask(eventId, b.cookie, "2つめの質問");
    const q3 = await ask(eventId, c.cookie, "3つめの質問");

    // q2 に2票、q3 に1票、q1 は0票
    expect((await vote(eventId, q2, a.cookie)).status).toBe(200);
    expect((await vote(eventId, q2, c.cookie)).status).toBe(200);
    expect((await vote(eventId, q3, a.cookie)).status).toBe(200);

    let payload = await qa(eventId, a.cookie);
    expect(payload.questions.map((q) => q.id)).toEqual([q2, q3, q1]);
    expect(find(payload, q2)!.votes).toBe(2);
    expect(find(payload, q2)!.votedByMe).toBe(true);
    expect(find(payload, q1)!.votes).toBe(0);
    // 自分の投稿は mine で分かる
    expect(find(payload, q1)!.mine).toBe(true);
    expect(find(payload, q2)!.mine).toBe(false);

    // 二重投票しても1票のまま（1質問1票）
    expect((await vote(eventId, q2, a.cookie)).status).toBe(200);
    payload = await qa(eventId, a.cookie);
    expect(find(payload, q2)!.votes).toBe(2);

    // 取り消せる
    expect((await unvote(eventId, q2, a.cookie)).status).toBe(200);
    payload = await qa(eventId, a.cookie);
    expect(find(payload, q2)!.votes).toBe(1);
    expect(find(payload, q2)!.votedByMe).toBe(false);
    // 1票ずつの同数は投稿の古い順（安定した並び）
    expect(payload.questions.map((q) => q.id)).toEqual([q2, q3, q1]);

    // 取り消しは冪等
    expect((await unvote(eventId, q2, a.cookie)).status).toBe(200);
    payload = await qa(eventId, a.cookie);
    expect(find(payload, q2)!.votes).toBe(1);
  });

  it("匿名設定 real: 常に実名。anonymous=true を送っても実名になる", async () => {
    const staff = await loginDev();
    const eventId = await setupEvent(staff, { qaAnonymity: "real" });
    const a = await makeMember(eventId, "participant");
    const qid = await ask(eventId, a.cookie, "実名の質問", true);

    const asMember = await qa(eventId, a.cookie);
    expect(asMember.anonymity).toBe("real");
    expect(find(asMember, qid)!.anonymous).toBe(false);
    expect(find(asMember, qid)!.author?.id).toBe(a.userId);
  });

  it("匿名設定 anon: 常に匿名。一般参加者には投稿者が見えず、スタッフには見える", async () => {
    const staff = await loginDev();
    const eventId = await setupEvent(staff, { qaAnonymity: "anon" });
    const a = await makeMember(eventId, "participant");
    const other = await makeMember(eventId, "participant");
    // anonymous=false を送っても匿名に寄せられる
    const qid = await ask(eventId, a.cookie, "匿名の質問", false);

    const asOther = await qa(eventId, other.cookie);
    expect(find(asOther, qid)!.anonymous).toBe(true);
    expect(find(asOther, qid)!.author).toBeNull();

    // 本人にも投稿者は出さないが、mine で自分の投稿だと分かる
    const asAuthor = await qa(eventId, a.cookie);
    expect(find(asAuthor, qid)!.author).toBeNull();
    expect(find(asAuthor, qid)!.mine).toBe(true);

    // スタッフには荒らし対応のため投稿者が見える
    const asStaff = await qa(eventId, staff);
    expect(asStaff.isStaff).toBe(true);
    expect(find(asStaff, qid)!.anonymous).toBe(true);
    expect(find(asStaff, qid)!.author?.id).toBe(a.userId);
  });

  it("匿名設定 choice: 投稿ごとに実名/匿名を選べる", async () => {
    const staff = await loginDev();
    const eventId = await setupEvent(staff); // 既定が choice
    const a = await makeMember(eventId, "participant");
    const other = await makeMember(eventId, "participant");
    expect((await qa(eventId, a.cookie)).anonymity).toBe("choice");

    const realQ = await ask(eventId, a.cookie, "実名で聞く", false);
    const anonQ = await ask(eventId, a.cookie, "匿名で聞く", true);

    const asOther = await qa(eventId, other.cookie);
    expect(find(asOther, realQ)!.author?.id).toBe(a.userId);
    expect(find(asOther, anonQ)!.author).toBeNull();

    const asStaff = await qa(eventId, staff);
    expect(find(asStaff, anonQ)!.author?.id).toBe(a.userId);
  });

  it("権限: 未ログイン401 / 非メンバー403 / 未確定メンバー403", async () => {
    const staff = await loginDev();
    const eventId = await setupEvent(staff);
    const member = await makeMember(eventId, "participant");
    const qid = await ask(eventId, member.cookie, "権限テスト用");

    expect((await getQa(eventId)).status).toBe(401);
    expect((await postQuestion(eventId, null, { body: "x" })).status).toBe(401);
    expect((await vote(eventId, qid, null)).status).toBe(401);

    const outsider = await makeUser();
    expect((await getQa(eventId, outsider.cookie)).status).toBe(403);
    expect((await postQuestion(eventId, outsider.cookie, { body: "x" })).status).toBe(403);
    expect((await vote(eventId, qid, outsider.cookie)).status).toBe(403);

    const waiting = await makeMember(eventId, "participant", "waitlist");
    expect((await getQa(eventId, waiting.cookie)).status).toBe(403);
    expect((await postQuestion(eventId, waiting.cookie, { body: "x" })).status).toBe(403);
    expect((await vote(eventId, qid, waiting.cookie)).status).toBe(403);
  });

  it("権限: 一般メンバーは投稿・投票可、回答済み/ピックアップ/非表示は403", async () => {
    const staff = await loginDev();
    const eventId = await setupEvent(staff);
    const member = await makeMember(eventId, "participant");
    const qid = await ask(eventId, member.cookie, "一般メンバーの質問");
    expect((await vote(eventId, qid, member.cookie)).status).toBe(200);

    expect((await patchQuestion(eventId, qid, member.cookie, { answered: true })).status).toBe(403);
    expect((await patchQuestion(eventId, qid, member.cookie, { hidden: true })).status).toBe(403);
    expect((await pick(eventId, member.cookie, qid)).status).toBe(403);

    // スタッフは全部できる
    expect((await patchQuestion(eventId, qid, staff, { answered: true })).status).toBe(200);
    expect((await pick(eventId, staff, qid)).status).toBe(200);
    expect((await patchQuestion(eventId, qid, staff, { hidden: true })).status).toBe(200);
  });

  it("回答済みは下に送られ、スタッフが取り消せる", async () => {
    const staff = await loginDev();
    const eventId = await setupEvent(staff);
    const a = await makeMember(eventId, "participant");
    const q1 = await ask(eventId, a.cookie, "たくさん票が入る質問");
    const q2 = await ask(eventId, a.cookie, "票が入らない質問");
    expect((await vote(eventId, q1, a.cookie)).status).toBe(200);

    // 票が多くても回答済みなら下
    expect((await patchQuestion(eventId, q1, staff, { answered: true })).status).toBe(200);
    let payload = await qa(eventId, a.cookie);
    expect(payload.questions.map((q) => q.id)).toEqual([q2, q1]);
    expect(find(payload, q1)!.answered).toBe(true);

    // 取り消せば票数順に戻る
    expect((await patchQuestion(eventId, q1, staff, { answered: false })).status).toBe(200);
    payload = await qa(eventId, a.cookie);
    expect(payload.questions.map((q) => q.id)).toEqual([q1, q2]);
  });

  it("ピックアップは常に1件だけで、解除もできる", async () => {
    const staff = await loginDev();
    const eventId = await setupEvent(staff);
    const a = await makeMember(eventId, "participant");
    const q1 = await ask(eventId, a.cookie, "1件目");
    const q2 = await ask(eventId, a.cookie, "2件目");

    expect((await qa(eventId, a.cookie)).pickedQuestionId).toBeNull();

    expect((await pick(eventId, staff, q1)).status).toBe(200);
    expect((await qa(eventId, a.cookie)).pickedQuestionId).toBe(q1);

    // 別の質問をピックすると前のものは外れる（1件だけ）
    expect((await pick(eventId, staff, q2)).status).toBe(200);
    expect((await qa(eventId, a.cookie)).pickedQuestionId).toBe(q2);

    // 解除
    expect((await pick(eventId, staff, null)).status).toBe(200);
    expect((await qa(eventId, a.cookie)).pickedQuestionId).toBeNull();

    // 他イベントの質問はピックできない
    const otherEvent = await setupEvent(staff);
    expect((await pick(otherEvent, staff, q1)).status).toBe(404);
  });

  it("非表示にした質問は一般参加者に返さず、ピックアップも解除される", async () => {
    const staff = await loginDev();
    const eventId = await setupEvent(staff);
    const a = await makeMember(eventId, "participant");
    const qid = await ask(eventId, a.cookie, "荒らしの質問");
    expect((await pick(eventId, staff, qid)).status).toBe(200);

    expect((await patchQuestion(eventId, qid, staff, { hidden: true })).status).toBe(200);

    const asMember = await qa(eventId, a.cookie);
    expect(find(asMember, qid)).toBeUndefined();
    expect(asMember.pickedQuestionId).toBeNull();

    // スタッフには hidden 付きで見える
    const asStaff = await qa(eventId, staff);
    expect(find(asStaff, qid)!.hidden).toBe(true);
    expect(asStaff.pickedQuestionId).toBeNull();

    // 非表示のままではピックできない
    expect((await pick(eventId, staff, qid)).status).toBe(409);

    // 解除すれば戻る
    expect((await patchQuestion(eventId, qid, staff, { hidden: false })).status).toBe(200);
    expect(find(await qa(eventId, a.cookie), qid)!.hidden).toBe(false);
  });

  it("qa_enabled が OFF なら投稿も投票もできない（既定は OFF）", async () => {
    const staff = await loginDev();
    // 既定 OFF の確認: qaEnabled を明示せずに公開する
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: staff },
      body: JSON.stringify({
        title: "Q&A 既定OFF",
        venueType: "offline",
        startsAt: 1,
        endsAt: 99999999999999,
      }),
    });
    const { event } = (await create.json()) as { event: { id: string } };
    const eventId = event.id;
    const member = await makeMember(eventId, "participant");

    const payload = await qa(eventId, member.cookie);
    expect(payload.qaEnabled).toBe(false);
    expect(payload.canPost).toBe(false);
    expect((await postQuestion(eventId, member.cookie, { body: "x" })).status).toBe(409);

    // ON にすれば投稿でき、その後 OFF にすると投票も止まる
    await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: staff },
      body: JSON.stringify({ qaEnabled: true }),
    });
    const qid = await ask(eventId, member.cookie, "有効化してから聞く");
    await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: staff },
      body: JSON.stringify({ qaEnabled: false }),
    });
    expect((await vote(eventId, qid, member.cookie)).status).toBe(409);
    expect((await unvote(eventId, qid, member.cookie)).status).toBe(409);
    // 読み出しは通る（それまでの質問がスタッフからも消えないように）
    expect(find(await qa(eventId, staff), qid)).toBeDefined();
    // 片付け（回答済み・非表示）はできる
    expect((await patchQuestion(eventId, qid, staff, { hidden: true })).status).toBe(200);
  });

  it("本文は300字まで、空文字は不可", async () => {
    const staff = await loginDev();
    const eventId = await setupEvent(staff);
    const a = await makeMember(eventId, "participant");
    expect((await postQuestion(eventId, a.cookie, { body: "   " })).status).toBe(400);
    expect((await postQuestion(eventId, a.cookie, { body: "あ".repeat(301) })).status).toBe(400);
    expect((await postQuestion(eventId, a.cookie, { body: "あ".repeat(300) })).status).toBe(201);
  });

  it("退会申請中ユーザーの質問は一覧から外れる", async () => {
    const staff = await loginDev();
    const eventId = await setupEvent(staff);
    const a = await makeMember(eventId, "participant");
    const b = await makeMember(eventId, "participant");
    const qid = await ask(eventId, a.cookie, "退会予定の人の質問");
    const kept = await ask(eventId, b.cookie, "残る質問");
    expect((await vote(eventId, kept, a.cookie)).status).toBe(200);

    await env.DB.prepare("UPDATE user SET deleted_at = ? WHERE id = ?")
      .bind(Date.now(), a.userId)
      .run();

    const payload = await qa(eventId, staff);
    expect(find(payload, qid)).toBeUndefined();
    // 退会申請中ユーザーの票も数えない（並びと票数の整合）
    expect(find(payload, kept)!.votes).toBe(0);
  });
});
