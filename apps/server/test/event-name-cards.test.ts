import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { EventNameCard } from "@eventer/shared";

const BASE = "https://example.com";

/**
 * 名札の一括印刷 (#304) の一覧API。
 *
 * 参加者の表示名・ハンドル・アイコン・実績をまとめて渡すので、
 * 誰が取れるかを「そのイベントの参加確定スタッフ」に固定しておく。
 * requireEventRole(["staff"]) はアプリ運営管理者とコミュニティ管理者も
 * 通してしまうため、そこに落ちていないことを退行防止として押さえる (#275)。
 */

/** dev-login（DevUser=イベント作成者＝staff・アプリ運営管理者） */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** 非adminのユーザーを1人作る（メンバーにはしない） */
async function makeUser(
  globalName: string | null = "テスト",
  avatarUrl: string | null = null,
): Promise<{ userId: string; cookie: string; username: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `u_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(uid, `nostr:${uid}`, username, globalName, avatarUrl, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}`, username };
}

async function addMember(
  eventId: string,
  userId: string,
  role: "participant" | "staff" | "judge" | "observer",
  status = "confirmed",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, ?, 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, role, status, Date.now())
    .run();
}

async function makeMember(
  eventId: string,
  role: "participant" | "staff" | "judge" | "observer",
  status = "confirmed",
  globalName: string | null = "テスト",
): Promise<{ userId: string; cookie: string; username: string }> {
  const u = await makeUser(globalName);
  await addMember(eventId, u.userId, role, status);
  return u;
}

/** コミュニティを作り、owner を1人つける */
async function makeCommunity(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO community (id, slug, name, description, owner_id, created_at) VALUES (?, ?, ?, '', ?, ?)",
  )
    .bind(
      id,
      `c-${id.slice(0, 8)}`,
      `community_${id.slice(0, 4)}`,
      ownerId,
      Date.now(),
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
  )
    .bind(crypto.randomUUID(), id, ownerId, Date.now())
    .run();
  return id;
}

/** 公開イベントを作る。DevUser（アプリ運営管理者）のメンバー行は外し、
 * 「イベントに参加していないサイト管理者」の状態にしておく */
async function setupEvent(communityId?: string): Promise<string> {
  const cookie = await loginDev();
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "名札印刷E2E",
      venueType: "offline",
      startsAt: 1,
      endsAt: 99999999999999,
    }),
  });
  expect(create.status).toBe(201);
  const { event } = (await create.json()) as { event: { id: string } };
  const patch = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ status: "published" }),
  });
  expect(patch.status).toBe(200);
  if (communityId) {
    await env.DB.prepare("UPDATE event SET community_id = ? WHERE id = ?")
      .bind(communityId, event.id)
      .run();
  }
  await env.DB.prepare(
    "DELETE FROM event_member WHERE event_id = ? AND user_id = (SELECT id FROM user WHERE discord_id = 'dev-user')",
  )
    .bind(event.id)
    .run();
  return event.id;
}

async function fetchCards(
  eventId: string,
  cookie?: string,
): Promise<Response> {
  return await SELF.fetch(`${BASE}/api/events/${eventId}/name-cards`, {
    headers: cookie ? { cookie } : undefined,
  });
}

async function cardsOf(eventId: string, cookie: string): Promise<EventNameCard[]> {
  const res = await fetchCards(eventId, cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { cards: EventNameCard[] }).cards;
}

describe("名札の一括印刷: 誰が名簿を取れるか (#304)", () => {
  it("そのイベントの参加確定スタッフだけが取れる", async () => {
    const eventId = await setupEvent();
    const staff = await makeMember(eventId, "staff");

    const cards = await cardsOf(eventId, staff.cookie);
    expect(cards.map((c) => c.id)).toContain(staff.userId);
  });

  it("参加者・審査員・観覧者は取れない", async () => {
    const eventId = await setupEvent();
    for (const role of ["participant", "judge", "observer"] as const) {
      const member = await makeMember(eventId, role);
      const res = await fetchCards(eventId, member.cookie);
      expect(res.status).toBe(403);
    }
  });

  it("未確定のスタッフは取れない", async () => {
    const eventId = await setupEvent();
    const applied = await makeMember(eventId, "staff", "applied");
    const waitlist = await makeMember(eventId, "staff", "waitlist");

    expect((await fetchCards(eventId, applied.cookie)).status).toBe(403);
    expect((await fetchCards(eventId, waitlist.cookie)).status).toBe(403);
  });

  it("イベントに参加していないアプリ運営管理者は取れない", async () => {
    const eventId = await setupEvent();
    const admin = await loginDev();

    expect((await fetchCards(eventId, admin)).status).toBe(403);
  });

  it("コミュニティのオーナーでも、そのイベントのスタッフでなければ取れない", async () => {
    const owner = await makeUser();
    const communityId = await makeCommunity(owner.userId);
    const eventId = await setupEvent(communityId);

    expect((await fetchCards(eventId, owner.cookie)).status).toBe(403);
  });

  it("メンバーですらない人・未ログインは取れない", async () => {
    const eventId = await setupEvent();
    const stranger = await makeUser();

    expect((await fetchCards(eventId, stranger.cookie)).status).toBe(403);
    expect((await fetchCards(eventId)).status).toBe(401);
  });
});

