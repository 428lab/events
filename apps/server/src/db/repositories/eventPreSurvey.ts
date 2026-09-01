import type {
  PreSurveyAccessRow,
  PreSurveyQuestion,
  PreSurveyResponseRowView,
  PreSurveyResults,
  PreSurveyStatus,
  SavePreSurveyInput,
} from "@eventer/shared";
import {
  PRE_SURVEY_MAX_RESPONSES,
  parseCheckboxValue,
} from "@eventer/shared";
import { batch, many, one, run, runCount } from "../client.js";
import { jd } from "./kpi.js";

/**
 * 開催前アンケート (#444)。設計は docs/pre-event-survey.md。
 *
 * - トークンは**保存型の 128bit 乱数（32hex）**。再発行＝列の置換で旧URLは即 404。
 *   署名トークンにしないのは、失効（再発行）ができないため（設計 §2.2）
 * - 回答上限は response の**1文の条件付き INSERT**が守る（在庫確保 #431 と同じ型。
 *   同時送信でも上限+1件にならない）
 * - 集計は読むたびに answer 行から計算する（集計列を持たない）
 */

export interface PreSurvey {
  id: string;
  eventId: string;
  token: string;
  title: string;
  description: string;
  status: PreSurveyStatus;
  createdAt: number;
}

interface SurveyRow {
  id: string;
  event_id: string;
  token: string;
  title: string;
  description: string;
  status: string;
  created_at: number;
}

const toSurvey = (r: SurveyRow): PreSurvey => ({
  id: r.id,
  eventId: r.event_id,
  token: r.token,
  title: r.title,
  description: r.description,
  status: r.status as PreSurveyStatus,
  createdAt: r.created_at,
});

interface QuestionRow {
  id: string;
  question: string;
  qtype: string;
  options: string;
  required: number;
  sort_order: number;
}

function toQuestion(r: QuestionRow): PreSurveyQuestion {
  let options: string[] = [];
  try {
    const parsed: unknown = JSON.parse(r.options);
    if (Array.isArray(parsed)) {
      options = parsed.filter((v): v is string => typeof v === "string");
    }
  } catch {
    // 壊れた JSON は選択肢なし扱い（#152 と同じ）
  }
  return {
    id: r.id,
    question: r.question,
    qtype: r.qtype as PreSurveyQuestion["qtype"],
    options,
    required: Boolean(r.required),
    sortOrder: r.sort_order,
  };
}

