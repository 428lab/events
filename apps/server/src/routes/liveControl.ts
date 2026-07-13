import { Hono } from "hono";
import {
  DEFAULT_LIVE_SET_ID,
  defaultLiveSetContent,
  updateEventLiveStateInput,
} from "@eventer/shared";
import type { LiveSet, UpdateEventLiveStateInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { valid, zValidator } from "../lib/validator.js";
import { eventLiveStateRepo } from "../db/repositories/eventLiveState.js";
import { liveSetsRepo } from "../db/repositories/liveSets.js";
import { decksRepo } from "../db/repositories/decks.js";

/** イベントの配信ランタイム状態（コントロールタブ→配信画面タブの同期点）。staff専用 */
export const liveControlRoutes = new Hono<AppEnv>();
liveControlRoutes.use("*", requireAuth);

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
    // 存在しない配信セットIDは弾く（DEFAULT は仮想セットなので許可）
    if (input.liveSetId && input.liveSetId !== DEFAULT_LIVE_SET_ID) {
      if (!(await liveSetsRepo.findById(input.liveSetId))) {
        return c.json({ error: "live_set_not_found" }, 404);
      }
    }
    return c.json(await eventLiveStateRepo.update(c.req.param("id"), input));
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
