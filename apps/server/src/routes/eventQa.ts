import { Hono } from "hono";
import type { Context } from "hono";
import { createQuestionInput, pickQuestionInput, updateQuestionInput } from "@eventer/shared";
import type {
  CreateQuestionInput,
  EventQaPayload,
  EventQuestion,
  PickQuestionInput,
  UpdateQuestionInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { communitiesRepo } from "../db/repositories/communities.js";
import { eventQaRepo, toQuestion } from "../db/repositories/eventQa.js";

const MEMBER_ROLES = ["participant", "staff", "judge", "observer"] as const;

/** イベントQ&A (#216)。参加確定メンバーが質問を投稿し、投票の多い順に並ぶ。
 * 回答済み・ピックアップ・非表示は staff。すべて要認証。 */
export const eventQaRoutes = new Hono<AppEnv>();
eventQaRoutes.use("*", requireAuth);

/** requireEventRole はロールのみ見るため、確定済み（status=confirmed）を追加チェック。
 * （メンバー行がない=appAdmin/コミュニティ管理者バイパスはそのまま許可。
 * eventChat.ts の同名ヘルパーと同じ判定） */
async function confirmedOnly(c: Context<AppEnv>): Promise<Response | null> {
  const member = await eventMembersRepo.find(
    c.req.param("id")!,
    c.get("user").id,
  );
  if (member && member.status !== "confirmed") {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

/** 匿名投稿の投稿者を見せてよい相手か。
 * requireEventRole(["staff"]) が通す相手（イベントの staff / アプリ運営管理者 /
 * コミュニティ管理者）と**同じ条件**にしている: 荒らし対応の操作ができる人と、
 * 誰を対象にすべきか分かる人を一致させないと、モデレーションが成り立たないため。
 * 画面上の「スタッフ操作UI」を出すかどうかは web 側が myRole のみで判定する。 */
async function canModerate(c: Context<AppEnv>, eventId: string): Promise<boolean> {
  const user = c.get("user");
  if (isAppAdmin(user)) return true;
  const member = await eventMembersRepo.find(eventId, user.id);
  if (member?.role === "staff") return true;
  const event = await eventsRepo.findById(eventId);
  if (!event?.communityId) return false;
  return communitiesRepo.isManager(event.communityId, user.id);
}

/** 質問一覧（参加確定メンバー）。Q&A が無効でも読み出しは通す
 * （途中でオフにしたときに、それまでの質問がスタッフからも消えると困るため）。
 * 投稿・投票の可否は canPost で返す */
eventQaRoutes.get(
  "/:id/questions",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const denied = await confirmedOnly(c);
    if (denied) return denied;
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    const me = c.get("user");
    const isStaff = await canModerate(c, eventId);
    const rows = await eventQaRepo.listByEvent(eventId, me.id, isStaff);
    const questions: EventQuestion[] = rows.map((r) =>
      toQuestion(r, me.id, isStaff),
    );
    // 一覧に無いピックアップ（投稿者が退会した等）は無かったことにする
    const picked = await eventQaRepo.pickedFor(eventId);
    const payload: EventQaPayload = {
      qaEnabled: event.qaEnabled,
      anonymity: event.qaAnonymity,
      pickedQuestionId:
        picked && questions.some((q) => q.id === picked) ? picked : null,
      canPost: event.qaEnabled,
      isStaff,
      questions,
    };
    return c.json(payload);
  },
);

/** 質問の投稿（参加確定メンバー）。
 * anonymity が 'choice' のときだけ投稿者の選択を尊重し、
 * 'real' は常に実名・'anon' は常に匿名にサーバー側で寄せる
 * （クライアントが何を送っても運営の決めた範囲から出られないようにする） */
eventQaRoutes.post(
  "/:id/questions",
  requireEventRole([...MEMBER_ROLES]),
  zValidator("json", createQuestionInput),
  async (c) => {
    const denied = await confirmedOnly(c);
    if (denied) return denied;
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    if (!event.qaEnabled) return c.json({ error: "qa_disabled" }, 409);
    const input = valid<CreateQuestionInput>(c, "json");
    const anonymous =
      event.qaAnonymity === "anon"
        ? true
        : event.qaAnonymity === "real"
          ? false
          : input.anonymous;
    const me = c.get("user");
    const id = await eventQaRepo.create(eventId, me.id, input.body, anonymous);
    const row = await eventQaRepo.findById(id, me.id);
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json(
      { question: toQuestion(row, me.id, await canModerate(c, eventId)) },
      201,
    );
  },
);

/** 投票（参加確定メンバー・1質問1票・冪等） */
eventQaRoutes.post(
  "/:id/questions/:qid/vote",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const denied = await confirmedOnly(c);
    if (denied) return denied;
    const eventId = c.req.param("id");
    const qid = c.req.param("qid");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    if (!event.qaEnabled) return c.json({ error: "qa_disabled" }, 409);
    // 他イベントの質問IDを差し込まれても投票できないようにする
    if (!(await eventQaRepo.belongsTo(qid, eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    await eventQaRepo.vote(qid, c.get("user").id);
    return c.json({ ok: true });
  },
);

/** 投票の取り消し（冪等） */
eventQaRoutes.delete(
  "/:id/questions/:qid/vote",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const denied = await confirmedOnly(c);
    if (denied) return denied;
    const eventId = c.req.param("id");
    const qid = c.req.param("qid");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    if (!event.qaEnabled) return c.json({ error: "qa_disabled" }, 409);
    if (!(await eventQaRepo.belongsTo(qid, eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    await eventQaRepo.unvote(qid, c.get("user").id);
    return c.json({ ok: true });
  },
);

/** 回答済み / 非表示の切り替え（staff のみ）。
 * Q&A を後からオフにしても片付けはできるよう qaEnabled は見ない */
eventQaRoutes.patch(
  "/:id/questions/:qid",
  requireEventRole(["staff"]),
  zValidator("json", updateQuestionInput),
  async (c) => {
    const eventId = c.req.param("id");
    const qid = c.req.param("qid");
    if (!(await eventQaRepo.belongsTo(qid, eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const input = valid<UpdateQuestionInput>(c, "json");
    await eventQaRepo.updateFlags(qid, input);
    // 非表示にした質問がピックアップ中なら解除する
    // （投影画面に「非表示のはずの質問」が出続けないように）
    if (input.hidden === true) {
      await eventQaRepo.clearPickedIf(eventId, qid);
    }
    const me = c.get("user");
    const row = await eventQaRepo.findById(qid, me.id);
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ question: toQuestion(row, me.id, true) });
  },
);

/** 「いまこの質問」の設定・解除（staff のみ）。
 * イベントの1列に持つので、常に1件だけしかピックアップされない */
eventQaRoutes.put(
  "/:id/qa/pick",
  requireEventRole(["staff"]),
  zValidator("json", pickQuestionInput),
  async (c) => {
    const eventId = c.req.param("id");
    if (!(await eventsRepo.findById(eventId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const { questionId } = valid<PickQuestionInput>(c, "json");
    if (questionId !== null) {
      if (!(await eventQaRepo.belongsTo(questionId, eventId))) {
        return c.json({ error: "not_found" }, 404);
      }
      const row = await eventQaRepo.findById(questionId, c.get("user").id);
      // 非表示の質問は投影できない（非表示の意味がなくなる）
      if (!row || row.hidden === 1) {
        return c.json({ error: "question_hidden" }, 409);
      }
    }
    await eventQaRepo.setPicked(eventId, questionId);
    return c.json({ pickedQuestionId: questionId });
  },
);
