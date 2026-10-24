import { HTTPException } from "hono/http-exception";
import type { CreateTeamInput, UpdateMyTeamInput, UpdateTeamInput } from "@eventer/shared";
import { eventWrite } from "./eventWriteGuard.js";
import { many } from "../client.js";

/**
 * コンテストのチーム参加 (#9, docs/team-participation.md)。
 *
 * チーム＝ entry(kind='team')、メンバー＝ entry_member（is_leader がリーダー）。
 * 採点・成果物・表彰・発表順は entry を見るので、チームはそのまま採点対象になる。
 *
 * 書き込みはどれも eventWrite の1バッチで、条件（チーム参加か・採点前か・定員・
 * 参加確定か）をバッチの中の主張文で確かめる。読んでから書くまでの間に状態が
 * 変わっても、主張文が落ちて何も書かれない。
 */

type Statement = { sql: string; args?: unknown[] };

/** バッチ内の主張。偽なら json_extract の不正パスで落とし、`code` で識別する */
const assert = (condition: string, code: string, args: unknown[]): Statement => ({
  sql: `SELECT CASE WHEN ${condition} THEN 1 ELSE json_extract('{}','${code}') END`,
  args,
});

const TEAM_MODE = "EXISTS (SELECT 1 FROM event WHERE id = ? AND contest_mode = 1 AND participation_type = 'team')";
/** 採点の締切（event_state.scoring_locked）前で、まだ誰の点も入っていない。
 * 参加者がチームを選べるのはこの間だけ（運営はいつでも） */
const BEFORE_SCORING = `NOT EXISTS (SELECT 1 FROM event_state WHERE event_id = ? AND scoring_locked = 1)
  AND NOT EXISTS (SELECT 1 FROM score WHERE event_id = ?)`;
const TEAM_OF_EVENT = "EXISTS (SELECT 1 FROM entry WHERE id = ? AND event_id = ? AND kind = 'team')";
const CONFIRMED_PARTICIPANT = `EXISTS (SELECT 1 FROM event_member m JOIN user u ON u.id = m.user_id AND u.deleted_at IS NULL
  WHERE m.event_id = ? AND m.user_id = ? AND m.role = 'participant' AND m.status = 'confirmed')`;
/** 定員に空きがある（本人がすでにそのチームにいる場合は数えない） */
const HAS_ROOM = `(SELECT capacity FROM entry WHERE id = ?) IS NULL
  OR (SELECT COUNT(*) FROM entry_member em JOIN user u ON u.id = em.user_id AND u.deleted_at IS NULL
      WHERE em.entry_id = ? AND em.user_id <> ?) < (SELECT capacity FROM entry WHERE id = ?)`;

/** 本人がいるそのイベントのチーム（いなければ空）。チーム内の操作はこのチームだけを触る */
const MY_TEAM = `SELECT em.entry_id FROM entry_member em JOIN entry en ON en.id = em.entry_id
  WHERE em.user_id = ? AND en.event_id = ? AND en.kind = 'team'`;
/** 本人が自分のチームのリーダー（退会申請中のリーダーは数えない。一覧の leaderUserId と同じ） */
const IS_MY_TEAM_LEADER = `EXISTS (SELECT 1 FROM entry_member em JOIN entry en ON en.id = em.entry_id
  WHERE em.user_id = ? AND em.is_leader = 1 AND en.event_id = ? AND en.kind = 'team')`;
const IN_MY_TEAM = (who: string) => `EXISTS (SELECT 1 FROM entry_member em JOIN user u ON u.id = em.user_id AND u.deleted_at IS NULL
  WHERE em.user_id = ${who} AND em.entry_id IN (${MY_TEAM}))`;
/** 自分のチームにリーダーがいない（退会申請中のリーダーはいないものとして扱う） */
const MY_TEAM_HAS_NO_LEADER = `NOT EXISTS (SELECT 1 FROM entry_member em JOIN user u ON u.id = em.user_id AND u.deleted_at IS NULL
  WHERE em.is_leader = 1 AND em.entry_id IN (${MY_TEAM}))`;

