import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type {
  PreSurveyAccessRow,
  PreSurveyAdminView,
  PreSurveyResponseRowView,
  PreSurveyResults,
  PublicPreSurvey,
} from "@eventer/shared";
import { PRE_SURVEY_MAX_RESPONSES } from "@eventer/shared";

const BASE = "https://example.com";

/**
 * 開催前アンケート (#444)。docs/pre-event-survey.md の契約を固定する。
 *
 * - **漏れ防止**: 回答者向け応答に eventId・下書きイベントのタイトル・主催者名が
 *   一切現れない（本文の文字列走査）。不明トークンは 404
 * - トークン再発行で旧URLは即 404、新URLで回答できる
 * - closed は質問すら返さない・POST 409。reopen で復帰
 * - 未ログイン回答可（user_id NULL）・ログイン済みは記録・同じ人の2回目も通る
 *   （1人1回は担保しない割り切り）
 * - 回答上限は1文の条件付き INSERT（999件+同時2本で1本だけ成功・1001件にならない）
 * - 結果は staff のみ（件数・自由記述一覧・ログイン/匿名の内訳。名前は無い）
 */

async function makeUser(): Promise<{
  userId: string;
  username: string;
  cookie: string;
}> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `p_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, username, `表示名_${username}`, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, username, cookie: `eventer_session=${sid}` };
}

/** 下書きイベント（タイトルは走査テスト用に特徴的な文字列） */
async function insertDraftEvent(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, scheduling, created_by, created_at)
     VALUES (?, ?, 0, 0, 'offline', 'draft', 1, ?, ?)`,
  )
    .bind(id, `極秘下書きイベント_${id.slice(0, 6)}`, ownerId, Date.now())
    .run();
  return id;
}

async function addStaff(eventId: string, userId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, 'staff', NULL, 'confirmed', 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, Date.now())
    .run();
}

const adminUrl = (eventId: string) => `${BASE}/api/events/${eventId}/pre-survey`;
const publicUrl = (token: string) => `${BASE}/api/public/pre-surveys/${token}`;

