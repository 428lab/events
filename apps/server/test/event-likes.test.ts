import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { EventLikesSummary } from "@eventer/shared";

const BASE = "https://example.com";

/** 一般ユーザーを1人作る（管理者ではない） */
async function makeUser(): Promise<{
  userId: string;
  username: string;
  cookie: string;
}> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `u_${uid.slice(0, 6)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, username, "テスト", Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, username, cookie: `eventer_session=${sid}` };
}

/** イベントを作る（既定は公開・開始済み・終了前） */
async function makeEvent(
  cookie: string,
  opts: {
    startsAt?: number;
    endsAt?: number;
    scheduling?: boolean;
    publish?: boolean;
  } = {},
): Promise<string> {
  const now = Date.now();
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: `いいねE2E_${crypto.randomUUID().slice(0, 6)}`,
      venueType: "online",
      ...(opts.scheduling
        ? { scheduling: true }
        : {
            startsAt: opts.startsAt ?? now - 3600_000,
            endsAt: opts.endsAt ?? now + 3600_000,
          }),
    }),
  });
  expect(create.status).toBe(201);
  const { event } = (await create.json()) as { event: { id: string } };
  if (opts.publish !== false) {
    const pub = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ status: "published" }),
    });
    expect(pub.status).toBe(200);
  }
  return event.id;
}

/** 確定メンバー行を直接作る（開始済みイベントにも入れるため） */
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

/** コミュニティ行を直接作る */
async function makeCommunity(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO community (id, slug, name, description, owner_id, created_at) VALUES (?, ?, ?, '', ?, ?)",
  )
    .bind(id, `c-${id.slice(0, 8)}`, "テストコミュニティ", ownerId, Date.now())
    .run();
  return id;
}

async function putLike(
  eventId: string,
  cookie: string,
  body: { kind: string; targetKey?: string; on: boolean },
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/likes`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

