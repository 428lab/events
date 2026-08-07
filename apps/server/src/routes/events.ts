import { Hono } from "hono";
import { valid, zValidator } from "../lib/validator.js";
import {
  addDateOptionInput,
  checkinInput,
  createEventInput,
  createSlotInput,
  finalizeDateInput,
  joinEventInput,
  memberLookupQuery,
  setAttendanceInput,
  setMemberSlotStatusInput,
  updateEventInput,
  updateMemberRoleInput,
  updateSlotInput,
  updateSubmissionInput,
  voteInput,
} from "@eventer/shared";
import type {
  AddDateOptionInput,
  CheckinInput,
  CheckinResultKind,
  CheckinUser,
  CreateEventInput,
  CreateSlotInput,
  Event,
  EventMember,
  FinalizeDateInput,
  JoinEventInput,
  MemberLookupQuery,
  MemberLookupResult,
  SetAttendanceInput,
  SetMemberSlotStatusInput,
  UpdateEventInput,
  UpdateMemberRoleInput,
  UpdateSlotInput,
  UpdateSubmissionInput,
  User,
  VoteInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { currentUser, requireAuth } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { eventsRepo } from "../db/repositories/events.js";
import { awardsRepo } from "../db/repositories/awards.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { entriesRepo } from "../db/repositories/entries.js";
import { scoringCriteriaRepo } from "../db/repositories/scoringCriteria.js";
import { participationSlotsRepo } from "../db/repositories/participationSlots.js";
import { eventSurveyRepo } from "../db/repositories/eventSurvey.js";
import { usersRepo } from "../db/repositories/users.js";
import { notificationsRepo } from "../db/repositories/notifications.js";
import { formatDateRangeJa } from "../lib/dateFormat.js";
import {
  createCheckinToken,
  verifyCheckinToken,
} from "../lib/checkinToken.js";
import { communitiesRepo } from "../db/repositories/communities.js";
import { schedulingRepo } from "../db/repositories/scheduling.js";
import { copyEventImage, deleteEventImage, putEventImage } from "./images.js";
import {
  listViewableRequestsForEvent,
  notifyRequestsOnPublish,
} from "./eventRequests.js";
import {
  notifyFollowersOnJoin,
  notifyFollowersOnPublish,
} from "./follows.js";

export const eventRoutes = new Hono<AppEnv>();

/** 公開イベントは誰でも閲覧可。下書きはメンバー/管理者のみ。 */
async function canView(event: Event, user: User | null): Promise<boolean> {
  if (event.status === "published") return true;
  if (!user) return false;
  if (isAppAdmin(user)) return true;
  return Boolean(await eventMembersRepo.find(event.id, user.id));
}

/* =========================================================
 *  公開ルート（未ログイン可）。requireAuth より前に登録する。
 * =======================================================*/

/** イベント詳細（公開イベントは未ログインでも閲覧可） */
eventRoutes.get("/:id", async (c) => {
  const event = await eventsRepo.findById(c.req.param("id"));
  if (!event) return c.json({ error: "not_found" }, 404);
  const user = await currentUser(c);
  if (!(await canView(event, user))) return c.json({ error: "not_found" }, 404);
  const member = user ? await eventMembersRepo.find(event.id, user.id) : null;
  const community = event.communityId
    ? await communitiesRepo.findById(event.communityId)
    : null;
  // 参加者限定の文章：確定メンバー・staff・作成者・アプリ管理者にだけ返す
  // （それ以外はキー自体を含めない）
  // 確定メンバー/staff/作成者/appAdmin に加え、コミュニティ管理者（staff相当でPATCH可能）
  // にも見せる。見えないと EditEventPage の保存で members_note を空文字で消してしまう
  const canSeeMembersNote = Boolean(
    (member && (member.status === "confirmed" || member.role === "staff")) ||
      (user && (event.createdBy === user.id || isAppAdmin(user))) ||
      (user &&
        event.communityId &&
        (await communitiesRepo.isManager(event.communityId, user.id))),
  );
  return c.json({
    event,
    ...(canSeeMembersNote
      ? { membersNote: await eventsRepo.membersNoteFor(event.id) }
      : {}),
    myRole: member?.role ?? null,
    community: community
      ? {
          id: community.id,
          slug: community.slug,
          name: community.name,
          iconUrl: community.iconUrl,
        }
      : null,
    // 生まれ元のたまご（メンバー限定たまごは閲覧権限のある人にだけ返す）
    fromRequests: await listViewableRequestsForEvent(event.id, user),
  });
});

/** Entry 一覧（公開イベントは未ログインでも閲覧可） */
eventRoutes.get("/:id/entries", async (c) => {
  const event = await eventsRepo.findById(c.req.param("id"));
  if (!event) return c.json({ error: "not_found" }, 404);
  if (!(await canView(event, await currentUser(c)))) return c.json({ error: "forbidden" }, 403);
  return c.json({ entries: await entriesRepo.listByEvent(event.id) });
});

/** 成果物集約（公開イベントは未ログインでも閲覧可。提出済みのみ） */
eventRoutes.get("/:id/submissions", async (c) => {
  const event = await eventsRepo.findById(c.req.param("id"));
  if (!event) return c.json({ error: "not_found" }, 404);
  if (!(await canView(event, await currentUser(c)))) return c.json({ error: "forbidden" }, 403);
  const entries = (await entriesRepo.listByEvent(event.id)).filter(
    (e) => e.submission,
  );
  return c.json({ entries });
});

/** 参加者一覧（公開イベントは未ログインでも閲覧可） */
eventRoutes.get("/:id/members", async (c) => {
  const event = await eventsRepo.findById(c.req.param("id"));
  if (!event) return c.json({ error: "not_found" }, 404);
  if (!(await canView(event, await currentUser(c)))) return c.json({ error: "forbidden" }, 403);
  return c.json({ members: await eventMembersRepo.listWithUsers(event.id) });
});

/** 参加枠一覧（公開イベントは未ログインでも閲覧可） */
eventRoutes.get("/:id/slots", async (c) => {
  const event = await eventsRepo.findById(c.req.param("id"));
  if (!event) return c.json({ error: "not_found" }, 404);
  if (!(await canView(event, await currentUser(c)))) return c.json({ error: "forbidden" }, 403);
  return c.json({ slots: await participationSlotsRepo.listByEvent(event.id) });
});

/** 日程調整（候補日と集計。公開イベントは未ログイン可。ログイン時は自分の回答付き） */
eventRoutes.get("/:id/schedule", async (c) => {
  const event = await eventsRepo.findById(c.req.param("id"));
  if (!event) return c.json({ error: "not_found" }, 404);
  const user = await currentUser(c);
  if (!(await canView(event, user))) return c.json({ error: "not_found" }, 404);
  const options = await schedulingRepo.listOptions(event.id);
  const myVotes = user
    ? await schedulingRepo.myVotes(event.id, user.id)
    : {};
  // 匿名設定時は回答者情報をサーバー側で落とす（クライアントから覗けない）
  const anonymous = event.scheduleAnonymous;
  return c.json({
    options: anonymous ? options.map((o) => ({ ...o, voters: [] })) : options,
    myVotes,
    anonymous,
  });
});

/* =========================================================
 *  ここから認証必須
 * =======================================================*/
eventRoutes.use("*", requireAuth);

/** 候補日の追加（staff） */
eventRoutes.post(
  "/:id/date-options",
  requireEventRole(["staff"]),
  zValidator("json", addDateOptionInput),
  async (c) => {
    const input = valid<AddDateOptionInput>(c, "json");
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    // 募集締切 (#269) と候補日は両立しない。締切は「開催日時が確定している」
    // 前提の設定なのに、候補日を足して finalize-date すると開催日時が動き、
    // 締切 > 開始日時（PATCH では 400 で弾いている状態）を作れてしまう。
    // 締切を外してから日程を選び直す、という順番に倒す
    if (event.registrationDeadline !== null) {
      return c.json({ error: "deadline_requires_fixed_date" }, 400);
    }
    const id = await schedulingRepo.addOption(eventId, input.startsAt, input.endsAt);
    return c.json({ id }, 201);
  },
);

/** 候補日の削除（staff） */
eventRoutes.delete(
  "/:id/date-options/:optionId",
  requireEventRole(["staff"]),
  async (c) => {
    await schedulingRepo.deleteOption(
      c.req.param("id"),
      c.req.param("optionId"),
    );
    return c.json({ ok: true });
  },
);

/** 候補日への回答（ログインユーザー誰でも。確定後は不可） */
eventRoutes.put(
  "/:id/date-options/:optionId/vote",
  zValidator("json", voteInput),
  async (c) => {
    const eventId = c.req.param("id");
    const optionId = c.req.param("optionId");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    if (!event.scheduling) return c.json({ error: "schedule_finalized" }, 409);
    if (!(await schedulingRepo.getOption(eventId, optionId))) {
      return c.json({ error: "not_found" }, 404);
    }
    await schedulingRepo.vote(
      optionId,
      c.get("user").id,
      valid<VoteInput>(c, "json").choice,
    );
    return c.json({ ok: true });
  },
);

/** 日程を確定（staff）。候補の日時をイベント開催日時に設定し調整完了 */
eventRoutes.post(
  "/:id/finalize-date",
  requireEventRole(["staff"]),
  zValidator("json", finalizeDateInput),
  async (c) => {
    const eventId = c.req.param("id");
    const opt = await schedulingRepo.getOption(
      eventId,
      valid<FinalizeDateInput>(c, "json").optionId,
    );
    if (!opt) return c.json({ error: "not_found" }, 404);
    // 確定で開催日時が動くので、PATCH と同じ不変条件（締切 <= 開始日時）を
    // ここでも守る (#269)。候補日の追加は締切ありなら弾いているが、
    // 「候補日あり → PATCH で日程確定＋締切設定 → 古い候補で finalize」の
    // 経路が残るため、確定側にもチェックを置く
    const current = await eventsRepo.findById(eventId);
    if (!current) return c.json({ error: "not_found" }, 404);
    if (
      current.registrationDeadline !== null &&
      current.registrationDeadline > opt.startsAt
    ) {
      return c.json({ error: "deadline_after_start" }, 400);
    }
    const event = await eventsRepo.finalizeDate(
      eventId,
      opt.startsAt,
      opt.endsAt,
    );
    // 日程調整の回答者へ確定を通知（確定操作をした本人は除く）
    if (event) {
      const me = c.get("user").id;
      const when = formatDateRangeJa(opt.startsAt, opt.endsAt);
      for (const userId of await schedulingRepo.listVoterIds(eventId)) {
        if (userId === me) continue;
        await notificationsRepo.create(
          userId,
          "schedule_finalized",
          "日程が確定しました",
          `「${event.title}」の開催日時が ${when} に決定しました`,
          `/events/${eventId}`,
        );
      }
    }
    return c.json({ event });
  },
);

/** 公開イベント一覧 */
eventRoutes.get("/", async (c) => {
  return c.json({ events: await eventsRepo.listPublished() });
});

/** イベントをコミュニティに紐づけられるか (#264)。
 * 紐づけると相手コミュニティの一覧・KPI（開催数・不発率・新規流入・重複度）に
 * そのまま入ってしまうため、勝手にぶら下げられないようにする。
 *
 * 条件は owner/admin。community_member は誰でも自由に参加できる（POST
 * /communities/:id/membership）ので、「メンバーか」では素通しになってしまう。
 * イベント作成フォームの選択肢も GET /communities/mine（= owner/admin）なので、
 * 画面上の仕様とも一致する。 */
async function canAttachCommunity(
  communityId: string,
  user: User,
): Promise<boolean> {
  if (isAppAdmin(user)) return true;
  return communitiesRepo.isManager(communityId, user.id);
}

/** イベント作成（作成者は staff として自動参加） */
eventRoutes.post("/", zValidator("json", createEventInput), async (c) => {
  const user = c.get("user");
  const input = valid<CreateEventInput>(c, "json");
  if (input.communityId && !(await canAttachCommunity(input.communityId, user))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const event = await eventsRepo.create(input, user.id);
  await eventMembersRepo.add(event.id, user.id, "staff");
  await scoringCriteriaRepo.seedDefaults(event.id);
  return c.json({ event }, 201);
});

/** イベント更新（staff のみ） */
eventRoutes.patch(
  "/:id",
  requireEventRole(["staff"]),
  zValidator("json", updateEventInput),
  async (c) => {
    const prior = await eventsRepo.findById(c.req.param("id"));
    const input = valid<UpdateEventInput>(c, "json");
    // 紐づけ先コミュニティを「変える」ときだけ権限を見る (#264)。
    // 編集フォームは現在値をそのまま送り返すので、変更がなければ通す
    // （コミュニティの owner/admin ではないイベントstaffが編集できなくなるため）。
    // 外すだけ（null）は staff なら誰でもできる
    if (input.communityId !== undefined) {
      const next = input.communityId ?? null;
      if (next !== (prior?.communityId ?? null)) {
        if (next && !(await canAttachCommunity(next, c.get("user")))) {
          return c.json({ error: "forbidden" }, 403);
        }
      }
    }
    // 日程調整をやめて直接確定する場合は、有効な開催日時が必須
    if (input.scheduling === false) {
      const startsAt = input.startsAt ?? prior?.startsAt ?? 0;
      const endsAt = input.endsAt ?? prior?.endsAt ?? 0;
      if (!(startsAt > 0 && endsAt > startsAt)) {
        return c.json({ error: "invalid_date" }, 400);
      }
    }
    // 募集締切 (#269) は「更新後の状態」で検証する。入力に含まれない項目は
    // 現在値が残るので、締切だけを送る編集でも、開始日時だけを前倒しする編集でも
    // 同じ不変条件（締切 <= 開始日時）を保てる
    const nextDeadline =
      input.registrationDeadline !== undefined
        ? input.registrationDeadline
        : (prior?.registrationDeadline ?? null);
    if (nextDeadline !== null) {
      // 日程調整中は開催日が未定で、締切より先に開催日が決まる保証が無い
      // （締切だけ過ぎて誰も申し込めない状態になり得る）。日程を確定してから設定する。
      // なお scheduling は false にしか変更できない（updateEventInput が z.literal(false)）
      // ため「締切が入ったまま日程調整へ戻る」経路は存在せず、クリア処理は要らない
      const stillScheduling = (prior?.scheduling ?? false) && input.scheduling !== false;
      if (stillScheduling) {
        return c.json({ error: "deadline_requires_fixed_date" }, 400);
      }
      // 開始後まで受け付けたいなら「締切なし」を選ぶ、という整理にする
      // （開始後の締切を許すと、締切とイベント終了の2つの締めが並んで分かりにくい）
      const nextStartsAt = input.startsAt ?? prior?.startsAt ?? 0;
      if (nextDeadline > nextStartsAt) {
        return c.json({ error: "deadline_after_start" }, 400);
      }
    }
    const event = await eventsRepo.update(c.req.param("id"), input);
    if (!event) return c.json({ error: "not_found" }, 404);
    // たまご（あったらいいな）にリンク済みなら公開時に賛同者へ通知
    await notifyRequestsOnPublish(event);
    // 作成者のフォロワーへ公開通知（draft→published の実遷移時のみ・初回のみ）
    if (prior?.status !== "published") {
      await notifyFollowersOnPublish(event);
    }
    return c.json({ event });
  },
);

/** イベント画像のアップロード/削除（staff のみ。admin はバイパス） */
eventRoutes.put("/:id/image", requireEventRole(["staff"]), putEventImage);
eventRoutes.delete("/:id/image", requireEventRole(["staff"]), deleteEventImage);

/** 公開（staff のみ） */
eventRoutes.post("/:id/publish", requireEventRole(["staff"]), async (c) => {
  const prior = await eventsRepo.findById(c.req.param("id"));
  const event = await eventsRepo.setStatus(c.req.param("id"), "published");
  if (!event) return c.json({ error: "not_found" }, 404);
  // たまご（あったらいいな）にリンク済みなら公開時に賛同者へ通知
  await notifyRequestsOnPublish(event);
  // 作成者のフォロワーへ公開通知（draft→published の実遷移時のみ・初回のみ）
  if (prior?.status !== "published") {
    await notifyFollowersOnPublish(event);
  }
  return c.json({ event });
});

/** イベントの複製（staff のみ）。設定・参加枠・採点基準・表彰の定義・画像を
 * コピーした下書きイベントを作る。メンバー・エントリー・コメント・写真・
 * 日程調整の候補/投票・受賞結果などはコピーしない。 */
eventRoutes.post("/:id/duplicate", requireEventRole(["staff"]), async (c) => {
  const src = await eventsRepo.findById(c.req.param("id"));
  if (!src) return c.json({ error: "not_found" }, 404);
  const user = c.get("user");

  // タイトル末尾に「のコピー」（200字上限を超えるなら切り詰めてから付与）
  const suffix = "のコピー";
  // コードポイント境界で切り詰め（サロゲートペアを分断しない）
  const base =
    src.title.length + suffix.length > 200
      ? [...src.title].slice(0, 200 - suffix.length).join("")
      : src.title;

  // 基本情報をコピーして下書きで作成。開催日時は未定（0）に戻し、
  // 日程調整をやり直せるよう scheduling=true で作る（編集で直接設定も可能）
  const created = await eventsRepo.create(
    {
      title: base + suffix,
      subtitle: src.subtitle,
      description: src.description,
      startsAt: 0,
      endsAt: 0,
      venueType: src.venueType,
      venueOffline: src.venueOffline,
      venueOnline: src.venueOnline,
      aggregateSelfEntry: src.aggregateSelfEntry,
      contestMode: src.contestMode,
      // 複製元と同じコミュニティに紐づける。複製できるのは複製元の staff
      // （＝そのコミュニティ側から招かれた人）だけなので、#264 の
      // 「第三者が任意のコミュニティにぶら下げる」経路にはならない
      communityId: src.communityId,
      scheduling: true,
      scheduleAnonymous: src.scheduleAnonymous,
      venueWanted: src.venueWanted,
    },
    user.id,
  );
  await eventMembersRepo.add(created.id, user.id, "staff");

  // create が受け取らない設定と参加者限定の文章は update で反映。
  // 募集締切 (#269) は**あえてコピーしない**。締切は複製元の開催日に紐づいた
  // 絶対時刻で、複製では開催日時を 0 に戻している（上）ため、そのまま持ち越すと
  // 「作った瞬間もう締め切られている」下書きができてしまう。抽選日時 drawAt を
  // コピーしない（下）のと同じ理由。
  await eventsRepo.update(created.id, {
    scheduleVisible: src.scheduleVisible,
    photosPublic: src.photosPublic,
    attendanceCheck: src.attendanceCheck,
    chatEnabled: src.chatEnabled,
    chatUrlsAllowed: src.chatUrlsAllowed,
    // Q&A (#216) は設定だけコピーする（質問・票は複製元のもの）
    qaEnabled: src.qaEnabled,
    qaAnonymity: src.qaAnonymity,
    membersNote: await eventsRepo.membersNoteFor(src.id),
  });

  // 参加枠の定義（参加者は除く）。listByEvent は sort_order 順なので順序が保たれる
  for (const slot of await participationSlotsRepo.listByEvent(src.id)) {
    await participationSlotsRepo.create(created.id, {
      name: slot.name,
      capacity: slot.capacity,
      selectionType: slot.selectionType,
      // 抽選日時は旧イベントの絶対時刻なのでコピーしない（日程リセットと整合）
      drawAt: null,
    });
  }

  // 採点基準（デフォルトのシードではなく元イベントの内容をコピー）
  for (const cr of await scoringCriteriaRepo.listByEvent(src.id)) {
    await scoringCriteriaRepo.create(created.id, {
      name: cr.name,
      description: cr.description,
      maxLevel: cr.maxLevel,
    });
  }

  // 表彰の定義（受賞結果は除く）
  for (const rank of await awardsRepo.listRanks(src.id)) {
    await awardsRepo.createRank(created.id, {
      name: rank.name,
      content: rank.content,
    });
  }
  for (const special of await awardsRepo.listSpecials(src.id)) {
    await awardsRepo.createSpecial(created.id, {
      name: special.name,
      content: special.content,
    });
  }

  // イベント画像（元画像が無ければスキップ）
  await copyEventImage(src.id, created.id);

  return c.json({ event: await eventsRepo.findById(created.id) }, 201);
});

/** イベント削除（staff のみ。関連データは FK CASCADE で削除） */
eventRoutes.delete("/:id", requireEventRole(["staff"]), async (c) => {
  await eventsRepo.delete(c.req.param("id"));
  return c.json({ ok: true });
});

/** 終了済みイベントか（日程調整中＝開催日未定は終了扱いしない） */
function isEventEnded(event: Event): boolean {
  return !event.scheduling && event.endsAt < Date.now();
}

/** 募集の締切を過ぎたか (#269)。
 * 未設定（null）は締切なし＝従来どおり isEventEnded まで受け付ける。
 * これで止まるのは**新規の参加登録だけ**。キャンセル・繰り上げ・スタッフ操作
 * （ロール変更・当選操作・出席チェック・QR受付）は当日運営に必要なので通す。 */
function isRegistrationClosed(event: Event): boolean {
  return (
    event.registrationDeadline !== null && event.registrationDeadline <= Date.now()
  );
}

/** 参加登録（枠選択。先着=確定/満員はキャンセル待ち、抽選=申込） */
eventRoutes.post("/:id/join", zValidator("json", joinEventInput), async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const event = await eventsRepo.findById(eventId);
  if (!event) return c.json({ error: "not_found" }, 404);
  // 終了済みイベントには参加できない（日程調整中は終了扱いしない）
  if (isEventEnded(event)) return c.json({ error: "event_ended" }, 409);

  const existing = await eventMembersRepo.find(eventId, user.id);
  if (existing) return c.json({ member: existing });

  // 募集締切を過ぎたら新規登録を断る (#269)。既存メンバーの再POSTは上で
  // 抜けているので影響しない。アンケート判定より**前**に置くこと：後ろだと
  // 締切後なのに Web がアンケート回答ダイアログを出してから断ることになる
  if (isRegistrationClosed(event)) {
    return c.json({ error: "registration_closed" }, 409);
  }

  // 必須の事前アンケートに未回答なら参加登録をブロック (#152)。
  // Web は先に PUT /survey/my で回答してから join する
  if (!(await eventSurveyRepo.hasAnsweredRequired(eventId, user.id, "pre"))) {
    return c.json({ error: "survey_required" }, 409);
  }

  const input = valid<JoinEventInput>(c, "json");
  const slots = await participationSlotsRepo.listByEvent(eventId);
  let slotId: string | null = null;
  let status = "confirmed";

  if (slots.length > 0) {
    const slot = slots.find((s) => s.id === input.slotId);
    if (!slot) return c.json({ error: "slot_required" }, 400);
    slotId = slot.id;
    if (slot.selectionType === "lottery") {
      status = "applied";
    } else {
      status = slot.confirmedCount < slot.capacity ? "confirmed" : "waitlist";
    }
  }

  const member = await eventMembersRepo.add(
    eventId,
    user.id,
    "participant",
    slotId,
    status,
  );
  if (status === "confirmed") {
    await entriesRepo.createIndividual(
      eventId,
      user.id,
      user.globalName ?? user.username,
    );
    // フォロワーへ「参加した」通知（公開イベントのみ）
    await notifyFollowersOnJoin(event, user.id);
  }
  return c.json({ member, status }, 201);
});

/** 参加解除（メンバーと個人 Entry を削除）。先着枠なら待機を自動繰り上げ。 */
eventRoutes.delete("/:id/join", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const event = await eventsRepo.findById(eventId);
  if (!event) return c.json({ error: "not_found" }, 404);
  // 終了済みイベントは参加解除できない（参加履歴を残す）
  if (isEventEnded(event)) return c.json({ error: "event_ended" }, 409);
  const leaving = await eventMembersRepo.find(eventId, user.id);
  await entriesRepo.removeIndividualEntry(eventId, user.id);
  if (
    leaving &&
    leaving.role === "participant" &&
    leaving.status === "confirmed" &&
    event.status === "published"
  ) {
    // 確定参加者の取消はキャンセル履歴として残す（参加実績の集計用）
    await eventMembersRepo.cancel(eventId, user.id, event.scheduling);
  } else {
    await eventMembersRepo.remove(eventId, user.id);
  }
  // 事前アンケートの回答は本人の離脱と同時に削除（入館用氏名等のPIIを残さない）
  await eventSurveyRepo.deleteAnswersForUser(eventId, user.id);

  let promotedUserId: string | null = null;
  // 先着枠で確定者が抜けたら、待機(waitlist)の最古を確定へ繰り上げる
  if (leaving && leaving.slotId && leaving.status === "confirmed") {
    const slot = await participationSlotsRepo.findById(leaving.slotId);
    if (
      slot &&
      slot.selectionType === "first_come" &&
      slot.confirmedCount < slot.capacity
    ) {
      const [next] = await eventMembersRepo.membersBySlotStatus(
        leaving.slotId,
        "waitlist",
      );
      if (next) {
        await eventMembersRepo.setStatus(next.id, "confirmed");
        const u = await usersRepo.findById(next.userId);
        if (u) {
          await entriesRepo.createIndividual(
            eventId,
            next.userId,
            u.globalName ?? u.username,
          );
        }
        promotedUserId = next.userId;
        const event = await eventsRepo.findById(eventId);
        await notificationsRepo.create(
          next.userId,
          "waitlist_promoted",
          "キャンセル待ちから繰り上がりました",
          event ? `「${event.title}」への参加が確定しました` : "参加が確定しました",
          `/events/${eventId}`,
        );
      }
    }
  }
  return c.json({ ok: true, promotedUserId });
});

