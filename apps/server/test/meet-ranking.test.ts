import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { MeetRankingLive } from "@eventer/shared";

const BASE = "https://example.com";

/**
 * 参加者向けの出会いランキング (#418)。
 *
 * ここで固定したい契約は docs/meet-ranking.md §3.8 の門:
 * - off のイベント・非メンバー・未確定メンバーは、**存在しないイベントと同一の 404**
 * - anonymous はサーバー応答に個人を指す値（userId・名前・アバター）を一切含まない
 * - named のときだけ名前が返る
 * - スタッフ運営用の /meets/ranking は設定に従わない（現状維持）
 */

async function makeUser(): Promise<{
  userId: string;
  username: string;
  cookie: string;
}> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `r_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, username, `表示名_${username}`, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, username, cookie: `eventer_session=${sid}` };
}

/** イベント行を直接作る（公開・開催中）。meetRanking 列だけがこのテストの主役 */
async function insertEvent(
  ownerId: string,
  meetRanking: "off" | "anonymous" | "named",
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, scheduling, meet_ranking, created_by, created_at)
     VALUES (?, ?, ?, ?, 'offline', 'published', 0, ?, ?, ?)`,
  )
    .bind(
      id,
      `ランキングE2E_${id.slice(0, 6)}`,
      now - 3600_000,
      now + 3600_000,
      meetRanking,
      ownerId,
      now,
    )
    .run();
  return id;
}

async function addMember(
  eventId: string,
  userId: string,
  role: "participant" | "staff" = "participant",
  status = "confirmed",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, ?, 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, role, status, Date.now())
    .run();
}

