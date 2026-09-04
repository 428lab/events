import { Hono } from "hono";
import { valid, zValidator } from "../lib/validator.js";
import { createEventInput, updateEventInput } from "@eventer/shared";
import type {
  CreateEventInput,
  Event,
  UpdateEventInput,
  User,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { scoringCriteriaRepo } from "../db/repositories/scoringCriteria.js";
import { communitiesRepo } from "../db/repositories/communities.js";
import { deleteEventImage, putEventImage } from "./images.js";
import { notifyRequestsOnPublish } from "./eventRequests.js";
import { notifyFollowersOnPublish } from "./follows.js";
import { checkRegistrationDeadline } from "../lib/registrationDeadline.js";

/** イベントそのものの一覧・作成・更新・公開・画像・削除 */
export const eventCrudRoutes = new Hono<AppEnv>();

/** イベントをコミュニティに紐づけられるか (#264)。
 * 紐づけると相手コミュニティの一覧・KPI（開催数・不発率・新規流入・重複度）に
 * そのまま入ってしまうため、勝手にぶら下げられないようにする。
 *
 * 条件は owner/admin。community_member は誰でも自由に参加できる（POST
 * /communities/:id/membership）ので、「メンバーか」では素通しになってしまう。
 * イベント作成フォームの選択肢も GET /communities/mine（= owner/admin）なので、
 * 画面上の仕様とも一致する。 */
export async function canAttachCommunity(
  communityId: string,
  user: User,
): Promise<boolean> {
  if (isAppAdmin(user)) return true;
  return communitiesRepo.isManager(communityId, user.id);
}

/**
 * 公開になったときの通知。**PATCH と POST /publish の両方がここを通る**。
 *
 * 2か所に書くと必ずずれる（たまごの賛同者には届くのにフォロワーには届かない、
 * 片方だけ何度も通知する、など）。フォロワーへの公開通知は draft→published の
 * 実遷移のときだけ・初回だけに絞りたいので、`prior` の状態もここで見る。
 */
async function notifyOnPublish(
  prior: Event | null,
  event: Event,
): Promise<void> {
  // たまご（あったらいいな）にリンク済みなら公開時に賛同者へ通知
  await notifyRequestsOnPublish(event);
  // 作成者のフォロワーへ公開通知（draft→published の実遷移時のみ・初回のみ）
  if (prior?.status !== "published") {
    await notifyFollowersOnPublish(event);
  }
}

/** 公開イベント一覧 */
eventCrudRoutes.get("/", async (c) => {
  return c.json({ events: await eventsRepo.listPublished() });
});

/** イベント作成（作成者は staff として自動参加） */
eventCrudRoutes.post("/", zValidator("json", createEventInput), async (c) => {
  const user = c.get("user");
  const input = valid<CreateEventInput>(c, "json");
  if (
    input.communityId &&
    !(await canAttachCommunity(input.communityId, user))
  ) {
    return c.json({ error: "forbidden" }, 403);
  }
  const event = await eventsRepo.create(input, user.id);
  await eventMembersRepo.add(event.id, user.id, "staff");
  await scoringCriteriaRepo.seedDefaults(event.id);
  return c.json({ event }, 201);
});

/** イベント更新（staff のみ） */
eventCrudRoutes.patch(
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
    // 同じ不変条件を保てる。
    // なお scheduling は false にしか変更できない（updateEventInput が z.literal(false)）
    // ため「締切が入ったまま日程調整へ戻る」経路は存在せず、クリア処理は要らない
    const violation = checkRegistrationDeadline({
      deadline:
        input.registrationDeadline !== undefined
          ? input.registrationDeadline
          : (prior?.registrationDeadline ?? null),
      scheduling: (prior?.scheduling ?? false) && input.scheduling !== false,
      startsAt: input.startsAt ?? prior?.startsAt ?? 0,
    });
    if (violation) return c.json({ error: violation }, 400);
    const event = await eventsRepo.update(c.req.param("id"), input);
    if (!event) return c.json({ error: "not_found" }, 404);
    await notifyOnPublish(prior, event);
    return c.json({ event });
  },
);

/** イベント画像のアップロード/削除（staff のみ。admin はバイパス） */
eventCrudRoutes.put("/:id/image", requireEventRole(["staff"]), putEventImage);
eventCrudRoutes.delete(
  "/:id/image",
  requireEventRole(["staff"]),
  deleteEventImage,
);

/** 公開（staff のみ） */
eventCrudRoutes.post("/:id/publish", requireEventRole(["staff"]), async (c) => {
  const prior = await eventsRepo.findById(c.req.param("id"));
  const event = await eventsRepo.setStatus(c.req.param("id"), "published");
  if (!event) return c.json({ error: "not_found" }, 404);
  await notifyOnPublish(prior, event);
  return c.json({ event });
});

/** イベント削除（staff のみ。関連データは FK CASCADE で削除） */
eventCrudRoutes.delete("/:id", requireEventRole(["staff"]), async (c) => {
  await eventsRepo.delete(c.req.param("id"));
  return c.json({ ok: true });
});
