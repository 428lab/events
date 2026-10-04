import { Hono, type Context } from "hono";
import {
  DEFAULT_LIVE_SET_ID,
  defaultLiveSetContent,
  updateEventLiveStateInput,
} from "@eventer/shared";
import { computeScheduleTimes, publicTracks } from "@eventer/shared";
import type { LivePresenter, LiveSet, UpdateEventLiveStateInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { isConfirmedEventStaff, requireEventRole } from "../auth/roles.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventLiveStateRepo } from "../db/repositories/eventLiveState.js";
import { eventLiveCutinRepo } from "../db/repositories/eventLiveCutin.js";
import { triggerCutinInput } from "@eventer/shared";
import { liveSetsRepo } from "../db/repositories/liveSets.js";
import { decksRepo } from "../db/repositories/decks.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventChatRepo } from "../db/repositories/eventChat.js";
import { groupChatRepo } from "../db/repositories/groupChat.js";
import { eventScheduleRepo } from "../db/repositories/eventSchedule.js";
import { presenterSlidesRepo } from "../db/repositories/presenterSlides.js";

/** イベントの配信ランタイム状態（コントロールタブ→配信画面タブの同期点）。staff専用 */
export const liveControlRoutes = new Hono<AppEnv>();
// 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)

/** 現在の配信状態（配信画面タブが1秒ポーリング） */
liveControlRoutes.get(
  "/:id/live-state",
  requireEventRole(["staff"]),
  async (c) => {
    return c.json(await eventLiveStateRepo.getOrInit(c.req.param("id")));
  },
);

/** シーン切替・デッキページ・BGM等の更新（コントロールタブ） */
liveControlRoutes.patch(
  "/:id/live-state",
  requireEventRole(["staff"]),
  zValidator("json", updateEventLiveStateInput),
  async (c) => {
    const input = valid<UpdateEventLiveStateInput>(c, "json");
    if ((input.liveIndicatorOn !== undefined || input.chatSource !== undefined) && !(await isConfirmedEventStaff(c.req.param("id"), c.get("user").id))) {
      return c.json({ error: "confirmed_staff_required" }, 403);
    }
    if (input.chatSource === "event") {
      const event = await eventsRepo.findById(c.req.param("id"));
      // 平文は公開イベントだけ。暗号化オン (#582) なら公開範囲を問わない（画面はスタッフ本人の資格で鍵を取る）。
      // 締め出しは人単位（平文の鍵・暗号化部屋の signer のどちらでも。設計 3.3）
      if (!event || !(event.visibility === "public" || event.chatEncrypted) || event.status !== "published" || event.scheduling || !event.chatEnabled || await eventChatRepo.isUserBlocked(c.req.param("id"), c.get("user").id) || await groupChatRepo.isMembersSignerBlocked(c.req.param("id"), c.get("user").id)) {
        return c.json({ error: "chat_unavailable" }, 403);
      }
    }
    // 発表者の選択 (#571) ではデッキとページをサーバーが決める。クライアントのデッキ指定と混ぜない
    if (input.presenterItemId !== undefined && (input.deckId !== undefined || input.deckPage !== undefined)) {
      return c.json({ error: "presenter_with_deck" }, 400);
    }
    if (input.presenterItemId && !(await eventScheduleRepo.findItem(c.req.param("id"), input.presenterItemId, "public"))) {
      return c.json({ error: "presenter_not_found" }, 404);
    }
    // デッキの直接指定は操作者自身のデッキだけ (#571)。発表者のデッキは presenterItemId で選ぶ
    // （任意の ID を書けると live-deck-content から他人のデッキの中身が読めてしまう）
    if (input.deckId) {
      const deck = await decksRepo.findById(input.deckId);
      if (!deck || deck.ownerId !== c.get("user").id) {
        return c.json({ error: "deck_not_owned" }, 403);
      }
    }
    // 存在しない配信セットIDは弾く（DEFAULT は仮想セットなので許可）
    if (input.liveSetId && input.liveSetId !== DEFAULT_LIVE_SET_ID) {
      if (!(await liveSetsRepo.findById(input.liveSetId))) {
        return c.json({ error: "live_set_not_found" }, 404);
      }
    }
    return c.json(await eventLiveStateRepo.update(c.req.param("id"), input, {eventId:c.req.param("id")!,actorId:c.get("user").id,permission:"manager"}));
  },
);

// requireEventRole includes administrators; cut-in operations never do.
async function confirmed(c: Context<AppEnv>) {
  return isConfirmedEventStaff(c.req.param("id")!, c.get("user").id);
}
liveControlRoutes.get("/:id/live-cutin", requireEventRole(["staff"]), async c => {
  if (!(await confirmed(c))) return c.json({ error: "confirmed_staff_required" }, 403);
  return c.json(await eventLiveCutinRepo.get(c.req.param("id"), c.get("user").id));
});
liveControlRoutes.post("/:id/live-cutin", requireEventRole(["staff"]), zValidator("json", triggerCutinInput), async c => {
  if (c.req.header("Origin") !== new URL(c.req.url).origin) return c.json({ error: "forbidden_origin" }, 403);
  if (!(await confirmed(c))) return c.json({ error: "confirmed_staff_required" }, 403);
  const result = await eventLiveCutinRepo.trigger(c.req.param("id"), c.get("user").id, valid<{ message: string }>(c, "json").message);
  return result ? c.json({ ...result, serverNow: Date.now() }, 201) : c.json({ error: "event_ended" }, 409);
});

/** 発表者一覧 (#571)。タイムテーブルの担当者付きコマを、タイムテーブルの並び
 * （開始時刻が分かる項目は時刻順）で1コマ1行。デッキは有効な紐付けだけを要約で返し、
 * **slug は返さない**（slug を知れば公開ページから中身が読めるため） */
liveControlRoutes.get(
  "/:id/live-presenters",
  requireEventRole(["staff"]),
  async (c) => {
    const eventId = c.req.param("id");
    const event = await eventsRepo.findById(eventId);
    if (!event) return c.json({ error: "not_found" }, 404);
    const [items, tracks, decks] = await Promise.all([
      eventScheduleRepo.listByEvent(eventId, "public"),
      eventScheduleRepo.listTracks(eventId, "public"),
      presenterSlidesRepo.effectiveDecks(eventId),
    ]);
    const trackIds = publicTracks(tracks).map((t) => t.id);
    const times = computeScheduleTimes(items, event.scheduling ? null : event.startsAt, trackIds);
    // トラックが無ければタイムテーブルの並びそのもの。トラックを使うイベントは並行するコマを
    // 開始時刻順に混ぜる（時刻が分からないコマは後ろ、同時刻は並び順）
    const byTime = (a: number | null, b: number | null) => a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b;
    const presenters: LivePresenter[] = items
      .map((item, index) => ({ item, index, startsAt: times[index] ?? null }))
      .filter(({ item }) => item.speakerUserId !== null || item.speakerName.trim() !== "")
      .sort((a, b) => (trackIds.length > 0 ? byTime(a.startsAt, b.startsAt) : 0) || a.index - b.index)
      .map(({ item, startsAt }) => ({
        itemId: item.id,
        title: item.title,
        startsAt,
        speaker: item.speaker,
        speakerName: item.speakerName,
        linkable: item.speakerUserId !== null,
        deck: decks.get(item.id) ?? null,
      }));
    return c.json({ presenters });
  },
);

/** 配信で映すスライド（デッキ）の中身。staff なら読める（deck要素のレンダリング用） */
liveControlRoutes.get(
  "/:id/live-deck-content",
  requireEventRole(["staff"]),
  async (c) => {
    const state = await eventLiveStateRepo.getOrInit(c.req.param("id"));
    if (!state.deckId) return c.json({ deck: null });
    return c.json({ deck: await decksRepo.findById(state.deckId) });
  },
);

/** イベントで使う配信セットの中身（画面・コントロール共通。オーナーでなくても staff なら読める）。
 * 未選択時はビルトインの既定セットを返す */
liveControlRoutes.get(
  "/:id/live-set-content",
  requireEventRole(["staff"]),
  async (c) => {
    const state = await eventLiveStateRepo.getOrInit(c.req.param("id"));
    if (state.liveSetId && state.liveSetId !== DEFAULT_LIVE_SET_ID) {
      const set = await liveSetsRepo.findById(state.liveSetId);
      if (set) return c.json(set);
    }
    const fallback: LiveSet = {
      id: DEFAULT_LIVE_SET_ID,
      ownerId: "",
      communityId: null,
      name: "デフォルト",
      content: defaultLiveSetContent(),
      createdAt: 0,
      updatedAt: 0,
    };
    return c.json(fallback);
  },
);
