import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { MeetPrizeLogRow, MyBingoResults } from "@eventer/shared";
import { bindEnv, type Env } from "../src/runtime.js";
import { eventBingoRepo } from "../src/db/repositories/eventBingo.js";

const BASE = "https://example.com";

/**
 * ビンゴ成績のスナップショットと受け取りログ (#441)。docs/bingo-history.md の契約:
 *
 * - end の瞬間に per-user 結果を保存（未達成は rank NULL）。以後**追記のみ**
 * - 同時 end で二重保存されない（UNIQUE (event_id, started_at, user_id) + batch）
 * - reset / ゲーム削除で保存済みは消えない。end せず delete した回は保存されない
 * - /me/bingo-results は**本人の行だけ**。集計の分母は
 *   達成率＝全ラウンド / 平均順位・平均抽選回数＝達成ラウンドのみ
 * - 引き換えログは全景品種別・新しい順・staff のみ。取り消した行は出ない
 */

async function makeUser(): Promise<{
  userId: string;
  username: string;
  cookie: string;
}> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `h_${uid.slice(0, 8)}`;
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

async function insertEvent(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, scheduling, created_by, created_at)
     VALUES (?, ?, ?, ?, 'offline', 'published', 0, ?, ?)`,
  )
    .bind(id, `成績E2E_${id.slice(0, 6)}`, now - 3600_000, now + 3600_000, ownerId, now)
    .run();
  return id;
}

async function addMember(
  eventId: string,
  userId: string,
  role: "participant" | "staff" = "participant",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, 'confirmed', 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, role, Date.now())
    .run();
}

const bingoUrl = (eventId: string) => `${BASE}/api/events/${eventId}/bingo`;

function post(url: string, cookie: string, body?: unknown): Promise<Response> {
  return SELF.fetch(url, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

/** 抽選順・枚数・ラウンド識別（started_at）を直接固定する */
async function setDraws(
  eventId: string,
  prefix: number[],
  drawnCount: number,
  startedAt: number,
): Promise<void> {
  const rest = Array.from({ length: 75 }, (_v, i) => i + 1).filter(
    (n) => !prefix.includes(n),
  );
  await env.DB.prepare(
    "UPDATE event_bingo_game SET status = 'running', draw_order = ?, drawn_count = ?, started_at = ? WHERE event_id = ?",
  )
    .bind(JSON.stringify([...prefix, ...rest]), drawnCount, startedAt, eventId)
    .run();
}

/** B列 first5 のカードを直接差し込む */
async function setCard(
  eventId: string,
  userId: string,
  first5: number[],
): Promise<void> {
  const numbers = [
    ...first5,
    16, 17, 18, 19, 20,
    31, 32, 33, 34,
    46, 47, 48, 49, 50,
    61, 62, 63, 64, 65,
  ];
  await env.DB.prepare(
    "INSERT OR REPLACE INTO event_bingo_card (event_id, user_id, numbers, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(eventId, userId, JSON.stringify(numbers), Date.now())
    .run();
}

async function myResults(cookie: string): Promise<MyBingoResults> {
  const res = await SELF.fetch(`${BASE}/api/me/bingo-results`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as MyBingoResults;
}

/** staff + 参加者2人 + ゲーム作成済み */
async function setup() {
  const staff = await makeUser();
  const eventId = await insertEvent(staff.userId);
  await addMember(eventId, staff.userId, "staff");
  const alice = await makeUser();
  const bob = await makeUser();
  await addMember(eventId, alice.userId);
  await addMember(eventId, bob.userId);
  expect((await post(bingoUrl(eventId), staff.cookie)).status).toBe(201);
  return { staff, eventId, alice, bob };
}

describe("end のスナップショット (#441)", () => {
  it("end で全カード保有者を保存（達成は rank/seq・未達成は NULL・drawn_total 付き）", async () => {
    const { eventId, staff, alice, bob } = await setup();
    await setCard(eventId, alice.userId, [1, 2, 3, 4, 5]);
    await setCard(eventId, bob.userId, [1, 2, 3, 4, 6]); // 6 は引かれない＝未達成
    await setDraws(eventId, [1, 2, 3, 4, 5], 5, Date.now());
    expect((await post(`${bingoUrl(eventId)}/end`, staff.cookie)).status).toBe(200);

    const mine = await myResults(alice.cookie);
    expect(mine.results).toHaveLength(1);
    expect(mine.results[0]).toMatchObject({
      eventId,
      rank: 1,
      completedAtSeq: 5,
      drawnTotal: 5,
    });
    expect(mine.results[0].eventTitle).toContain("成績E2E_");

    const theirs = await myResults(bob.cookie);
    expect(theirs.results[0]).toMatchObject({
      eventId,
      rank: null,
      completedAtSeq: null,
      drawnTotal: 5,
    });
    // 本人の行だけ（alice の達成が bob の応答に混ざらない・逆も）
    expect(theirs.results).toHaveLength(1);
    expect(theirs.games).toBe(1);
    expect(theirs.achieved).toBe(0);
    expect(mine.games).toBe(1);
    expect(mine.achieved).toBe(1); // alice 側にも自分の1行だけ
  });

  it("同時に2人が end を押しても、保存は1回ぶんだけ（batch + UNIQUE）", async () => {
    const { eventId, staff, alice } = await setup();
    await setCard(eventId, alice.userId, [1, 2, 3, 4, 5]);
    await setDraws(eventId, [1, 2, 3, 4, 5], 5, Date.now());
    const [r1, r2] = await Promise.all([
      post(`${bingoUrl(eventId)}/end`, staff.cookie),
      post(`${bingoUrl(eventId)}/end`, staff.cookie),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM event_bingo_result WHERE event_id = ?",
    )
      .bind(eventId)
      .first<{ n: number }>();
    expect(row?.n).toBe(1); // alice の1行だけ（二重保存なし）
  });

  it("導出の直後に draw が入ったら、古いスナップショットを保存せず 409 相当（false）で終わる", async () => {
    // ルートは「rows を導出 → endGame の batch」の2段で、その隙間に draw が
    // 入りうる。endGame は INSERT に「drawn_count が導出時と同じ」の EXISTS を
    // 持つので、競合時は**何も保存せず・閉じずに** false を返す（押し直しで
    // 新しい導出が正しく入る）。古い rows が rank NULL のまま確定しないこと
    const { eventId, staff, alice } = await setup();
    void staff;
    await setCard(eventId, alice.userId, [1, 2, 3, 4, 5]);
    await setDraws(eventId, [1, 2, 3, 4, 5], 4, Date.now()); // 4個時点＝リーチ

    bindEnv(env as unknown as Env);
    const game = (await eventBingoRepo.findGame(eventId))!;
    const rows = await eventBingoRepo.statusRows(eventId, [1, 2, 3, 4]);
    expect(rows[0].rank).toBeNull(); // 導出時点では未達成

    // 隙間に draw が入る（5個目＝alice がビンゴする番号）
    expect(await eventBingoRepo.draw(eventId)).toBe(5);

    const ended = await eventBingoRepo.endGame(
      eventId,
      game.startedAt!,
      game.drawnCount, // 導出時点の 4
      rows.map((r) => ({
        userId: r.userId,
        rank: r.rank,
        completedAtSeq: r.completedAtSeq,
      })),
    );
    expect(ended).toBe(false); // 閉じない（ルートは 409 を返す）
    const saved = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM event_bingo_result WHERE event_id = ?",
    )
      .bind(eventId)
      .first<{ n: number }>();
    expect(saved?.n).toBe(0); // 古いスナップショットは1行も入らない
    const still = await env.DB.prepare(
      "SELECT status FROM event_bingo_game WHERE event_id = ?",
    )
      .bind(eventId)
      .first<{ status: string }>();
    expect(still?.status).toBe("running"); // 押し直せば正しく取れる
  });

  it("reset 後の2回戦は別ラウンドとして追記され、保存済みは消えない。集計の分母も契約どおり", async () => {
    const { eventId, staff, alice } = await setup();
    // 1回戦: 5手目でビンゴ（rank 1）
    await setCard(eventId, alice.userId, [1, 2, 3, 4, 5]);
    await setDraws(eventId, [1, 2, 3, 4, 5], 5, 1000);
    await post(`${bingoUrl(eventId)}/end`, staff.cookie);
    // 2回戦: 未達成のまま終了
    expect((await post(`${bingoUrl(eventId)}/reset`, staff.cookie)).status).toBe(200);
    await setCard(eventId, alice.userId, [1, 2, 3, 4, 5]);
    await setDraws(eventId, [1, 2, 3], 3, 2000); // 3個では未達成
    await post(`${bingoUrl(eventId)}/end`, staff.cookie);

    const mine = await myResults(alice.cookie);
    expect(mine.results).toHaveLength(2);
    expect(mine.games).toBe(2);
    expect(mine.achieved).toBe(1);
    // 平均順位・平均抽選回数の分母は**達成ラウンドのみ**（未達成を混ぜない）
    expect(mine.avgRank).toBe(1);
    expect(mine.avgSeq).toBe(5);

    // ゲームを削除しても保存済みの成績は消えない（追記のみの契約）
    await SELF.fetch(bingoUrl(eventId), {
      method: "DELETE",
      headers: { cookie: staff.cookie },
    });
    expect((await myResults(alice.cookie)).results).toHaveLength(2);
  });

  it("end せず delete した回は保存されない。イベント削除で成績ごと消える", async () => {
    const { eventId, staff, alice } = await setup();
    await setCard(eventId, alice.userId, [1, 2, 3, 4, 5]);
    await setDraws(eventId, [1, 2, 3, 4, 5], 5, Date.now());
    await SELF.fetch(bingoUrl(eventId), {
      method: "DELETE",
      headers: { cookie: staff.cookie },
    });
    expect((await myResults(alice.cookie)).results).toHaveLength(0);

    // 別イベントで end 済みの成績を作り、イベント削除で CASCADE
    const other = await setup();
    await setCard(other.eventId, alice.userId, [1, 2, 3, 4, 5]);
    await addMember(other.eventId, alice.userId); // 別イベントの確定メンバー
    await setDraws(other.eventId, [1, 2, 3, 4, 5], 5, Date.now());
    await post(`${bingoUrl(other.eventId)}/end`, other.staff.cookie);
    expect((await myResults(alice.cookie)).results).toHaveLength(1);
    await SELF.fetch(`${BASE}/api/events/${other.eventId}`, {
      method: "DELETE",
      headers: { cookie: other.staff.cookie },
    });
    expect((await myResults(alice.cookie)).results).toHaveLength(0);
  });

  it("未ログインは 401（公開の口は無い）", async () => {
    const res = await SELF.fetch(`${BASE}/api/me/bingo-results`);
    expect(res.status).toBe(401);
  });
});

describe("引き換えログ (#441)", () => {
  it("全景品種別が新しい順で返り、取り消した行は消える。staff 以外は 403", async () => {
    const { eventId, staff, alice, bob } = await setup();
    // meet_count 景品と bingo 景品を1つずつ
    const mk = async (body: Record<string, unknown>) => {
      const res = await post(`${BASE}/api/events/${eventId}/meet-prizes`, staff.cookie, {
        description: "",
        stock: 5,
        ...body,
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { prize: { id: string } }).prize.id;
    };
    const meetPrize = await mk({ name: "出会い賞", conditionType: "meet_count", threshold: 1 });
    const bingoPrize = await mk({ name: "ビンゴ賞", conditionType: "bingo" });

    // alice: 出会い1件で meet_count / bob: ビンゴでプール
    const [low, high] = [alice.userId, bob.userId].sort();
    await env.DB.prepare(
      "INSERT INTO event_meet (id, event_id, user_low, user_high, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), eventId, low, high, Date.now())
      .run();
    await setCard(eventId, bob.userId, [1, 2, 3, 4, 5]);
    await setDraws(eventId, [1, 2, 3, 4, 5], 5, Date.now());

    const redeemUrl = (p: string) => `${BASE}/api/events/${eventId}/meet-prizes/${p}/redeem`;
    expect((await post(redeemUrl(meetPrize), staff.cookie, { userId: alice.userId })).status).toBe(201);
    expect((await post(redeemUrl(bingoPrize), staff.cookie, { userId: bob.userId })).status).toBe(201);

    const logUrl = `${BASE}/api/events/${eventId}/meet-prizes/log`;
    expect((await SELF.fetch(logUrl, { headers: { cookie: alice.cookie } })).status).toBe(403);

    let { log } = (await (
      await SELF.fetch(logUrl, { headers: { cookie: staff.cookie } })
    ).json()) as { log: MeetPrizeLogRow[] };
    expect(log).toHaveLength(2);
    // 新しい順・景品名と受け取った人・対応した staff が載る
    expect(log.map((r) => r.prizeName).sort()).toEqual(["ビンゴ賞", "出会い賞"]);
    expect(log[0].redeemedAt).toBeGreaterThanOrEqual(log[1].redeemedAt);
    expect(log.every((r) => r.redeemedByName !== null)).toBe(true);

    // 取り消した行はログから消える（「いま有効な引き換え」）
    await SELF.fetch(`${redeemUrl(meetPrize)}/${alice.userId}`, {
      method: "DELETE",
      headers: { cookie: staff.cookie },
    });
    ({ log } = (await (
      await SELF.fetch(logUrl, { headers: { cookie: staff.cookie } })
    ).json()) as { log: MeetPrizeLogRow[] });
    expect(log).toHaveLength(1);
    expect(log[0].prizeName).toBe("ビンゴ賞");

    // redeemed_by の退会（SET NULL 相当）は null で返る
    await env.DB.prepare(
      "UPDATE event_prize_redemption SET redeemed_by = NULL",
    ).run();
    ({ log } = (await (
      await SELF.fetch(logUrl, { headers: { cookie: staff.cookie } })
    ).json()) as { log: MeetPrizeLogRow[] });
    expect(log[0].redeemedByName).toBeNull();

    // 受け取り手の退会（soft delete）でも配布の記録は消えず、名前だけ伏せる
    await env.DB.prepare("UPDATE user SET deleted_at = ? WHERE id = ?")
      .bind(Date.now(), bob.userId)
      .run();
    ({ log } = (await (
      await SELF.fetch(logUrl, { headers: { cookie: staff.cookie } })
    ).json()) as { log: MeetPrizeLogRow[] });
    expect(log).toHaveLength(1); // 行は残る
    expect(log[0].name).toBe(""); // 名前は出さない（UI が「退会したユーザー」を出す）
  });
});