/** ロール変更（staff のみ） */
eventRoutes.patch(
  "/:id/members/:userId/role",
  requireEventRole(["staff"]),
  zValidator("json", updateMemberRoleInput),
  async (c) => {
    const member = await eventMembersRepo.setRole(
      c.req.param("id"),
      c.req.param("userId"),
      valid<UpdateMemberRoleInput>(c, "json").role,
    );
    if (!member) return c.json({ error: "not_found" }, 404);
    return c.json({ member });
  },
);

/** 出席チェック（staff のみ） */
eventRoutes.patch(
  "/:id/members/:userId/attendance",
  requireEventRole(["staff"]),
  zValidator("json", setAttendanceInput),
  async (c) => {
    const { attended } = valid<SetAttendanceInput>(c, "json");
    const member = await eventMembersRepo.setAttended(
      c.req.param("id"),
      c.req.param("userId"),
      attended,
      // 出席にした時刻を記録（解除では NULL に戻る） (#154)
      attended ? Date.now() : null,
    );
    if (!member) return c.json({ error: "not_found" }, 404);
    return c.json({ member });
  },
);

/* =========================================================
 *  QR受付（入場チェックイン） (#154)
 * =======================================================*/

/** 受付画面に返すユーザーの最小情報 */
function toCheckinUser(user: User): CheckinUser {
  return {
    id: user.id,
    username: user.username,
    name: user.globalName ?? user.username,
    avatarUrl: user.avatarUrl,
  };
}

