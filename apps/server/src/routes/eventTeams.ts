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
import { eventSignal } from "../lib/eventSignal.js";
import { deferBackground } from "../runtime.js";

/**
 * コンテストのチーム参加 (#9, docs/team-participation.md)。
 *
 * - 運営: チーム参加のオン・オフ、チームの作成・変更・削除、リーダーを立てる、メンバーの割り当て
 * - 参加確定の参加者: 自分でチームを選ぶ・移る・抜ける（採点が始まるまで）
 * - チームの中: リーダーが名前を変える・リーダーを任せる。リーダーのいないチームではメンバーがリーダーになる（採点が始まるまで）
 *
 * チームの一覧は既存の `GET /:id/entries`（eventsPublic.ts）がそのまま返す。
 * 条件の判定（チーム参加か・採点前か・定員・参加確定か）はリポジトリの1バッチの中にある。
 */
export const eventTeamRoutes = new Hono<AppEnv>();

const entries = (eventId: string) => async () => ({ entries: await entriesRepo.listByEvent(eventId) });
/** 一覧が変わったことを、開いている採点・管理画面へ知らせる（集計の合図と同じ topic） */
const changed = (eventId: string) => deferBackground(eventSignal.publishRefetch([["scores", eventId]]));

eventTeamRoutes.put("/:id/team-mode", requireEventRole(["staff"]), zValidator("json", setTeamModeInput), async (c) => {
  const eventId = c.req.param("id");
  await teamsRepo.setTeamMode(eventId, c.get("user").id, valid<SetTeamModeInput>(c, "json").enabled);
  await changed(eventId);
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
  await changed(eventId);
  return c.json(await entries(eventId)());
});

/** 運営がメンバーを入れる・移す・未所属に戻す（teamId=null） */
const assignInput = z.object({ teamId: z.string().min(1).nullable() }).strict();
eventTeamRoutes.put("/:id/team-members/:userId", requireEventRole(["staff"]), zValidator("json", assignInput), async (c) => {
  const eventId = c.req.param("id");
  const { teamId } = valid<z.infer<typeof assignInput>>(c, "json");
  await teamsRepo.assign(eventId, teamId, c.req.param("userId"), c.get("user").id);
  await changed(eventId);
  return c.json(await entries(eventId)());
});

/** 参加者が自分でチームに入る・移る */
eventTeamRoutes.post("/:id/teams/:teamId/join", requireEventRole(["participant"]), async (c) => {
  const eventId = c.req.param("id");
  await teamsRepo.join(eventId, c.req.param("teamId"), c.get("user").id);
  await changed(eventId);
  return c.json(await entries(eventId)());
});

/** 参加者が自分のチームを抜ける */
eventTeamRoutes.delete("/:id/my-team", requireEventRole(["participant"]), async (c) => {
  const eventId = c.req.param("id");
  await teamsRepo.leave(eventId, c.get("user").id);
  await changed(eventId);
  return c.json(await entries(eventId)());
});

/** リーダーが自分のチームの名前・ひとことを変える */
eventTeamRoutes.patch("/:id/my-team", requireEventRole(["participant"]), zValidator("json", updateMyTeamInput), async (c) => {
  const eventId = c.req.param("id");
  await teamsRepo.updateMyTeam(eventId, c.get("user").id, valid<UpdateMyTeamInput>(c, "json"));
  await changed(eventId);
  return c.json(await entries(eventId)());
});

/** リーダーが同じチームのメンバーにリーダーを任せる */
eventTeamRoutes.put("/:id/my-team/leader", requireEventRole(["participant"]), zValidator("json", handOverTeamLeaderInput), async (c) => {
  const eventId = c.req.param("id");
  await teamsRepo.handOverLeader(eventId, c.get("user").id, valid<HandOverTeamLeaderInput>(c, "json").userId);
  await changed(eventId);
  return c.json(await entries(eventId)());
});

/** リーダーのいないチームで、メンバーが自分でリーダーになる */
eventTeamRoutes.post("/:id/my-team/leader", requireEventRole(["participant"]), async (c) => {
  const eventId = c.req.param("id");
  await teamsRepo.becomeLeader(eventId, c.get("user").id);
  await changed(eventId);
  return c.json(await entries(eventId)());
});
