import { Hono } from "hono";
import { valid, zValidator } from "../lib/validator.js";
import {
  TEAM_DEFAULT_NAME_PREFIX,
  createTeamInput,
  handOverTeamLeaderInput,
  setTeamLeaderInput,
  setTeamModeInput,
  updateMyTeamInput,
  updateTeamInput,
} from "@eventer/shared";
import type {
  CreateTeamInput,
  HandOverTeamLeaderInput,
  SetTeamLeaderInput,
  SetTeamModeInput,
  UpdateMyTeamInput,
  UpdateTeamInput,
} from "@eventer/shared";
import { resolveLanguage } from "@eventer/shared/i18n";
import { z } from "zod";
import type { AppEnv } from "../types.js";
import { requireEventRole } from "../auth/roles.js";
import { entriesRepo } from "../db/repositories/entries.js";
import { teamsRepo } from "../db/repositories/teams.js";
import { canManageEventAs } from "../auth/roles.js";
import { env } from "../runtime.js";
import { eventSignal } from "../lib/eventSignal.js";
import { deferBackground } from "../runtime.js";
import { publishDeckSync } from "../lib/deckSync.js";
import { deckAgentTokensRepo } from "../db/repositories/deckAgentTokens.js";
import { deckAgentSpecUrl, hashDeckAgentToken, newDeckAgentToken } from "./deckAgent.js";

/**
 * コンテストのチーム参加 (#9, docs/team-participation.md)。
 *
 * - 運営: チーム参加のオン・オフ、チームの作成・変更・削除、リーダーを立てる、メンバーの割り当て
 * - 参加確定の参加者と運営: 自分でチームを選ぶ・移る・抜ける（採点が始まるまで。運営もチームで参加できる）
 * - チームの中: リーダーが名前を変える・リーダーを任せる。リーダーのいないチームではメンバーがリーダーになる（採点が始まるまで）
 *
 * チームの一覧は既存の `GET /:id/entries`（eventsPublic.ts）がそのまま返す。
 * 条件の判定（チーム参加か・採点前か・定員・参加確定か）はリポジトリの1バッチの中にある。
 */
export const eventTeamRoutes = new Hono<AppEnv>();

const entries = (eventId: string) => async () => ({ entries: await entriesRepo.listByEvent(eventId) });
/** 一覧が変わったことを、開いている採点・管理画面へ知らせる（集計の合図と同じ topic） */
const changed = (eventId: string) => deferBackground(eventSignal.publishRefetch([["scores", eventId]]));
/** メンバーが変わりうる操作のあと: 上に加えて、チームのスライドの同時編集へ世代の切り替えを知らせる
 * (docs/team-deck-live-sync.md §4.4。機能オフなら何もしない) */
const membersChanged = async (eventId: string) => {
  await changed(eventId);
  await deferBackground(publishDeckSync(eventId));
};

eventTeamRoutes.put("/:id/team-mode", requireEventRole(["staff"]), zValidator("json", setTeamModeInput), async (c) => {
  const eventId = c.req.param("id");
  await teamsRepo.setTeamMode(eventId, c.get("user").id, valid<SetTeamModeInput>(c, "json").enabled);
  await membersChanged(eventId);
  return c.json(await entries(eventId)());
});

eventTeamRoutes.post("/:id/teams", requireEventRole(["staff"]), zValidator("json", createTeamInput), async (c) => {
  const eventId = c.req.param("id");
  // 名前が空欄のときの「チーム1」/「Team 1」は、運営の画面の言語（?lang=）で決める
  const accepted = (c.req.header("accept-language") ?? "").split(",").map((part) => part.split(";")[0]?.trim());
  const prefix = TEAM_DEFAULT_NAME_PREFIX[resolveLanguage([c.req.query("lang"), ...accepted])];
  const id = await teamsRepo.create(eventId, c.get("user").id, valid<CreateTeamInput>(c, "json"), prefix);
  await changed(eventId);
  return c.json({ id, ...(await entries(eventId)()) }, 201);
});

eventTeamRoutes.patch("/:id/teams/:teamId", requireEventRole(["staff"]), zValidator("json", updateTeamInput), async (c) => {
  const eventId = c.req.param("id");
  await teamsRepo.update(eventId, c.req.param("teamId"), c.get("user").id, valid<UpdateTeamInput>(c, "json"));
  await changed(eventId);
  return c.json(await entries(eventId)());
});