function toCheckinMember(member: EventMember | null) {
  return member
    ? { role: member.role, status: member.status, attended: member.attended }
    : null;
}

/** 入場チケット（署名付きQRトークン）。本人＝確定メンバーのみ */
eventRoutes.get("/:id/my-ticket", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const member = await eventMembersRepo.find(eventId, user.id);
  if (!member || member.status !== "confirmed") {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json(await createCheckinToken(eventId, user.id));
});

/** 入場チケットの検証＋出席記録（staff のみ）。
 * 署名検証を通ったチケットは「本人がアカウントを開いている」証明なので即時に出席記録する */
eventRoutes.post(
  "/:id/checkin",
  requireEventRole(["staff"]),
  zValidator("json", checkinInput),
  async (c) => {
    const eventId = c.req.param("id");
    const { token } = valid<CheckinInput>(c, "json");
    const verified = await verifyCheckinToken(token);
    if (!verified.ok) {
      return verified.reason === "expired"
        ? c.json({ error: "expired_token" }, 410)
        : c.json({ error: "invalid_token" }, 400);
    }
    // 別イベントのチケットの流用は拒否
    if (verified.eventId !== eventId) {
      return c.json({ error: "wrong_event" }, 400);
    }
    const user = await usersRepo.findById(verified.userId);
    if (!user) return c.json({ error: "invalid_token" }, 400);
    let member = await eventMembersRepo.find(eventId, user.id);
    let result: CheckinResultKind;
    if (!member || member.status !== "confirmed") {
      // 確定参加者でない場合は出席記録しない（受付で案内してもらう）
      result = "not_confirmed";
    } else if (member.attended) {
      result = "already";
    } else {
      member = await eventMembersRepo.setAttended(
        eventId,
        user.id,
        true,
        Date.now(),
      );
      result = "checked_in";
    }
    return c.json({
      result,
      user: toCheckinUser(user),
      member: toCheckinMember(member),
    });
  },
);

