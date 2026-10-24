import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import type { Entry, Event } from "@eventer/shared";

/** コンテストのチーム参加 (#9, docs/team-participation.md) */

const sql = (query: string, ...args: unknown[]) => env.DB.prepare(query).bind(...args);
async function actor() {
  const id = crypto.randomUUID(), session = crypto.randomUUID();
  await sql("INSERT INTO user(id,discord_id,username,created_at) VALUES(?,?,?,?)", id, id, `User-${id.slice(0, 8)}`, Date.now()).run();
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)", session, id, Date.now() + 86400000).run();
  return { id, cookie: `eventer_session=${session}` };
}
type Actor = Awaited<ReturnType<typeof actor>>;
const request = (path: string, user: Actor, method = "GET", body?: unknown) => SELF.fetch(`https://example.com/api/events${path}`, {
  method, headers: { cookie: user.cookie, "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
async function setup(contestMode = true) {
  const host = await actor();
  const created = await request("", host, "POST", { title: "チーム戦", venueType: "online", contestMode, startsAt: Date.now() + 3600000, endsAt: Date.now() + 7200000 });
  expect(created.status).toBe(201);
  const { event } = await created.json() as { event: Event };
  expect((await request(`/${event.id}`, host, "PATCH", { status: "published" })).status).toBe(200);
  return { host, id: event.id };
}
async function list(id: string, user: Actor) {
  const response = await request(`/${id}/entries`, user);
  expect(response.status).toBe(200);
  return (await response.json() as { entries: Entry[] }).entries;
}
async function participant(id: string) {
  const user = await actor();
  expect((await request(`/${id}/join`, user, "POST", {})).status).toBe(201);
  return user;
}
const teamMode = (id: string, user: Actor, enabled: boolean) => request(`/${id}/team-mode`, user, "PUT", { enabled });
async function createTeam(id: string, host: Actor, name: string, capacity: number | null = null) {
  const response = await request(`/${id}/teams`, host, "POST", { name, capacity });
  expect(response.status).toBe(201);
  return (await response.json() as { id: string }).id;
}
const join = (id: string, user: Actor, teamId: string) => request(`/${id}/teams/${teamId}/join`, user, "POST");
const leave = (id: string, user: Actor) => request(`/${id}/my-team`, user, "DELETE");
const setLeader = (id: string, host: Actor, teamId: string, userId: string | null) => request(`/${id}/teams/${teamId}/leader`, host, "PUT", { userId });
const team = async (id: string, user: Actor, teamId: string) => (await list(id, user)).find((e) => e.id === teamId)!;
async function criterion(id: string, host: Actor) {
  const response = await request(`/${id}/criteria`, host, "POST", { name: "完成度" });
  expect(response.status).toBe(201);
  return (await response.json() as { criterion: { id: string } }).criterion.id;
}
const error = async (response: Response) => (await response.json() as { error: string }).error;

it("運営がチームを作ってリーダーを立て、参加者は好きなチームを選び・移り・抜けられる", async () => {
  const { host, id } = await setup();
  const a = await participant(id), b = await participant(id), c = await participant(id);
  // オフのうちは個人エントリー3つ。チーム参加をオンにすると一覧から消え、チームだけになる
  expect((await list(id, host)).map((e) => e.kind)).toEqual(["individual", "individual", "individual"]);
  expect((await teamMode(id, host, true)).status).toBe(200);
  expect(await list(id, host)).toEqual([]);
  const red = await createTeam(id, host, "赤チーム"), blue = await createTeam(id, host, "青チーム");

  // リーダーを立てると自動でそのチームのメンバーになる
  expect((await setLeader(id, host, red, a.id)).status).toBe(200);
  expect(await team(id, host, red)).toMatchObject({ kind: "team", name: "赤チーム", leaderUserId: a.id, memberUserIds: [a.id] });

  expect((await join(id, b, red)).status).toBe(200);
  expect((await join(id, c, blue)).status).toBe(200);
  expect((await team(id, b, red)).memberUserIds.sort()).toEqual([a.id, b.id].sort());
  // 移る: 元のチームからは外れる
  expect((await join(id, b, blue)).status).toBe(200);
  expect((await team(id, b, red)).memberUserIds).toEqual([a.id]);
  expect((await team(id, b, blue)).memberUserIds.sort()).toEqual([b.id, c.id].sort());
  // リーダーが自分で抜けるとリーダーも外れる（運営が立て直す）
  expect((await leave(id, a)).status).toBe(200);
  expect(await team(id, host, red)).toMatchObject({ memberUserIds: [], leaderUserId: null });
  // 個人エントリーは消えていない（オフに戻せば元どおり）
  expect((await sql("SELECT COUNT(*) n FROM entry WHERE event_id=? AND kind='individual'", id).first())!.n).toBe(3);
});

it("定員いっぱいのチームには入れない。リーダーの割り当ても定員を守る", async () => {
  const { host, id } = await setup();
  const a = await participant(id), b = await participant(id), c = await participant(id);
  expect((await teamMode(id, host, true)).status).toBe(200);
  const small = await createTeam(id, host, "2人チーム", 2);
  expect((await join(id, a, small)).status).toBe(200);
  expect((await join(id, b, small)).status).toBe(200);
  const full = await join(id, c, small);
  expect(full.status).toBe(409);
  expect(await error(full)).toBe("team_full");
  expect((await setLeader(id, host, small, c.id)).status).toBe(409);
  // すでにいる人がもう一度押しても、定員に数え直さない
  expect((await join(id, a, small)).status).toBe(200);
  // メンバーより少ない定員には下げられない
  expect(await error(await request(`/${id}/teams/${small}`, host, "PATCH", { capacity: 1 }))).toBe("capacity_below_members");
});

it("参加者はチームの作成・変更・削除・リーダー指定・割り当てができない（403）。参加確定でない人は入れない", async () => {
  const { host, id } = await setup();
  const a = await participant(id), outsider = await actor();
  expect((await teamMode(id, host, true)).status).toBe(200);
  const red = await createTeam(id, host, "赤");
  expect((await teamMode(id, a, false)).status).toBe(403);
  expect((await request(`/${id}/teams`, a, "POST", { name: "勝手" })).status).toBe(403);
  expect((await request(`/${id}/teams/${red}`, a, "PATCH", { name: "改名" })).status).toBe(403);
  expect((await request(`/${id}/teams/${red}`, a, "DELETE")).status).toBe(403);
  expect((await setLeader(id, a, red, a.id)).status).toBe(403);
  expect((await request(`/${id}/team-members/${a.id}`, a, "PUT", { teamId: red })).status).toBe(403);
  expect((await join(id, outsider, red)).status).toBe(403);
  // 運営本人は参加者ではないのでチームに入らない
  expect((await join(id, host, red)).status).toBe(403);
  expect(await error(await setLeader(id, host, red, host.id))).toBe("not_participant");
});

it("採点が始まったら参加者は動けない。運営はいつでも動かせる。自分のチームは採点できない", async () => {
  const { host, id } = await setup();
  const a = await participant(id), b = await participant(id), judge = await participant(id);
  expect((await teamMode(id, host, true)).status).toBe(200);
  const red = await createTeam(id, host, "赤"), blue = await createTeam(id, host, "青");
  expect((await join(id, a, red)).status).toBe(200);
  expect((await join(id, b, blue)).status).toBe(200);
  expect((await join(id, judge, blue)).status).toBe(200);
  const criterionId = await criterion(id, host);
  // 自分のチームは採点できない（採点者がメンバーに含まれる）
  expect(await error(await request(`/${id}/scores`, b, "PUT", { entryId: blue, criterionId, value: 5 }))).toBe("self_scoring_forbidden");
  expect((await request(`/${id}/scores`, judge, "PUT", { entryId: red, criterionId, value: 4 })).status).toBe(200);
  // 使っていない種類（個人エントリー）は採点対象にならない
  const individual = (await sql("SELECT id FROM entry WHERE event_id=? AND kind='individual' LIMIT 1", id).first())!.id as string;
  expect(await error(await request(`/${id}/scores`, judge, "PUT", { entryId: individual, criterionId, value: 3 }))).toBe("entry_not_found");
  // 点が入ったら参加者は移れない・抜けられない
  expect(await error(await join(id, a, blue))).toBe("team_locked");
  expect(await error(await leave(id, a))).toBe("team_locked");
  // 運営は動かせる
  expect((await request(`/${id}/team-members/${a.id}`, host, "PUT", { teamId: blue })).status).toBe(200);
  expect((await team(id, host, blue)).memberUserIds).toContain(a.id);
  expect((await request(`/${id}/team-members/${a.id}`, host, "PUT", { teamId: null })).status).toBe(200);
  expect((await team(id, host, blue)).memberUserIds).not.toContain(a.id);
  // 集計はチーム単位
  const summary = await request(`/${id}/scores/summary`, host);
  expect(((await summary.json()) as { entries: Array<{ entryId: string; total: number }> }).entries.map((e) => e.entryId).sort()).toEqual([red, blue].sort());
  // 締切後も参加者は動けない
  await sql("DELETE FROM score WHERE event_id=?", id).run();
  expect((await request(`/${id}/state/scoring-lock`, host, "POST")).status).toBe(200);
  expect(await error(await join(id, a, red))).toBe("team_locked");
});

it("成果物はチームのメンバーなら誰でも提出・編集でき、メンバー以外はできない", async () => {
  const { host, id } = await setup();
  const a = await participant(id), b = await participant(id), other = await participant(id);
  expect((await teamMode(id, host, true)).status).toBe(200);
  const red = await createTeam(id, host, "赤");
  expect((await setLeader(id, host, red, a.id)).status).toBe(200);
  expect((await join(id, b, red)).status).toBe(200);
  const put = (user: Actor, url: string) => request(`/${id}/entries/${red}/submission`, user, "PUT", { presentationUrl: url, sourceCodeUrl: "" });
  expect((await put(a, "https://example.com/v1")).status).toBe(200);
  expect((await put(b, "https://example.com/v2")).status).toBe(200);
  expect((await team(id, host, red)).submission).toMatchObject({ presentationUrl: "https://example.com/v2" });
  expect((await put(other, "https://example.com/x")).status).toBe(403);
  // 使っていない種類（自分の個人エントリー）には提出できない
  const own = (await sql(`SELECT en.id FROM entry en JOIN entry_member em ON em.entry_id=en.id
    WHERE en.event_id=? AND en.kind='individual' AND em.user_id=?`, id, other.id).first())!.id as string;
  expect((await request(`/${id}/entries/${own}/submission`, other, "PUT", { presentationUrl: "https://example.com/solo" })).status).toBe(404);
});

it("チーム参加の切り替えは、点数・成果物・受賞がひとつでもあると止まる。非コンテストでは使えない", async () => {
  const { host, id } = await setup();
  const a = await participant(id);
  const solo = (await list(id, host))[0];
  expect((await request(`/${id}/entries/${solo.id}/submission`, a, "PUT", { presentationUrl: "https://example.com/solo" })).status).toBe(200);
  expect(await error(await teamMode(id, host, true))).toBe("team_mode_locked");
  await sql("DELETE FROM submission WHERE entry_id=?", solo.id).run();
  expect((await teamMode(id, host, true)).status).toBe(200);
  // オフに戻すと個人エントリーが元どおり出てくる
  expect((await teamMode(id, host, false)).status).toBe(200);
  expect((await list(id, host)).map((e) => e.id)).toEqual([solo.id]);
  // チーム参加がオフのうちはチームを作れない
  expect(await error(await request(`/${id}/teams`, host, "POST", { name: "赤" }))).toBe("team_mode_off");
  const ordinary = await setup(false);
  expect(await error(await teamMode(ordinary.id, ordinary.host, true))).toBe("team_mode_off");
});

it("空のチームだけ削除できる", async () => {
  const { host, id } = await setup();
  const a = await participant(id);
  expect((await teamMode(id, host, true)).status).toBe(200);
  const red = await createTeam(id, host, "赤"), blue = await createTeam(id, host, "青");
  expect((await join(id, a, red)).status).toBe(200);
  expect(await error(await request(`/${id}/teams/${red}`, host, "DELETE"))).toBe("team_not_empty");
  expect((await request(`/${id}/teams/${blue}`, host, "DELETE")).status).toBe(200);
  expect((await list(id, host)).map((e) => e.id)).toEqual([red]);
  // 他のイベントのチームは触れない
  const other = await setup();
  expect((await teamMode(other.id, other.host, true)).status).toBe(200);
  expect((await request(`/${other.id}/teams/${red}`, other.host, "DELETE")).status).toBe(404);
});

it("参加取消・運営への変更でチームから外れ、リーダーも外れる。参加し直しても勝手には戻らない", async () => {
  const { host, id } = await setup();
  const a = await participant(id), b = await participant(id);
  expect((await teamMode(id, host, true)).status).toBe(200);
  const red = await createTeam(id, host, "赤");
  expect((await setLeader(id, host, red, a.id)).status).toBe(200);
  expect((await join(id, b, red)).status).toBe(200);
  expect((await request(`/${id}/join`, a, "DELETE")).status).toBe(200);
  expect(await team(id, host, red)).toMatchObject({ memberUserIds: [b.id], leaderUserId: null });
  expect((await request(`/${id}/members/${b.id}/role`, host, "PATCH", { role: "staff" })).status).toBe(200);
  expect((await team(id, host, red)).memberUserIds).toEqual([]);
  expect((await request(`/${id}/join`, a, "POST", {})).status).toBe(201);
  expect((await team(id, host, red)).memberUserIds).toEqual([]);
});

// 統合では負け側の event_member が重複として消え、トリガー（event_member_leave_team_on_delete）で
// 負け側のチーム所属も外れる。統合側に専用の文は要らない
it("アカウント統合で両方が別のチームにいれば、勝ち側の所属を残す", async () => {
  const { host, id } = await setup();
  const winner = await participant(id), loser = await participant(id);
  expect((await teamMode(id, host, true)).status).toBe(200);
  const red = await createTeam(id, host, "赤"), blue = await createTeam(id, host, "青");
  expect((await join(id, winner, red)).status).toBe(200);
  expect((await join(id, loser, blue)).status).toBe(200);
  const { accountMergeRepo } = await import("../src/db/repositories/accountMerge.js");
  const { bindEnv } = await import("../src/runtime.js");
  bindEnv(env as never);
  await accountMergeRepo.mergeUsers(winner.id, loser.id);
  const rows = (await sql(`SELECT em.entry_id FROM entry_member em JOIN entry en ON en.id=em.entry_id
    WHERE en.event_id=? AND en.kind='team' AND em.user_id=?`, id, winner.id).all()).results;
  expect(rows).toEqual([{ entry_id: red }]);
});

it("個人参加のコンテストは今までどおり（チームの操作は team_mode_off）", async () => {
  const { host, id } = await setup();
  const a = await participant(id), b = await participant(id);
  const entries = await list(id, host);
  expect(entries.map((e) => [e.kind, e.leaderUserId, e.capacity, e.description])).toEqual([
    ["individual", null, null, ""], ["individual", null, null, ""],
  ]);
  const criterionId = await criterion(id, host);
  const bEntry = entries.find((e) => e.memberUserIds.includes(b.id))!;
  expect((await request(`/${id}/scores`, a, "PUT", { entryId: bEntry.id, criterionId, value: 4 })).status).toBe(200);
  expect(await error(await request(`/${id}/scores`, b, "PUT", { entryId: bEntry.id, criterionId, value: 4 }))).toBe("self_scoring_forbidden");
  expect(await error(await join(id, a, bEntry.id))).toBe("team_mode_off");
});

const renameMine = (id: string, user: Actor, body: unknown) => request(`/${id}/my-team`, user, "PATCH", body);
const handOver = (id: string, user: Actor, userId: string) => request(`/${id}/my-team/leader`, user, "PUT", { userId });
const becomeLeader = (id: string, user: Actor) => request(`/${id}/my-team/leader`, user, "POST");

it("名前を空欄で作ると「チーム1」「チーム2」…。使われている番号は飛ばす。英語の画面なら Team 1", async () => {
  const { host, id } = await setup();
  expect((await teamMode(id, host, true)).status).toBe(200);
  const first = await createTeam(id, host, "");
  expect((await team(id, host, first)).name).toBe("チーム1");
  // 名前を変えたチームの番号は空く。手で付けた「チーム3」は使われているので飛ばす
  await createTeam(id, host, "チーム3");
  const second = (await (await request(`/${id}/teams`, host, "POST", {})).json() as { id: string }).id;
  expect((await team(id, host, second)).name).toBe("チーム2");
  const third = await createTeam(id, host, "  ");
  expect((await team(id, host, third)).name).toBe("チーム4");
  const english = await request(`/${id}/teams?lang=en`, host, "POST", {});
  expect(english.status).toBe(201);
  expect((await team(id, host, (await english.json() as { id: string }).id)).name).toBe("Team 1");
});

it("リーダーは自分のチームの名前・ひとことを変えられる。メンバー・ほかのチームの人・参加者以外は変えられない", async () => {
  const { host, id } = await setup();
  const lead = await participant(id), member = await participant(id), other = await participant(id), outsider = await actor();
  expect((await teamMode(id, host, true)).status).toBe(200);
  const red = await createTeam(id, host, ""), blue = await createTeam(id, host, "");
  expect((await setLeader(id, host, red, lead.id)).status).toBe(200);
  expect((await join(id, member, red)).status).toBe(200);
  expect((await setLeader(id, host, blue, other.id)).status).toBe(200);

  expect((await renameMine(id, lead, { name: "ねこチーム", description: "UI担当" })).status).toBe(200);
  expect(await team(id, host, red)).toMatchObject({ name: "ねこチーム", description: "UI担当" });
  // ほかのチームは変わらない
  expect((await team(id, host, blue)).name).toBe("チーム2");
  const byMember = await renameMine(id, member, { name: "乗っ取り" });
  expect(byMember.status).toBe(403);
  expect(await error(byMember)).toBe("not_team_leader");
  expect((await renameMine(id, outsider, { name: "外" })).status).toBe(403);
  // 空の名前にはできない
  expect((await renameMine(id, lead, { name: " " })).status).toBe(400);
  expect((await team(id, host, red)).name).toBe("ねこチーム");
});

it("リーダーは同じチームのメンバーにだけリーダーを任せられる。メンバーは任せられない", async () => {
  const { host, id } = await setup();
  const lead = await participant(id), member = await participant(id), other = await participant(id);
  expect((await teamMode(id, host, true)).status).toBe(200);
  const red = await createTeam(id, host, "赤"), blue = await createTeam(id, host, "青");
  expect((await setLeader(id, host, red, lead.id)).status).toBe(200);
  expect((await join(id, member, red)).status).toBe(200);
  expect((await join(id, other, blue)).status).toBe(200);

  expect(await error(await handOver(id, lead, other.id))).toBe("not_team_member");
  expect((await team(id, host, red)).leaderUserId).toBe(lead.id);
  expect(await error(await handOver(id, member, member.id))).toBe("not_team_leader");

  expect((await setLeader(id, host, blue, other.id)).status).toBe(200);
  expect((await handOver(id, lead, member.id)).status).toBe(200);
  expect(await team(id, host, red)).toMatchObject({ leaderUserId: member.id });
  // ほかのチームのリーダーには影響しない
  expect((await team(id, host, blue)).leaderUserId).toBe(other.id);
  expect((await team(id, host, red)).memberUserIds.sort()).toEqual([lead.id, member.id].sort());
  // 元のリーダーはもう名前を変えられず、新しいリーダーは変えられる
  expect(await error(await renameMine(id, lead, { name: "元" }))).toBe("not_team_leader");
  expect((await renameMine(id, member, { name: "新" })).status).toBe(200);
  // 1チームにリーダーは1人
  expect((await sql("SELECT COUNT(*) n FROM entry_member WHERE entry_id=? AND is_leader=1", red).first())!.n).toBe(1);
});

it("リーダーのいないチームでは、メンバーがリーダーになれる。リーダーがいれば取れない。ほかのチームの人はなれない", async () => {
  const { host, id } = await setup();
  const a = await participant(id), b = await participant(id), c = await participant(id), loner = await participant(id);
  expect((await teamMode(id, host, true)).status).toBe(200);
  const red = await createTeam(id, host, "赤"), blue = await createTeam(id, host, "青");
  expect((await join(id, a, red)).status).toBe(200);
  expect((await join(id, b, red)).status).toBe(200);
  expect((await join(id, c, blue)).status).toBe(200);
  // チームに入っていない人はなれない
  expect(await error(await becomeLeader(id, loner))).toBe("not_team_member");

  expect((await setLeader(id, host, blue, c.id)).status).toBe(200);
  expect((await becomeLeader(id, a)).status).toBe(200);
  expect((await team(id, host, red)).leaderUserId).toBe(a.id);
  // ほかのチームのリーダーには影響しない
  expect((await team(id, host, blue)).leaderUserId).toBe(c.id);
  expect(await error(await becomeLeader(id, b))).toBe("team_has_leader");
  expect((await team(id, host, red)).leaderUserId).toBe(a.id);
  // リーダーが抜けると空き、残ったメンバーがなれる
  expect((await leave(id, a)).status).toBe(200);
  expect((await becomeLeader(id, b)).status).toBe(200);
  expect((await team(id, host, red)).leaderUserId).toBe(b.id);
  // 運営はいつでもリーダーを変えられる
  expect((await setLeader(id, host, red, c.id)).status).toBe(200);
  expect((await team(id, host, red)).leaderUserId).toBe(c.id);
});

it("採点が始まったら、チームの中の操作（名前・任せる・なる）はできない。運営はいつでも変えられる", async () => {
  const { host, id } = await setup();
  const lead = await participant(id), member = await participant(id), judge = await participant(id);
  expect((await teamMode(id, host, true)).status).toBe(200);
  const red = await createTeam(id, host, "赤"), blue = await createTeam(id, host, "青");
  expect((await setLeader(id, host, red, lead.id)).status).toBe(200);
  expect((await join(id, member, red)).status).toBe(200);
  expect((await join(id, judge, blue)).status).toBe(200);
  const criterionId = await criterion(id, host);
  expect((await request(`/${id}/scores`, judge, "PUT", { entryId: red, criterionId, value: 4 })).status).toBe(200);

  expect(await error(await renameMine(id, lead, { name: "後から" }))).toBe("team_locked");
  expect(await error(await handOver(id, lead, member.id))).toBe("team_locked");
  expect(await error(await becomeLeader(id, judge))).toBe("team_locked");
  expect(await team(id, host, red)).toMatchObject({ name: "赤", leaderUserId: lead.id });
  // 運営は変えられる
  expect((await request(`/${id}/teams/${red}`, host, "PATCH", { name: "運営が直した" })).status).toBe(200);
  expect((await team(id, host, red)).name).toBe("運営が直した");
});

it("チーム参加がオフのイベントでは、チームの中の操作は team_mode_off", async () => {
  const { host, id } = await setup();
  const lead = await participant(id);
  expect((await teamMode(id, host, true)).status).toBe(200);
  const red = await createTeam(id, host, "赤");
  expect((await setLeader(id, host, red, lead.id)).status).toBe(200);
  expect((await teamMode(id, host, false)).status).toBe(200);
  expect(await error(await renameMine(id, lead, { name: "x" }))).toBe("team_mode_off");
  expect(await error(await becomeLeader(id, lead))).toBe("team_mode_off");
});
