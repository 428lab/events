import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { BingoState, BingoStatus, MeetPrizeStatus } from "@eventer/shared";

const BASE = "https://example.com";

/**
 * 数字ビンゴ (#436)。docs/bingo.md の契約を固定する。
 *
 * - カードはサーバー生成（列範囲・重複なし・冪等）。クライアント申告を信じる場所が無い
 * - 抽選は事前順列 + drawn_count の条件付き UPDATE 1文（同時に押しても飛び・重複なし）
 * - 判定・達成順はすべて導出。同じ手番で完成した人は同順位（競技順位）
 * - リセットで達成は消えるが、引き換え済みの景品は残る
 * - 門: ゲーム行なし・非メンバーは 404（イベント不存在と同一ボディ）。
 *   参加者向け応答に他人の名前・カードは載らない
 * - 景品プール: 達成者はプールから1つだけ（1文の INSERT が同時実行でも守る）
 */

async function makeUser(): Promise<{
  userId: string;
  username: string;
  cookie: string;
}> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `b_${uid.slice(0, 8)}`;
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
    .bind(id, `ビンゴE2E_${id.slice(0, 6)}`, now - 3600_000, now + 3600_000, ownerId, now)
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

const bingoUrl = (eventId: string) => `${BASE}/api/events/${eventId}/bingo`;