function put(url: string, cookie: string, body: unknown): Promise<Response> {
  return SELF.fetch(url, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function post(url: string, body?: unknown, cookie?: string): Promise<Response> {
  return SELF.fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
}

/** staff がアンケートを作って管理ビュー（token 込み）を返す */
async function setup() {
  const staff = await makeUser();
  const eventId = await insertDraftEvent(staff.userId);
  await addStaff(eventId, staff.userId);
  const res = await put(adminUrl(eventId), staff.cookie, {
    title: "秋のもくもく会、興味ありますか？",
    description: "候補日への投票をお願いします",
    questions: [
      { question: "参加したい曜日", qtype: "select", options: ["土曜", "日曜"], required: true },
      { question: "興味のある内容", qtype: "checkbox", options: ["開発", "デザイン", "雑談"] },
      { question: "ひとこと", qtype: "text", options: [] },
    ],
  });
  expect(res.status).toBe(200);
  const { survey } = (await res.json()) as { survey: PreSurveyAdminView };
  return { staff, eventId, survey };
}

/** 有効な回答（曜日=土曜・内容=[開発,雑談]・ひとこと） */
function validAnswers(survey: PreSurveyAdminView) {
  const [q1, q2, q3] = survey.questions;
  return {
    answers: [
      { questionId: q1.id, value: "土曜" },
      { questionId: q2.id, value: ["開発", "雑談"] },
      { questionId: q3.id, value: "楽しみにしています" },
    ],
  };
}

describe("漏れ防止とトークンの門 (#444)", () => {
  it("回答者向け応答に下書きイベントの情報（eventId・タイトル・主催者）が一切現れない", async () => {
    const { staff, eventId, survey } = await setup();
    const res = await SELF.fetch(publicUrl(survey.token));
    expect(res.status).toBe(200);
    const raw = await res.text();
    // 主催者が書いたものだけが載る
    expect(raw).toContain("秋のもくもく会、興味ありますか？");
    expect(raw).toContain("参加したい曜日");
    // 下書きイベント側の情報は1文字も混ざらない（本文の走査で固定）
    for (const needle of [eventId, "極秘下書きイベント", staff.userId, staff.username, "表示名_"]) {
      expect(raw).not.toContain(needle);
    }
  });

  it("不明トークンは 404。トークン再発行で旧URLは即 404・新URLで回答できる", async () => {
    const { staff, eventId, survey } = await setup();
    expect((await SELF.fetch(publicUrl("0".repeat(32)))).status).toBe(404);

    const rotate = await post(`${adminUrl(eventId)}/rotate`, {}, staff.cookie);
    expect(rotate.status).toBe(200);
    const { token: newToken } = (await rotate.json()) as { token: string };
    expect(newToken).not.toBe(survey.token);
    expect(newToken).toMatch(/^[0-9a-f]{32}$/); // 128bit 乱数(32hex)

    expect((await SELF.fetch(publicUrl(survey.token))).status).toBe(404); // 旧URL即無効
    const answer = await post(
      `${publicUrl(newToken)}/responses`,
      validAnswers(survey),
    );
    expect(answer.status).toBe(201);
  });

  it("管理系は staff のみ（参加者 403・未ログイン 401）", async () => {
    const { eventId } = await setup();
    const other = await makeUser();
    expect(
      (await put(adminUrl(eventId), other.cookie, { title: "x", questions: [] })).status,
    ).toBe(403);
    expect(
      (
        await SELF.fetch(`${adminUrl(eventId)}/results`, {
          headers: { cookie: other.cookie },
        })
      ).status,
    ).toBe(403);
    expect((await SELF.fetch(adminUrl(eventId))).status).toBe(401);
  });
});

describe("回答（未ログイン可・送信1回きり）", () => {
  it("user_id が保存されるのは「ログイン中かつ named（明示同意）」だけ (#448)。2回目の送信も通る", async () => {
    const { survey } = await setup();
    const url = `${publicUrl(survey.token)}/responses`;
    const alice = await makeUser();

    // 1: 未ログイン → NULL
    expect((await post(url, validAnswers(survey))).status).toBe(201);
    // 2: 未ログインで named を名乗っても NULL（ログインが無ければ紐づけようがない）
    expect(
      (await post(url, { named: true, ...validAnswers(survey) })).status,
    ).toBe(201);
    // 3: ログイン中でも同意チェック無しなら NULL（見せないだけでなく持たない）
    expect((await post(url, validAnswers(survey), alice.cookie)).status).toBe(201);
    // 4: ログイン中 + named の同意があるときだけ保存（1人1回は担保しない＝2回目）
    expect(
      (await post(url, { named: true, ...validAnswers(survey) }, alice.cookie))
        .status,
    ).toBe(201);

    const rows = await env.DB.prepare(
      "SELECT user_id FROM event_pre_survey_response WHERE survey_id = ? ORDER BY created_at, rowid",
    )
      .bind(survey.id)
      .all<{ user_id: string | null }>();
    expect(rows.results.map((r) => r.user_id)).toEqual([
      null,
      null,
      null,
      alice.userId,
    ]);
  });

  it("検証: required 欠落・選択肢の外・未知の質問IDは 400", async () => {
    const { survey } = await setup();
    const url = `${publicUrl(survey.token)}/responses`;
    const [q1] = survey.questions;

    const missing = await post(url, { answers: [] });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "required_missing" });

    expect(
      (await post(url, { answers: [{ questionId: q1.id, value: "月曜" }] })).status,
    ).toBe(400); // select の選択肢の外
    expect(
      (
        await post(url, {
          answers: [
            { questionId: q1.id, value: "土曜" },
            { questionId: crypto.randomUUID(), value: "x" },
          ],
        })
      ).status,
    ).toBe(400); // 未知の質問ID
    expect(
      (
        await post(url, {
          answers: [
            { questionId: q1.id, value: "土曜" },
            { questionId: survey.questions[1].id, value: ["開発", "存在しない"] },
          ],
        })
      ).status,
    ).toBe(400); // checkbox は options の部分集合のみ
  });

  it("closed は質問すら返さず、回答は 409。reopen で復帰", async () => {
    const { staff, eventId, survey } = await setup();
    expect((await post(`${adminUrl(eventId)}/close`, {}, staff.cookie)).status).toBe(200);

    const res = await SELF.fetch(publicUrl(survey.token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PublicPreSurvey;
    expect(body).toEqual({ status: "closed", title: "秋のもくもく会、興味ありますか？" });

    const answer = await post(`${publicUrl(survey.token)}/responses`, validAnswers(survey));
    expect(answer.status).toBe(409);
    expect(await answer.json()).toEqual({ error: "closed" });

    expect((await post(`${adminUrl(eventId)}/reopen`, {}, staff.cookie)).status).toBe(200);
    expect(
      (await post(`${publicUrl(survey.token)}/responses`, validAnswers(survey))).status,
    ).toBe(201);
  });

  it("回答上限: 999件のところへ同時に2本来ても1本だけ成功し、合計はちょうど上限で止まる", async () => {
    const { survey } = await setup();
    // 999 件を直接仕込む（HTTP で回すには多すぎる）
    const stmts = [];
    for (let i = 0; i < PRE_SURVEY_MAX_RESPONSES - 1; i++) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO event_pre_survey_response (id, survey_id, user_id, created_at) VALUES (?, ?, NULL, ?)",
        ).bind(crypto.randomUUID(), survey.id, i),
      );
    }
    await env.DB.batch(stmts);

    const url = `${publicUrl(survey.token)}/responses`;
    const [r1, r2] = await Promise.all([
      post(url, validAnswers(survey)),
      post(url, validAnswers(survey)),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const failed = r1.status === 409 ? r1 : r2;
    expect(await failed.json()).toEqual({ error: "survey_full" });

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM event_pre_survey_response WHERE survey_id = ?",
    )
      .bind(survey.id)
      .first<{ n: number }>();
    expect(row?.n).toBe(PRE_SURVEY_MAX_RESPONSES); // 1001 件にならない
  });
});