/** プロフィールQR（印刷カード等）からのメンバー照会（staff のみ）。
 * 本人確認チケットではないため、出席記録は staff の手動操作に任せる */
eventRoutes.get(
  "/:id/member-lookup",
  requireEventRole(["staff"]),
  zValidator("query", memberLookupQuery),
  async (c) => {
    const { handle } = valid<MemberLookupQuery>(c, "query");
    const user =
      (await usersRepo.findByUsername(handle)) ??
      (await usersRepo.findById(handle));
    if (!user) {
      return c.json({ found: false } satisfies MemberLookupResult);
    }
    const member = await eventMembersRepo.find(c.req.param("id"), user.id);
    return c.json({
      found: true,
      user: toCheckinUser(user),
      member: toCheckinMember(member),
    } satisfies MemberLookupResult);
  },
);

/** 参加枠の作成/更新/削除（staff のみ） */
eventRoutes.post(
  "/:id/slots",
  requireEventRole(["staff"]),
  zValidator("json", createSlotInput),
  async (c) => {
    const slot = await participationSlotsRepo.create(
      c.req.param("id"),
      valid<CreateSlotInput>(c, "json"),
    );
    return c.json({ slot }, 201);
  },
);

eventRoutes.patch(
  "/:id/slots/:slotId",
  requireEventRole(["staff"]),
  zValidator("json", updateSlotInput),
  async (c) => {
    const cur = await participationSlotsRepo.findById(c.req.param("slotId"));
    if (!cur || cur.eventId !== c.req.param("id")) {
      return c.json({ error: "not_found" }, 404);
    }
    const slot = await participationSlotsRepo.update(
      c.req.param("slotId"),
      valid<UpdateSlotInput>(c, "json"),
    );
    if (!slot) return c.json({ error: "not_found" }, 404);
    return c.json({ slot });
  },
);

