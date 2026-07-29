import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

/** dev-login（DevUser=管理者）してセッションcookieを返す */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** 非adminユーザーを作って { userId, cookie } を返す */
async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, `u_${uid.slice(0, 6)}`, "テスト", Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

/** コミュニティを直接作成し、memberIds をメンバーにする */
async function makeCommunity(
  ownerId: string,
  memberIds: string[],
): Promise<string> {
  const cid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO community (id, slug, name, owner_id, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(cid, `c${cid.slice(0, 8)}`, "テストコミュ", ownerId, Date.now())
    .run();
  for (const uid of [ownerId, ...memberIds]) {
    await env.DB.prepare(
      "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        crypto.randomUUID(),
        cid,
        uid,
        uid === ownerId ? "owner" : "member",
        Date.now(),
      )
      .run();
  }
  return cid;
}

async function postRequest(
  cookie: string,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/event-requests`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ title, ...extra }),
  });
  expect(res.status).toBe(201);
  const { request } = (await res.json()) as { request: { id: string } };
  return request.id;
}

describe("イベントのたまご (#29)", () => {
  it("投稿→公開一覧に出る→賛同で人数が増える", async () => {
    const user = await makeUser();
    const title = `たまご_${crypto.randomUUID().slice(0, 8)}`;
    const id = await postRequest(user.cookie, title);

    // 未ログインで一覧・詳細が見える
    const list = await SELF.fetch(`${BASE}/api/public/event-requests`);
    expect(list.status).toBe(200);
    const { requests } = (await list.json()) as {
      requests: { id: string; title: string }[];
    };
    expect(requests.some((r) => r.id === id)).toBe(true);

    // 別ユーザーが「参加したい」「開催してもいい」
    const fan = await makeUser();
    for (const kind of ["attend", "host"]) {
      const res = await SELF.fetch(`${BASE}/api/event-requests/${id}/react`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: fan.cookie },
        body: JSON.stringify({ kind, on: true }),
      });
      expect(res.status).toBe(200);
    }
    const detail = await SELF.fetch(`${BASE}/api/public/event-requests/${id}`, {
      headers: { cookie: fan.cookie },
    });
    const d = (await detail.json()) as {
      request: { attendCount: number; hostCount: number };
      myReactions: string[];
    };
    expect(d.request.attendCount).toBe(1);
    expect(d.request.hostCount).toBe(1);
    expect(d.myReactions.sort()).toEqual(["attend", "host"]);

    // 賛同取り消し
    const off = await SELF.fetch(`${BASE}/api/event-requests/${id}/react`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: fan.cookie },
      body: JSON.stringify({ kind: "attend", on: false }),
    });
    const offBody = (await off.json()) as { request: { attendCount: number } };
    expect(offBody.request.attendCount).toBe(0);
  });

  it("メンバー限定のコミュニティたまごは非メンバーに見えない・公開一覧にも出ない", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const cid = await makeCommunity(owner.userId, []);
    const title = `限定たまご_${crypto.randomUUID().slice(0, 8)}`;
    const id = await postRequest(owner.cookie, title, {
      communityId: cid,
      membersOnly: true,
    });

    // 非メンバー → 404
    const denied = await SELF.fetch(
      `${BASE}/api/public/event-requests/${id}`,
      { headers: { cookie: outsider.cookie } },
    );
    expect(denied.status).toBe(404);
    // 未ログイン → 404
    const anon = await SELF.fetch(`${BASE}/api/public/event-requests/${id}`);
    expect(anon.status).toBe(404);
    // 公開一覧にも出ない
    const list = await SELF.fetch(`${BASE}/api/public/event-requests`);
    const { requests } = (await list.json()) as { requests: { id: string }[] };
    expect(requests.some((r) => r.id === id)).toBe(false);
    // メンバー（owner本人）→ 200
    const mine = await SELF.fetch(`${BASE}/api/public/event-requests/${id}`, {
      headers: { cookie: owner.cookie },
    });
    expect(mine.status).toBe(200);

    // 投稿者ではない一般メンバー → 200（memberRole 経由の判定パス）
    const member = await makeUser();
    await env.DB.prepare(
      "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)",
    )
      .bind(crypto.randomUUID(), cid, member.userId, Date.now())
      .run();
    const memberView = await SELF.fetch(
      `${BASE}/api/public/event-requests/${id}`,
      { headers: { cookie: member.cookie } },
    );
    expect(memberView.status).toBe(200);
  });

  it("非メンバーはコミュニティたまごを投稿できない(403)・賛同もできない(403)", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const cid = await makeCommunity(owner.userId, []);
    const res = await SELF.fetch(`${BASE}/api/event-requests`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: outsider.cookie },
      body: JSON.stringify({ title: "勝手に投稿", communityId: cid }),
    });
    expect(res.status).toBe(403);

    // コミュニティ公開たまご（閲覧は誰でも可）でも賛同はメンバーのみ
    const id = await postRequest(owner.cookie, "コミュ公開たまご", {
      communityId: cid,
    });
    const react = await SELF.fetch(`${BASE}/api/event-requests/${id}/react`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: outsider.cookie },
      body: JSON.stringify({ kind: "attend", on: true }),
    });
    expect(react.status).toBe(403);
  });

  it("コミュニティ詳細のたまご欄: メンバー限定は非メンバーに出ない", async () => {
    const owner = await makeUser();
    const cid = await makeCommunity(owner.userId, []);
    // slug を取得
    const row = await env.DB.prepare("SELECT slug FROM community WHERE id = ?")
      .bind(cid)
      .first<{ slug: string }>();
    const openId = await postRequest(owner.cookie, "公開たまご", {
      communityId: cid,
    });
    const secretId = await postRequest(owner.cookie, "限定たまご", {
      communityId: cid,
      membersOnly: true,
    });

    // 未ログイン → 公開のみ
    const anon = await SELF.fetch(
      `${BASE}/api/public/communities/${row!.slug}`,
    );
    const anonBody = (await anon.json()) as { requests: { id: string }[] };
    expect(anonBody.requests.some((r) => r.id === openId)).toBe(true);
    expect(anonBody.requests.some((r) => r.id === secretId)).toBe(false);

    // メンバー（owner）→ 両方
    const mine = await SELF.fetch(
      `${BASE}/api/public/communities/${row!.slug}`,
      { headers: { cookie: owner.cookie } },
    );
    const mineBody = (await mine.json()) as { requests: { id: string }[] };
    expect(mineBody.requests.some((r) => r.id === secretId)).toBe(true);
  });

  it("公開済みイベントの link-event は即時通知され、再POSTしても重複しない", async () => {
    const requester = await makeUser();
    const host = await loginDev();
    const id = await postRequest(requester.cookie, "即時通知たまご");

    // 公開済みイベントを作成
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: host },
      body: JSON.stringify({
        title: "公開済みイベント",
        venueType: "online",
        startsAt: Date.now() + 3600_000,
        endsAt: Date.now() + 7200_000,
      }),
    });
    const { event } = (await create.json()) as { event: { id: string } };
    await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: host },
      body: JSON.stringify({ status: "published" }),
    });

    // link-event を3回連打
    for (let i = 0; i < 3; i++) {
      const res = await SELF.fetch(
        `${BASE}/api/event-requests/${id}/link-event`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: host },
          body: JSON.stringify({ eventId: event.id }),
        },
      );
      expect(res.status).toBe(200);
    }
    const notifs = await SELF.fetch(`${BASE}/api/notifications`, {
      headers: { cookie: requester.cookie },
    });
    const body = (await notifs.json()) as {
      notifications: { type: string }[];
    };
    expect(
      body.notifications.filter((n) => n.type === "request_event_created")
        .length,
    ).toBe(1);
  });

  it("検索: キーワードで絞り込め、人気順で並ぶ (#31)", async () => {
    const user = await makeUser();
    const fan1 = await makeUser();
    const fan2 = await makeUser();
    const tag = crypto.randomUUID().slice(0, 8);
    const plainId = await postRequest(user.cookie, `検索用たまご_${tag}`);
    const popularId = await postRequest(user.cookie, `検索用人気たまご_${tag}`, {
      description: "説明にもキーワード",
    });
    // popular に「参加したい」2票
    for (const fan of [fan1, fan2]) {
      await SELF.fetch(`${BASE}/api/event-requests/${popularId}/react`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: fan.cookie },
        body: JSON.stringify({ kind: "attend", on: true }),
      });
    }

    // キーワード検索（タイトル一致）
    const res = await SELF.fetch(
      `${BASE}/api/public/event-requests?q=${encodeURIComponent(tag)}`,
    );
    const body = (await res.json()) as {
      requests: { id: string }[];
      total: number;
    };
    expect(body.total).toBe(2);
    expect(body.requests.map((r) => r.id).sort()).toEqual(
      [plainId, popularId].sort(),
    );

    // 検索に引っかからないキーワード
    const none = await SELF.fetch(
      `${BASE}/api/public/event-requests?q=${encodeURIComponent(`存在しない_${tag}`)}`,
    );
    expect(((await none.json()) as { total: number }).total).toBe(0);

    // 人気順: popular（2票）が plain（0票）より先
    const popular = await SELF.fetch(
      `${BASE}/api/public/event-requests?q=${encodeURIComponent(tag)}&sort=popular`,
    );
    const popularBody = (await popular.json()) as {
      requests: { id: string }[];
    };
    expect(popularBody.requests[0].id).toBe(popularId);

    // LIKE ワイルドカードはリテラル扱い（%で全件ヒットしない）
    const wild = await SELF.fetch(
      `${BASE}/api/public/event-requests?q=${encodeURIComponent(`%${tag}`)}`,
    );
    expect(((await wild.json()) as { total: number }).total).toBe(0);
  });

  it("イベント詳細から生まれ元のたまごへ辿れる。メンバー限定たまごは権限のある人だけ (#33)", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const host = await loginDev();
    const cid = await makeCommunity(owner.userId, []);
    // メンバー限定たまご（owner が投稿）
    const secretId = await postRequest(owner.cookie, "限定の生まれ元たまご", {
      communityId: cid,
      membersOnly: true,
    });
    // 全体公開たまご
    const openId = await postRequest(owner.cookie, "公開の生まれ元たまご");

    // host（admin）がイベントを作り両方にリンク→公開
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: host },
      body: JSON.stringify({
        title: "たまご生まれイベント",
        venueType: "online",
        startsAt: Date.now() + 3600_000,
        endsAt: Date.now() + 7200_000,
      }),
    });
    const { event } = (await create.json()) as { event: { id: string } };
    for (const rid of [secretId, openId]) {
      await SELF.fetch(`${BASE}/api/event-requests/${rid}/link-event`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: host },
        body: JSON.stringify({ eventId: event.id }),
      });
    }
    await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: host },
      body: JSON.stringify({ status: "published" }),
    });

    // 非メンバー: 公開たまごだけ見える
    const view = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      headers: { cookie: outsider.cookie },
    });
    const body = (await view.json()) as {
      fromRequests: { id: string }[];
    };
    expect(body.fromRequests.some((r) => r.id === openId)).toBe(true);
    expect(body.fromRequests.some((r) => r.id === secretId)).toBe(false);

    // メンバー（owner=投稿者）: 両方見える
    const memberView = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      headers: { cookie: owner.cookie },
    });
    const memberBody = (await memberView.json()) as {
      fromRequests: { id: string }[];
    };
    expect(memberBody.fromRequests.map((r) => r.id).sort()).toEqual(
      [openId, secretId].sort(),
    );

    // 投稿者ではない一般メンバーでも両方見える（memberRole 経由の判定パス）
    const plainMember = await makeUser();
    await env.DB.prepare(
      "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)",
    )
      .bind(crypto.randomUUID(), cid, plainMember.userId, Date.now())
      .run();
    const plainView = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      headers: { cookie: plainMember.cookie },
    });
    const plainBody = (await plainView.json()) as {
      fromRequests: { id: string }[];
    };
    expect(plainBody.fromRequests.map((r) => r.id).sort()).toEqual(
      [openId, secretId].sort(),
    );

    // 未ログイン: 公開たまごだけ
    const anon = await SELF.fetch(`${BASE}/api/events/${event.id}`);
    const anonBody = (await anon.json()) as { fromRequests: { id: string }[] };
    expect(anonBody.fromRequests.some((r) => r.id === openId)).toBe(true);
    expect(anonBody.fromRequests.some((r) => r.id === secretId)).toBe(false);
  });

  it("短い共有URL: by-slug でID解決でき、メンバー限定は非メンバーに404 (#42)", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const id = await postRequest(owner.cookie, "共有たまご");
    const detail = await SELF.fetch(`${BASE}/api/public/event-requests/${id}`);
    const { request } = (await detail.json()) as {
      request: { slug: string };
    };
    expect(request.slug).toMatch(/^[0-9a-f]{8}$/);

    // 未ログインで by-slug 解決
    const bySlug = await SELF.fetch(
      `${BASE}/api/public/event-requests/by-slug/${request.slug}`,
    );
    expect(bySlug.status).toBe(200);
    expect(((await bySlug.json()) as { id: string }).id).toBe(id);

    // メンバー限定たまごの slug は非メンバーに404
    const cid = await makeCommunity(owner.userId, []);
    const secretId = await postRequest(owner.cookie, "限定共有たまご", {
      communityId: cid,
      membersOnly: true,
    });
    const secretDetail = await SELF.fetch(
      `${BASE}/api/public/event-requests/${secretId}`,
      { headers: { cookie: owner.cookie } },
    );
    const secret = (await secretDetail.json()) as {
      request: { slug: string };
    };
    const denied = await SELF.fetch(
      `${BASE}/api/public/event-requests/by-slug/${secret.request.slug}`,
      { headers: { cookie: outsider.cookie } },
    );
    expect(denied.status).toBe(404);

    // /r/:slug は SPA HTML（公開たまごは OG 注入あり・限定はなし）
    const og = await SELF.fetch(`${BASE}/r/${request.slug}`);
    expect(og.status).toBe(200);
    const html = await og.text();
    expect(html).toContain("og:title");
    expect(html).toContain("共有たまご");
    const secretOg = await SELF.fetch(`${BASE}/r/${secret.request.slug}`);
    const secretHtml = await secretOg.text();
    expect(secretHtml).not.toContain("限定共有たまご");
  });

  it("コミュニティを削除してもたまごは残り、全体たまご化される", async () => {
    const owner = await makeUser();
    const cid = await makeCommunity(owner.userId, []);
    const id = await postRequest(owner.cookie, "生き残りたまご", {
      communityId: cid,
      membersOnly: true,
    });
    const del = await SELF.fetch(`${BASE}/api/communities/${cid}`, {
      method: "DELETE",
      headers: { cookie: owner.cookie },
    });
    expect(del.status).toBe(200);
    // たまごは残り、コミュニティなし＋限定解除になっている
    const detail = await SELF.fetch(`${BASE}/api/public/event-requests/${id}`);
    expect(detail.status).toBe(200);
    const d = (await detail.json()) as {
      request: { communityId: string | null; membersOnly: boolean };
    };
    expect(d.request.communityId).toBeNull();
    expect(d.request.membersOnly).toBe(false);
  });

  it("開催宣言→イベント公開で投稿者と賛同者に通知が届く（宣言者本人には届かない）", async () => {
    const requester = await makeUser();
    const fan = await makeUser();
    const host = await loginDev(); // イベント作成者（admin）
    const title = `孵化たまご_${crypto.randomUUID().slice(0, 8)}`;
    const id = await postRequest(requester.cookie, title);
    await SELF.fetch(`${BASE}/api/event-requests/${id}/react`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: fan.cookie },
      body: JSON.stringify({ kind: "attend", on: true }),
    });

    // host がイベント作成（draft）→ リンク → この時点では通知なし
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: host },
      body: JSON.stringify({
        title: `${title}に応えるイベント`,
        venueType: "online",
        startsAt: Date.now() + 3600_000,
        endsAt: Date.now() + 7200_000,
      }),
    });
    const { event } = (await create.json()) as { event: { id: string } };
    const link = await SELF.fetch(
      `${BASE}/api/event-requests/${id}/link-event`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: host },
        body: JSON.stringify({ eventId: event.id }),
      },
    );
    expect(link.status).toBe(200);

    const notifsBefore = await SELF.fetch(`${BASE}/api/notifications`, {
      headers: { cookie: requester.cookie },
    });
    const before = (await notifsBefore.json()) as {
      notifications: { type: string }[];
    };
    expect(
      before.notifications.some((n) => n.type === "request_event_created"),
    ).toBe(false);

    // 公開 → 通知発火
    await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: host },
      body: JSON.stringify({ status: "published" }),
    });
    for (const target of [requester, fan]) {
      const res = await SELF.fetch(`${BASE}/api/notifications`, {
        headers: { cookie: target.cookie },
      });
      const body = (await res.json()) as {
        notifications: { type: string; link: string }[];
      };
      const notif = body.notifications.find(
        (n) => n.type === "request_event_created",
      );
      expect(notif).toBeTruthy();
      expect(notif!.link).toBe(`/events/${event.id}`);
    }

    // 詳細にイベントがリンクされている
    const detail = await SELF.fetch(`${BASE}/api/public/event-requests/${id}`);
    const d = (await detail.json()) as { events: { id: string }[] };
    expect(d.events.some((e) => e.id === event.id)).toBe(true);

    // 再公開しても通知は重複しない
    await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: host },
      body: JSON.stringify({ status: "published" }),
    });
    const again = await SELF.fetch(`${BASE}/api/notifications`, {
      headers: { cookie: requester.cookie },
    });
    const againBody = (await again.json()) as {
      notifications: { type: string }[];
    };
    expect(
      againBody.notifications.filter(
        (n) => n.type === "request_event_created",
      ).length,
    ).toBe(1);
  });

  it("他人のイベントは勝手にリンクできない(403)・クローズは投稿者のみ", async () => {
    const requester = await makeUser();
    const stranger = await makeUser();
    const host = await loginDev();
    const id = await postRequest(requester.cookie, "権限テストたまご");

    // host のイベントを stranger がリンクしようとする → 403
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: host },
      body: JSON.stringify({
        title: "他人のイベント",
        venueType: "online",
        startsAt: Date.now() + 3600_000,
        endsAt: Date.now() + 7200_000,
      }),
    });
    const { event } = (await create.json()) as { event: { id: string } };
    const link = await SELF.fetch(
      `${BASE}/api/event-requests/${id}/link-event`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: stranger.cookie },
        body: JSON.stringify({ eventId: event.id }),
      },
    );
    expect(link.status).toBe(403);

    // 他人はクローズできない
    const close = await SELF.fetch(`${BASE}/api/event-requests/${id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: stranger.cookie },
      body: JSON.stringify({ status: "closed" }),
    });
    expect(close.status).toBe(403);

    // 投稿者はクローズできる → クローズ後は賛同できない(409)
    const closeMine = await SELF.fetch(
      `${BASE}/api/event-requests/${id}/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: requester.cookie },
        body: JSON.stringify({ status: "closed" }),
      },
    );
    expect(closeMine.status).toBe(200);
    const react = await SELF.fetch(`${BASE}/api/event-requests/${id}/react`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: stranger.cookie },
      body: JSON.stringify({ kind: "attend", on: true }),
    });
    expect(react.status).toBe(409);
  });
});
