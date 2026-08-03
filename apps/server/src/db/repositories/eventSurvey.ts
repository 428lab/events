import type {
  SaveSurveyQuestionItem,
  SurveyPhase,
  SurveyQuestion,
} from "@eventer/shared";
import { batch, many, one } from "../client.js";

interface QuestionRow {
  id: string;
  event_id: string;
  phase: string;
  question: string;
  qtype: string;
  options: string;
  required: number;
  sort_order: number;
}

function toQuestion(row: QuestionRow): SurveyQuestion {
  let options: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.options);
    if (Array.isArray(parsed)) {
      options = parsed.filter((v): v is string => typeof v === "string");
    }
  } catch {
    // 壊れた JSON は選択肢なし扱い
  }
  return {
    id: row.id,
    eventId: row.event_id,
    phase: row.phase as SurveyQuestion["phase"],
    question: row.question,
    qtype: row.qtype as SurveyQuestion["qtype"],
    options,
    required: Boolean(row.required),
    sortOrder: row.sort_order,
  };
}

/** スタッフ閲覧用の回答行（ユーザー情報＋参加状態つき） */
export interface SurveyAnswerRow {
  userId: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
  /** event_member.status。未参加（回答のみ）は null */
  memberStatus: string | null;
  questionId: string;
  value: string;
  updatedAt: number;
}

export const eventSurveyRepo = {
  /** 質問一覧（sort_order 順） */
  async listQuestions(
    eventId: string,
    phase: SurveyPhase,
  ): Promise<SurveyQuestion[]> {
    const rows = await many<QuestionRow>(
      `SELECT id, event_id, phase, question, qtype, options, required, sort_order
        FROM event_survey_question
        WHERE event_id = ? AND phase = ? ORDER BY sort_order ASC`,
      eventId,
      phase,
    );
    return rows.map(toQuestion);
  },

  /** 質問の一括保存。id 一致の既存行は UPDATE（回答を保持）、
   * 入力に無い既存行は DELETE（回答は FK CASCADE で削除）、id 無しは INSERT。 */
  async replaceQuestions(
    eventId: string,
    phase: SurveyPhase,
    items: SaveSurveyQuestionItem[],
  ): Promise<SurveyQuestion[]> {
    const now = Date.now();
    const existingIds = new Set(
      (await this.listQuestions(eventId, phase)).map((q) => q.id),
    );
    // 他イベントの id を差し込まれても既存一致しない限り新規 INSERT になる
    const keptIds = items
      .map((it) => it.id)
      .filter((id): id is string => Boolean(id && existingIds.has(id)));
    await batch([
      {
        sql: `DELETE FROM event_survey_question
          WHERE event_id = ? AND phase = ?${
            keptIds.length > 0
              ? ` AND id NOT IN (${keptIds.map(() => "?").join(",")})`
              : ""
          }`,
        args: [eventId, phase, ...keptIds],
      },
      ...items.map((it, i) => {
        const options = JSON.stringify(it.options);
        const required = it.required ? 1 : 0;
        if (it.id && existingIds.has(it.id)) {
          return {
            sql: `UPDATE event_survey_question
              SET question = ?, qtype = ?, options = ?, required = ?, sort_order = ?
              WHERE id = ? AND event_id = ?`,
            args: [it.question, it.qtype, options, required, i, it.id, eventId],
          };
        }
        return {
          sql: `INSERT INTO event_survey_question
            (id, event_id, phase, question, qtype, options, required, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            crypto.randomUUID(),
            eventId,
            phase,
            it.question,
            it.qtype,
            options,
            required,
            i,
            now,
          ],
        };
      }),
    ]);
    return this.listQuestions(eventId, phase);
  },

  /** 自分の回答一覧 */
  async myAnswers(
    eventId: string,
    userId: string,
  ): Promise<Array<{ questionId: string; value: string }>> {
    const rows = await many<{ question_id: string; value: string }>(
      "SELECT question_id, value FROM event_survey_answer WHERE event_id = ? AND user_id = ?",
      eventId,
      userId,
    );
    return rows.map((r) => ({ questionId: r.question_id, value: r.value }));
  },

  /** 回答の一括 upsert（同一質問への再回答は上書き） */
  async upsertAnswers(
    eventId: string,
    userId: string,
    answers: Array<{ questionId: string; value: string }>,
  ): Promise<void> {
    if (answers.length === 0) return;
    const now = Date.now();
    await batch(
      answers.map((a) => ({
        sql: `INSERT INTO event_survey_answer
          (id, question_id, event_id, user_id, value, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(question_id, user_id)
          DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        args: [crypto.randomUUID(), a.questionId, eventId, userId, a.value, now],
      })),
    );
  },

  /** 必須の質問すべてに空でない回答があるか（参加登録のブロック判定 #152） */
  async hasAnsweredRequired(
    eventId: string,
    userId: string,
    phase: SurveyPhase,
  ): Promise<boolean> {
    const row = await one<{ c: number }>(
      `SELECT COUNT(*) AS c FROM event_survey_question q
        LEFT JOIN event_survey_answer a
          ON a.question_id = q.id AND a.user_id = ?
        WHERE q.event_id = ? AND q.phase = ? AND q.required = 1
          AND (a.value IS NULL OR a.value = '' OR a.value = '[]')`,
      userId,
      eventId,
      phase,
    );
    return (row?.c ?? 0) === 0;
  },

  /** スタッフ閲覧用: フェーズ内の全回答（ユーザー情報・参加状態つき）。
   * 参加していない人の回答も含む（回答後に参加しなかったケース）。 */
  async answersFor(
    eventId: string,
    phase: SurveyPhase,
  ): Promise<SurveyAnswerRow[]> {
    const rows = await many<{
      user_id: string;
      username: string;
      global_name: string | null;
      avatar_url: string | null;
      member_status: string | null;
      question_id: string;
      value: string;
      updated_at: number;
    }>(
      `SELECT a.user_id, u.username, u.global_name, u.avatar_url,
        m.status AS member_status, a.question_id, a.value, a.updated_at
        FROM event_survey_answer a
        JOIN event_survey_question q ON q.id = a.question_id
        JOIN user u ON u.id = a.user_id
        LEFT JOIN event_member m ON m.event_id = a.event_id AND m.user_id = a.user_id
        WHERE a.event_id = ? AND q.phase = ?
        ORDER BY u.username ASC, q.sort_order ASC`,
      eventId,
      phase,
    );
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      globalName: r.global_name,
      avatarUrl: r.avatar_url,
      memberStatus: r.member_status,
      questionId: r.question_id,
      value: r.value,
      updatedAt: r.updated_at,
    }));
  },
};