const CODES = [
  "team_mode_off", "team_locked", "team_not_found", "not_participant", "team_full",
  "team_not_empty", "team_mode_locked", "capacity_below_members",
  "not_team_leader", "not_team_member", "team_has_leader",
] as const;
type TeamErrorCode = (typeof CODES)[number];
const STATUS: Record<TeamErrorCode, 403 | 404 | 409> = {
  team_mode_off: 409, team_locked: 409, team_not_found: 404, not_participant: 409, team_full: 409,
  team_not_empty: 409, team_mode_locked: 409, capacity_below_members: 409,
  not_team_leader: 403, not_team_member: 409, team_has_leader: 409,
};

async function teamWrite(eventId: string, actorId: string, permission: "staff" | "registered", statements: Statement[]) {
  try {
    return await eventWrite({ eventId, actorId, permission }, statements);
  } catch (error) {
    const text = `${String(error)} ${String((error as Error)?.cause)}`;
    const code = CODES.find((c) => text.includes(c));
    if (code) throw new HTTPException(STATUS[code], { res: Response.json({ error: code }, { status: STATUS[code] }) });
    throw error;
  }
}

/** 本人をそのイベントのチームから外す文（チームを移る・抜けるの共通部分） */
const leaveTeamsSql = (eventId: string, userId: string): Statement => ({
  sql: `DELETE FROM entry_member WHERE user_id = ?
    AND entry_id IN (SELECT id FROM entry WHERE event_id = ? AND kind = 'team')`,
  args: [userId, eventId],
});

