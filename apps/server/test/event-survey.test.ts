import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { SurveyQuestion } from "@eventer/shared";

const BASE = "https://example.com";

/** dev-login（DevUser=staff/管理者）してセッションcookieを返す */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** 公開イベントを作って ID を返す */
async function setupEvent(cookie: string): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "事前アンケートE2E",
      venueType: "offline",
      startsAt: 1,
      endsAt: 99999999999999,
    }),
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

/** 非adminのユーザーを1人作る（メンバーにはしない）。 */
async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, `u_${uid.slice(0, 6)}`, "テスト", Date.now())
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
): Promise<{ userId: string; cookie: string }> {
  const u = await makeUser();
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, 'confirmed', 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, u.userId, role, Date.now())
    .run();
  return u;
}

function putQuestions(
  eventId: string,
  cookie: string | null,
  questions: unknown[],
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/survey`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ questions }),
  });
}

async function getQuestions(
  eventId: string,
  cookie?: string,
): Promise<SurveyQuestion[]> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/survey`, {
    headers: cookie ? { cookie } : undefined,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { questions: SurveyQuestion[] }).questions;
}

function putMyAnswers(
  eventId: string,
  cookie: string,
  answers: unknown[],
): Promise<Response> {
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

/** テンプレ相当の質問セット（氏名=必須text、懇親会=必須select、興味=任意checkbox） */
const QUESTIONS = [
  { question: "氏名", qtype: "text", required: true },
  {
    question: "懇親会に参加しますか",
    qtype: "select",
    options: ["参加", "不参加"],
    required: true,
  },
  {
    question: "興味のある分野",
    qtype: "checkbox",
    options: ["AI", "Web", "IoT"],
    required: false,
  },
];

describe("参加時の事前アンケート (#152)", () => {
  it("staff が質問を保存でき、公開GETで読める。非staffの保存は403", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);

    const saved = await putQuestions(eventId, admin, QUESTIONS);
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as { questions: SurveyQuestion[] };
    expect(body.questions).toHaveLength(3);
    expect(body.questions.map((q) => q.sortOrder)).toEqual([0, 1, 2]);

    // 未ログインでも公開イベントの質問は読める（回答は含まれない）
    const anon = await getQuestions(eventId);
    expect(anon.map((q) => q.question)).toEqual([
      "氏名",
      "懇親会に参加しますか",
      "興味のある分野",
    ]);
    expect(anon[1].options).toEqual(["参加", "不参加"]);
    expect(anon[0].required).toBe(true);
    expect(anon[2].required).toBe(false);

    // 参加者（非staff）は質問を保存できない
    const member = await makeMember(eventId, "participant");
    const forbidden = await putQuestions(eventId, member.cookie, QUESTIONS);
    expect(forbidden.status).toBe(403);

    // select なのに選択肢なしはバリデーションエラー
    const invalid = await putQuestions(eventId, admin, [
      { question: "選択肢なし", qtype: "select", options: [] },
    ]);
    expect(invalid.status).toBe(400);
  });

  it("必須未回答なら join が 409 survey_required、回答後は join できる", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    await putQuestions(eventId, admin, QUESTIONS);
    const questions = await getQuestions(eventId);
    const user = await makeUser();

    // 未回答のまま参加登録はブロックされる
    const blocked = await joinEvent(eventId, user.cookie);
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: string }).error).toBe(
      "survey_required",
    );

    // 必須が欠けた回答は 400
    const missing = await putMyAnswers(eventId, user.cookie, [
      { questionId: questions[0].id, value: "山田太郎" },
    ]);
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toBe(
      "required_missing",
    );

    // select の選択肢に無い値は 400
    const badOption = await putMyAnswers(eventId, user.cookie, [
      { questionId: questions[0].id, value: "山田太郎" },
      { questionId: questions[1].id, value: "たぶん行く" },
    ]);
    expect(badOption.status).toBe(400);
    expect(((await badOption.json()) as { error: string }).error).toBe(
      "invalid_option",
    );

    // checkbox の選択肢外も 400
    const badCheckbox = await putMyAnswers(eventId, user.cookie, [
      { questionId: questions[0].id, value: "山田太郎" },
      { questionId: questions[1].id, value: "参加" },
      { questionId: questions[2].id, value: ["AI", "料理"] },
    ]);
    expect(badCheckbox.status).toBe(400);

    // 正しい回答（checkbox は選択肢の部分集合でOK）
    const ok = await putMyAnswers(eventId, user.cookie, [
      { questionId: questions[0].id, value: "山田太郎" },
      { questionId: questions[1].id, value: "参加" },
      { questionId: questions[2].id, value: ["AI", "Web"] },
    ]);
    expect(ok.status).toBe(200);

    // 回答済みなら参加登録できる
    const joined = await joinEvent(eventId, user.cookie);
    expect(joined.status).toBe(201);

    // 自分の回答が読める（checkbox は JSON array 文字列）
    const mine = await SELF.fetch(`${BASE}/api/events/${eventId}/survey/my`, {
      headers: { cookie: user.cookie },
    });
    expect(mine.status).toBe(200);
    const { answers } = (await mine.json()) as {
      answers: Array<{ questionId: string; value: string }>;
    };
    expect(answers.find((a) => a.questionId === questions[2].id)?.value).toBe(
      JSON.stringify(["AI", "Web"]),
    );
  });

  it("id 維持の質問編集では回答が残り、削除した質問の回答は消える", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    await putQuestions(eventId, admin, [
      { question: "氏名", qtype: "text", required: true },
      { question: "所属・会社名", qtype: "text", required: false },
    ]);
    const questions = await getQuestions(eventId);
    const user = await makeUser();
    await putMyAnswers(eventId, user.cookie, [
      { questionId: questions[0].id, value: "山田太郎" },
      { questionId: questions[1].id, value: "428lab" },
    ]);

    // 1問目は id を維持して文言変更、2問目は削除して新しい質問を追加
    const edited = await putQuestions(eventId, admin, [
      {
        id: questions[0].id,
        question: "氏名（フルネーム）",
        qtype: "text",
        required: true,
      },
      { question: "緊急連絡先", qtype: "text", required: false },
    ]);
    expect(edited.status).toBe(200);
    const after = (await edited.json()) as { questions: SurveyQuestion[] };
    expect(after.questions[0].id).toBe(questions[0].id);
    expect(after.questions[0].question).toBe("氏名（フルネーム）");
    expect(after.questions[1].id).not.toBe(questions[1].id);

    const answersRes = await SELF.fetch(
      `${BASE}/api/events/${eventId}/survey/answers`,
      { headers: { cookie: admin } },
    );
    expect(answersRes.status).toBe(200);
    const { rows } = (await answersRes.json()) as {
      rows: Array<{
        user: { id: string };
        answers: Record<string, string>;
      }>;
    };
    const row = rows.find((r) => r.user.id === user.userId)!;
    // id 維持の質問の回答は残る
    expect(row.answers[questions[0].id]).toBe("山田太郎");
    // 削除された質問の回答は消えている
    expect(row.answers[questions[1].id]).toBeUndefined();

    // 必須質問が残っているので未回答ユーザーの join は引き続きブロック
    const another = await makeUser();
    const blocked = await joinEvent(eventId, another.cookie);
    expect(blocked.status).toBe(409);
  });

  it("回答一覧とCSVは staff のみ。CSVはBOM付きでエスケープされる", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    await putQuestions(eventId, admin, [
      { question: "コメント", qtype: "text", required: true },
    ]);
    const questions = await getQuestions(eventId);
    const user = await makeUser();
    // カンマ・引用符・改行を含む回答
    const tricky = 'こんにちは, "世界"\n2行目';
    await putMyAnswers(eventId, user.cookie, [
      { questionId: questions[0].id, value: tricky },
    ]);
    await joinEvent(eventId, user.cookie);
    // フォーミュラインジェクションを狙う回答者
    const attacker = await makeUser();
    await putMyAnswers(eventId, attacker.cookie, [
      { questionId: questions[0].id, value: '=HYPERLINK("http://evil")' },
    ]);
    await joinEvent(eventId, attacker.cookie);

    // 参加者（非staff）は回答一覧もCSVも見られない
    const member = await makeMember(eventId, "participant");
    for (const path of ["survey/answers", "survey/answers.csv"]) {
      const res = await SELF.fetch(`${BASE}/api/events/${eventId}/${path}`, {
        headers: { cookie: member.cookie },
      });
      expect(res.status).toBe(403);
    }

    // staff は回答一覧を見られる（未回答の確定メンバーも1行として含む）
    const answersRes = await SELF.fetch(
      `${BASE}/api/events/${eventId}/survey/answers`,
      { headers: { cookie: admin } },
    );
    expect(answersRes.status).toBe(200);
    const body = (await answersRes.json()) as {
      questions: SurveyQuestion[];
      rows: Array<{
        user: { id: string };
        memberStatus: string | null;
        answers: Record<string, string>;
      }>;
    };
    const answeredRow = body.rows.find((r) => r.user.id === user.userId)!;
    expect(answeredRow.answers[questions[0].id]).toBe(tricky);
    expect(answeredRow.memberStatus).toBe("confirmed");
    // 未回答の確定メンバーも一覧に出る
    expect(body.rows.some((r) => r.user.id === member.userId)).toBe(true);

    // CSV
    const csvRes = await SELF.fetch(
      `${BASE}/api/events/${eventId}/survey/answers.csv`,
      { headers: { cookie: admin } },
    );
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("content-type")).toContain("text/csv");
    const csv = await csvRes.text();
    // Excel 用の UTF-8 BOM
    expect(csv.startsWith("\uFEFF")).toBe(true);
    // ヘッダ行
    expect(csv).toContain("ユーザー名,表示名,参加状態,コメント");
    // カンマ・引用符・改行を含むセルは引用＆引用符は二重化
    expect(csv).toContain('"こんにちは, ""世界""\n2行目"');
    // フォーミュラインジェクション対策: = 始まりの回答は ' が前置される
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csv).toContain("'=HYPERLINK");
  });

  it("質問の無いイベントの join は影響を受けない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const user = await makeUser();
    const joined = await joinEvent(eventId, user.cookie);
    expect(joined.status).toBe(201);
  });
});