describe("入力の縁 (#445 レビュー)", () => {
  it("checkbox の重複値は1つに潰して保存する（集計の水増し防止）", async () => {
    const { staff, eventId, survey } = await setup();
    const url = `${publicUrl(survey.token)}/responses`;
    const res = await post(url, {
      answers: [
        { questionId: survey.questions[0].id, value: "土曜" },
        { questionId: survey.questions[1].id, value: ["開発", "開発", "雑談"] },
      ],
    });
    expect(res.status).toBe(201);
    const results = (await (
      await SELF.fetch(`${adminUrl(eventId)}/results`, {
        headers: { cookie: staff.cookie },
      })
    ).json()) as { results: PreSurveyResults };
    expect(results.results.choices[1].counts).toEqual([1, 0, 1]); // 開発は2でなく1
  });

  it("自由記述は2000字まで（境界: 2000字は通り、2001字は400）", async () => {
    const { survey } = await setup();
    const url = `${publicUrl(survey.token)}/responses`;
    const base = {
      questionId: survey.questions[0].id,
      value: "土曜",
    };
    const text = (n: number) => ({
      questionId: survey.questions[2].id,
      value: "あ".repeat(n),
    });
    expect(
      (await post(url, { answers: [base, text(2000)] })).status,
    ).toBe(201);
    expect(
      (await post(url, { answers: [base, text(2001)] })).status,
    ).toBe(400);
  });
});

/** 門のソース監査（変異のトリップワイヤ）。挙動の証明は「不明トークンは404」の
 * テストが担い、こちらは「トークン照合が repo から消えた」リファクタに
 * 気づかせるだけの安い網（#436 と同じ型） */