/** 128bit のランダムトークン（32hex）。Math.random は使わない */
export function generatePreSurveyToken(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const eventPreSurveyRepo = {
  async findByEvent(eventId: string): Promise<PreSurvey | null> {
    const r = await one<SurveyRow>(
      "SELECT * FROM event_pre_survey WHERE event_id = ?",
      eventId,
    );
    return r ? toSurvey(r) : null;
  },

  async findByToken(token: string): Promise<PreSurvey | null> {
    const r = await one<SurveyRow>(
      "SELECT * FROM event_pre_survey WHERE token = ?",
      token,
    );
    return r ? toSurvey(r) : null;
  },

  async listQuestions(surveyId: string): Promise<PreSurveyQuestion[]> {
    const rows = await many<QuestionRow>(
      `SELECT id, question, qtype, options, required, sort_order
         FROM event_pre_survey_question
        WHERE survey_id = ? ORDER BY sort_order ASC`,
      surveyId,
    );
    return rows.map(toQuestion);
  },

  /** 作成/更新の一括保存（#152 replaceQuestions と同じ型）。
   * id 一致の既存質問は UPDATE（回答を保持）、入力に無い既存行は DELETE
   * （回答は CASCADE）、qtype が変わった質問の回答は破棄 */
  async save(eventId: string, input: SavePreSurveyInput): Promise<PreSurvey> {
    const now = Date.now();
    let survey = await this.findByEvent(eventId);
    if (!survey) {
      await run(
        `INSERT INTO event_pre_survey (id, event_id, token, title, description, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?)`,
        crypto.randomUUID(),
        eventId,
        generatePreSurveyToken(),
        input.title,
        input.description,
        now,
      );
      survey = (await this.findByEvent(eventId))!;
    } else {
      await run(
        "UPDATE event_pre_survey SET title = ?, description = ? WHERE id = ?",
        input.title,
        input.description,
        survey.id,
      );
    }

    const existing = await this.listQuestions(survey.id);
    const existingIds = new Set(existing.map((q) => q.id));
    const existingById = new Map(existing.map((q) => [q.id, q]));
    const keptIds = input.questions
      .map((it) => it.id)
      .filter((id): id is string => Boolean(id && existingIds.has(id)));
    await batch([
      {
        sql: `DELETE FROM event_pre_survey_question
               WHERE survey_id = ?${
                 keptIds.length > 0
                   ? ` AND id NOT IN (${keptIds.map(() => "?").join(",")})`
                   : ""
               }`,
        args: [survey.id, ...keptIds],
      },
      // qtype が変わった既存質問の回答は破棄（旧型式の値が混ざるのを防ぐ。#152 と同じ）
      ...input.questions
        .filter(
          (it) =>
            it.id &&
            existingIds.has(it.id) &&
            existingById.get(it.id)?.qtype !== it.qtype,
        )
        .map((it) => ({
          sql: "DELETE FROM event_pre_survey_answer WHERE question_id = ?",
          args: [it.id as string],
        })),
      ...input.questions.map((it, i) => {
        const options = JSON.stringify(it.options);
        const required = it.required ? 1 : 0;
        if (it.id && existingIds.has(it.id)) {
          return {
            sql: `UPDATE event_pre_survey_question
                     SET question = ?, qtype = ?, options = ?, required = ?, sort_order = ?
                   WHERE id = ?`,
            args: [it.question, it.qtype, options, required, i, it.id],
          };
        }
        return {
          sql: `INSERT INTO event_pre_survey_question
                  (id, survey_id, question, qtype, options, required, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            crypto.randomUUID(),
            survey.id,
            it.question,
            it.qtype,
            options,
            required,
            i,
          ],
        };
      }),
    ]);
    return survey;
  },

  /** トークン再発行。旧URLはこの1文で即 404 になる */
  async rotateToken(surveyId: string): Promise<string> {
    const token = generatePreSurveyToken();
    await run(
      "UPDATE event_pre_survey SET token = ? WHERE id = ?",
      token,
      surveyId,
    );
    return token;
  },

  async setStatus(surveyId: string, status: PreSurveyStatus): Promise<void> {
    await run(
      "UPDATE event_pre_survey SET status = ?, closed_at = ? WHERE id = ?",
      status,
      status === "closed" ? Date.now() : null,
      surveyId,
    );
  },

  async delete(surveyId: string): Promise<void> {
    // 質問・回答は FK CASCADE で消える
    await run("DELETE FROM event_pre_survey WHERE id = ?", surveyId);
  },

  async responseCount(surveyId: string): Promise<number> {
    const r = await one<{ v: number }>(
      "SELECT COUNT(*) AS v FROM event_pre_survey_response WHERE survey_id = ?",
      surveyId,
    );
    return r?.v ?? 0;
  },

  /**
   * 回答の受け付け。response の挿入を**1文の条件付き INSERT**にし、
   * 「open のまま・上限未満」のときだけ入る（同時送信で上限を超えない）。
   * @returns 挿入できた response id（closed か上限到達なら null） */
  async insertResponse(
    surveyId: string,
    userId: string | null,
  ): Promise<string | null> {
    const id = crypto.randomUUID();
    const changes = await runCount(
      `INSERT INTO event_pre_survey_response (id, survey_id, user_id, created_at)
       SELECT ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM event_pre_survey
                       WHERE id = ? AND status = 'open')
          AND (SELECT COUNT(*) FROM event_pre_survey_response WHERE survey_id = ?)
              < ${PRE_SURVEY_MAX_RESPONSES}`,
      id,
      surveyId,
      userId,
      Date.now(),
      surveyId,
      surveyId,
    );
    return changes > 0 ? id : null;
  },

  /** 回答本体の保存。失敗したら response ごと消して投げ直す（孤児を残さない） */
  async insertAnswers(
    responseId: string,
    answers: { questionId: string; value: string }[],
  ): Promise<void> {
    try {
      await batch(
        answers.map((a) => ({
          sql: `INSERT INTO event_pre_survey_answer (id, response_id, question_id, value)
                VALUES (?, ?, ?, ?)`,
          args: [crypto.randomUUID(), responseId, a.questionId, a.value],
        })),
      );
    } catch (e) {
      try {
        await run(
          "DELETE FROM event_pre_survey_response WHERE id = ?",
          responseId,
        );
      } catch (cleanupError) {
        console.error("[pre-survey] response cleanup failed", cleanupError);
      }
      throw e;
    }
  },

  /** 回答一覧 (#447・staff のみが読む)。行=1送信・新しい順。
   * 表示名が出るのは**回答者が同意した記名回答だけ** (#448。それ以外は
   * user_id 自体を保存していないので出しようがない。退会も null）。
   * 上限1000件（insertResponse の門）なのでページングは持たない */
  async responseRows(surveyId: string): Promise<PreSurveyResponseRowView[]> {
    const rows = await many<{
      id: string;
      created_at: number;
      username: string | null;
      global_name: string | null;
      question_id: string | null;
      value: string | null;
    }>(
      `SELECT r.id, r.created_at, u.username, u.global_name,
              a.question_id, a.value
         FROM event_pre_survey_response r
         LEFT JOIN user u ON u.id = r.user_id AND u.deleted_at IS NULL
         LEFT JOIN event_pre_survey_answer a ON a.response_id = r.id
        WHERE r.survey_id = ?
        ORDER BY r.created_at DESC, r.id ASC`,
      surveyId,
    );
    const byResponse = new Map<string, PreSurveyResponseRowView>();
    const order: string[] = [];
    for (const r of rows) {
      let row = byResponse.get(r.id);
      if (!row) {
        row = {
          createdAt: r.created_at,
          respondent: r.username ? (r.global_name ?? r.username) : null,
          answers: {},
        };
        byResponse.set(r.id, row);
        order.push(r.id);
      }
      if (r.question_id !== null) row.answers[r.question_id] = r.value ?? "";
    }
    return order.map((id) => byResponse.get(id)!);
  },

  /** 共有URLの表示を1回数える (#450)。**1文の upsert** なので同時アクセスでも
   * 欠損しない（読んでから書く2文にしない）。日毎の件数だけを持ち、
   * IP・UA 等は保存しない。day は jstDay()（呼び出し側）で作る */
  async recordAccess(surveyId: string, day: string): Promise<void> {
    await run(
      `INSERT INTO event_pre_survey_access (survey_id, day, count)
       VALUES (?, ?, 1)
       ON CONFLICT(survey_id, day) DO UPDATE SET count = count + 1`,
      surveyId,
      day,
    );
  },

  /** 日毎のアクセスと回答数 (#450・staff のみが読む)。新しい順。
   * responses は response.created_at から JST 日毎に導出（新しい保存はしない。
   * 日付変換は kpi.ts の jd() を共用——写しを作らない） */
  async accessStats(surveyId: string): Promise<PreSurveyAccessRow[]> {
    const views = await many<{ day: string; count: number }>(
      "SELECT day, count FROM event_pre_survey_access WHERE survey_id = ?",
      surveyId,
    );
    const responses = await many<{ day: string; n: number }>(
      `SELECT ${jd("created_at")} AS day, COUNT(*) AS n
         FROM event_pre_survey_response
        WHERE survey_id = ?
        GROUP BY day`,
      surveyId,
    );
    const byDay = new Map<string, PreSurveyAccessRow>();
    const rowOf = (day: string) => {
      let row = byDay.get(day);
      if (!row) byDay.set(day, (row = { day, views: 0, responses: 0 }));
      return row;
    };
    for (const v of views) rowOf(v.day).views = v.count;
    for (const r of responses) rowOf(r.day).responses = r.n;
    return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  },

  /** 集計（staff のみが読む）。回答者の名前は返さない（内訳は件数だけ）。
   * named = 回答者が同意して user_id が保存された記名回答の数 (#448) */
  async results(surveyId: string): Promise<PreSurveyResults> {
    const questions = await this.listQuestions(surveyId);
    const totals = await one<{ total: number; named: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) AS named
         FROM event_pre_survey_response WHERE survey_id = ?`,
      surveyId,
    );
    const total = totals?.total ?? 0;
    const named = totals?.named ?? 0;

    const rows = await many<{
      question_id: string;
      value: string;
      created_at: number;
    }>(
      `SELECT a.question_id, a.value, r.created_at
         FROM event_pre_survey_answer a
         JOIN event_pre_survey_response r ON r.id = a.response_id
        WHERE r.survey_id = ?
        ORDER BY r.created_at DESC`,
      surveyId,
    );
    const byQuestion = new Map<string, { value: string; createdAt: number }[]>();
    for (const r of rows) {
      let list = byQuestion.get(r.question_id);
      if (!list) byQuestion.set(r.question_id, (list = []));
      list.push({ value: r.value, createdAt: r.created_at });
    }

    const choices = [];
    const texts = [];
    for (const q of questions) {
      const answers = byQuestion.get(q.id) ?? [];
      if (q.qtype === "text") {
        texts.push({ question: q, answers: answers.filter((a) => a.value !== "") });
        continue;
      }
      const counts = q.options.map(() => 0);
      for (const a of answers) {
        const picked =
          q.qtype === "checkbox" ? parseCheckboxValue(a.value) : [a.value];
        for (const v of picked) {
          const idx = q.options.indexOf(v);
          if (idx >= 0) counts[idx] = (counts[idx] ?? 0) + 1;
        }
      }
      choices.push({ question: q, counts, answered: answers.length });
    }
    return { total, named, choices, texts };
  },
};
