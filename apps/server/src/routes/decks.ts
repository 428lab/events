import { Hono } from "hono";
import { createDeckInput, updateDeckInput } from "@eventer/shared";
import type { CreateDeckInput, UpdateDeckInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { valid, zValidator } from "../lib/validator.js";
import { decksRepo } from "../db/repositories/decks.js";
import { eventLiveStateRepo } from "../db/repositories/eventLiveState.js";
import { publishLive } from "./liveControl.js";
import { putDeckImage } from "./deckImages.js";
import { postDeckImport } from "./deckImport.js";
import { deckAgentTokenRoutes } from "./deckAgent.js";
import { deckLiveSyncEnabled, deckSyncConfig } from "../lib/deckSync.js";

/** /api/decks（作成・編集・削除・自分の一覧）。閲覧は /api/public/decks/:slug */
export const deckRoutes = new Hono<AppEnv>();
deckRoutes.use("*", requireAuth);
deckRoutes.post("/import", postDeckImport);
/** AI エージェント用の一時トークン（docs/agent-deck-token.md）。/:id より先に登録する */
deckRoutes.route("/agent-tokens", deckAgentTokenRoutes);

/** スライド画像アップロード（owner） */
deckRoutes.put("/:id/images", putDeckImage);

deckRoutes.get("/mine", async (c) => {
  return c.json({ decks: await decksRepo.listByOwner(c.get("user").id) });
});

/** 自分が編集できるチームのスライド（いまメンバーのチームのもの。docs/team-participation.md） */
deckRoutes.get("/team", async (c) => {
  return c.json({ decks: await decksRepo.listTeamDecks(c.get("user").id) });
});

deckRoutes.post("/", zValidator("json", createDeckInput), async (c) => {
  const deck = await decksRepo.create(
    valid<CreateDeckInput>(c, "json"),
    c.get("user").id,
  );
  return c.json(deck, 201);
});

/** 編集用の取得。個人のデッキは持ち主、チームのスライドはそのチームのいまのメンバーだけ。
 * チームのスライドのメンバーには同時編集の設定 `sync` を付ける（docs/team-deck-live-sync.md §4.1。
 * 機能オフ・サービス鍵なし・個人のデッキでは null） */
deckRoutes.get("/:id", async (c) => {
  const rev = Date.now();
  const user = c.get("user");
  const found = await decksRepo.findForEdit(c.req.param("id"), user.id);
  if (found.status === "not_found") return c.json({ error: "not_found" }, 404);
  if (found.status === "forbidden") return c.json({ error: "forbidden" }, 403);
  if (found.status === "agent_writing") return c.json({ error: "agent_writing", agent: found.lock }, 423);
  const deck = found.deck;
  const key = deck.team && (await deckLiveSyncEnabled()) ? await decksRepo.syncKeyForEdit(deck.id, user.id) : null;
  const sync = key
    ? await deckSyncConfig(deck.id, key, { userId: user.id, name: user.globalName ?? user.username }, rev)
    : null;
  return c.json({ ...deck, sync });
});

/** 保存。baseRevision を添えると、その間にほかの人が保存していたら 409 deck_conflict
 * （誰がいつ保存したかを返す。編集画面はそこで自動保存を止めて、読み込み直すかを聞く） */
deckRoutes.patch("/:id", zValidator("json", updateDeckInput), async (c) => {
  const result = await decksRepo.updateAsEditor(
    c.req.param("id"),
    c.get("user").id,
    valid<UpdateDeckInput>(c, "json"),
  );
  if (result.status === "not_found") return c.json({ error: "not_found" }, 404);
  if (result.status === "forbidden") return c.json({ error: "forbidden" }, 403);
  if (result.status === "agent_writing") return c.json({ error: "agent_writing", agent: result.lock }, 423);
  // 今の同期の世代（§4.4）。自分の世代より新しければ、編集画面は GET を1回取り直す
  const syncVersion = result.deck.team ? await decksRepo.syncVersion(result.deck.id) : null;
  if (result.status === "conflict") {
    return c.json({
      error: "deck_conflict",
      revision: result.deck.revision,
      updatedAt: result.deck.updatedAt,
      lastSavedBy: result.deck.lastSavedBy ?? null,
      syncVersion,
    }, 409);
  }
  return c.json({ ...result.deck, syncVersion });
});

/** 個人のデッキを持ち主が消す。チームのスライドはメンバーからは消せない
 * （1人がチームの作業を消してしまわないように） */
deckRoutes.delete("/:id", async (c) => {
  const deck = await decksRepo.findById(c.req.param("id"));
  if (!deck) return c.json({ error: "not_found" }, 404);
  if (deck.ownerId !== c.get("user").id) return c.json({ error: "forbidden" }, 403);
  // 配信中のデッキなら、消すと配信状態から外れる（FK）。開いている配信画面へ知らせる
  const liveEvents = await eventLiveStateRepo.eventIdsUsing("deck_id", deck.id);
  if (!(await decksRepo.deletePersonal(deck.id, deck.ownerId))) return c.json({ error: "team_deck_delete" }, 409);
  if (liveEvents.length > 0) await publishLive(liveEvents);
  return c.json({ ok: true });
});