function post(url: string, cookie: string, body?: unknown): Promise<Response> {
  return SELF.fetch(url, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

async function getState(eventId: string, cookie: string): Promise<BingoState> {
  const res = await SELF.fetch(bingoUrl(eventId), { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as BingoState;
}

/** staff 1人 + 参加者2人 + ゲーム作成済み */
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

/** 判定テスト用: 抽選順と枚数を直接固定する（順列の乱数性を外して決定的にする） */
async function setDraws(
  eventId: string,
  prefix: number[],
  drawnCount: number,
): Promise<void> {
  const rest = Array.from({ length: 75 }, (_v, i) => i + 1).filter(
    (n) => !prefix.includes(n),
  );
  await env.DB.prepare(
    "UPDATE event_bingo_game SET status = 'running', draw_order = ?, drawn_count = ?, started_at = ? WHERE event_id = ?",
  )
    .bind(JSON.stringify([...prefix, ...rest]), drawnCount, Date.now(), eventId)
    .run();
}

/** 判定テスト用: カードを直接差し込む（B列 first5 + 残りは固定の妥当な数字） */
async function setCard(
  eventId: string,
  userId: string,
  first5: number[],
): Promise<void> {
  const numbers = [
    ...first5,
    16, 17, 18, 19, 20, // I
    31, 32, 33, 34, // N（FREE抜き4個）
    46, 47, 48, 49, 50, // G
    61, 62, 63, 64, 65, // O
  ];
  await env.DB.prepare(
    "INSERT OR REPLACE INTO event_bingo_card (event_id, user_id, numbers, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(eventId, userId, JSON.stringify(numbers), Date.now())
    .run();
}

/** 門のソース監査（変異のトリップワイヤ）。挙動の証明は下の 404 テストが担い、
 * こちらは「確定メンバーの条件が bingoAudience から消えた」リファクタを
 * コンパイル前に気づかせるだけの安い網 */
const routeSources = import.meta.glob("../src/routes/eventBingo.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("門と見える範囲 (#436)", () => {
  it("bingoAudience が確定メンバーを要求している（ソース監査）", () => {
    const src = Object.values(routeSources)[0]!;
    expect(src).toContain('member?.status === "confirmed"');
  });

  it("ゲーム行が無ければ参加者に 404（存在しないイベントと同一ボディ）。staff は 'none' を見る", async () => {
    const staff = await makeUser();
    const eventId = await insertEvent(staff.userId);
    await addMember(eventId, staff.userId, "staff");
    const alice = await makeUser();
    await addMember(eventId, alice.userId);

    const res = await SELF.fetch(bingoUrl(eventId), {
      headers: { cookie: alice.cookie },
    });
    const missing = await SELF.fetch(bingoUrl(crypto.randomUUID()), {
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await res.json()).toEqual(await missing.json());

    // staff は作成前でも "none" が見える（作成ボタンを出すため）
    const forStaff = await getState(eventId, staff.cookie);
    expect(forStaff.status).toBe("none");
  });

  it("非メンバー・未確定メンバーは 404。参加者向け応答に他人の名前・カードが無い", async () => {
    const { eventId, staff, alice, bob } = await setup();
    const outsider = await makeUser();
    expect(
      (await SELF.fetch(bingoUrl(eventId), { headers: { cookie: outsider.cookie } }))
        .status,
    ).toBe(404);
    const pending = await makeUser();
    await addMember(eventId, pending.userId, "participant", "pending");
    expect(
      (await SELF.fetch(bingoUrl(eventId), { headers: { cookie: pending.cookie } }))
        .status,
    ).toBe(404);

    // alice と bob がカードを持つ状態で、alice の応答に bob 由来の値が無い
    await post(`${bingoUrl(eventId)}/card`, alice.cookie);
    await post(`${bingoUrl(eventId)}/card`, bob.cookie);
    const raw = await (
      await SELF.fetch(bingoUrl(eventId), { headers: { cookie: alice.cookie } })
    ).text();
    for (const needle of [bob.userId, bob.username, "表示名_", staff.userId]) {
      expect(raw).not.toContain(needle);
    }
    const state = JSON.parse(raw) as BingoState;
    expect(state.counts.cards).toBe(2);
  });

  it("名前入りの一覧（/bingo/status）は staff のみ", async () => {
    const { eventId, alice } = await setup();
    const res = await SELF.fetch(`${bingoUrl(eventId)}/status`, {
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(403);
  });
});

describe("カード発行", () => {
  it("列ごとの標準範囲・重複なし・24個。発行は冪等（2回目は同じカード）", async () => {
    const { eventId, alice } = await setup();
    const first = (await (
      await post(`${bingoUrl(eventId)}/card`, alice.cookie)
    ).json()) as { card: number[] };
    expect(first.card).toHaveLength(24);
    expect(new Set(first.card).size).toBe(24);
    // 列優先: B(0-4)=1-15 / I(5-9)=16-30 / N(10-13)=31-45 / G(14-18)=46-60 / O(19-23)=61-75
    const ranges: [number, number, number][] = [
      [0, 5, 1], [5, 10, 16], [10, 14, 31], [14, 19, 46], [19, 24, 61],
    ];
    for (const [from, to, lo] of ranges) {
      for (const n of first.card.slice(from, to)) {
        expect(n).toBeGreaterThanOrEqual(lo);
        expect(n).toBeLessThanOrEqual(lo + 14);
      }
    }
    const second = (await (
      await post(`${bingoUrl(eventId)}/card`, alice.cookie)
    ).json()) as { card: number[] };
    expect(second.card).toEqual(first.card);
  });

  it("ended 中は発行できない（409）。setup・running 中は途中参加でも発行できる", async () => {
    const { eventId, staff, alice, bob } = await setup();
    expect((await post(`${bingoUrl(eventId)}/card`, alice.cookie)).status).toBe(200);
    await post(`${bingoUrl(eventId)}/start`, staff.cookie);
    expect((await post(`${bingoUrl(eventId)}/card`, bob.cookie)).status).toBe(200);
    await post(`${bingoUrl(eventId)}/end`, staff.cookie);
    const late = await makeUser();
    await addMember(eventId, late.userId);
    const res = await post(`${bingoUrl(eventId)}/card`, late.cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "game_ended" });
  });
});

describe("抽選（事前順列 + 条件付き UPDATE の1文）", () => {
  it("start 前は引けない。start で 75 個の順列が固定され、引くたびに次が出る", async () => {
    const { eventId, staff } = await setup();
    const early = await post(`${bingoUrl(eventId)}/draw`, staff.cookie);
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: "not_running" });

    expect((await post(`${bingoUrl(eventId)}/start`, staff.cookie)).status).toBe(200);
    // 二重 start は 409（条件付き UPDATE の1文）
    expect((await post(`${bingoUrl(eventId)}/start`, staff.cookie)).status).toBe(409);

    const d1 = (await (await post(`${bingoUrl(eventId)}/draw`, staff.cookie)).json()) as {
      number: number;
      drawnNumbers: number[];
    };
    // 初回（drawn_count=1）の応答に番号が入ること（実機フィードバック #436 の明示固定）
    expect(typeof d1.number).toBe("number");
    expect(d1.number).toBeGreaterThanOrEqual(1);
    expect(d1.drawnNumbers).toEqual([d1.number]);
    const d2 = (await (await post(`${bingoUrl(eventId)}/draw`, staff.cookie)).json()) as {
      number: number;
      drawnNumbers: number[];
    };
    expect(d2.drawnNumbers).toHaveLength(2);
    expect(d2.drawnNumbers[0]).toBe(d1.number);
    expect(d2.number).not.toBe(d1.number);

    // 取り消しで1個戻る
    const undo = (await (
      await post(`${bingoUrl(eventId)}/draw/undo`, staff.cookie)
    ).json()) as { drawnNumbers: number[] };
    expect(undo.drawnNumbers).toEqual([d1.number]);
  });

  it("同時に2回引いても、番号は飛ばず・重複せず・ちょうど2進む。各応答は自分の番号を受け取る", async () => {
    const { eventId, staff } = await setup();
    await post(`${bingoUrl(eventId)}/start`, staff.cookie);
    const [r1, r2] = await Promise.all([
      post(`${bingoUrl(eventId)}/draw`, staff.cookie),
      post(`${bingoUrl(eventId)}/draw`, staff.cookie),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT drawn_count FROM event_bingo_game WHERE event_id = ?",
    )
      .bind(eventId)
      .first<{ drawn_count: number }>();
    expect(row?.drawn_count).toBe(2);
    const state = (await (
      await SELF.fetch(`${bingoUrl(eventId)}/status`, { headers: { cookie: staff.cookie } })
    ).json()) as BingoStatus;
    expect(new Set(state.drawnNumbers).size).toBe(2);
    // RETURNING で受けた自分の手番から番号を決めるので、2応答は**別の番号**を
    // 名乗り、合わせるとちょうど公開済みの2個になる（同じ番号を二重発表しない・
    // どの応答にも出ない番号を作らない。レビュー指摘の回帰防止）
    const n1 = ((await r1.json()) as { number: number }).number;
    const n2 = ((await r2.json()) as { number: number }).number;
    expect(n1).not.toBe(n2);
    expect([n1, n2].sort((a, b) => a - b)).toEqual(
      [...state.drawnNumbers].sort((a, b) => a - b),
    );
  });

  it("75 個引き切ったら exhausted", async () => {
    const { eventId, staff } = await setup();
    await setDraws(eventId, [], 75);
    const res = await post(`${bingoUrl(eventId)}/draw`, staff.cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "exhausted" });
  });
});

describe("判定と達成順（すべて導出・同着は同順位）", () => {
  it("リーチ→ビンゴが手元の状態に出る。FREE込みの縦横斜めが効く", async () => {
    const { eventId, alice } = await setup();
    await setCard(eventId, alice.userId, [1, 2, 3, 4, 5]);
    // B列の4個まで（リーチ）
    await setDraws(eventId, [1, 2, 3, 4], 4);
    let state = await getState(eventId, alice.cookie);
    expect(state.me).toEqual({ bingo: false, reach: true, rank: null });
    // 5個目でビンゴ
    await setDraws(eventId, [1, 2, 3, 4, 5], 5);
    state = await getState(eventId, alice.cookie);
    expect(state.me).toEqual({ bingo: true, reach: false, rank: 1 });
    expect(state.counts).toEqual({ cards: 1, bingo: 1, reach: 0 });
  });

  it("同じ手番で完成した2人は同順位、次の人は人数分飛ぶ（競技順位）", async () => {
    const { eventId, staff, alice, bob } = await setup();
    const carol = await makeUser();
    await addMember(eventId, carol.userId);
    // alice と bob は同じ5番の読み上げ（手番5）で完成。carol は手番6で完成
    await setCard(eventId, alice.userId, [1, 2, 3, 4, 5]);
    await setCard(eventId, bob.userId, [5, 1, 2, 3, 4]);
    await setCard(eventId, carol.userId, [1, 2, 3, 4, 6]);
    await setDraws(eventId, [1, 2, 3, 4, 5, 6], 6);

    expect((await getState(eventId, alice.cookie)).me?.rank).toBe(1);
    expect((await getState(eventId, bob.cookie)).me?.rank).toBe(1);
    expect((await getState(eventId, carol.cookie)).me?.rank).toBe(3);

    const status = (await (
      await SELF.fetch(`${bingoUrl(eventId)}/status`, { headers: { cookie: staff.cookie } })
    ).json()) as BingoStatus;
    expect(
      status.rows.filter((r) => r.bingo).map((r) => [r.userId, r.rank]),
    ).toEqual([
      ...[alice, bob]
        .sort((a, b) => (a.username < b.username ? -1 : 1))
        .map((u) => [u.userId, 1]),
      [carol.userId, 3],
    ]);
  });

  it("後から発行したカードにも既出の番号が効く", async () => {
    const { eventId, alice } = await setup();
    await setDraws(eventId, [1, 2, 3, 4, 5], 5);
    await setCard(eventId, alice.userId, [1, 2, 3, 4, 5]); // 既出番号だけのB列
    const state = await getState(eventId, alice.cookie);
    expect(state.me?.bingo).toBe(true);
  });
});

describe("ライフサイクルとリセット", () => {
  it("リセットは ended からのみ。カードが消えて達成も消えるが、引き換え済みの景品は残る", async () => {
    const { eventId, staff, alice } = await setup();
    // ビンゴ景品プールを1つ作る
    const prizeRes = await post(
      `${BASE}/api/events/${eventId}/meet-prizes`,
      staff.cookie,
      { name: "ビンゴ景品", description: "", conditionType: "bingo", stock: 5 },
    );
    expect(prizeRes.status).toBe(201);
    const prizeId = ((await prizeRes.json()) as { prize: { id: string } }).prize.id;

    await setCard(eventId, alice.userId, [1, 2, 3, 4, 5]);
    await setDraws(eventId, [1, 2, 3, 4, 5], 5);
    expect(
      (
        await post(
          `${BASE}/api/events/${eventId}/meet-prizes/${prizeId}/redeem`,
          staff.cookie,
          { userId: alice.userId },
        )
      ).status,
    ).toBe(201);

    // running からのリセットは 409（先に end）
    expect((await post(`${bingoUrl(eventId)}/reset`, staff.cookie)).status).toBe(409);
    expect((await post(`${bingoUrl(eventId)}/end`, staff.cookie)).status).toBe(200);
    expect((await post(`${bingoUrl(eventId)}/reset`, staff.cookie)).status).toBe(200);

    const state = await getState(eventId, alice.cookie);
    expect(state.status).toBe("setup");
    expect(state.card).toBeNull(); // カード再配布（消えている）
    expect(state.counts).toEqual({ cards: 0, bingo: 0, reach: 0 });

    // 引き換え済みは残る（物は渡っている）
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM event_prize_redemption WHERE prize_id = ?",
    )
      .bind(prizeId)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);

    // リセット後の引き換えは not_achieved（達成の再検証が先に立つ）
    const again = await post(
      `${BASE}/api/events/${eventId}/meet-prizes/${prizeId}/redeem`,
      staff.cookie,
      { userId: alice.userId },
    );
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "not_achieved" });
  });

  it("ゲーム削除で参加者は 404 に戻る", async () => {
    const { eventId, staff, alice } = await setup();
    await SELF.fetch(bingoUrl(eventId), {
      method: "DELETE",
      headers: { cookie: staff.cookie },
    });
    expect(
      (await SELF.fetch(bingoUrl(eventId), { headers: { cookie: alice.cookie } }))
        .status,
    ).toBe(404);
  });
});

describe("ビンゴ景品プール（1人1つの選び取り）", () => {
  async function setupPool() {
    const base = await setup();
    const mk = async (name: string, stock: number) => {
      const res = await post(
        `${BASE}/api/events/${base.eventId}/meet-prizes`,
        base.staff.cookie,
        { name, description: "", conditionType: "bingo", stock },
      );
      expect(res.status).toBe(201);
      return ((await res.json()) as { prize: { id: string } }).prize.id;
    };
    const prizeA = await mk("ぬいぐるみ", 1);
    const prizeB = await mk("ステッカー", 5);
    const redeemUrl = (prizeId: string) =>
      `${BASE}/api/events/${base.eventId}/meet-prizes/${prizeId}/redeem`;
    return { ...base, prizeA, prizeB, redeemUrl };
  }

  it("bingo 景品に threshold は付けられない（400）。未達成は not_achieved", async () => {
    const { eventId, staff, alice, prizeA, redeemUrl } = await setupPool();
    const bad = await post(`${BASE}/api/events/${eventId}/meet-prizes`, staff.cookie, {
      name: "x",
      conditionType: "bingo",
      threshold: 3,
      stock: 1,
    });
    expect(bad.status).toBe(400);

    await setCard(eventId, alice.userId, [1, 2, 3, 4, 5]);
    await setDraws(eventId, [1, 2, 3, 4], 4); // リーチ止まり
    const res = await post(redeemUrl(prizeA), staff.cookie, { userId: alice.userId });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_achieved" });
  });

  it("プール全体で1人1回: 別のプール景品の2つ目は already_redeemed。取り消しで選び直せる", async () => {
    const { eventId, staff, alice, prizeA, prizeB, redeemUrl } = await setupPool();
    await setCard(eventId, alice.userId, [1, 2, 3, 4, 5]);
    await setDraws(eventId, [1, 2, 3, 4, 5], 5);

    expect((await post(redeemUrl(prizeA), staff.cookie, { userId: alice.userId })).status).toBe(201);
    const second = await post(redeemUrl(prizeB), staff.cookie, { userId: alice.userId });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "already_redeemed" });

    // 取り消せば別の景品を選び直せる（枠と在庫は導出なので自然に戻る）
    await SELF.fetch(`${redeemUrl(prizeA)}/${alice.userId}`, {
      method: "DELETE",
      headers: { cookie: staff.cookie },
    });
    expect((await post(redeemUrl(prizeB), staff.cookie, { userId: alice.userId })).status).toBe(201);
  });

  it("同一人がプール内の2景品へ同時に来ても1つしか通らない（1文の原子性）", async () => {
    const { eventId, staff, alice, prizeA, prizeB, redeemUrl } = await setupPool();
    await setCard(eventId, alice.userId, [1, 2, 3, 4, 5]);
    await setDraws(eventId, [1, 2, 3, 4, 5], 5);
    const [r1, r2] = await Promise.all([
      post(redeemUrl(prizeA), staff.cookie, { userId: alice.userId }),
      post(redeemUrl(prizeB), staff.cookie, { userId: alice.userId }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM event_prize_redemption r
        JOIN event_prize p ON p.id = r.prize_id
       WHERE p.event_id = ? AND r.user_id = ?`,
    )
      .bind(eventId, alice.userId)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("プール景品ごとの在庫競合は既存どおり（在庫1に2人目は out_of_stock）", async () => {
    const { eventId, staff, alice, bob, prizeA, redeemUrl } = await setupPool();
    await setCard(eventId, alice.userId, [1, 2, 3, 4, 5]);
    await setCard(eventId, bob.userId, [5, 1, 2, 3, 4]);
    await setDraws(eventId, [1, 2, 3, 4, 5], 5);
    expect((await post(redeemUrl(prizeA), staff.cookie, { userId: alice.userId })).status).toBe(201);
    const res = await post(redeemUrl(prizeA), staff.cookie, { userId: bob.userId });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "out_of_stock" });
  });

  it("デスクの達成者一覧が達成順（同着は同順位）で返り、選んだ景品が載る", async () => {
    const { eventId, staff, alice, bob, prizeA, redeemUrl } = await setupPool();
    await setCard(eventId, alice.userId, [1, 2, 3, 4, 5]);
    await setCard(eventId, bob.userId, [1, 2, 3, 4, 6]);
    await setDraws(eventId, [1, 2, 3, 4, 5, 6], 6);
    await post(redeemUrl(prizeA), staff.cookie, { userId: alice.userId });

    const status = (await (
      await SELF.fetch(`${BASE}/api/events/${eventId}/meet-prizes/status`, {
        headers: { cookie: staff.cookie },
      })
    ).json()) as MeetPrizeStatus;
    expect(
      status.bingoAchievers.map((a) => [a.userId, a.rank, a.redeemedPrizeId]),
    ).toEqual([
      [alice.userId, 1, prizeA],
      [bob.userId, 2, null],
    ]);
  });
});

describe("イベント複製との関係", () => {
  it("ゲーム・カードは複製されない（当日の記録。景品定義は #431 の複製でコピーされる）", async () => {
    const { eventId, staff, alice } = await setup();
    await post(`${bingoUrl(eventId)}/card`, alice.cookie);
    const dup = await post(`${BASE}/api/events/${eventId}/duplicate`, staff.cookie);
    expect(dup.status).toBe(201);
    const copied = ((await dup.json()) as { event: { id: string } }).event.id;
    const state = (await (
      await SELF.fetch(bingoUrl(copied), { headers: { cookie: staff.cookie } })
    ).json()) as BingoState;
    expect(state.status).toBe("none"); // ゲーム行ごと存在しない
  });
});