eventTeamRoutes.delete("/:id/teams/:teamId", requireEventRole(["staff"]), async (c) => {
  const eventId = c.req.param("id");
  await teamsRepo.remove(eventId, c.req.param("teamId"), c.get("user").id);
  await changed(eventId);
  return c.json(await entries(eventId)());
});

eventTeamRoutes.put("/:id/teams/:teamId/leader", requireEventRole(["staff"]), zValidator("json", setTeamLeaderInput), async (c) => {
  const eventId = c.req.param("id");
  await teamsRepo.setLeader(eventId, c.req.param("teamId"), valid<SetTeamLeaderInput>(c, "json").userId, c.get("user").id);
  await membersChanged(eventId);
  return c.json(await entries(eventId)());
});

/** 運営がメンバーを入れる・移す・未所属に戻す（teamId=null） */
const assignInput = z.object({ teamId: z.string().min(1).nullable() }).strict();
eventTeamRoutes.put("/:id/team-members/:userId", requireEventRole(["staff"]), zValidator("json", assignInput), async (c) => {
  const eventId = c.req.param("id");
  const { teamId } = valid<z.infer<typeof assignInput>>(c, "json");
  await teamsRepo.assign(eventId, teamId, c.req.param("userId"), c.get("user").id);
  await membersChanged(eventId);
  return c.json(await entries(eventId)());
});

/** 参加者が自分でチームに入る・移る */
eventTeamRoutes.post("/:id/teams/:teamId/join", requireEventRole(["participant", "staff"]), async (c) => {
  const eventId = c.req.param("id");
  await teamsRepo.join(eventId, c.req.param("teamId"), c.get("user").id);
  await membersChanged(eventId);
  return c.json(await entries(eventId)());
});

/** 参加者が自分のチームを抜ける */
eventTeamRoutes.delete("/:id/my-team", requireEventRole(["participant", "staff"]), async (c) => {
  const eventId = c.req.param("id");
  await teamsRepo.leave(eventId, c.get("user").id);
  await membersChanged(eventId);
  return c.json(await entries(eventId)());
});

/** リーダーが自分のチームの名前・ひとことを変える */
eventTeamRoutes.patch("/:id/my-team", requireEventRole(["participant", "staff"]), zValidator("json", updateMyTeamInput), async (c) => {
  const eventId = c.req.param("id");
  await teamsRepo.updateMyTeam(eventId, c.get("user").id, valid<UpdateMyTeamInput>(c, "json"));
  await changed(eventId);
  return c.json(await entries(eventId)());
});

/** リーダーが同じチームのメンバーにリーダーを任せる */
eventTeamRoutes.put("/:id/my-team/leader", requireEventRole(["participant", "staff"]), zValidator("json", handOverTeamLeaderInput), async (c) => {
  const eventId = c.req.param("id");
  await teamsRepo.handOverLeader(eventId, c.get("user").id, valid<HandOverTeamLeaderInput>(c, "json").userId);
  await changed(eventId);
  return c.json(await entries(eventId)());
});

/** リーダーのいないチームで、メンバーが自分でリーダーになる */
eventTeamRoutes.post("/:id/my-team/leader", requireEventRole(["participant", "staff"]), async (c) => {
  const eventId = c.req.param("id");
  await teamsRepo.becomeLeader(eventId, c.get("user").id);
  await changed(eventId);
  return c.json(await entries(eventId)());
});

/** チームのスライド（docs/team-participation.md「チームのスライド」）。
 * 1チーム1つ。そのチームのメンバーなら誰でも作れて、作った人も含め**いまの**メンバーが編集できる。
 * 作ったとき、チームの成果物のプレゼン資料 URL が空なら、このスライドの公開 URL を入れる */
/** チームのスライドを作る（すでにあれば既存のものを返す）。AI 用トークンの発行からも使う */
async function ensureTeamDeck(eventId: string, teamId: string, userId: string) {
  const team = (await entriesRepo.listByEvent(eventId)).find((e) => e.id === teamId && e.kind === "team");
  const id = crypto.randomUUID();
  const slug = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const content = JSON.stringify({ slides: [{ id: crypto.randomUUID(), background: "#ffffff", elements: [] }] });
  return teamsRepo.createTeamDeck(eventId, teamId, userId, {
    id, slug, title: (team?.name ?? "").slice(0, 120), content,
    viewUrl: `${env.appBaseUrl.replace(/\/+$/, "")}/d/${slug}`,
  });
}