export const teamsRepo = {
  /** チーム参加のオン・オフ（運営）。点数・成果物・受賞がひとつでもあれば切り替えない。
   * 個人エントリーもチームも消さない（見せる種類が変わるだけ） */
  async setTeamMode(eventId: string, actorId: string, enabled: boolean) {
    await teamWrite(eventId, actorId, "staff", [
      assert("EXISTS (SELECT 1 FROM event WHERE id = ? AND contest_mode = 1)", "team_mode_off", [eventId]),
      assert(`NOT EXISTS (SELECT 1 FROM score WHERE event_id = ?)
        AND NOT EXISTS (SELECT 1 FROM submission s JOIN entry en ON en.id = s.entry_id WHERE en.event_id = ?)
        AND NOT EXISTS (SELECT 1 FROM award_result WHERE event_id = ?)`,
      "team_mode_locked", [eventId, eventId, eventId]),
      { sql: "UPDATE event SET participation_type = ? WHERE id = ?", args: [enabled ? "team" : "individual", eventId] },
    ]);
  },

  /** 名前が空欄なら「チーム1」「チーム2」…（使われていない最小の番号）を付ける。
   * 同時に作られて同じ名前になっても壊れない（チーム名は重複してよい。あとで変えられる） */
  async create(eventId: string, actorId: string, input: CreateTeamInput, defaultNamePrefix: string): Promise<string> {
    const id = crypto.randomUUID();
    const name = input.name || await nextDefaultName(eventId, defaultNamePrefix);
    await teamWrite(eventId, actorId, "staff", [
      assert(TEAM_MODE, "team_mode_off", [eventId]),
      { sql: `INSERT INTO entry (id, event_id, kind, name, description, capacity, created_at)
          VALUES (?, ?, 'team', ?, ?, ?, ?)`,
        args: [id, eventId, name, input.description, input.capacity, Date.now()] },
    ]);
    return id;
  },

  async update(eventId: string, teamId: string, actorId: string, input: UpdateTeamInput) {
    await teamWrite(eventId, actorId, "staff", [
      assert(TEAM_OF_EVENT, "team_not_found", [teamId, eventId]),
      ...(input.capacity != null ? [assert(
        "(SELECT COUNT(*) FROM entry_member WHERE entry_id = ?) <= ?", "capacity_below_members", [teamId, input.capacity],
      )] : []),
      { sql: `UPDATE entry SET name = COALESCE(?, name), description = COALESCE(?, description),
          capacity = CASE WHEN ? THEN ? ELSE capacity END WHERE id = ?`,
        args: [input.name ?? null, input.description ?? null, input.capacity !== undefined ? 1 : 0, input.capacity ?? null, teamId] },
    ]);
  },

  /** 空のチームだけ消せる（メンバー・点数・成果物・受賞を巻き込んで消さない） */
  async remove(eventId: string, teamId: string, actorId: string) {
    await teamWrite(eventId, actorId, "staff", [
      assert(TEAM_OF_EVENT, "team_not_found", [teamId, eventId]),
      assert(`NOT EXISTS (SELECT 1 FROM entry_member WHERE entry_id = ?)
        AND NOT EXISTS (SELECT 1 FROM score WHERE entry_id = ?)
        AND NOT EXISTS (SELECT 1 FROM submission WHERE entry_id = ?)
        AND NOT EXISTS (SELECT 1 FROM award_result WHERE entry_id = ?)`,
      "team_not_empty", [teamId, teamId, teamId, teamId]),
      { sql: "DELETE FROM entry WHERE id = ?", args: [teamId] },
    ]);
  },

  /** 参加者が自分でチームに入る・移る。採点が始まったら運営だけが動かせる */
  async join(eventId: string, teamId: string, userId: string) {
    await teamWrite(eventId, userId, "registered", [
      assert(TEAM_MODE, "team_mode_off", [eventId]),
      assert(TEAM_OF_EVENT, "team_not_found", [teamId, eventId]),
      assert(CONFIRMED_PARTICIPANT, "not_participant", [eventId, userId]),
      assert(BEFORE_SCORING, "team_locked", [eventId, eventId]),
      assert(HAS_ROOM, "team_full", [teamId, teamId, userId, teamId]),
      ...this.placeStatements(eventId, teamId, userId),
    ]);
  },

  /** 参加者が自分でチームを抜ける。リーダーだった場合はリーダーも外れる */
  async leave(eventId: string, userId: string) {
    await teamWrite(eventId, userId, "registered", [
      assert(TEAM_MODE, "team_mode_off", [eventId]),
      assert(BEFORE_SCORING, "team_locked", [eventId, eventId]),
      leaveTeamsSql(eventId, userId),
    ]);
  },

  /** 運営がメンバーを入れる・移す（いつでも。定員は守る）。teamId=null で未所属に戻す */
  async assign(eventId: string, teamId: string | null, userId: string, actorId: string) {
    await teamWrite(eventId, actorId, "staff", [
      assert(TEAM_MODE, "team_mode_off", [eventId]),
      ...(teamId ? [
        assert(TEAM_OF_EVENT, "team_not_found", [teamId, eventId]),
        assert(CONFIRMED_PARTICIPANT, "not_participant", [eventId, userId]),
        assert(HAS_ROOM, "team_full", [teamId, teamId, userId, teamId]),
        ...this.placeStatements(eventId, teamId, userId),
      ] : [leaveTeamsSql(eventId, userId)]),
    ]);
  },

  /** 運営がリーダーを立てる。リーダーはそのチームのメンバーになる（他のチームからは移る）。
   * userId=null でリーダーを外す（メンバーには残る） */
  async setLeader(eventId: string, teamId: string, userId: string | null, actorId: string) {
    await teamWrite(eventId, actorId, "staff", [
      assert(TEAM_MODE, "team_mode_off", [eventId]),
      assert(TEAM_OF_EVENT, "team_not_found", [teamId, eventId]),
      ...(userId ? [
        assert(CONFIRMED_PARTICIPANT, "not_participant", [eventId, userId]),
        assert(HAS_ROOM, "team_full", [teamId, teamId, userId, teamId]),
        ...this.placeStatements(eventId, teamId, userId),
      ] : []),
      { sql: "UPDATE entry_member SET is_leader = CASE WHEN user_id = ? THEN 1 ELSE 0 END WHERE entry_id = ?",
        args: [userId, teamId] },
    ]);
  },

  /** リーダーが自分のチームの名前・ひとことを変える（採点が始まるまで。運営はいつでも update で変えられる） */
  async updateMyTeam(eventId: string, userId: string, input: UpdateMyTeamInput) {
    await teamWrite(eventId, userId, "registered", [
      assert(TEAM_MODE, "team_mode_off", [eventId]),
      assert(IS_MY_TEAM_LEADER, "not_team_leader", [userId, eventId]),
      assert(BEFORE_SCORING, "team_locked", [eventId, eventId]),
      { sql: `UPDATE entry SET name = COALESCE(?, name), description = COALESCE(?, description)
          WHERE id IN (${MY_TEAM})`,
        args: [input.name ?? null, input.description ?? null, userId, eventId] },
    ]);
  },

  /** リーダーが同じチームのメンバーにリーダーを任せる（採点が始まるまで） */
  async handOverLeader(eventId: string, userId: string, toUserId: string) {
    await teamWrite(eventId, userId, "registered", [
      assert(TEAM_MODE, "team_mode_off", [eventId]),
      assert(IS_MY_TEAM_LEADER, "not_team_leader", [userId, eventId]),
      assert(IN_MY_TEAM("?"), "not_team_member", [toUserId, userId, eventId]),
      assert(BEFORE_SCORING, "team_locked", [eventId, eventId]),
      { sql: `UPDATE entry_member SET is_leader = CASE WHEN user_id = ? THEN 1 ELSE 0 END
          WHERE entry_id IN (${MY_TEAM})`,
        args: [toUserId, userId, eventId] },
    ]);
  },

  /** リーダーのいないチームで、メンバーが自分でリーダーになる（採点が始まるまで）。
   * リーダーがいるチームでは取れない（任せてもらうか、運営が決める） */
  async becomeLeader(eventId: string, userId: string) {
    await teamWrite(eventId, userId, "registered", [
      assert(TEAM_MODE, "team_mode_off", [eventId]),
      assert(IN_MY_TEAM("?"), "not_team_member", [userId, userId, eventId]),
      assert(MY_TEAM_HAS_NO_LEADER, "team_has_leader", [userId, eventId]),
      assert(BEFORE_SCORING, "team_locked", [eventId, eventId]),
      { sql: `UPDATE entry_member SET is_leader = CASE WHEN user_id = ? THEN 1 ELSE 0 END
          WHERE entry_id IN (${MY_TEAM})`,
        args: [userId, userId, eventId] },
    ]);
  },

  /** 本人をそのチームに置く（すでにいれば何もしない。別のチームにいれば移す） */
  placeStatements(eventId: string, teamId: string, userId: string): Statement[] {
    return [
      { sql: `DELETE FROM entry_member WHERE user_id = ? AND entry_id <> ?
          AND entry_id IN (SELECT id FROM entry WHERE event_id = ? AND kind = 'team')`,
        args: [userId, teamId, eventId] },
      { sql: `INSERT INTO entry_member (id, entry_id, user_id, is_leader) VALUES (?, ?, ?, 0)
          ON CONFLICT(entry_id, user_id) DO NOTHING`,
        args: [crypto.randomUUID(), teamId, userId] },
    ];
  },
};

/** 「チーム1」「チーム2」…のうち、そのイベントで使われていない最小の番号の名前 */
async function nextDefaultName(eventId: string, prefix: string): Promise<string> {
  const rows = await many<{ name: string }>(
    "SELECT name FROM entry WHERE event_id = ? AND kind = 'team'", eventId,
  );
  const used = new Set(rows.map((r) => r.name));
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
