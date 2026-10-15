import { Hono } from "hono";
import { createCohostInput, MAX_EVENT_COHOSTS } from "@eventer/shared";
import type { Community, CreateCohostInput, Event, User } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireEventRole } from "../auth/roles.js";
import { valid, zValidator } from "../lib/validator.js";
import { communitiesRepo } from "../db/repositories/communities.js";
import { eventCohostsRepo } from "../db/repositories/eventCohosts.js";
import { eventsRepo } from "../db/repositories/events.js";
import { notificationsRepo } from "../db/repositories/notifications.js";
import { genericEventNotice } from "../db/repositories/eventNotificationAccess.js";

/**
 * イベントの共催コミュニティ (#625)。docs/event-cohost.md
 *
 * 主催（event.community_id）はそのまま、共催は event_cohost に持つ。共催は
 * **表示と共催側コミュニティページの一覧への掲載だけ**に効き、権限は渡さない。
 * 共催側の人に運営してほしいときは運営スタッフ招待 (#339) で個別に招く。
 *
 * 他のコミュニティに無断でぶら下げられないよう (#264)、ここで作るのは承認待ちの
 * 依頼だけ。成立させるのは共催先の owner/admin（routes/communities.ts）。
 * ただし依頼者自身が共催先の owner/admin なら、承諾できる本人が頼んでいるので
 * 承認を挟まず共催中で作り、依頼・結果の通知も送らない。
 */

/** 画面からは「https://…/c/foo/」や「/c/foo」の形で貼られることを見越して slug に直す */
function toSlug(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/?c\//, "")
    .replace(/\/+$/, "");
}

/** 共催の依頼を共催先の owner/admin 全員に届ける。
 *
 * **eventId を付けない。** 受け手（共催先の owner/admin）はそのイベントを閲覧
 * できないことが多く（下書き・限定公開・非公開）、eventId を付けると
 * notificationVisibleSql の閲覧資格の判定で通知ごと消えてしまう。遷移先も
 * イベントページではなく、承諾・辞退ができるコミュニティ編集ページにする。
 * 主語は人ではなくコミュニティ（主催が無いときだけ依頼者名）なので actor は残さない。
 *
 * eventId が無いと通知・メールの汎用化（genericEventNotice）が効かないので、
 * 非公開・下書きのイベントはここで題名を含まない汎用の文面にする
 * （docs/private-events.md §8）。 */
async function notifyRequested(
  event: Event,
  target: Community,
  requester: User,
): Promise<void> {
  const link = `/c/${target.slug}/edit#cohosts`;
  let title: string;
  let body: string;
  if (event.visibility === "private" || event.status === "draft") {
    ({ title, body } = genericEventNotice(event.id, "cohost_request"));
  } else {
    const host = event.communityId
      ? await communitiesRepo.findById(event.communityId)
      : null;
    const from = host?.name ?? requester.globalName ?? requester.username;
    title = `「${event.title}」の共催の依頼が届きました`;
    body = `${from} から ${target.name} への共催の依頼です。`;
  }
  await notificationsRepo.createForMany(
    await eventCohostsRepo.managerIds(target.id),
    "cohost_request",
    title,
    body,
    link,
    undefined,
    // メールは送らない。取り下げ→再依頼のたびに owner/admin 全員へメールが再送されるため
    { skipEmail: true },
  );
}

/** 依頼の結果をイベントの作成者に返す（共催先コミュニティでの承諾・辞退）。
 * 依頼した人は記録していない（event_cohost は user を参照しない）ので、宛先は
 * イベントの作成者に固定する。こちらはイベントの通知なので eventId を付け、
 * 作成者がイベントを見られなくなっていれば通常のイベント通知と同じく届かない */
export async function notifyCohostResult(
  event: Event,
  community: Community,
  accepted: boolean,
): Promise<void> {
  await notificationsRepo.create(
    event.createdBy,
    "cohost_result",
    accepted
      ? `「${event.title}」の共催が承諾されました`
      : `「${event.title}」の共催が辞退されました`,
    accepted
      ? `${community.name} が共催に加わりました。`
      : `${community.name} は共催に加わりませんでした。`,
    `/events/${event.id}/manage#cohosts`,
    undefined,
    { eventId: event.id },
  );
}

/* =========================================================
 *  主催側: /api/events/:id/cohosts
 * =======================================================*/

export const eventCohostRoutes = new Hono<AppEnv>();
// 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)
// 認可はイベントの編集（PATCH /api/events/:id）と同じ requireEventRole(["staff"])

/** 共催の一覧（そのイベントの管理者のみ。承認待ちを含む） */
eventCohostRoutes.get("/:id/cohosts", requireEventRole(["staff"]), async (c) => {
  return c.json({ cohosts: await eventCohostsRepo.listByEvent(c.req.param("id")) });
});

/** 共催を申請する（そのイベントの管理者のみ）。相手はコミュニティの slug で指定する */
eventCohostRoutes.post(
  "/:id/cohosts",
  requireEventRole(["staff"]),
  zValidator("json", createCohostInput),
  async (c) => {
    const eventId = c.req.param("id");
    const user = c.get("user");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);

    const { slug } = valid<CreateCohostInput>(c, "json");
    const target = await communitiesRepo.findBySlug(toSlug(slug));
    if (!target) return c.json({ error: "community_not_found" }, 404);
    if (target.id === event.communityId) {
      return c.json({ error: "host_community" }, 400);
    }
    if (await eventCohostsRepo.find(eventId, target.id)) {
      return c.json({ error: "already_cohost" }, 409);
    }
    if ((await eventCohostsRepo.countByEvent(eventId)) >= MAX_EVENT_COHOSTS) {
      return c.json({ error: "cohost_limit" }, 400);
    }
    // 共催先の承諾と同じ判定（routes/communities.ts の accept）。通れば承認済みで作る
    const status = (await communitiesRepo.isManager(target.id, user.id)) ? "accepted" : "pending";
    // 上の検査と同時押しで競ったときは、作る文の中の上限・一意制約で止まる
    if (!(await eventCohostsRepo.create(eventId, target.id, user.id, status))) {
      return (await eventCohostsRepo.find(eventId, target.id))
        ? c.json({ error: "already_cohost" }, 409)
        : c.json({ error: "cohost_limit" }, 400);
    }
    if (status === "pending") await notifyRequested(event, target, user);
    return c.json({ status, cohosts: await eventCohostsRepo.listByEvent(eventId) }, 201);
  },
);

/** 共催を取り下げる（そのイベントの管理者のみ）。承認待ち・共催中のどちらも行ごと消す。
 * 主催側が自分で外すので、共催先へは知らせない */
eventCohostRoutes.delete(
  "/:id/cohosts/:communityId",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    const removed = await eventCohostsRepo.remove(eventId, c.req.param("communityId"), {
      actorId: c.get("user").id,
    });
    if (!removed) return c.json({ error: "not_found" }, 404);
    return c.json({ cohosts: await eventCohostsRepo.listByEvent(eventId) });
  },
);
