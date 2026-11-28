import { Hono } from "hono";
import { createDeckInput, setDeckProfileInput, setProfileDeckAutoInput, updateDeckInput } from "@eventer/shared";
import type { CreateDeckInput, SetDeckProfileInput, SetProfileDeckAutoInput, UpdateDeckInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { valid, zValidator } from "../lib/validator.js";
import { decksRepo } from "../db/repositories/decks.js";
import { profileDecksRepo } from "../db/repositories/profileDecks.js";
import { eventLiveStateRepo } from "../db/repositories/eventLiveState.js";
import { publishLive } from "./liveControl.js";
import { putDeckImage } from "./deckImages.js";
import { postDeckImport } from "./deckImport.js";
import { deckAgentSpecUrl, deckAgentTokenRoutes, hashDeckAgentToken, newDeckAgentToken } from "./deckAgent.js";
import { deckAgentTokensRepo } from "../db/repositories/deckAgentTokens.js";
import { deckLiveSyncEnabled, deckSyncConfig } from "../lib/deckSync.js";

/** /api/decks（作成・編集・削除・自分の一覧）。閲覧は /api/public/decks/:slug */
export const deckRoutes = new Hono<AppEnv>();
deckRoutes.use("*", requireAuth);
deckRoutes.post("/import", postDeckImport);
/** AI エージェント用の一時トークン（docs/agent-deck-token.md）。/:id より先に登録する */
deckRoutes.route("/agent-tokens", deckAgentTokenRoutes);

/** スライド画像アップロード（owner） */
deckRoutes.put("/:id/images", putDeckImage);

/** 「スライドをプロフィールに自動で載せる」（docs/slide-editor.md「プロフィールに載せる」）。
 * オンなら、載せないにしたもの以外の、載せられるデッキすべて（これから作るものも）が載る */
deckRoutes.put("/profile-auto", zValidator("json", setProfileDeckAutoInput), async (c) => {
  await profileDecksRepo.setAutoShow(c.get("user").id, valid<SetProfileDeckAutoInput>(c, "json").autoShow);
  return c.json({ ok: true });
});

/** このデッキを自分のプロフィールに載せる／載せない。載せられるのは自分の個人のデッキと、
 * 自分がメンバーのチームのスライド（公開イベントのもの）。それ以外は 403 */
deckRoutes.put("/:id/profile", zValidator("json", setDeckProfileInput), async (c) => {
  const ok = await profileDecksRepo.setShown(c.get("user").id, c.req.param("id"), valid<SetDeckProfileInput>(c, "json").show);
  if (!ok) return c.json({ error: "forbidden" }, 403);
  return c.json({ ok: true });
});

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

/** 作成済みの自分のスライドを AI に直してもらう（docs/agent-deck-token.md §4c。オーナー決定 2026-11-28）。
 * 持ち主の個人のデッキだけ。トークンはこのデッキに結び付き、AI は読む・書き直す・画像を上げるだけができる。
 * 有効な間は持ち主も編集できない（deckEditableSql）。1つのデッキに有効なのは1本だけ（409 agent_busy）。
 * 平文のトークンは応答で1回だけ返す */
deckRoutes.post("/:id/agent-token", async (c) => {
  c.header("Cache-Control", "no-store");
  if (c.req.header("Origin") !== new URL(c.req.url).origin) return c.json({ error: "forbidden_origin" }, 403);
  const deckId = c.req.param("id"), ownerId = c.get("user").id;
  const token = newDeckAgentToken();
  const now = Date.now();
  const issued = await deckAgentTokensRepo.issueForEditDeck({
    id: crypto.randomUUID(), ownerId, tokenHash: await hashDeckAgentToken(token), deckId, now,
  });
  if (issued === "forbidden") {
    // チームのスライドは「チームを選ぶ」のチームの欄から（このルートでは結び付けない）
    const deck = await decksRepo.findById(deckId);
    if (!deck) return c.json({ error: "not_found" }, 404);
    // 他人のデッキは中身の有無を漏らさないよう 404 と同じにする。チームのスライドはチームの欄から発行する
    if (deck.ownerId !== ownerId && !(await decksRepo.isTeamDeck(deckId))) return c.json({ error: "not_found" }, 404);
    return c.json({ error: (await decksRepo.isTeamDeck(deckId)) ? "team_deck_agent_elsewhere" : "forbidden" }, 403);
  }
  if (issued === "busy") {
    const active = await deckAgentTokensRepo.activeForEditDeck(deckId, now);
    return c.json({ error: "agent_busy", agent: active ? { expiresAt: active.expires_at, issuedBy: null, scope: "deck" } : null }, 409);
  }
  if (issued === "limit") return c.json({ error: "agent_token_daily_limit" }, 429);
  const active = await deckAgentTokensRepo.activeForEditDeck(deckId, now);
  return c.json({ token, specUrl: deckAgentSpecUrl(), deckId, expiresAt: active?.expires_at ?? now }, 201);
});

/** 持ち主が、自分のデッキを直している AI を止める。止めたらまた編集できる。AI が書いた中身は残る */
deckRoutes.delete("/:id/agent-token", async (c) => {
  if (c.req.header("Origin") !== new URL(c.req.url).origin) return c.json({ error: "forbidden_origin" }, 403);
  const revoked = await deckAgentTokensRepo.revokeForEditDeck(c.req.param("id"), c.get("user").id, Date.now());
  return revoked > 0 ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

/** 「AIの変更を取り消す」: AI の最初の書き込みの直前の中身に戻す（オーナー決定 2026-11-28「つけて」）。
 * 編集できる人だけ・AI が書いている間はできない（423）。戻す中身が無ければ 404 no_ai_backup */
deckRoutes.post("/:id/undo-ai", async (c) => {
  if (c.req.header("Origin") !== new URL(c.req.url).origin) return c.json({ error: "forbidden_origin" }, 403);
  const result = await decksRepo.undoAi(c.req.param("id"), c.get("user").id);
  if (result.status === "not_found") return c.json({ error: "not_found" }, 404);
  if (result.status === "forbidden") return c.json({ error: "forbidden" }, 403);
  if (result.status === "agent_writing") return c.json({ error: "agent_writing", agent: result.lock }, 423);
  if (result.status === "no_backup") return c.json({ error: "no_ai_backup" }, 404);
  return c.json(result.deck);
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
