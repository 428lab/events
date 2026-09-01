import { Hono } from "hono";
import type { Context } from "hono";
import type {
  PreSurveyAdminView,
  PublicPreSurvey,
  SavePreSurveyInput,
  SubmitPreSurveyInput,
} from "@eventer/shared";
import {
  preSurveyValueMatches,
  savePreSurveyInput,
  submitPreSurveyInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { currentUser, requireAuth } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventPreSurveyRepo } from "../db/repositories/eventPreSurvey.js";

/**
 * 開催前アンケート (#444)。設計は docs/pre-event-survey.md。
 *
 * **下書き情報の漏れ防止が最大の急所**: 回答者向けの応答（公開2本）に載せてよいのは
 * 「主催者がこのアンケートのために書いたもの」だけ。eventId・イベントのタイトル・
 * 日時・主催者名は**絶対に載せない**（サーバー側の責務。クライアントで伏せるのは
 * 偽の防御）。門はトークン一致の1つ（128bit 乱数。不明トークンは 404）。
 * closed のときは質問すら返さない。
 */

/* ===== 公開ハンドラ（未ログイン可。worker.ts で直接登録） ===== */

/** アンケートの表示（トークンが門）。closed はタイトルと状態だけ */
export async function getPublicPreSurvey(c: Context<AppEnv>) {
  const survey = await eventPreSurveyRepo.findByToken(c.req.param("token")!);
  if (!survey) return c.json({ error: "not_found" }, 404);
  if (survey.status === "closed") {
    return c.json({
      status: "closed",
      title: survey.title,
    } satisfies PublicPreSurvey);
  }
  return c.json({
    status: "open",
    title: survey.title,
    description: survey.description,
    questions: await eventPreSurveyRepo.listQuestions(survey.id),
  } satisfies PublicPreSurvey);
}

/**
 * 回答の送信（未ログイン可・送信1回きり・編集なし）。
 * ログイン済みなら user_id を記録する（結果の内訳表示用。名前は結果に出さない）。
 * 1人1回は担保しない（設計 §3.3 の割り切り）。上限・closed はリポジトリの
 * 1文の条件付き INSERT が原子的に守る。
 */
export async function postPublicPreSurveyResponse(c: Context<AppEnv>) {
  const survey = await eventPreSurveyRepo.findByToken(c.req.param("token")!);
  if (!survey) return c.json({ error: "not_found" }, 404);

  const parsed = submitPreSurveyInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
  const input: SubmitPreSurveyInput = parsed.data;

  // 質問との突き合わせ（required・選択肢の範囲・値の型）。
  // 検証はサーバーの質問定義が正（クライアントのフォームは信じない）
  const questions = await eventPreSurveyRepo.listQuestions(survey.id);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const given = new Map(input.answers.map((a) => [a.questionId, a.value]));
  if (input.answers.some((a) => !byId.has(a.questionId))) {
    return c.json({ error: "invalid_input" }, 400);
  }
  const normalized: { questionId: string; value: string }[] = [];
  for (const q of questions) {
    const value = given.get(q.id);
    const empty =
      value === undefined ||
      (typeof value === "string" ? value.trim() === "" : value.length === 0);
    if (empty) {
      if (q.required) return c.json({ error: "required_missing" }, 400);
      continue;
    }
    if (!preSurveyValueMatches(q.qtype, value)) {
      return c.json({ error: "invalid_input" }, 400);
    }
    if (q.qtype === "select" && !q.options.includes(value as string)) {
      return c.json({ error: "invalid_input" }, 400);
    }
    if (q.qtype === "checkbox") {
      // 重複値（["開発","開発"]）は1つに潰す（集計の水増し防止）
      const picked = [...new Set(value as string[])];
      if (picked.some((v) => !q.options.includes(v))) {
        return c.json({ error: "invalid_input" }, 400);
      }
      normalized.push({ questionId: q.id, value: JSON.stringify(picked) });
      continue;
    }
    normalized.push({ questionId: q.id, value: value as string });
  }

  const user = await currentUser(c);
  const responseId = await eventPreSurveyRepo.insertResponse(
    survey.id,
    user?.id ?? null,
  );
  if (!responseId) {
    // closed か上限か（案内の文言が変わる）。読み直して区別する
    const now = await eventPreSurveyRepo.findByToken(c.req.param("token")!);
    return c.json(
      { error: now?.status === "closed" ? "closed" : "survey_full" },
      409,
    );
  }
  await eventPreSurveyRepo.insertAnswers(responseId, normalized);
  return c.json({ ok: true }, 201);
}