async function getSummary(
  eventId: string,
  cookie: string,
): Promise<EventLikesSummary> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/likes`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { summary: EventLikesSummary }).summary;
}

describe("いいねフィードバック (#155)", () => {
  it("参加確定メンバーはイベント/主催者/スタッフ/コミュニティにいいねでき、トグル・冪等・mineが機能する", async () => {
    const owner = await makeUser();
    const staff = await makeUser();
    const member = await makeUser();
    const eventId = await makeEvent(owner.cookie);
    const communityId = await makeCommunity(owner.userId);
    await env.DB.prepare("UPDATE event SET community_id = ? WHERE id = ?")
      .bind(communityId, eventId)
      .run();
    await addMember(eventId, staff.userId, "staff");
    await addMember(eventId, member.userId);

    // イベント自体にいいね
    const r1 = await putLike(eventId, member.cookie, { kind: "event", on: true });
    expect(r1.status).toBe(200);
    // 冪等: 2回ONしても1のまま
    await putLike(eventId, member.cookie, { kind: "event", on: true });
    // 主催者・スタッフ・コミュニティにいいね
    for (const body of [
      { kind: "host", targetKey: owner.userId, on: true },
      { kind: "staff", targetKey: staff.userId, on: true },
      { kind: "community", targetKey: communityId, on: true },
    ]) {
      const res = await putLike(eventId, member.cookie, body);
      expect(res.status).toBe(200);
    }

    const s1 = await getSummary(eventId, member.cookie);
    expect(s1.event).toBe(1);
    expect(s1.host?.userId).toBe(owner.userId);
    expect(s1.host?.count).toBe(1);
    expect(s1.staff.map((x) => x.userId)).toEqual([staff.userId]);
    expect(s1.staff[0].count).toBe(1);
    expect(s1.community).toBe(1);
    expect(s1.mine).toHaveLength(4);
    expect(s1.mine).toContainEqual({ kind: "event", targetKey: "" });
    expect(s1.mine).toContainEqual({ kind: "host", targetKey: owner.userId });

    // 別メンバーの mine は空だが件数は見える
    const s2 = await getSummary(eventId, staff.cookie);
    expect(s2.event).toBe(1);
    expect(s2.mine).toHaveLength(0);

    // トグルOFF
    const off = await putLike(eventId, member.cookie, {
      kind: "event",
      on: false,
    });
    expect(off.status).toBe(200);
    const s3 = await getSummary(eventId, member.cookie);
    expect(s3.event).toBe(0);
    expect(s3.mine).toHaveLength(3);
  });

  it("自分自身へのいいねは拒否される（主催者→host、スタッフ→自分のstaff行）", async () => {
    const owner = await makeUser();
    const staff = await makeUser();
    const eventId = await makeEvent(owner.cookie);
    await addMember(eventId, staff.userId, "staff");

    const r1 = await putLike(eventId, owner.cookie, {
      kind: "host",
      targetKey: owner.userId,
      on: true,
    });
    expect(r1.status).toBe(403);
    expect(((await r1.json()) as { error: string }).error).toBe("self_like");

    const r2 = await putLike(eventId, staff.cookie, {
      kind: "staff",
      targetKey: staff.userId,
      on: true,
    });
    expect(r2.status).toBe(403);
    expect(((await r2.json()) as { error: string }).error).toBe("self_like");
  });

  it("非メンバーは403、開始前・日程調整中は409", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const eventId = await makeEvent(owner.cookie);

    // 非メンバー: GET/PUTとも403
    const g = await SELF.fetch(`${BASE}/api/events/${eventId}/likes`, {
      headers: { cookie: outsider.cookie },
    });
    expect(g.status).toBe(403);
    const p = await putLike(eventId, outsider.cookie, { kind: "event", on: true });
    expect(p.status).toBe(403);

    // 開始前（未来イベント）: 409
    const now = Date.now();
    const future = await makeEvent(owner.cookie, {
      startsAt: now + 3600_000,
      endsAt: now + 7200_000,
    });
    const member = await makeUser();
    await addMember(future, member.userId);
    const f = await putLike(future, member.cookie, { kind: "event", on: true });
    expect(f.status).toBe(409);
    expect(((await f.json()) as { error: string }).error).toBe("not_started");

    // 日程調整中（開催日時未確定）: 409
    const scheduling = await makeEvent(owner.cookie, { scheduling: true });
    await addMember(scheduling, member.userId);
    const s = await putLike(scheduling, member.cookie, {
      kind: "event",
      on: true,
    });
    expect(s.status).toBe(409);
  });

  it("不正な対象は400（スタッフでない人・主催者以外のhost・コミュニティ無し）", async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const other = await makeUser();
    const eventId = await makeEvent(owner.cookie);
    await addMember(eventId, member.userId);
    await addMember(eventId, other.userId); // participant（staffではない）

    // participant を staff 対象に指定
    const r1 = await putLike(eventId, member.cookie, {
      kind: "staff",
      targetKey: other.userId,
      on: true,
    });
    expect(r1.status).toBe(400);
    // host の targetKey が主催者以外
    const r2 = await putLike(eventId, member.cookie, {
      kind: "host",
      targetKey: other.userId,
      on: true,
    });
    expect(r2.status).toBe(400);
    // コミュニティ無しイベントへの community いいね
    const r3 = await putLike(eventId, member.cookie, {
      kind: "community",
      targetKey: crypto.randomUUID(),
      on: true,
    });
    expect(r3.status).toBe(400);
    // 主催者本人を staff 対象に指定（host 側で表すため不可）
    const r4 = await putLike(eventId, member.cookie, {
      kind: "staff",
      targetKey: owner.userId,
      on: true,
    });
    expect(r4.status).toBe(400);
  });

  it("公開プロフィールの参加実績にもらったいいね合計が出る（下書きイベント分は除外）", async () => {
    const owner = await makeUser();
    const staff = await makeUser();
    const m1 = await makeUser();
    const m2 = await makeUser();
    const eventId = await makeEvent(owner.cookie);
    await addMember(eventId, staff.userId, "staff");
    await addMember(eventId, m1.userId);
    await addMember(eventId, m2.userId);

    // owner は host として2件、staff は staff として1件もらう
    await putLike(eventId, m1.cookie, {
      kind: "host",
      targetKey: owner.userId,
      on: true,
    });
    await putLike(eventId, m2.cookie, {
      kind: "host",
      targetKey: owner.userId,
      on: true,
    });
    await putLike(eventId, m1.cookie, {
      kind: "staff",
      targetKey: staff.userId,
      on: true,
    });

    // 下書きイベントへのいいねは合計に含まれない（直接insertで再現）
    const draft = await makeEvent(owner.cookie, { publish: false });
    await env.DB.prepare(
      "INSERT INTO event_like (id, event_id, user_id, kind, target_key, created_at) VALUES (?, ?, ?, 'host', ?, ?)",
    )
      .bind(crypto.randomUUID(), draft, m1.userId, owner.userId, Date.now())
      .run();

    const profile = async (username: string) => {
      const res = await SELF.fetch(`${BASE}/api/public/users/${username}`);
      expect(res.status).toBe(200);
      return (await res.json()) as {
        participation: { likesReceived: number };
      };
    };
    expect((await profile(owner.username)).participation.likesReceived).toBe(2);
    expect((await profile(staff.username)).participation.likesReceived).toBe(1);
    expect((await profile(m1.username)).participation.likesReceived).toBe(0);
  });

  it("コミュニティ詳細にもらったいいね合計が出る", async () => {
    const owner = await makeUser();
    const m1 = await makeUser();
    const eventId = await makeEvent(owner.cookie);
    const communityId = await makeCommunity(owner.userId);
    await env.DB.prepare("UPDATE event SET community_id = ? WHERE id = ?")
      .bind(communityId, eventId)
      .run();
    await addMember(eventId, m1.userId);

    await putLike(eventId, m1.cookie, {
      kind: "community",
      targetKey: communityId,
      on: true,
    });

    const slugRow = await env.DB.prepare(
      "SELECT slug FROM community WHERE id = ?",
    )
      .bind(communityId)
      .first<{ slug: string }>();
    const res = await SELF.fetch(
      `${BASE}/api/public/communities/${slugRow!.slug}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { likesReceived: number };
    expect(body.likesReceived).toBe(1);
  });
});
