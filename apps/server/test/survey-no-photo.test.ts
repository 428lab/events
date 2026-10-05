import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { EventNameCard, SurveyQuestion } from "@eventer/shared";

const BASE = "https://example.com";

/**
 * 写真NG（No photo）のプリセット質問 (D-NOPHOTO)。
 * 保存値は言語に依存しない ok / no_photo、文言は閲覧者の言語。
 * 名札一覧の noPhoto はこの回答から出す（名札の一覧と同じくスタッフのみ）。
 */

async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

async function setupEvent(cookie: string): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ title: "写真NG E2E", venueType: "offline", startsAt: 1, endsAt: 99999999999999 }),
  });
  expect(create.status).toBe(201);
  const { event } = (await create.json()) as { event: { id: string } };
  const patch = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ status: "published" }),
  });
  expect(patch.status).toBe(200);
  return event.id;
}

async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  ).bind(uid, `nostr:${uid}`, `u_${uid.slice(0, 6)}`, "テスト", Date.now()).run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sid, uid, Date.now() + 86400000).run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

function putQuestions(eventId: string, cookie: string, questions: unknown[]): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/survey`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ questions }),
  });
}

async function getQuestions(eventId: string): Promise<SurveyQuestion[]> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/survey`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { questions: SurveyQuestion[] }).questions;
}

function putMyAnswers(eventId: string, cookie: string, answers: unknown[]): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/survey/my`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ answers }),
  });
}

function joinEvent(eventId: string, cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({}),
  });
}

async function nameCards(eventId: string, cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/name-cards`, { headers: { cookie } });
}