async function insertMeet(
  eventId: string,
  a: string,
  b: string,
): Promise<void> {
  const [low, high] = a < b ? [a, b] : [b, a];
  await env.DB.prepare(
    "INSERT INTO event_meet (id, event_id, user_low, user_high, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), eventId, low, high, Date.now())
    .run();
}

function liveUrl(eventId: string): string {
  return `${BASE}/api/events/${eventId}/meets/ranking/live`;
}

/** 出会いの分布を作る: a=3件, b=2件, c=2件, d=1件（同率2位が2人） */
async function seedRanking(eventId: string): Promise<{
  a: Awaited<ReturnType<typeof makeUser>>;
  b: Awaited<ReturnType<typeof makeUser>>;
  c: Awaited<ReturnType<typeof makeUser>>;
  d: Awaited<ReturnType<typeof makeUser>>;
}> {
  const [a, b, c, d] = await Promise.all([
    makeUser(),
    makeUser(),
    makeUser(),
    makeUser(),
  ]);
  for (const u of [a, b, c, d]) await addMember(eventId, u.userId);
  await insertMeet(eventId, a.userId, b.userId);
  await insertMeet(eventId, a.userId, c.userId);
  await insertMeet(eventId, a.userId, d.userId);
  await insertMeet(eventId, b.userId, c.userId);
  return { a, b, c, d };
}

describe("出会いランキング live API (#418)", () => {
  it("off のイベントは、存在しないイベントと同一の 404 を返す（存在ごと隠す）", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId, "off");
    const me = await makeUser();
    await addMember(eventId, me.userId);
    await insertMeet(eventId, me.userId, owner.userId);

    const offRes = await SELF.fetch(liveUrl(eventId), {
      headers: { cookie: me.cookie },
    });
    const missingRes = await SELF.fetch(liveUrl(crypto.randomUUID()), {
      headers: { cookie: me.cookie },
    });
    expect(offRes.status).toBe(404);
    expect(missingRes.status).toBe(404);
    // ステータスだけでなくボディも同一（外から設定の有無を判別できないこと）
    expect(await offRes.json()).toEqual(await missingRes.json());
  });

  it("非メンバー・未確定メンバーも同じ 404（機能の存在を見せない）。未ログインは 401", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId, "named");
    await addMember(eventId, owner.userId, "staff");

    const outsider = await makeUser();
    const outsiderRes = await SELF.fetch(liveUrl(eventId), {
      headers: { cookie: outsider.cookie },
    });
    expect(outsiderRes.status).toBe(404);

    const pending = await makeUser();
    await addMember(eventId, pending.userId, "participant", "pending");
    const pendingRes = await SELF.fetch(liveUrl(eventId), {
      headers: { cookie: pending.cookie },
    });
    expect(pendingRes.status).toBe(404);
    // 404 のボディも存在しないイベントと同一
    const missingRes = await SELF.fetch(liveUrl(crypto.randomUUID()), {
      headers: { cookie: outsider.cookie },
    });
    expect(await outsiderRes.json()).toEqual(await missingRes.json());

    const anonRes = await SELF.fetch(liveUrl(eventId));
    expect(anonRes.status).toBe(401);
  });

  it("named: 名前入りの上位と競技順位（同数は同順位、次は人数分飛ぶ）を返す", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId, "named");
    const { a, b, c, d } = await seedRanking(eventId);

    const res = await SELF.fetch(liveUrl(eventId), {
      headers: { cookie: d.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MeetRankingLive;
    expect(body.mode).toBe("named");
    if (body.mode !== "named") return;

    // a=3件が1位、b/c=2件が同率2位、d=1件は4位（3位は飛ぶ）
    expect(body.ranking.map((r) => [r.rank, r.count])).toEqual([
      [1, 3],
      [2, 2],
      [2, 2],
      [4, 1],
    ]);
    expect(body.ranking[0].userId).toBe(a.userId);
    expect(body.ranking[0].name).toBe(`表示名_${a.username}`);
    // 同率内は username 昇順で安定（ポーリングのたびに入れ替わらない）
    const tie = [body.ranking[1], body.ranking[2]];
    expect(tie.map((r) => r.userId).sort()).toEqual(
      [b.userId, c.userId].sort(),
    );
    expect(tie[0].username < tie[1].username).toBe(true);

    expect(body.totalRanked).toBe(4);
    // 呼び出した本人（d）の順位
    expect(body.me).toEqual({ rank: 4, count: 1 });
  });

  it("anonymous: 件数ごとの集約だけを返し、個人を指す値を一切含まない。me は本人にだけ返る", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId, "anonymous");
    const { a, b, c, d } = await seedRanking(eventId);

    const res = await SELF.fetch(liveUrl(eventId), {
      headers: { cookie: b.cookie },
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as MeetRankingLive;
    expect(body.mode).toBe("anonymous");
    if (body.mode !== "anonymous") return;

    // 3件×1人 → 1位 / 2件×2人 → 2位 / 1件×1人 → 4位
    expect(body.ranking).toEqual([
      { rank: 1, count: 3, people: 1 },
      { rank: 2, count: 2, people: 2 },
      { rank: 4, count: 1, people: 1 },
    ]);
    expect(body.totalRanked).toBe(4);
    // 本人自身の順位・件数は匿名でも返す（他人のものは返さない）
    expect(body.me).toEqual({ rank: 2, count: 2 });

    // 応答のどこにも個人を指す値が無いこと（行の形だけでなく応答全体で確かめる）
    for (const u of [a, b, c, d, owner]) {
      expect(raw).not.toContain(u.userId);
      expect(raw).not.toContain(u.username);
      expect(raw).not.toContain(`表示名_${u.username}`);
    }
  });

  it("出会いが1件も無いイベントでは空のランキングと me=null を返す", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId, "named");
    const me = await makeUser();
    await addMember(eventId, me.userId);

    const res = await SELF.fetch(liveUrl(eventId), {
      headers: { cookie: me.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MeetRankingLive;
    expect(body.ranking).toEqual([]);
    expect(body.totalRanked).toBe(0);
    expect(body.me).toBeNull();
  });

  it("スタッフ運営用の /meets/ranking は設定 off でも従来どおり名前入りで返る（現状維持）", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId, "off");
    await addMember(eventId, owner.userId, "staff");
    const { a } = await seedRanking(eventId);

    const res = await SELF.fetch(
      `${BASE}/api/events/${eventId}/meets/ranking`,
      { headers: { cookie: owner.cookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ranking: { userId: string; count: number }[];
    };
    expect(body.ranking[0].userId).toBe(a.userId);
    expect(body.ranking[0].count).toBe(3);
  });

  it("設定はイベント編集（PATCH）で保存でき、イベント取得に載る", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId, "off");
    await addMember(eventId, owner.userId, "staff");

    const patch = await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ meetRanking: "named" }),
    });
    expect(patch.status).toBe(200);

    const got = await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      headers: { cookie: owner.cookie },
    });
    const { event } = (await got.json()) as {
      event: { meetRanking: string };
    };
    expect(event.meetRanking).toBe("named");
  });
});