/* ===== staff（主催者の管理）。/api/events 配下 ===== */

export const eventPreSurveyRoutes = new Hono<AppEnv>();
eventPreSurveyRoutes.use("*", requireAuth);

async function adminView(eventId: string): Promise<PreSurveyAdminView | null> {
  const survey = await eventPreSurveyRepo.findByEvent(eventId);
  if (!survey) return null;
  return {
    id: survey.id,
    title: survey.title,
    description: survey.description,
    status: survey.status,
    token: survey.token,
    responseCount: await eventPreSurveyRepo.responseCount(survey.id),
    createdAt: survey.createdAt,
    questions: await eventPreSurveyRepo.listQuestions(survey.id),
  };
}

/** 管理ビュー（未作成なら 404。UI は作成フォームを出す） */
eventPreSurveyRoutes.get(
  "/:id/pre-survey",
  requireEventRole(["staff"]),
  async (c) => {
    const view = await adminView(c.req.param("id"));
    if (!view) return c.json({ error: "not_found" }, 404);
    return c.json({ survey: view });
  },
);

/** 作成/更新の一括保存（タイトル・説明・質問。#152 の保存の型） */
eventPreSurveyRoutes.put(
  "/:id/pre-survey",
  requireEventRole(["staff"]),
  zValidator("json", savePreSurveyInput),
  async (c) => {
    const eventId = c.req.param("id");
    // 存在しないイベントへの INSERT を FK 違反（500）にせず 404 で返すための前置。
    // GET と違い、こちらは書き込みが走るので残す
    if (!(await eventsRepo.findById(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    await eventPreSurveyRepo.save(eventId, valid<SavePreSurveyInput>(c, "json"));
    return c.json({ survey: await adminView(eventId) });
  },
);

/** トークン再発行（配布先を間違えた・想定外に拡散したときの取り消し。旧URL即404） */
eventPreSurveyRoutes.post(
  "/:id/pre-survey/rotate",
  requireEventRole(["staff"]),
  async (c) => {
    const survey = await eventPreSurveyRepo.findByEvent(c.req.param("id"));
    if (!survey) return c.json({ error: "not_found" }, 404);
    return c.json({ token: await eventPreSurveyRepo.rotateToken(survey.id) });
  },
);

/** 手動クローズ / 再オープン（自動クローズは無い。設計 §3.5） */
for (const [path, status] of [
  ["close", "closed"],
  ["reopen", "open"],
] as const) {
  eventPreSurveyRoutes.post(
    `/:id/pre-survey/${path}`,
    requireEventRole(["staff"]),
    async (c) => {
      const survey = await eventPreSurveyRepo.findByEvent(c.req.param("id"));
      if (!survey) return c.json({ error: "not_found" }, 404);
      await eventPreSurveyRepo.setStatus(survey.id, status);
      return c.json({ ok: true });
    },
  );
}

/** 集計（staff のみ）。選択式は件数、自由記述は一覧。名前は返さない */
eventPreSurveyRoutes.get(
  "/:id/pre-survey/results",
  requireEventRole(["staff"]),
  async (c) => {
    const survey = await eventPreSurveyRepo.findByEvent(c.req.param("id"));
    if (!survey) return c.json({ error: "not_found" }, 404);
    return c.json({ results: await eventPreSurveyRepo.results(survey.id) });
  },
);

/** アンケートごと削除（回答も CASCADE。UI が確認ダイアログを出す） */
eventPreSurveyRoutes.delete(
  "/:id/pre-survey",
  requireEventRole(["staff"]),
  async (c) => {
    const survey = await eventPreSurveyRepo.findByEvent(c.req.param("id"));
    if (!survey) return c.json({ error: "not_found" }, 404);
    await eventPreSurveyRepo.delete(survey.id);
    return c.json({ ok: true });
  },
);
