import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

async function makeUser(): Promise<{
  userId: string;
  username: string;
  cookie: string;
}> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `u_${uid.slice(0, 8)}`;
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

async function notifTypes(cookie: string): Promise<string[]> {
  const res = await SELF.fetch(`${BASE}/api/notifications`, {
    headers: { cookie },
  });
  const { notifications } = (await res.json()) as {
    notifications: { type: string }[];
  };
  return notifications.map((n) => n.type);
}

describe("フォローと通知 (#21)", () => {
  it("フォロー/解除でプロフィールのカウントと isFollowing が変わる。自分はフォロー不可", async () => {
    const alice = await makeUser();
    const bob = await makeUser();

    // alice が bob をフォロー
    const on = await SELF.fetch(`${BASE}/api/users/${bob.username}/follow`, {
      method: "POST",
      headers: { cookie: alice.cookie },
    });
    expect(on.status).toBe(200);
    expect((await on.json()) as object).toMatchObject({
      isFollowing: true,
      followerCount: 1,
    });

    // プロフィールに反映（alice視点）
    const prof = await SELF.fetch(`${BASE}/api/public/users/${bob.username}`, {
      headers: { cookie: alice.cookie },
    });
    const p = (await prof.json()) as {
      followerCount: number;
      isFollowing: boolean;
      isMe: boolean;
    };
    expect(p.followerCount).toBe(1);
    expect(p.isFollowing).toBe(true);
    expect(p.isMe).toBe(false);

    // 未ログインでは isFollowing=false・数は見える
    const anon = await SELF.fetch(`${BASE}/api/public/users/${bob.username}`);
    const ap = (await anon.json()) as {
      followerCount: number;
      isFollowing: boolean;
    };
    expect(ap.followerCount).toBe(1);
    expect(ap.isFollowing).toBe(false);

    // 自分フォローは 400
    const self = await SELF.fetch(
      `${BASE}/api/users/${alice.username}/follow`,
      { method: "POST", headers: { cookie: alice.cookie } },
    );
    expect(self.status).toBe(400);

    // 解除
    const off = await SELF.fetch(`${BASE}/api/users/${bob.username}/follow`, {
      method: "DELETE",
      headers: { cookie: alice.cookie },
    });
    expect((await off.json()) as object).toMatchObject({
      isFollowing: false,
      followerCount: 0,
    });

    // 未ログインは 401
    const noauth = await SELF.fetch(
      `${BASE}/api/users/${bob.username}/follow`,
      { method: "POST" },
    );
    expect(noauth.status).toBe(401);
  });

  it("フォロー中一覧は本人の /me/following で見える", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    await SELF.fetch(`${BASE}/api/users/${bob.username}/follow`, {
      method: "POST",
      headers: { cookie: alice.cookie },
    });
    const res = await SELF.fetch(`${BASE}/api/me/following`, {
      headers: { cookie: alice.cookie },
    });
    const { following } = (await res.json()) as {
      following: { id: string }[];
    };
    expect(following.some((u) => u.id === bob.userId)).toBe(true);
  });

  it("フォロー相手のイベント公開でフォロワーに通知（再公開では重複しない・本人には来ない）", async () => {
    const follower = await makeUser();
    const host = await loginDev(); // DevUser がフォロイー
    const meRes = await SELF.fetch(`${BASE}/api/auth/me`, {
      headers: { cookie: host },
    });
    const me = (await meRes.json()) as { user: { username: string } };
    const followRes = await SELF.fetch(
      `${BASE}/api/users/${me.user.username}/follow`,
      { method: "POST", headers: { cookie: follower.cookie } },
    );
    expect(followRes.status).toBe(200);

    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: host },
      body: JSON.stringify({
        title: `フォロー通知イベント_${crypto.randomUUID().slice(0, 6)}`,
        venueType: "online",
        startsAt: Date.now() + 3600_000,
        endsAt: Date.now() + 7200_000,
      }),
    });
    const { event } = (await create.json()) as { event: { id: string } };

    // 下書きの時点では通知なし
    expect(await notifTypes(follower.cookie)).not.toContain(
      "followee_created_event",
    );

    // 公開 → 通知1件
    await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: host },
      body: JSON.stringify({ status: "published" }),
    });
    const after = await notifTypes(follower.cookie);
    expect(
      after.filter((t) => t === "followee_created_event").length,
    ).toBe(1);

    // 再公開（PATCH）しても増えない
    await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: host },
      body: JSON.stringify({ status: "published" }),
    });
    expect(
      (await notifTypes(follower.cookie)).filter(
        (t) => t === "followee_created_event",
      ).length,
    ).toBe(1);
  });

  it("フォロー相手が公開イベントに参加するとフォロワーに通知", async () => {
    const follower = await makeUser();
    const joiner = await makeUser();
    const host = await loginDev();

    await SELF.fetch(`${BASE}/api/users/${joiner.username}/follow`, {
      method: "POST",
      headers: { cookie: follower.cookie },
    });

    // 公開イベントを用意
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: host },
      body: JSON.stringify({
        title: `参加通知イベント_${crypto.randomUUID().slice(0, 6)}`,
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

    // joiner が参加（枠なし＝即confirmed）
    const join = await SELF.fetch(`${BASE}/api/events/${event.id}/join`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: joiner.cookie },
      body: JSON.stringify({}),
    });
    expect(join.status).toBe(201);

    const types = await notifTypes(follower.cookie);
    expect(types).toContain("followee_joined_event");
    // 本人（joiner）には来ない
    expect(await notifTypes(joiner.cookie)).not.toContain(
      "followee_joined_event",
    );
  });
});
