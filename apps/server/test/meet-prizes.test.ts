import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { MeetPrizeList, MeetPrizeStatus } from "@eventer/shared";

const BASE = "https://example.com";

/**
 * 出会いの景品引き換え (#431)。docs/meet-prizes.md の契約を固定する。
 *
 * - オフ（meet_prizes = 0）の公開一覧は**存在しないイベントと同一の 404**（門は1か所）
 * - 公開応答に個人を指す値（userId・名前）を一切含めない（1位は bool のみ）
 * - 在庫の確保は1文（二重引き換え already_redeemed / 在庫切れ out_of_stock。
 *   残り1個への同時到達は片方だけ通る）
 * - 達成は導出（取り消しで人数が減れば消える。引き換え済みは残る）
 * - 1位は締めた時点のスナップショット（同率は全員。締め直しは全置換。0件は 409）
 * - staff の CRUD・デスクはオフでも動く（仕込み用）
 */

async function makeUser(): Promise<{
  userId: string;
  username: string;
  cookie: string;
}> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `p_${uid.slice(0, 8)}`;
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

/** イベント行を直接作る（公開・開催中）。meet_prizes 列がこのテストの主役 */
async function insertEvent(
  ownerId: string,
  meetPrizes: 0 | 1,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, scheduling, meet_prizes, created_by, created_at)
     VALUES (?, ?, ?, ?, 'offline', 'published', 0, ?, ?, ?)`,
  )
    .bind(
      id,
      `景品E2E_${id.slice(0, 6)}`,
      now - 3600_000,
      now + 3600_000,
      meetPrizes,
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

/** 出会いの取り消し (#330) 相当（記録の行を消す。達成は導出なので自然に消えるはず） */
async function deleteMeet(
  eventId: string,
  a: string,
  b: string,
): Promise<void> {
  const [low, high] = a < b ? [a, b] : [b, a];
  await env.DB.prepare(
    "DELETE FROM event_meet WHERE event_id = ? AND user_low = ? AND user_high = ?",
  )
    .bind(eventId, low, high)
    .run();
}

const listUrl = (eventId: string) => `${BASE}/api/events/${eventId}/meet-prizes`;

function post(url: string, cookie: string, body?: unknown): Promise<Response> {
  return SELF.fetch(url, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

/** staff で景品を1つ作る */
async function createPrize(
  eventId: string,
  cookie: string,
  input: Record<string, unknown>,
): Promise<string> {
  const res = await post(listUrl(eventId), cookie, {
    name: "テスト景品",
    description: "",
    conditionType: "meet_count",
    threshold: 2,
    stock: 5,
    sortOrder: 0,
    ...input,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { prize: { id: string } }).prize.id;
}

function redeemUrl(eventId: string, prizeId: string): string {
  return `${listUrl(eventId)}/${prizeId}/redeem`;
}

/** よくある舞台: staff 1人 + 参加者2人（互いに出会って各1件） */
async function setup(meetPrizes: 0 | 1 = 1) {
  const staff = await makeUser();
  const eventId = await insertEvent(staff.userId, meetPrizes);
  await addMember(eventId, staff.userId, "staff");
  const alice = await makeUser();
  const bob = await makeUser();
  await addMember(eventId, alice.userId);
  await addMember(eventId, bob.userId);
  return { eventId, staff, alice, bob };
}

describe("公開一覧とオフの門 (#431)", () => {
  it("オフのイベントは、存在しないイベントと同一の 404（存在ごと隠す）", async () => {
    const { eventId } = await setup(0);
    const offRes = await SELF.fetch(listUrl(eventId));
    const missingRes = await SELF.fetch(listUrl(crypto.randomUUID()));
    expect(offRes.status).toBe(404);
    expect(missingRes.status).toBe(404);
    // ステータスだけでなくボディも同一（外から設定の有無を判別できないこと）
    expect(await offRes.json()).toEqual(await missingRes.json());
  });

  it("オンなら未ログインでも景品と残数が見える。個人を指す値は載せない", async () => {
    const { eventId, staff, alice, bob } = await setup();
    await createPrize(eventId, staff.cookie, { name: "ステッカー", threshold: 1 });
    await createPrize(eventId, staff.cookie, {
      name: "トロフィー",
      conditionType: "top_rank",
      threshold: null,
      stock: 1,
    });
    await insertMeet(eventId, alice.userId, bob.userId);
    // 1位を確定しても、公開応答は bool だけで勝者名を載せない
    const close = await post(
      `${BASE}/api/events/${eventId}/meets/winners/close`,
      staff.cookie,
    );
    expect(close.status).toBe(200);

    const res = await SELF.fetch(listUrl(eventId));
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as MeetPrizeList;
    expect(body.prizes.map((p) => [p.name, p.conditionType, p.stockLeft])).toEqual([
      ["ステッカー", "meet_count", 5],
      ["トロフィー", "top_rank", 1],
    ]);
    expect(body.winnersDecided).toBe(true);
    expect(body.me).toBeNull();
    // 個人を指す値が本文に一切現れない（userId・username・表示名）
    for (const needle of [alice.userId, alice.username, bob.userId, "表示名_"]) {
      expect(raw).not.toContain(needle);
    }
  });

  it("確定メンバーには me（件数・1位か・交換済み）が付く。非メンバーには付かない", async () => {
    const { eventId, staff, alice, bob } = await setup();
    const prizeId = await createPrize(eventId, staff.cookie, { threshold: 1 });
    await insertMeet(eventId, alice.userId, bob.userId);
    await post(redeemUrl(eventId, prizeId), staff.cookie, {
      userId: alice.userId,
    });

    const mine = (await (
      await SELF.fetch(listUrl(eventId), { headers: { cookie: alice.cookie } })
    ).json()) as MeetPrizeList;
    expect(mine.me).toEqual({
      count: 1,
      won: false,
      redeemedPrizeIds: [prizeId],
    });

    const outsider = await makeUser();
    const theirs = (await (
      await SELF.fetch(listUrl(eventId), {
        headers: { cookie: outsider.cookie },
      })
    ).json()) as MeetPrizeList;
    expect(theirs.me).toBeNull();
  });
});

describe("景品の CRUD（staff・オフでも動く）", () => {
  it("オフのイベントでも staff は作成・一覧（status）・更新・削除ができる（仕込み用）", async () => {
    const { eventId, staff } = await setup(0);
    const prizeId = await createPrize(eventId, staff.cookie, {});
    const patch = await SELF.fetch(`${listUrl(eventId)}/${prizeId}`, {
      method: "PATCH",
      headers: { cookie: staff.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "改名",
        description: "",
        conditionType: "meet_count",
        threshold: 3,
        stock: 2,
        sortOrder: 1,
      }),
    });
    expect(patch.status).toBe(200);
    const status = await SELF.fetch(`${listUrl(eventId)}/status`, {
      headers: { cookie: staff.cookie },
    });
    expect(status.status).toBe(200);
    const body = (await status.json()) as MeetPrizeStatus;
    expect(body.prizes[0].prize.name).toBe("改名");
    const del = await SELF.fetch(`${listUrl(eventId)}/${prizeId}`, {
      method: "DELETE",
      headers: { cookie: staff.cookie },
    });
    expect(del.status).toBe(200);
  });

  it("参加者は作成できない（403）。未ログインの公開一覧以外は要認証", async () => {
    const { eventId, alice } = await setup();
    const res = await post(listUrl(eventId), alice.cookie, {
      name: "x",
      conditionType: "meet_count",
      threshold: 5,
      stock: 1,
    });
    expect(res.status).toBe(403);
  });

  it("別イベントの prizeId の差し込みは 404（子リソースの所有チェック）", async () => {
    const a = await setup();
    const b = await setup();
    const foreignPrize = await createPrize(b.eventId, b.staff.cookie, {});
    // a のイベントに b の景品IDで PATCH / DELETE / redeem
    const patch = await SELF.fetch(`${listUrl(a.eventId)}/${foreignPrize}`, {
      method: "PATCH",
      headers: { cookie: a.staff.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "乗っ取り",
        description: "",
        conditionType: "meet_count",
        threshold: 1,
        stock: 0,
        sortOrder: 0,
      }),
    });
    expect(patch.status).toBe(404);
    const del = await SELF.fetch(`${listUrl(a.eventId)}/${foreignPrize}`, {
      method: "DELETE",
      headers: { cookie: a.staff.cookie },
    });
    expect(del.status).toBe(404);
    const redeem = await post(redeemUrl(a.eventId, foreignPrize), a.staff.cookie, {
      userId: a.alice.userId,
    });
    expect(redeem.status).toBe(404);
  });

  it("threshold と条件の食い違いは 400（meet_count は必須・top_rank は不可）", async () => {
    const { eventId, staff } = await setup();
    const noThreshold = await post(listUrl(eventId), staff.cookie, {
      name: "x",
      conditionType: "meet_count",
      stock: 1,
    });
    expect(noThreshold.status).toBe(400);
    const extraThreshold = await post(listUrl(eventId), staff.cookie, {
      name: "x",
      conditionType: "top_rank",
      threshold: 5,
      stock: 1,
    });
    expect(extraThreshold.status).toBe(400);
  });
});

describe("引き換え（在庫の早い者勝ちの正）", () => {
  it("達成した人を交換済みにできる。境界: ちょうど threshold で可・未満は not_achieved", async () => {
    const { eventId, staff, alice, bob } = await setup();
    const prizeId = await createPrize(eventId, staff.cookie, { threshold: 2 });
    await insertMeet(eventId, alice.userId, bob.userId); // alice=1件

    const under = await post(redeemUrl(eventId, prizeId), staff.cookie, {
      userId: alice.userId,
    });
    expect(under.status).toBe(409);
    expect(await under.json()).toEqual({ error: "not_achieved" });

    const carol = await makeUser();
    await addMember(eventId, carol.userId);
    await insertMeet(eventId, alice.userId, carol.userId); // alice=2件（ちょうど）
    const ok = await post(redeemUrl(eventId, prizeId), staff.cookie, {
      userId: alice.userId,
    });
    expect(ok.status).toBe(201);
  });

  it("二重引き換えは already_redeemed", async () => {
    const { eventId, staff, alice, bob } = await setup();
    const prizeId = await createPrize(eventId, staff.cookie, { threshold: 1 });
    await insertMeet(eventId, alice.userId, bob.userId);
    expect(
      (await post(redeemUrl(eventId, prizeId), staff.cookie, { userId: alice.userId })).status,
    ).toBe(201);
    const again = await post(redeemUrl(eventId, prizeId), staff.cookie, {
      userId: alice.userId,
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "already_redeemed" });
  });

  it("在庫は引き換えた順の早い者勝ち: stock=1 で2人目は out_of_stock。取り消しで1戻る", async () => {
    const { eventId, staff, alice, bob } = await setup();
    const prizeId = await createPrize(eventId, staff.cookie, {
      threshold: 1,
      stock: 1,
    });
    await insertMeet(eventId, alice.userId, bob.userId); // 両者とも達成

    expect(
      (await post(redeemUrl(eventId, prizeId), staff.cookie, { userId: alice.userId })).status,
    ).toBe(201);
    const second = await post(redeemUrl(eventId, prizeId), staff.cookie, {
      userId: bob.userId,
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "out_of_stock" });

    // 公開一覧の残数は 0（在庫切れでも景品自体は消えない）
    const pub = (await (await SELF.fetch(listUrl(eventId))).json()) as MeetPrizeList;
    expect(pub.prizes[0].stockLeft).toBe(0);

    // 誤操作の取り消しで在庫が1戻り、bob が引き換えられる
    const undo = await SELF.fetch(
      `${redeemUrl(eventId, prizeId)}/${alice.userId}`,
      { method: "DELETE", headers: { cookie: staff.cookie } },
    );
    expect(undo.status).toBe(200);
    expect(
      (await post(redeemUrl(eventId, prizeId), staff.cookie, { userId: bob.userId })).status,
    ).toBe(201);
  });

  it("残り1個への同時到達は片方だけ通る（確保は1文なので原子的）", async () => {
    const { eventId, staff, alice, bob } = await setup();
    const prizeId = await createPrize(eventId, staff.cookie, {
      threshold: 1,
      stock: 1,
    });
    await insertMeet(eventId, alice.userId, bob.userId);

    const [r1, r2] = await Promise.all([
      post(redeemUrl(eventId, prizeId), staff.cookie, { userId: alice.userId }),
      post(redeemUrl(eventId, prizeId), staff.cookie, { userId: bob.userId }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
    // DB 上も1行だけ（在庫がマイナスにならない）
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM event_prize_redemption WHERE prize_id = ?",
    )
      .bind(prizeId)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("stock=0 の景品は最初から out_of_stock。未確定メンバーは not_confirmed", async () => {
    const { eventId, staff, alice, bob } = await setup();
    await insertMeet(eventId, alice.userId, bob.userId);
    const empty = await createPrize(eventId, staff.cookie, {
      threshold: 1,
      stock: 0,
    });
    const res = await post(redeemUrl(eventId, empty), staff.cookie, {
      userId: alice.userId,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "out_of_stock" });

    const pending = await makeUser();
    await addMember(eventId, pending.userId, "participant", "pending");
    const notConfirmed = await post(redeemUrl(eventId, empty), staff.cookie, {
      userId: pending.userId,
    });
    expect(notConfirmed.status).toBe(409);
    expect(await notConfirmed.json()).toEqual({ error: "not_confirmed" });
  });
});

describe("出会いの取り消し (#330) との関係", () => {
  it("取り消しで人数が減ると未引き換えの達成は消える。引き換え済みは残る", async () => {
    const { eventId, staff, alice, bob } = await setup();
    const redeemed = await createPrize(eventId, staff.cookie, {
      name: "交換済みのほう",
      threshold: 1,
    });
    const notYet = await createPrize(eventId, staff.cookie, {
      name: "未交換のほう",
      threshold: 1,
    });
    await insertMeet(eventId, alice.userId, bob.userId);
    expect(
      (await post(redeemUrl(eventId, redeemed), staff.cookie, { userId: alice.userId })).status,
    ).toBe(201);

    // 取り消しで alice は 0件に
    await deleteMeet(eventId, alice.userId, bob.userId);

    // 未引き換えの景品はもう引き換えられない（達成は導出）
    const res = await post(redeemUrl(eventId, notYet), staff.cookie, {
      userId: alice.userId,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_achieved" });

    // 引き換え済みの行はそのまま（景品は物理的に渡っている）
    const mine = (await (
      await SELF.fetch(listUrl(eventId), { headers: { cookie: alice.cookie } })
    ).json()) as MeetPrizeList;
    expect(mine.me).toEqual({ count: 0, won: false, redeemedPrizeIds: [redeemed] });
  });
});

describe("1位の確定（締め）", () => {
  it("同率1位は全員が勝者。勝者だけが top_rank を引き換えられる", async () => {
    const { eventId, staff, alice, bob } = await setup();
    const carol = await makeUser();
    const dave = await makeUser();
    await addMember(eventId, carol.userId);
    await addMember(eventId, dave.userId);
    // alice=2, bob=2（同率1位）, carol=1, dave=1
    await insertMeet(eventId, alice.userId, carol.userId);
    await insertMeet(eventId, alice.userId, bob.userId);
    await insertMeet(eventId, bob.userId, dave.userId);

    const prizeId = await createPrize(eventId, staff.cookie, {
      name: "トロフィー",
      conditionType: "top_rank",
      threshold: null,
      stock: 5,
    });

    // 締める前は誰も引き換えられない
    const before = await post(redeemUrl(eventId, prizeId), staff.cookie, {
      userId: alice.userId,
    });
    expect(before.status).toBe(409);
    expect(await before.json()).toEqual({ error: "not_achieved" });

    const close = await post(
      `${BASE}/api/events/${eventId}/meets/winners/close`,
      staff.cookie,
    );
    expect(close.status).toBe(200);
    const winners = (await close.json()) as { winners: { userId: string }[] };
    expect(winners.winners.map((w) => w.userId).sort()).toEqual(
      [alice.userId, bob.userId].sort(),
    );

    // 勝者は引き換えられ、勝者でない人は not_achieved
    expect(
      (await post(redeemUrl(eventId, prizeId), staff.cookie, { userId: alice.userId })).status,
    ).toBe(201);
    const loser = await post(redeemUrl(eventId, prizeId), staff.cookie, {
      userId: carol.userId,
    });
    expect(loser.status).toBe(409);
    expect(await loser.json()).toEqual({ error: "not_achieved" });
  });

  it("締め直しは全置換。誰も出会っていなければ 409。確定の取り消しで未確定に戻る", async () => {
    const { eventId, staff, alice, bob } = await setup();
    const carol = await makeUser();
    await addMember(eventId, carol.userId);
    const closeUrl = `${BASE}/api/events/${eventId}/meets/winners/close`;

    // 誰も出会っていない → 締められない（勝者0人の「確定済み」を作らない）
    const empty = await post(closeUrl, staff.cookie);
    expect(empty.status).toBe(409);
    expect(await empty.json()).toEqual({ error: "no_meets" });

    await insertMeet(eventId, alice.userId, bob.userId); // alice=1, bob=1 で同率
    await post(closeUrl, staff.cookie);
    // その後 carol が3件で単独首位に → 締め直すと勝者が入れ替わる
    // （carol と alice/bob の出会いは両者の件数も上げるので、carol だけ 1 件多くする）
    const dave = await makeUser();
    await addMember(eventId, dave.userId);
    await insertMeet(eventId, carol.userId, alice.userId);
    await insertMeet(eventId, carol.userId, bob.userId);
    await insertMeet(eventId, carol.userId, dave.userId);
    const reclose = await post(closeUrl, staff.cookie);
    const winners = (await reclose.json()) as { winners: { userId: string }[] };
    expect(winners.winners.map((w) => w.userId)).toEqual([carol.userId]);

    // 確定の取り消しで未確定に戻る（公開の bool も落ちる）
    const clear = await SELF.fetch(`${BASE}/api/events/${eventId}/meets/winners`, {
      method: "DELETE",
      headers: { cookie: staff.cookie },
    });
    expect(clear.status).toBe(200);
    const pub = (await (await SELF.fetch(listUrl(eventId))).json()) as MeetPrizeList;
    expect(pub.winnersDecided).toBe(false);
  });
});

describe("イベント複製との関係", () => {
  it("景品の定義と設定はコピーされ、引き換え記録・1位の確定はコピーされない", async () => {
    const { eventId, staff, alice, bob } = await setup();
    const prizeId = await createPrize(eventId, staff.cookie, {
      name: "コピーされる景品",
      threshold: 1,
      stock: 3,
    });
    await insertMeet(eventId, alice.userId, bob.userId);
    await post(redeemUrl(eventId, prizeId), staff.cookie, { userId: alice.userId });
    await post(`${BASE}/api/events/${eventId}/meets/winners/close`, staff.cookie);

    const dup = await post(`${BASE}/api/events/${eventId}/duplicate`, staff.cookie);
    expect(dup.status).toBe(201);
    const created = (await dup.json()) as { event: { id: string; meetPrizes: boolean } };
    expect(created.event.meetPrizes).toBe(true);

    const status = (await (
      await SELF.fetch(`${listUrl(created.event.id)}/status`, {
        headers: { cookie: staff.cookie },
      })
    ).json()) as MeetPrizeStatus;
    expect(status.prizes.map((p) => [p.prize.name, p.prize.stock, p.redeemedCount])).toEqual([
      ["コピーされる景品", 3, 0],
    ]);
    expect(status.winners).toEqual([]);
  });
});