eventTeamRoutes.post("/:id/teams/:teamId/deck", requireEventRole(["participant", "staff"]), async (c) => {
  const eventId = c.req.param("id"), teamId = c.req.param("teamId");
  const result = await ensureTeamDeck(eventId, teamId, c.get("user").id);
  await changed(eventId);
  return c.json({ deckId: result.id, created: result.created, ...(await entries(eventId)()) }, result.created ? 201 : 200);
});

/** チームのスライドを AI に書いてもらう（docs/agent-deck-token.md「チームのスライド」）。
 * そのチームのメンバーなら誰でも発行できる。まだスライドが無ければ先に作る（成果物の URL も入る）。
 * 有効なトークンがある間はメンバーも編集できない。1つのスライドに有効なのは1本だけ（409 agent_busy）。
 * 平文のトークンは応答で1回だけ返す */
eventTeamRoutes.post("/:id/teams/:teamId/deck/agent-token", requireEventRole(["participant", "staff"]), async (c) => {
  c.header("Cache-Control", "no-store");
  // Cookie で書き込む入口なので、個人の発行と同じく同じオリジンからだけ
  if (c.req.header("Origin") !== new URL(c.req.url).origin) return c.json({ error: "forbidden_origin" }, 403);
  const eventId = c.req.param("id"), teamId = c.req.param("teamId"), userId = c.get("user").id;
  // メンバーでない・終わった・チーム参加でないは、ここ（作る経路の主張文）で止まる
  const deck = await ensureTeamDeck(eventId, teamId, userId);
  const token = newDeckAgentToken();
  const now = Date.now();
  const issued = await deckAgentTokensRepo.issueForTeamDeck({
    id: crypto.randomUUID(), ownerId: userId, tokenHash: await hashDeckAgentToken(token), deckId: deck.id, now,
  });
  if (issued === "busy") return c.json({ error: "agent_busy", agent: await agentOf(deck.id, now) }, 409);
  if (issued === "limit") return c.json({ error: "agent_token_daily_limit" }, 429);
  if (issued === "forbidden") return c.json({ error: "forbidden" }, 403);
  // 開いている編集画面へ: 取り直して「AIが書いています」に切り替える
  await changed(eventId);
  await deferBackground(publishDeckSync(eventId));
  const agent = await agentOf(deck.id, now);
  return c.json({ token, specUrl: deckAgentSpecUrl(), deckId: deck.id, expiresAt: agent?.expiresAt ?? now }, 201);
});

/** そのチームのスライドの AI を止める（メンバーなら誰でも。発行した人でなくても）。止めたらまた編集できる */
eventTeamRoutes.delete("/:id/teams/:teamId/deck/agent-token", requireEventRole(["participant", "staff"]), async (c) => {
  if (c.req.header("Origin") !== new URL(c.req.url).origin) return c.json({ error: "forbidden_origin" }, 403);
  const eventId = c.req.param("id"), teamId = c.req.param("teamId");
  const deckId = (await teamsRepo.listTeamDecks(eventId, c.get("user").id, false)).find((d) => d.entryId === teamId)?.deck.id;
  if (!deckId) return c.json({ error: "not_found" }, 404);
  const revoked = await deckAgentTokensRepo.revokeForTeamDeck(deckId, c.get("user").id, Date.now());
  if (revoked === 0) return c.json({ error: "not_found" }, 404);
  await changed(eventId);
  await deferBackground(publishDeckSync(eventId));
  return c.json({ ok: true });
});

async function agentOf(deckId: string, now: number) {
  const row = await deckAgentTokensRepo.activeForTeamDeck(deckId, now);
  return row ? { expiresAt: row.expires_at, issuedBy: row.owner_name !== null ? { id: row.owner_id, name: row.owner_name } : null } : null;
}

/** チームのスライドの一覧。運営は全チームのもの（見るだけ）、参加者は自分のチームのもの */
eventTeamRoutes.get("/:id/team-decks", requireEventRole(["participant", "staff"]), async (c) => {
  const eventId = c.req.param("id");
  const isStaff = await canManageEventAs(eventId, c);
  return c.json({ decks: await teamsRepo.listTeamDecks(eventId, c.get("user").id, isStaff) });
});