eventRoutes.delete("/:id/slots/:slotId", requireEventRole(["staff"]), async (c) => {
  const cur = await participationSlotsRepo.findById(c.req.param("slotId"));
  if (!cur || cur.eventId !== c.req.param("id")) {
    return c.json({ error: "not_found" }, 404);
  }
  await participationSlotsRepo.delete(c.req.param("slotId"));
  return c.json({ ok: true });
});

/** 抽選実行（staff のみ）。applied から定員までを当選=confirmed、残りを落選=lost に */
eventRoutes.post("/:id/slots/:slotId/draw", requireEventRole(["staff"]), async (c) => {
  const eventId = c.req.param("id");
  const slot = await participationSlotsRepo.findById(c.req.param("slotId"));
  if (!slot || slot.eventId !== eventId) return c.json({ error: "not_found" }, 404);
  if (slot.selectionType !== "lottery") {
    return c.json({ error: "not_lottery" }, 400);
  }
  // membersBySlotStatus は退会申請中 (#250) を除くので、猶予期間中の申込者は
  // 抽選対象にも落選通知の対象にもならない（枠を無駄に消費させない）。
  // 参加者以外（staff/judge/observer）も除く (#277)：運営側は枠を消費しないし、
  // 落選にすると操作UIは出るのにサーバーが403を返す状態になる
  const applied = await eventMembersRepo.membersBySlotStatus(slot.id, "applied");
  const shuffled = [...applied].sort(() => Math.random() - 0.5);
  const winners = shuffled.slice(0, slot.capacity);
  const winnerIds = new Set(winners.map((w) => w.id));
  const event = await eventsRepo.findById(eventId);
  const title = event?.title ?? "イベント";
  const link = `/events/${eventId}`;

  for (const m of applied) {
    if (winnerIds.has(m.id)) {
      await eventMembersRepo.setStatus(m.id, "confirmed");
      const u = await usersRepo.findById(m.userId);
      if (u) {
        await entriesRepo.createIndividual(eventId, m.userId, u.globalName ?? u.username);
      }
      await notificationsRepo.create(
        m.userId,
        "lottery_won",
        "抽選に当選しました",
        `「${title}」の抽選に当選しました。参加が確定です`,
        link,
      );
    } else {
      await eventMembersRepo.setStatus(m.id, "lost");
      await notificationsRepo.create(
        m.userId,
        "lottery_lost",
        "抽選結果のお知らせ",
        `「${title}」は今回は落選となりました`,
        link,
      );
    }
  }
  return c.json({
    drawn: applied.length,
    confirmed: winners.length,
    lost: applied.length - winners.length,
  });
});

