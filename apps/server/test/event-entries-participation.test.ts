import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import type { Entry, Event } from "@eventer/shared";
import { bindEnv } from "../src/runtime.js";
import { entriesRepo } from "../src/db/repositories/entries.js";

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
  const created = await request("", host, "POST", { title: "作品参加", venueType: "online", contestMode, startsAt: Date.now() + 3600000, endsAt: Date.now() + 7200000 });
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
const participate = (id: string, user: Actor, participating: boolean) => request(`/${id}/entries/self/participation`, user, "PUT", { participating });
const member = (id: string, user: Actor) => sql("SELECT * FROM event_member WHERE event_id=? AND user_id=?", id, user.id).first();
async function submit(id: string, user: Actor, entry: Entry) {
  expect((await request(`/${id}/entries/${entry.id}/submission`, user, "PUT", { presentationUrl: "https://example.com/slides", sourceCodeUrl: "https://example.com/source" })).status).toBe(200);
}
async function criterion(id: string, host: Actor) {
  const response = await request(`/${id}/criteria`, host, "POST", { name: "作品の完成度" });
  expect(response.status).toBe(201);
  return (await response.json() as { criterion: { id: string } }).criterion.id;
}

it("主催と運営は自分のEntryだけON/未採点OFFでき、提出URLだけ消えて運営所属は変わらない", async () => {
  const { host, id } = await setup(), staff = await actor();
  await sql("INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,'staff','confirmed',1)", crypto.randomUUID(), id, staff.id).run();
  expect(await list(id, host)).toEqual([]);
  for (const user of [host, staff]) {
    const before = await member(id, user);
    expect((await participate(id, user, true)).status).toBe(200);
    const own = (await list(id, user)).find(e => e.memberUserIds.includes(user.id))!;
    await submit(id, user, own);
    expect((await participate(id, user, true)).status).toBe(200);
    expect((await list(id, user)).filter(e => e.memberUserIds.includes(user.id))).toMatchObject([{ id: own.id, submission: { presentationUrl: "https://example.com/slides" } }]);
    expect(await member(id, user)).toEqual(before);
  }
  const staffEntry = (await list(id, staff)).find(e => e.memberUserIds.includes(staff.id))!;
  const hostEntry = (await list(id, host)).find(e => e.memberUserIds.includes(host.id))!;
  const before = await member(id, host);
  expect((await participate(id, host, false)).status).toBe(200);
  expect(await list(id, host)).toEqual([staffEntry]);
  expect(await sql("SELECT * FROM submission WHERE entry_id=?", hostEntry.id).first()).toBeNull();
  expect(await sql("SELECT * FROM entry_member WHERE entry_id=?", hostEntry.id).first()).toBeNull();
  expect(await member(id, host)).toEqual(before);
  expect((await request(`/${id}`, host, "PATCH", { title: "運営権限を保持" })).status).toBe(200);
});

it("通常参加者は従来通り登録・提出・採点・取消でき、採点済み主催のOFFは書込時にも拒否する", async () => {
  const { host, id } = await setup(), voter = await actor();
  expect((await request(`/${id}/join`, voter, "POST", {})).status).toBe(201);
  const normalEntry = (await list(id, voter))[0];
  await submit(id, voter, normalEntry);
  expect((await participate(id, host, true)).status).toBe(200);
  const hostEntry = (await list(id, voter)).find(e => e.memberUserIds.includes(host.id))!;
  await submit(id, host, hostEntry);
  const criterionId = await criterion(id, host);
  expect((await request(`/${id}/scores`, host, "PUT", { entryId: normalEntry.id, criterionId, value: 4 })).status).toBe(200);
  expect((await request(`/${id}/scores`, voter, "PUT", { entryId: hostEntry.id, criterionId, value: 3 })).status).toBe(200);
  expect((await request(`/${id}/scores`, host, "PUT", { entryId: hostEntry.id, criterionId, value: 5 })).status).toBe(403);
  const beforeEntries = await list(id, host), beforeMember = await member(id, host);
  const scores = await sql("SELECT * FROM score WHERE event_id=?", id).all();
  const denied = await participate(id, host, false);
  expect(denied.status).toBe(409);
  expect(await denied.json()).toEqual({ error: "entry_already_scored" });
  // Direct repository call proves this is not merely a route/UI precheck.
  bindEnv(env as never);
  await expect(entriesRepo.setSelfParticipation(id, host.id, false)).rejects.toMatchObject({ status: 409 });
  expect(await list(id, host)).toEqual(beforeEntries);
  expect(await member(id, host)).toEqual(beforeMember);
  expect((await sql("SELECT * FROM score WHERE event_id=?", id).all()).results).toEqual(scores.results);
  expect((await request(`/${id}/join`, voter, "DELETE")).status).toBe(200);
  expect((await list(id, host)).map(e => e.id)).toEqual([hostEntry.id]);
});

it("通常参加から昇格した運営の既存Entry・提出・点数・発表順はONで変更しない", async () => {
  const { host, id } = await setup(), staff = await actor();
  expect((await request(`/${id}/join`, staff, "POST", {})).status).toBe(201);
  const entry = (await list(id, host))[0];
  await submit(id, staff, entry);
  await sql("UPDATE entry SET presentation_order=7 WHERE id=?", entry.id).run();
  const criterionId = await criterion(id, host);
  expect((await request(`/${id}/scores`, host, "PUT", { entryId: entry.id, criterionId, value: 4 })).status).toBe(200);
  expect((await request(`/${id}/members/${staff.id}/role`, host, "PATCH", { role: "staff" })).status).toBe(200);
  const before = await list(id, staff), membership = await member(id, staff);
  expect((await participate(id, staff, true)).status).toBe(200);
  expect(await list(id, staff)).toEqual(before);
  expect(await member(id, staff)).toEqual(membership);
  expect(await sql("SELECT value FROM score WHERE entry_id=?", entry.id).first()).toEqual({ value: 4 });
});

it("非staff・他人指定・通常イベントを拒否し、本人staffと閲覧権限をバッチでも要求する", async () => {
  const { host, id } = await setup(), participant = await actor();
  expect((await request(`/${id}/join`, participant, "POST", {})).status).toBe(201);
  expect((await participate(id, participant, true)).status).toBe(403);
  expect((await participate(id, participant, false)).status).toBe(403);
  expect((await request(`/${id}/entries/self/participation`, host, "PUT", { participating: false, userId: participant.id })).status).toBe(400);
  const before = await list(id, host);
  bindEnv(env as never);
  await expect(entriesRepo.setSelfParticipation(id, participant.id, false)).rejects.toMatchObject({ status: 409 });
  expect(await list(id, host)).toEqual(before);
  const ordinary = await setup(false);
  expect((await participate(ordinary.id, ordinary.host, true)).status).toBe(409);
  await sql("UPDATE event SET visibility='private' WHERE id=?", id).run();
  expect((await participate(id, participant, true)).status).toBe(404);
  expect((await participate(id, host, true)).status).toBe(200);
});