const repoSources = import.meta.glob(
  "../src/db/repositories/eventPreSurvey.ts",
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

describe("門のソース監査 (#444)", () => {
  it("findByToken がトークン照合を持っている", () => {
    const src = Object.values(repoSources)[0]!;
    expect(src).toContain("WHERE token = ?");
  });
});

describe("共有URLのアクセス数 (#450)", () => {
  const accessUrl = (eventId: string) => `${adminUrl(eventId)}/access`;
  const countRows = (eventId: string, cookie: string) =>
    SELF.fetch(accessUrl(eventId), { headers: { cookie } });

  it("同日2アクセスで count=2（1文 upsert）。404 は数えず、closed でも数える", async () => {
    const { staff, eventId, survey } = await setup();
    await SELF.fetch(publicUrl(survey.token));
    await SELF.fetch(publicUrl(survey.token));
    await SELF.fetch(publicUrl("0".repeat(32))); // 不明トークン＝数えない
    await post(`${adminUrl(eventId)}/close`, {}, staff.cookie);
    await SELF.fetch(publicUrl(survey.token)); // closed の表示も数える

    const { rows } = (await (
      await countRows(eventId, staff.cookie)
    ).json()) as { rows: PreSurveyAccessRow[] };
    expect(rows).toHaveLength(1); // 今日の1行だけ
    expect(rows[0].views).toBe(3);
    expect(rows[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 個人を特定する情報が無い（保存列は day と count だけ）
    const cols = await env.DB.prepare(
      "SELECT * FROM event_pre_survey_access LIMIT 1",
    ).first<Record<string, unknown>>();
    expect(Object.keys(cols ?? {}).sort()).toEqual(["count", "day", "survey_id"]);
  });

  it("日ごとに別の行になり、views と responses が日毎に対応する", async () => {
    const { staff, eventId, survey } = await setup();
    // 過去日ぶんを直接仕込む（ルートは常に「今日」を使うため）
    await env.DB.prepare(
      "INSERT INTO event_pre_survey_access (survey_id, day, count) VALUES (?, '2026-08-30', 5), (?, '2026-08-31', 2)",
    )
      .bind(survey.id, survey.id)
      .run();
    // 8/30 JST の回答を1件（created_at を直接指定）
    await env.DB.prepare(
      "INSERT INTO event_pre_survey_response (id, survey_id, user_id, created_at) VALUES (?, ?, NULL, ?)",
    )
      .bind(crypto.randomUUID(), survey.id, Date.parse("2026-08-30T12:00:00+09:00"))
      .run();

    const { rows } = (await (
      await countRows(eventId, staff.cookie)
    ).json()) as { rows: PreSurveyAccessRow[] };
    // 新しい順
    expect(rows.map((r) => r.day)).toEqual(["2026-08-31", "2026-08-30"]);
    expect(rows[0]).toEqual({ day: "2026-08-31", views: 2, responses: 0 });
    expect(rows[1]).toEqual({ day: "2026-08-30", views: 5, responses: 1 });
  });

  it("トークン再発行をまたいで同じ集計に積まれる。staff 以外は 403", async () => {
    const { staff, eventId, survey } = await setup();
    await SELF.fetch(publicUrl(survey.token));
    const rotate = await post(`${adminUrl(eventId)}/rotate`, {}, staff.cookie);
    const { token: newToken } = (await rotate.json()) as { token: string };
    await SELF.fetch(publicUrl(newToken));

    const { rows } = (await (
      await countRows(eventId, staff.cookie)
    ).json()) as { rows: PreSurveyAccessRow[] };
    expect(rows).toHaveLength(1);
    expect(rows[0].views).toBe(2); // 再発行の前後が合算される（キーは survey_id）

    const outsider = await makeUser();
    expect((await countRows(eventId, outsider.cookie)).status).toBe(403);
  });

  it("同時アクセスでも欠損しない（upsert 2本同時で合計が一致）", async () => {
    const { staff, eventId, survey } = await setup();
    await Promise.all([
      SELF.fetch(publicUrl(survey.token)),
      SELF.fetch(publicUrl(survey.token)),
    ]);
    const { rows } = (await (
      await countRows(eventId, staff.cookie)
    ).json()) as { rows: PreSurveyAccessRow[] };
    expect(rows[0].views).toBe(2);
  });
});

describe("集計と後始末", () => {
  it("選択式は選択肢ごとの件数・自由記述は一覧・記名の件数。名前は返さない", async () => {
    const { staff, eventId, survey } = await setup();
    const url = `${publicUrl(survey.token)}/responses`;
    const alice = await makeUser();
    await post(url, validAnswers(survey)); // 匿名: 土曜・[開発,雑談]・ひとこと
    await post(
      url,
      {
        named: true, // 記名の同意 (#448)
        answers: [
          { questionId: survey.questions[0].id, value: "日曜" },
          { questionId: survey.questions[1].id, value: ["開発"] },
        ],
      },
      alice.cookie,
    );

    const res = await SELF.fetch(`${adminUrl(eventId)}/results`, {
      headers: { cookie: staff.cookie },
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const { results } = JSON.parse(raw) as { results: PreSurveyResults };
    expect(results.total).toBe(2);
    expect(results.named).toBe(1); // 同意した記名回答だけが数えられる
    expect(results.choices[0].counts).toEqual([1, 1]); // 土曜1・日曜1
    expect(results.choices[1].counts).toEqual([2, 0, 1]); // 開発2・デザイン0・雑談1
    expect(results.choices[0].answered).toBe(2);
    expect(results.texts[0].answers.map((a) => a.value)).toEqual([
      "楽しみにしています",
    ]);
    // 回答者の名前・IDは結果に載せない（匿名回答と扱いを揃える）
    expect(raw).not.toContain(alice.userId);
    expect(raw).not.toContain(alice.username);
  });

  it("回答一覧 (#447): 行=1送信・新しい順・未ログインは respondent null・質問と値の対応。staff 以外 403", async () => {
    const { staff, eventId, survey } = await setup();
    const url = `${publicUrl(survey.token)}/responses`;
    await post(url, validAnswers(survey)); // 匿名
    const alice = await makeUser();
    await post(
      url,
      {
        named: true, // 記名の同意 (#448)。同意なしなら表示名は出ない
        answers: [
          { questionId: survey.questions[0].id, value: "日曜" },
          { questionId: survey.questions[1].id, value: ["開発", "雑談"] },
        ],
      },
      alice.cookie,
    );

    const listUrl = `${adminUrl(eventId)}/responses`;
    const outsider = await makeUser();
    expect(
      (await SELF.fetch(listUrl, { headers: { cookie: outsider.cookie } })).status,
    ).toBe(403);

    const { rows } = (await (
      await SELF.fetch(listUrl, { headers: { cookie: staff.cookie } })
    ).json()) as { rows: PreSurveyResponseRowView[] };
    expect(rows).toHaveLength(2);
    // 新しい順: 先頭は alice（**同意した記名回答**＝表示名あり）
    expect(rows[0].respondent).toBe(`表示名_${alice.username}`);
    expect(rows[0].answers[survey.questions[0].id]).toBe("日曜");
    expect(rows[0].answers[survey.questions[1].id]).toBe(
      JSON.stringify(["開発", "雑談"]),
    );
    expect(rows[0].answers[survey.questions[2].id]).toBeUndefined(); // 未回答はキーなし
    // 2件目は匿名（respondent null）
    expect(rows[1].respondent).toBeNull();
    expect(rows[1].answers[survey.questions[0].id]).toBe("土曜");
    expect(rows[1].answers[survey.questions[2].id]).toBe("楽しみにしています");
  });

  it("質問を消す保存で回答が CASCADE。イベント削除でアンケートごと消える", async () => {
    const { staff, eventId, survey } = await setup();
    await post(`${publicUrl(survey.token)}/responses`, validAnswers(survey));

    // ひとこと（text）を消して保存 → その回答だけ消える
    const [q1, q2] = survey.questions;
    await put(adminUrl(eventId), staff.cookie, {
      title: survey.title,
      description: survey.description,
      questions: [
        { id: q1.id, question: q1.question, qtype: q1.qtype, options: q1.options, required: true },
        { id: q2.id, question: q2.question, qtype: q2.qtype, options: q2.options },
      ],
    });
    const answers = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM event_pre_survey_answer a
        JOIN event_pre_survey_response r ON r.id = a.response_id
       WHERE r.survey_id = ?`,
    )
      .bind(survey.id)
      .first<{ n: number }>();
    expect(answers?.n).toBe(2); // 3問中1問削除で回答も1件減る

    await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      method: "DELETE",
      headers: { cookie: staff.cookie },
    });
    expect((await SELF.fetch(publicUrl(survey.token))).status).toBe(404);
    const left = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM event_pre_survey_response WHERE survey_id = ?",
    )
      .bind(survey.id)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});