describe("写真NG（No photo）のプリセット質問", () => {
  it("migration: preset 列があり、同じイベントに no_photo は1問まで（DBの一意制約）", async () => {
    const cols = await env.DB.prepare("PRAGMA table_info(event_survey_question)").all<{ name: string }>();
    expect(cols.results.map((c) => c.name)).toContain("preset");
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const insert = () => env.DB.prepare(
      "INSERT INTO event_survey_question (id, event_id, question, qtype, options, required, sort_order, created_at, preset) VALUES (?, ?, 'q', 'select', '[]', 1, 0, 0, 'no_photo')",
    ).bind(crypto.randomUUID(), eventId).run();
    await insert();
    await expect(insert()).rejects.toThrow();
  });

  it("ON で固定の必須select（ok/no_photo）が足され、入力の文言は無視される。2つ送ると400", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const dup = await putQuestions(eventId, admin, [{ preset: "no_photo" }, { preset: "no_photo" }]);
    expect(dup.status).toBe(400);
    const unknown = await putQuestions(eventId, admin, [{ preset: "unknown" }]);
    expect(unknown.status).toBe(400);
    const res = await putQuestions(eventId, admin, [
      { question: "氏名", qtype: "text", required: false },
      { preset: "no_photo", question: "x", qtype: "text", options: [], required: false },
    ]);
    expect(res.status).toBe(200);
    const questions = await getQuestions(eventId);
    expect(questions).toHaveLength(2);
    expect(questions[0].preset).toBeNull();
    expect(questions[1]).toMatchObject({ preset: "no_photo", qtype: "select", options: ["ok", "no_photo"], required: true });
    expect(questions[1].question).not.toBe("x");
  });

  it("必須チェック・正準値の検証・OFF で回答ごと消える。保存し直しても id と回答は残る", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    await putQuestions(eventId, admin, [{ preset: "no_photo" }]);
    const [q] = await getQuestions(eventId);
    const user = await makeUser();

    expect((await joinEvent(eventId, user.cookie)).status).toBe(409);
    expect((await putMyAnswers(eventId, user.cookie, [])).status).toBe(400);
    // 表示文言そのもの（どの言語でも）は保存値として受け付けない
    expect((await putMyAnswers(eventId, user.cookie, [{ questionId: q.id, value: "写真NG（No photo）" }])).status).toBe(400);
    expect((await putMyAnswers(eventId, user.cookie, [{ questionId: q.id, value: "No photo" }])).status).toBe(400);
    expect((await putMyAnswers(eventId, user.cookie, [{ questionId: q.id, value: "no_photo" }])).status).toBe(200);
    expect((await joinEvent(eventId, user.cookie)).status).toBe(201);

    // id 付きで保存し直しても回答は残る
    await putQuestions(eventId, admin, [{ id: q.id, preset: "no_photo" }]);
    const kept = await env.DB.prepare("SELECT value FROM event_survey_answer WHERE question_id = ?").bind(q.id).first<{ value: string }>();
    expect(kept?.value).toBe("no_photo");

    // 通常の質問の id を流用してプリセットにはできない（別の質問として作り直す）
    await putQuestions(eventId, admin, [{ question: "一般", qtype: "text" }]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS c FROM event_survey_answer WHERE question_id = ?").bind(q.id).first<{ c: number }>()).toEqual({ c: 0 });
    const [plain] = await getQuestions(eventId);
    await putQuestions(eventId, admin, [{ id: plain.id, preset: "no_photo" }]);
    const after = await getQuestions(eventId);
    expect(after).toHaveLength(1);
    expect(after[0].id).not.toBe(plain.id);
    expect(after[0].preset).toBe("no_photo");
  });

  it("集計・CSV は保存値を閲覧者の言語の文言にする（?lang と Accept-Language）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    await putQuestions(eventId, admin, [{ preset: "no_photo" }]);
    const [q] = await getQuestions(eventId);
    const a = await makeUser();
    const b = await makeUser();
    await putMyAnswers(eventId, a.cookie, [{ questionId: q.id, value: "no_photo" }]);
    await putMyAnswers(eventId, b.cookie, [{ questionId: q.id, value: "ok" }]);

    const answers = await SELF.fetch(`${BASE}/api/events/${eventId}/survey/answers`, { headers: { cookie: admin } });
    const body = (await answers.json()) as { rows: Array<{ user: { id: string }; answers: Record<string, string> }> };
    expect(body.rows.find((r) => r.user.id === a.userId)?.answers[q.id]).toBe("no_photo");
    expect(body.rows.find((r) => r.user.id === b.userId)?.answers[q.id]).toBe("ok");

    const ja = await (await SELF.fetch(`${BASE}/api/events/${eventId}/survey/answers.csv`, { headers: { cookie: admin } })).text();
    expect(ja).toContain("写真への写り込みを避けたいですか？");
    expect(ja).toContain("写真NG（No photo）");
    expect(ja).toContain("撮影OK");
    const en = await (await SELF.fetch(`${BASE}/api/events/${eventId}/survey/answers.csv?lang=en`, { headers: { cookie: admin } })).text();
    expect(en).toContain("Do you prefer not to be photographed?");
    expect(en).toContain(",No photo");
    expect(en).toContain(",Photos OK");
    const header = await (await SELF.fetch(`${BASE}/api/events/${eventId}/attendance.csv`, {
      headers: { cookie: admin, "accept-language": "en-US,en;q=0.9" },
    })).text();
    expect(header).toContain("Do you prefer not to be photographed?");
  });

  it("名札一覧の noPhoto は no_photo と答えた確定メンバーだけ true。スタッフ以外には名簿ごと渡さない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    await putQuestions(eventId, admin, [{ preset: "no_photo" }]);
    const [q] = await getQuestions(eventId);
    const no = await makeUser();
    const ok = await makeUser();
    await putMyAnswers(eventId, no.cookie, [{ questionId: q.id, value: "no_photo" }]);
    await putMyAnswers(eventId, ok.cookie, [{ questionId: q.id, value: "ok" }]);
    expect((await joinEvent(eventId, no.cookie)).status).toBe(201);
    expect((await joinEvent(eventId, ok.cookie)).status).toBe(201);

    const res = await nameCards(eventId, admin);
    expect(res.status).toBe(200);
    const cards = ((await res.json()) as { cards: EventNameCard[] }).cards;
    expect(cards.find((c) => c.id === no.userId)?.noPhoto).toBe(true);
    expect(cards.find((c) => c.id === ok.userId)?.noPhoto).toBe(false);

    // 参加者本人（スタッフでない）は名簿を取れない
    expect((await nameCards(eventId, no.cookie)).status).toBe(403);
    // イベント詳細・メンバー一覧に回答は出ない
    const members = await (await SELF.fetch(`${BASE}/api/events/${eventId}`, { headers: { cookie: ok.cookie } })).text();
    expect(members).not.toContain("no_photo");
  });
});