describe("名札の一括印刷: 対象メンバー (#304)", () => {
  it("参加確定なら役割を問わず全員ぶん返る", async () => {
    const eventId = await setupEvent();
    const staff = await makeMember(eventId, "staff");
    const participant = await makeMember(eventId, "participant");
    const judge = await makeMember(eventId, "judge");
    const observer = await makeMember(eventId, "observer");

    const cards = await cardsOf(eventId, staff.cookie);
    expect(cards.map((c) => c.id).sort()).toEqual(
      [staff.userId, participant.userId, judge.userId, observer.userId].sort(),
    );
    expect(
      cards.find((c) => c.id === judge.userId)?.role,
    ).toBe("judge");
  });

  it("確定していない人・取り消した人は返らない", async () => {
    const eventId = await setupEvent();
    const staff = await makeMember(eventId, "staff");
    const applied = await makeMember(eventId, "participant", "applied");
    const waitlist = await makeMember(eventId, "participant", "waitlist");
    const canceled = await makeMember(eventId, "participant", "canceled");

    const ids = (await cardsOf(eventId, staff.cookie)).map((c) => c.id);
    expect(ids).not.toContain(applied.userId);
    expect(ids).not.toContain(waitlist.userId);
    expect(ids).not.toContain(canceled.userId);
  });

  it("表示名が未設定でもハンドルで名札を作れる", async () => {
    const eventId = await setupEvent();
    const staff = await makeMember(eventId, "staff");
    const noName = await makeMember(eventId, "participant", "confirmed", null);

    const card = (await cardsOf(eventId, staff.cookie)).find(
      (c) => c.id === noName.userId,
    );
    expect(card?.name).toBe(noName.username);
    expect(card?.handle).toBe(noName.username);
    expect(card?.avatarUrl).toBeNull();
  });

  it("カードに刷る実績（レベル・参加実績・コミュニティ）が付いてくる", async () => {
    const owner = await makeUser();
    const communityId = await makeCommunity(owner.userId);
    const eventId = await setupEvent(communityId);
    const staff = await makeMember(eventId, "staff");
    await addMember(eventId, owner.userId, "participant");

    const cards = await cardsOf(eventId, staff.cookie);
    const ownerCard = cards.find((c) => c.id === owner.userId);
    // レベルは1始まり、実績は0でも欠けずに入る（カード側が undefined を踏まない）
    expect(ownerCard?.gamification.level).toBeGreaterThanOrEqual(1);
    expect(ownerCard?.participation).toEqual({
      attended: 0,
      noShow: 0,
      hosted: 0,
      spoken: 0,
    });
    // 所属コミュニティはカードの帯に出る（アイコン未設定なら iconUrl は null）
    expect(ownerCard?.communities).toEqual([
      { id: communityId, name: expect.any(String), iconUrl: null },
    ]);
  });

  it("どのコミュニティにも属さない人は帯が空になる", async () => {
    const eventId = await setupEvent();
    const staff = await makeMember(eventId, "staff");
    const lone = await makeMember(eventId, "participant");

    const cards = await cardsOf(eventId, staff.cookie);
    expect(cards.find((c) => c.id === lone.userId)?.communities).toEqual([]);
  });

  it("退会申請中のユーザーは名簿に出ない", async () => {
    const eventId = await setupEvent();
    const staff = await makeMember(eventId, "staff");
    const leaving = await makeMember(eventId, "participant");
    await env.DB.prepare("UPDATE user SET deleted_at = ? WHERE id = ?")
      .bind(Date.now(), leaving.userId)
      .run();

    const ids = (await cardsOf(eventId, staff.cookie)).map((c) => c.id);
    expect(ids).not.toContain(leaving.userId);
  });

  it("存在しないイベントも 403（イベントの有無を漏らさない）", async () => {
    const missing = crypto.randomUUID();
    const stranger = await makeUser();
    // 権限が先に落ちる（イベントの有無を漏らさない）
    expect((await fetchCards(missing, stranger.cookie)).status).toBe(403);
  });
});

describe("名札の一括印刷: 実績の集計 (#304)", () => {
  /** 終了済み・公開・確定4人のイベントを作り、指定ユーザーを確定参加者にする */
  async function pastEventWithMembers(
    memberIds: string[],
  ): Promise<string> {
    const eventId = await setupEvent();
    await env.DB.prepare(
      "UPDATE event SET starts_at = ?, ends_at = ? WHERE id = ?",
    )
      .bind(1, 2, eventId)
      .run();
    for (const uid of memberIds) await addMember(eventId, uid, "participant");
    return eventId;
  }

  it("過去イベントの出席が参加実績として数えられる", async () => {
    const target = await makeUser();
    // 有効イベント（確定4人以上）の条件を満たすよう頭数をそろえる
    const others = await Promise.all([makeUser(), makeUser(), makeUser()]);
    await pastEventWithMembers([
      target.userId,
      ...others.map((o) => o.userId),
    ]);

    const eventId = await setupEvent();
    const staff = await makeMember(eventId, "staff");
    await addMember(eventId, target.userId, "participant");

    const card = (await cardsOf(eventId, staff.cookie)).find(
      (c) => c.id === target.userId,
    );
    expect(card?.participation.attended).toBe(1);
    // 有効イベントでの出席はXPにもなる（公開プロフィールと同じ導出）
    expect(card?.gamification.xp).toBeGreaterThan(0);
  });
});
