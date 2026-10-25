import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import type { Event } from "@eventer/shared";

/** 入館名簿CSVのチーム列 (#9, docs/team-participation.md)。
 * チーム参加のコンテストだけ「ロール」の直後に「チーム」「リーダー」が入り、それ以外は今までと同じ */

const sql = (query: string, ...args: unknown[]) => env.DB.prepare(query).bind(...args);
async function actor(username: string) {
  const id = crypto.randomUUID(), session = crypto.randomUUID();
  await sql("INSERT INTO user(id,discord_id,username,global_name,created_at) VALUES(?,?,?,?,?)", id, id, username, null, Date.now()).run();
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)", session, id, Date.now() + 86400000).run();
  return { id, username, cookie: `eventer_session=${session}` };
}
type Actor = Awaited<ReturnType<typeof actor>>;
const request = (path: string, user: Actor, method = "GET", body?: unknown) => SELF.fetch(`https://example.com/api/events${path}`, {
  method, headers: { cookie: user.cookie, "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const suffix = () => crypto.randomUUID().slice(0, 6);

async function setup(contestMode: boolean) {
  const host = await actor(`host_${suffix()}`);
  const created = await request("", host, "POST", { title: "名簿チーム列", venueType: "online", contestMode, startsAt: Date.now() + 3600000, endsAt: Date.now() + 7200000 });
  expect(created.status).toBe(201);
  const { event } = await created.json() as { event: Event };
  expect((await request(`/${event.id}`, host, "PATCH", { status: "published" })).status).toBe(200);
  const people: Actor[] = [];
  for (const name of ["aoi", "haruto", "yui"]) {
    const user = await actor(`${name}_${suffix()}`);
    expect((await request(`/${event.id}/join`, user, "POST", {})).status).toBe(201);
    people.push(user);
  }
  return { host, id: event.id, people };
}

async function csv(id: string, user: Actor) {
  const response = await request(`/${id}/attendance.csv`, user);
  expect(response.status).toBe(200);
  return response.text();
}
const rows = (text: string) => text.slice(1).split("\r\n").filter((l) => l !== "").map((l) => l.split(","));

it("チーム参加のコンテストでは、ロールの直後にチーム名とリーダーの列が入る。未所属は空欄", async () => {
  const { host, id, people: [aoi, haruto, yui] } = await setup(true);
  expect((await request(`/${id}/team-mode`, host, "PUT", { enabled: true })).status).toBe(200);
  const created = await request(`/${id}/teams`, host, "POST", { name: "チーム・ねこ" });
  expect(created.status).toBe(201);
  const team = (await created.json() as { id: string }).id;
  expect((await request(`/${id}/teams/${team}/leader`, host, "PUT", { userId: aoi.id })).status).toBe(200);
  expect((await request(`/${id}/teams/${team}/join`, haruto, "POST")).status).toBe(200);

  const [header, ...body] = rows(await csv(id, host));
  expect(header.slice(0, 6)).toEqual(["ユーザー名", "表示名", "ロール", "チーム", "リーダー", "参加状態"]);
  const byUser = new Map(body.map((r) => [r[0], r]));
  expect(byUser.get(aoi.username)!.slice(2, 6)).toEqual(["参加者", "チーム・ねこ", "○", "確定"]);
  expect(byUser.get(haruto.username)!.slice(2, 6)).toEqual(["参加者", "チーム・ねこ", "", "確定"]);
  expect(byUser.get(yui.username)!.slice(2, 6)).toEqual(["参加者", "", "", "確定"]);
  // 列の数はどの行もヘッダーと同じ
  for (const r of body) expect(r).toHaveLength(header.length);
});

it("チーム参加でないイベントの名簿は今までと同じ（チームが残っていてもオフなら列を出さない）", async () => {
  const { host, id, people: [aoi] } = await setup(true);
  const before = await csv(id, host);
  expect(rows(before)[0]).toEqual(["ユーザー名", "表示名", "ロール", "参加状態", "出席", "出席時刻"]);

  // チームを作ってからオフに戻しても、名簿はオンにする前と1バイトも変わらない
  expect((await request(`/${id}/team-mode`, host, "PUT", { enabled: true })).status).toBe(200);
  const created = await request(`/${id}/teams`, host, "POST", { name: "チーム・いぬ" });
  const team = (await created.json() as { id: string }).id;
  expect((await request(`/${id}/teams/${team}/leader`, host, "PUT", { userId: aoi.id })).status).toBe(200);
  expect((await request(`/${id}/team-mode`, host, "PUT", { enabled: false })).status).toBe(200);
  expect(await csv(id, host)).toBe(before);

  // コンテストでないイベントにも列は出ない
  const plain = await setup(false);
  expect(rows(await csv(plain.id, plain.host))[0]).toEqual(["ユーザー名", "表示名", "ロール", "参加状態", "出席", "出席時刻"]);
});
