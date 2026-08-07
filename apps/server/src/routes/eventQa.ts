import { Hono } from "hono";
import type { Context } from "hono";
import {
  EVENT_QUESTION_LIMIT,
  EVENT_QUESTION_USER_LIMIT,
  createQuestionInput,
  pickQuestionInput,
  updateQuestionInput,
} from "@eventer/shared";
import type {
  CreateQuestionInput,
  EventMember,
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
 * 回答済み・ピックアップ・非表示は staff。すべて要認証。
 *
 * 権限は3段階に分けてある（混ぜると開示範囲が広がりすぎる）:
 * - 読める人: メンバー（＋appAdmin / コミュニティ管理者）
 * - 投稿・投票できる人: 参加確定メンバーのみ（confirmedMemberOnly）
 * - モデレーションできる人: canModerate / 実名が見える人: そのイベントの staff だけ */
export const eventQaRoutes = new Hono<AppEnv>();
eventQaRoutes.use("*", requireAuth);

/** requireEventRole はロールのみ見るため、確定済み（status=confirmed）を追加チェック。
 * （メンバー行がない=appAdmin/コミュニティ管理者バイパスはそのまま許可。
 * eventChat.ts の同名ヘルパーと同じ判定）。
 * 閲覧・モデレーションの入口で使う */
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

/** 投稿・投票は「参加確定メンバー」だけ（確定仕様）。
 * confirmedOnly と違い、**メンバー行が無い相手は通さない**:
 * appAdmin やコミュニティ管理者が参加していないイベントで質問したり
 * 票を入れたりできてしまうのを防ぐ。読み出しはこの制限をかけない */
async function confirmedMemberOnly(
  c: Context<AppEnv>,
): Promise<Response | null> {
  const member = await eventMembersRepo.find(
    c.req.param("id")!,
    c.get("user").id,
  );
  if (member?.status !== "confirmed") {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

/** モデレーション操作（回答済み・非表示・ピックアップ）ができる相手か。
 * requireEventRole(["staff"]) が通す相手（イベントの staff / アプリ運営管理者 /
 * コミュニティ管理者）と同じ条件。非表示の質問もこの人たちには返す
 * （非表示にしたものを見られないと解除できない） */
async function canModerate(c: Context<AppEnv>, eventId: string): Promise<boolean> {
  const user = c.get("user");
  if (isAppAdmin(user)) return true;
  const member = await eventMembersRepo.find(eventId, user.id);
  if (member?.role === "staff") return true;
  const event = await eventsRepo.findById(eventId);
  if (!event?.communityId) return false;
  return communitiesRepo.isManager(event.communityId, user.id);
}

/** 匿名投稿の投稿者を見せてよい相手か＝**そのイベントの staff メンバーだけ**。
 * canModerate より狭くしているのは、確定仕様の「スタッフには常に投稿者が分かる」を
 * 満たしつつ開示範囲を最小にするため。たとえば自分のコミュニティのイベントに
 * 一般参加者として参加しているコミュニティオーナーや、イベントと関係のない
 * アプリ運営管理者にまで匿名投稿者の実名を返す必要はない
 * （荒らし対応で実名が要る場合は、そのイベントの staff にすればよい）。 */
function revealsAuthor(member: EventMember | null): boolean {
  return member?.role === "staff";
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
    const member = await eventMembersRepo.find(eventId, me.id);
    const moderate = await canModerate(c, eventId);
    // 実名の開示（reveal）と操作権限（moderate）は別物。混ぜると
    // 「操作したいだけの人」にまで匿名投稿者の実名が渡ってしまう
    const reveal = revealsAuthor(member);
    const rows = await eventQaRepo.listByEvent(eventId, me.id, moderate);
    const questions: EventQuestion[] = rows.map((r) =>
      toQuestion(r, me.id, reveal),
    );
    // 一覧に無いピックアップ（投稿者が退会した等）は無かったことにする
    const picked = await eventQaRepo.pickedFor(eventId);
    const payload: EventQaPayload = {
      qaEnabled: event.qaEnabled,
      anonymity: event.qaAnonymity,
      pickedQuestionId:
        picked && questions.some((q) => q.id === picked) ? picked : null,
      // 参加していない appAdmin / コミュニティ管理者は読めても投稿・投票はできない
      canPost: event.qaEnabled && member?.status === "confirmed",
      canModerate: moderate,
      revealsAuthor: reveal,
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
    const denied = await confirmedMemberOnly(c);
    if (denied) return denied;
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    if (!event.qaEnabled) return c.json({ error: "qa_disabled" }, 409);
    const me = c.get("user");
    // 全件をポーリングで配る作りなので、荒らし1人で全員のレスポンスが
    // 膨らまないように総数と1人あたりの両方で止める
    if ((await eventQaRepo.countByEvent(eventId)) >= EVENT_QUESTION_LIMIT) {
      return c.json(
        { error: "question_limit", limit: EVENT_QUESTION_LIMIT },
        409,
      );
    }
    if (
      (await eventQaRepo.countByUser(eventId, me.id)) >=
      EVENT_QUESTION_USER_LIMIT
    ) {
      return c.json(
        { error: "question_user_limit", limit: EVENT_QUESTION_USER_LIMIT },
        409,
      );
    }
    const input = valid<CreateQuestionInput>(c, "json");
    const anonymous =
      event.qaAnonymity === "anon"
        ? true
        : event.qaAnonymity === "real"
          ? false
          : input.anonymous;
    const id = await eventQaRepo.create(eventId, me.id, input.body, anonymous);
    const row = await eventQaRepo.findById(id, me.id);
    if (!row) return c.json({ error: "not_found" }, 404);
    const member = await eventMembersRepo.find(eventId, me.id);
    return c.json(
      { question: toQuestion(row, me.id, revealsAuthor(member)) },
      201,
    );
  },
);

/** 投票（参加確定メンバー・1質問1票・冪等） */
eventQaRoutes.post(
  "/:id/questions/:qid/vote",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const denied = await confirmedMemberOnly(c);
    if (denied) return denied;
    const eventId = c.req.param("id");
    const qid = c.req.param("qid");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    if (!event.qaEnabled) return c.json({ error: "qa_disabled" }, 409);
    // 他イベントの質問IDを差し込まれても投票できないようにする
    const meta = await eventQaRepo.meta(qid);
    if (!meta || meta.eventId !== eventId) {
      return c.json({ error: "not_found" }, 404);
    }
    // 非表示の質問は一覧に出ないが、IDを知っていれば叩けてしまう。
    // 票が溜まると解除したときにいきなり上位に並ぶので、ここで弾く
    if (meta.hidden) return c.json({ error: "question_hidden" }, 409);
    await eventQaRepo.vote(qid, c.get("user").id);
    return c.json({ ok: true });
  },
);

/** 投票の取り消し（冪等）。
 * 投票と違い非表示でも通す（自分が入れた票を引っ込めるのは常にできてよい） */
eventQaRoutes.delete(
  "/:id/questions/:qid/vote",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const denied = await confirmedMemberOnly(c);
    if (denied) return denied;
    const eventId = c.req.param("id");
    const qid = c.req.param("qid");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    if (!event.qaEnabled) return c.json({ error: "qa_disabled" }, 409);
    const meta = await eventQaRepo.meta(qid);
    if (!meta || meta.eventId !== eventId) {
      return c.json({ error: "not_found" }, 404);
    }
    await eventQaRepo.unvote(qid, c.get("user").id);
    return c.json({ ok: true });
  },
);

/** 自分の質問の取り消し（投稿者本人のみ）。
 * 「実名で出すつもりがなかった」「個人情報を書いてしまった」ときの自助手段なので、
 * スタッフの非表示（記録を残す）と違って行ごと消す。票は FK の CASCADE で一緒に消える。
 * Q&A を後から OFF にしても引っ込められるよう qaEnabled は見ない。
 * 参加確定でなくなった人でも自分の投稿は消せるようにしている（取り下げを妨げない）。 */
eventQaRoutes.delete(
  "/:id/questions/:qid",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const eventId = c.req.param("id");
    const qid = c.req.param("qid");
    const meta = await eventQaRepo.meta(qid);
    if (!meta || meta.eventId !== eventId) {
      return c.json({ error: "not_found" }, 404);
    }
    // スタッフでも他人の質問は消せない（消すのではなく非表示にする）
    if (meta.userId !== c.get("user").id) {
      return c.json({ error: "forbidden" }, 403);
    }
    await eventQaRepo.delete(qid);
    // 消した質問がピックアップ中なら解除する
    // （event.qa_picked_question_id には FK がないので自分で片付ける）
    await eventQaRepo.clearPickedIf(eventId, qid);
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
    // 一覧GETと同じく参加確定を要求する（未確定の staff がGETは403なのに
    // 更新は通る、という非対称をなくす）
    const denied = await confirmedOnly(c);
    if (denied) return denied;
    const eventId = c.req.param("id");
    const qid = c.req.param("qid");
    const meta = await eventQaRepo.meta(qid);
    if (!meta || meta.eventId !== eventId) {
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
    const member = await eventMembersRepo.find(eventId, me.id);
    return c.json({ question: toQuestion(row, me.id, revealsAuthor(member)) });
  },
);

/** 「いまこの質問」の設定・解除（staff のみ）。
 * イベントの1列に持つので、常に1件だけしかピックアップされない */
eventQaRoutes.put(
  "/:id/qa/pick",
  requireEventRole(["staff"]),
  zValidator("json", pickQuestionInput),
  async (c) => {
    const denied = await confirmedOnly(c);
    if (denied) return denied;
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    // 投影に出すための操作なので、Q&A を切っているイベントでは受け付けない
    // （回答済み・非表示の片付けと違い、後から必要になることがない）
    if (!event.qaEnabled) return c.json({ error: "qa_disabled" }, 409);
    const { questionId } = valid<PickQuestionInput>(c, "json");
    if (questionId !== null) {
      const meta = await eventQaRepo.meta(questionId);
      if (!meta || meta.eventId !== eventId) {
        return c.json({ error: "not_found" }, 404);
      }
      // 非表示の質問は投影できない（非表示の意味がなくなる）。
      // findById が null なのは投稿者が退会申請中のとき＝一覧に出ないので同じ扱い
      const row = await eventQaRepo.findById(questionId, c.get("user").id);
      if (meta.hidden || !row) {
        return c.json({ error: "question_hidden" }, 409);
      }
    }
    await eventQaRepo.setPicked(eventId, questionId);
    return c.json({ pickedQuestionId: questionId });
  },
);
