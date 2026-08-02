import { Hono } from "hono";
import { valid, zValidator } from "../lib/validator.js";
import {
  addDateOptionInput,
  createEventInput,
  createSlotInput,
  finalizeDateInput,
  joinEventInput,
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
  CreateEventInput,
  CreateSlotInput,
  Event,
  FinalizeDateInput,
  JoinEventInput,
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
import { usersRepo } from "../db/repositories/users.js";
import { notificationsRepo } from "../db/repositories/notifications.js";
import { formatDateRangeJa } from "../lib/dateFormat.js";
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
    const id = await schedulingRepo.addOption(
      c.req.param("id"),
      input.startsAt,
      input.endsAt,
    );
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

/** イベント作成（作成者は staff として自動参加） */
eventRoutes.post("/", zValidator("json", createEventInput), async (c) => {
  const user = c.get("user");
  const input = valid<CreateEventInput>(c, "json");
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
    const event = await eventsRepo.update(
      c.req.param("id"),
      valid<UpdateEventInput>(c, "json"),
    );
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
  const base =
    src.title.length + suffix.length > 200
      ? src.title.slice(0, 200 - suffix.length)
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
      communityId: src.communityId,
      scheduling: true,
      scheduleAnonymous: src.scheduleAnonymous,
      venueWanted: src.venueWanted,
    },
    user.id,
  );
  await eventMembersRepo.add(created.id, user.id, "staff");

  // create が受け取らない設定と参加者限定の文章は update で反映
  await eventsRepo.update(created.id, {
    scheduleVisible: src.scheduleVisible,
    photosPublic: src.photosPublic,
    attendanceCheck: src.attendanceCheck,
    membersNote: await eventsRepo.membersNoteFor(src.id),
  });

  // 参加枠の定義（参加者は除く）。listByEvent は sort_order 順なので順序が保たれる
  for (const slot of await participationSlotsRepo.listByEvent(src.id)) {
    await participationSlotsRepo.create(created.id, {
      name: slot.name,
      capacity: slot.capacity,
      selectionType: slot.selectionType,
      drawAt: slot.drawAt,
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
  await eventMembersRepo.remove(eventId, user.id);

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
    const member = await eventMembersRepo.setAttended(
      c.req.param("id"),
      c.req.param("userId"),
      valid<SetAttendanceInput>(c, "json").attended,
    );
    if (!member) return c.json({ error: "not_found" }, 404);
    return c.json({ member });
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
    const status = valid<SetMemberSlotStatusInput>(c, "json").status;
    await eventMembersRepo.setStatus(member.id, status);
    // Entry 同期: 確定なら個人Entry作成、それ以外は削除
    if (status === "confirmed") {
      const u = await usersRepo.findById(userId);
      if (u) {
        await entriesRepo.createIndividual(
          eventId,
          userId,
          u.globalName ?? u.username,
        );
      }
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