describe("回答のお願い通知 (#173)", () => {
  it("未回答の確定参加者にだけ通知され、回答済み・非staffは対象外/403", async () => {
    const staffCookie = await loginDev();
    const eventId = await setupEvent(staffCookie);
    await putQuestions(eventId, staffCookie, [
      { question: "氏名", qtype: "text", required: true },
    ]);
    const questions = await getQuestions(eventId);
    // 回答済み参加者と未回答参加者（直接insertで参加要件を迂回して作る）
    const answered = await makeUser();
    await putMyAnswers(eventId, answered.cookie, [
      { questionId: questions[0].id, value: "回答済み" },
    ]);
    await joinEvent(eventId, answered.cookie);
    const silent = await makeUser();
    await env.DB.prepare(
      "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, 'participant', NULL, 'confirmed', 0, ?)",
    )
      .bind(crypto.randomUUID(), eventId, silent.userId, Date.now())
      .run();

    // 非staffは403
    const forbidden = await SELF.fetch(
      `${BASE}/api/events/${eventId}/survey/remind`,
      { method: "POST", headers: { cookie: answered.cookie } },
    );
    expect(forbidden.status).toBe(403);

    const res = await SELF.fetch(
      `${BASE}/api/events/${eventId}/survey/remind`,
      { method: "POST", headers: { cookie: staffCookie } },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { notified: number }).notified).toBe(1);

    // 未回答者にだけ通知が作られている
    const n1 = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notification WHERE user_id = ? AND type = 'survey_reminder'",
    )
      .bind(silent.userId)
      .first<{ n: number }>();
    const n2 = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notification WHERE user_id = ? AND type = 'survey_reminder'",
    )
      .bind(answered.userId)
      .first<{ n: number }>();
    expect(n1?.n).toBe(1);
    expect(n2?.n).toBe(0);
  });
});
