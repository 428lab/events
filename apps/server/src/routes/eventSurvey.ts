import { Hono } from "hono";
import type { Context } from "hono";
import {
  saveSurveyQuestionsInput,
  submitSurveyAnswersInput,
  surveyValueLabel,
} from "@eventer/shared";
import type {
  SaveSurveyQuestionsInput,
  SubmitSurveyAnswersInput,
  SurveyQuestion,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { currentUser } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { notificationsRepo } from "../db/repositories/notifications.js";
import {
  eventSurveyRepo,
  type SurveyAnswerRow,
} from "../db/repositories/eventSurvey.js";

/** アンケートの質問を閲覧できるか。公開イベントは誰でも、下書きはメンバー/管理者のみ
 * （イベント詳細 GET・タイムテーブルと同じ判定）。回答は含めない */
async function canViewSurvey(eventId: string, c: Context): Promise<boolean> {
  const event = await eventsRepo.findById(eventId);
  if (!event) return false;
  if (event.status === "published") return true;
  const user = await currentUser(c);
  if (!user) return false;
  if (isAppAdmin(user)) return true;
  return Boolean(await eventMembersRepo.find(eventId, user.id));
}

/* ===== 公開ハンドラ（未ログイン可。worker.ts で eventRoutes より先に登録） ===== */

/** 事前アンケートの質問一覧（イベントを閲覧できる人は誰でも。回答は返さない） */
export async function getEventSurvey(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  if (!(await canViewSurvey(eventId, c))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json({ questions: await eventSurveyRepo.listQuestions(eventId, "pre") });
}

/* ===== 要認証ルート ===== */

export const eventSurveyRoutes = new Hono<AppEnv>();
// 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)

/** 質問の一括保存（staff のみ）。id 一致の既存質問は回答を保持したまま更新 */
eventSurveyRoutes.put(
  "/:id/survey",
  requireEventRole(["staff"]),
  zValidator("json", saveSurveyQuestionsInput),
  async (c) => {
    const eventId = c.req.param("id");
    if (!(await eventsRepo.findById(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const input = valid<SaveSurveyQuestionsInput>(c, "json");
    const questions = await eventSurveyRepo.replaceQuestions(
      eventId,
      "pre",
      input.questions,
    );
    return c.json({ questions });
  },
);

/** 自分の回答一覧（本人のみ） */
eventSurveyRoutes.get("/:id/survey/my", async (c) => {
  const eventId = c.req.param("id");
  if (!(await canViewSurvey(eventId, c))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const user = c.get("user");
  return c.json({ answers: await eventSurveyRepo.myAnswers(eventId, user.id) });
});

/** 自分の回答を送信/更新。参加登録前でも回答できる（参加フローで先に回答するため。
 * ここではメンバー登録は作らない）。 */
eventSurveyRoutes.put(
  "/:id/survey/my",
  zValidator("json", submitSurveyAnswersInput),
  async (c) => {
    const eventId = c.req.param("id");
    if (!(await canViewSurvey(eventId, c))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const user = c.get("user");
    const input = valid<SubmitSurveyAnswersInput>(c, "json");
    const questions = await eventSurveyRepo.listQuestions(eventId, "pre");
    const byId = new Map<string, SurveyQuestion>(questions.map((q) => [q.id, q]));

    // 検証しつつ保存値（checkbox は JSON array 文字列）へ正規化する
    const normalized: Array<{ questionId: string; value: string }> = [];
    const seen = new Set<string>();
    for (const a of input.answers) {
      const q = byId.get(a.questionId);
      // 存在しない質問・重複回答は不正入力
      if (!q || seen.has(q.id)) {
        return c.json({ error: "invalid_question" }, 400);
      }
      seen.add(q.id);
      if (q.qtype === "checkbox") {
        const values = Array.isArray(a.value) ? a.value : a.value === "" ? [] : [a.value];
        // 選択肢に無い値は不正
        if (values.some((v) => !q.options.includes(v))) {
          return c.json({ error: "invalid_option" }, 400);
        }
        normalized.push({ questionId: q.id, value: JSON.stringify(values) });
      } else {
        if (Array.isArray(a.value)) {
          return c.json({ error: "invalid_value" }, 400);
        }
        const value = a.value.trim();
        // select は選択肢のいずれか（空 = 未回答は必須チェック側で判定）
        if (q.qtype === "select" && value !== "" && !q.options.includes(value)) {
          return c.json({ error: "invalid_option" }, 400);
        }
        normalized.push({ questionId: q.id, value });
      }
    }

    // 必須の質問はこのリクエストで空でない回答が揃っていること
    const answered = new Map(normalized.map((a) => [a.questionId, a.value]));
    for (const q of questions) {
      if (!q.required) continue;
      const v = answered.get(q.id);
      if (v === undefined || v === "" || v === "[]") {
        return c.json({ error: "required_missing" }, 400);
      }
    }

    await eventSurveyRepo.upsertAnswers(eventId, user.id, normalized);
    return c.json({ answers: await eventSurveyRepo.myAnswers(eventId, user.id) });
  },
);

/** スタッフ閲覧用の回答一覧。回答済みユーザー ∪ 確定メンバーの1人1行
 * （入館名簿CSV (#154) からも再利用する） */
export async function collectAnswerRows(eventId: string): Promise<{
  questions: SurveyQuestion[];
  rows: Array<{
    user: {
      id: string;
      username: string;
      globalName: string | null;
      avatarUrl: string | null;
    };
    memberStatus: string | null;
    answers: Record<string, string>;
  }>;
}> {
  const questions = await eventSurveyRepo.listQuestions(eventId, "pre");
  const answerRows = await eventSurveyRepo.answersFor(eventId, "pre");
  const rowByUser = new Map<
    string,
    {
      user: {
        id: string;
        username: string;
        globalName: string | null;
        avatarUrl: string | null;
      };
      memberStatus: string | null;
      answers: Record<string, string>;
    }
  >();
  const ensure = (
    user: SurveyAnswerRow | { userId: string; username: string; globalName: string | null; avatarUrl: string | null },
    memberStatus: string | null,
  ) => {
    let row = rowByUser.get(user.userId);
    if (!row) {
      row = {
        user: {
          id: user.userId,
          username: user.username,
          globalName: user.globalName,
          avatarUrl: user.avatarUrl,
        },
        memberStatus,
        answers: {},
      };
      rowByUser.set(user.userId, row);
    }
    return row;
  };
  for (const a of answerRows) {
    ensure(a, a.memberStatus).answers[a.questionId] = a.value;
  }
  // 未回答の確定メンバーも1行として含める（誰が未回答か見えるように）
  for (const m of await eventMembersRepo.listWithUsers(eventId)) {
    if (m.status !== "confirmed") continue;
    ensure(
      {
        userId: m.user.id,
        username: m.user.username,
        globalName: m.user.globalName,
        avatarUrl: m.user.avatarUrl,
      },
      m.status,
    );
  }
  return { questions, rows: [...rowByUser.values()] };
}

/** 未回答の確定参加者へ「回答のお願い」通知を送る（staff のみ・強制ではない） */
eventSurveyRoutes.post(
  "/:id/survey/remind",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    const questions = await eventSurveyRepo.listQuestions(eventId, "pre");
    if (questions.length === 0) return c.json({ notified: 0 });
    const answered = new Set(
      (await eventSurveyRepo.answersFor(eventId, "pre")).map((r) => r.userId),
    );
    // 確定参加者のうち、1問も回答していない人に通知（回答済みの人には送らない）
    const targets = (await eventMembersRepo.listWithUsers(eventId))
      .filter(
        (m) =>
          m.status === "confirmed" &&
          m.role === "participant" &&
          !answered.has(m.userId),
      )
      .map((m) => m.userId);
    if (targets.length > 0) {
      await notificationsRepo.createForMany(
        targets,
        "survey_reminder",
        "アンケート回答のお願い",
        `「${event.title}」の参加アンケートにご回答ください`,
        `/events/${eventId}`,
      );
    }
    return c.json({ notified: targets.length });
  },
);

/** 全回答の一覧（staff のみ） */
eventSurveyRoutes.get(
  "/:id/survey/answers",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    if (!(await eventsRepo.findById(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json(await collectAnswerRows(eventId));
  },
);

/** CSV の1セルをエスケープする。
 * カンマ・引用符・改行は引用で保護し、= + - @ タブ始まりのセルは
 * Excel で式として実行されないよう ' を前置する（フォーミュラインジェクション対策）。
 * 入館名簿CSV (#154) からも再利用する */
export function csvCell(v: string): string {
  const guarded = /^[=+\-@\t]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

export const MEMBER_STATUS_LABEL: Record<string, string> = {
  confirmed: "確定",
  waitlist: "キャンセル待ち",
  applied: "抽選申込中",
  lost: "落選",
  canceled: "キャンセル",
};

/** 回答の CSV エクスポート（staff のみ。Excel 用に UTF-8 BOM 付き） */
eventSurveyRoutes.get(
  "/:id/survey/answers.csv",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    if (!(await eventsRepo.findById(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const { questions, rows } = await collectAnswerRows(eventId);
    const header = ["ユーザー名", "表示名", "参加状態", ...questions.map((q) => q.question)];
    const lines = [header.map(csvCell).join(",")];
    for (const row of rows) {
      lines.push(
        [
          row.user.username,
          row.user.globalName ?? "",
          row.memberStatus
            ? (MEMBER_STATUS_LABEL[row.memberStatus] ?? row.memberStatus)
            : "未参加",
          ...questions.map((q) =>
            surveyValueLabel(q.qtype, row.answers[q.id] ?? ""),
          ),
        ]
          .map(csvCell)
          .join(","),
      );
    }
    // 先頭に BOM を付けて Excel での文字化けを防ぐ
    return c.body(`\uFEFF${lines.join("\r\n")}\r\n`, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="survey-answers.csv"',
    });
  },
);