/** 当選操作（staff のみ）。申込者の status を手動設定し、Entry を同期。 */
eventRoutes.patch(
  "/:id/slots/:slotId/members/:userId/status",
  requireEventRole(["staff"]),
  zValidator("json", setMemberSlotStatusInput),
  async (c) => {
    const eventId = c.req.param("id");
    const userId = c.req.param("userId");
    const member = await eventMembersRepo.find(eventId, userId);
    if (!member || member.slotId !== c.req.param("slotId")) {
      return c.json({ error: "not_found" }, 404);
    }
    // 退会申請中 (#250) は一覧にも出ないので操作対象にしない（当選させても
    // 参加できず枠だけ消費する。findById は猶予期間中を null にする）
    const target = await usersRepo.findById(userId);
    if (!target) return c.json({ error: "not_found" }, 404);
    const status = valid<SetMemberSlotStatusInput>(c, "json").status;
    await eventMembersRepo.setStatus(member.id, status);
    // Entry 同期: 確定なら個人Entry作成、それ以外は削除
    if (status === "confirmed") {
      await entriesRepo.createIndividual(
        eventId,
        userId,
        target.globalName ?? target.username,
      );
    } else {
      await entriesRepo.removeIndividualEntry(eventId, userId);
    }
    // 確定/落選はユーザーへ通知
    if (status === "confirmed" || status === "lost") {
      const event = await eventsRepo.findById(eventId);
      const title = event?.title ?? "イベント";
      if (status === "confirmed") {
        await notificationsRepo.create(
          userId,
          "lottery_won",
          "参加が確定しました",
          `「${title}」への参加が確定しました`,
          `/events/${eventId}`,
        );
      } else {
        await notificationsRepo.create(
          userId,
          "lottery_lost",
          "抽選結果のお知らせ",
          `「${title}」は今回は落選となりました`,
          `/events/${eventId}`,
        );
      }
    }
    return c.json({ ok: true });
  },
);

/** 自分の Entry の成果物を保存（その Entry の member のみ） */
eventRoutes.put(
  "/:id/entries/:entryId/submission",
  zValidator("json", updateSubmissionInput),
  async (c) => {
    const user = c.get("user");
    const entryId = c.req.param("entryId");
    const entry = await entriesRepo.findById(entryId);
    if (!entry || entry.eventId !== c.req.param("id")) {
      return c.json({ error: "not_found" }, 404);
    }
    if (!(await entriesRepo.isMember(entryId, user.id))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const input = valid<UpdateSubmissionInput>(c, "json");
    const norm = (v: string | null | undefined) => (v ? v : null);
    const submission = await entriesRepo.upsertSubmission(
      entryId,
      norm(input.presentationUrl),
      norm(input.sourceCodeUrl),
    );
    return c.json({ submission });
  },
);
