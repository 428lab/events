import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { EventComment } from "@eventer/shared";

const BASE = "https://example.com";

/** dev-login（DevUser=staff/管理者）してセッションcookieを返す */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** 公開イベントを作って ID を返す */
async function setupEvent(cookie: string): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "コメントE2E",
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
  return event.id;
}

/** 非adminのユーザーを1人作る（メンバーにはしない）。 */
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

/** 非adminのメンバーを1人作る（status を指定可） */
async function makeMember(
  eventId: string,
  role: "participant" | "staff" | "judge" | "observer",
  status = "confirmed",
): Promise<{ userId: string; cookie: string }> {
  const u = await makeUser();
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, ?, 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, u.userId, role, status, Date.now())
    .run();
  return u;
}

async function postComment(
  eventId: string,
  cookie: string,
  body: string,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ body }),
  });
}

describe("イベントのサブタイトル (#77)", () => {
  it("作成・更新でサブタイトルが保存され GET に含まれる", async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
    const cookie = res.headers.get("set-cookie")!.split(";")[0];
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        title: "サブタイトル検証",
        subtitle: "副題テスト",
        venueType: "online",
        startsAt: Date.now() + 3600_000,
        endsAt: Date.now() + 7200_000,
      }),
    });
    expect(create.status).toBe(201);
    const { event } = (await create.json()) as {
      event: { id: string; subtitle: string };
    };
    expect(event.subtitle).toBe("副題テスト");
    const patch = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ subtitle: "変更後" }),
    });
    expect(
      ((await patch.json()) as { event: { subtitle: string } }).event.subtitle,
    ).toBe("変更後");
  });
});

describe("イベントコメント (#72)", () => {
  it("確定メンバーが投稿でき、公開GETで誰でも読める。非メンバー403・未ログイン401", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const member = await makeMember(eventId, "participant");

    const created = await postComment(eventId, member.cookie, "**こんにちは**");
    expect(created.status).toBe(201);
    const { comment } = (await created.json()) as { comment: EventComment };
    expect(comment.body).toBe("**こんにちは**");
    expect(comment.userId).toBe(member.userId);

    // 未ログインでも公開イベントのコメントは読める
    const anonGet = await SELF.fetch(`${BASE}/api/events/${eventId}/comments`);
    expect(anonGet.status).toBe(200);
    const { comments } = (await anonGet.json()) as { comments: EventComment[] };
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("**こんにちは**");
    expect(comments[0].userName).toBe("テスト");

    // 非メンバー（ログイン済み）の投稿は 403
    const outsider = await makeUser();
    const denied = await postComment(eventId, outsider.cookie, "外野です");
    expect(denied.status).toBe(403);

    // 未ログインの投稿は 401
    const anonPost = await SELF.fetch(`${BASE}/api/events/${eventId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "匿名" }),
    });
    expect([401, 403]).toContain(anonPost.status);

    // 未確定（waitlist）メンバーの投稿も 403
    const waitlisted = await makeMember(eventId, "participant", "waitlist");
    const deniedWl = await postComment(eventId, waitlisted.cookie, "待機中");
    expect(deniedWl.status).toBe(403);
  });

  it("下書きイベントのコメントは非メンバー・未ログインには読めない", async () => {
    const admin = await loginDev();
    // setupEvent は公開するので、ここでは下書きのまま作る
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({
        title: "下書きコメントE2E",
        venueType: "offline",
        startsAt: 1,
        endsAt: 99999999999999,
      }),
    });
    const { event } = (await create.json()) as { event: { id: string } };

    const anon = await SELF.fetch(`${BASE}/api/events/${event.id}/comments`);
    expect(anon.status).toBe(403);

    const outsider = await makeUser();
    const outsiderGet = await SELF.fetch(
      `${BASE}/api/events/${event.id}/comments`,
      { headers: { cookie: outsider.cookie } },
    );
    expect(outsiderGet.status).toBe(403);

    // メンバー（下書きイベントの staff=作成者）は読める
    const staffGet = await SELF.fetch(
      `${BASE}/api/events/${event.id}/comments`,
      { headers: { cookie: admin } },
    );
    expect(staffGet.status).toBe(200);
  });

  it("削除: 本人OK・他人の一般参加者403・staffは他人のコメントも削除可", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const author = await makeMember(eventId, "participant");
    const other = await makeMember(eventId, "participant");
    const staff = await makeMember(eventId, "staff");

    const post = async () => {
      const res = await postComment(eventId, author.cookie, "消される運命");
      expect(res.status).toBe(201);
      return ((await res.json()) as { comment: EventComment }).comment.id;
    };
    const del = (commentId: string, cookie: string) =>
      SELF.fetch(`${BASE}/api/events/${eventId}/comments/${commentId}`, {
        method: "DELETE",
        headers: { cookie },
      });

    // 他人の一般参加者は 403
    const c1 = await post();
    expect((await del(c1, other.cookie)).status).toBe(403);

    // 本人は削除できる
    expect((await del(c1, author.cookie)).status).toBe(200);

    // staff は他人のコメントも削除できる
    const c2 = await post();
    expect((await del(c2, staff.cookie)).status).toBe(200);

    // 存在しないコメントは 404
    expect((await del(crypto.randomUUID(), staff.cookie)).status).toBe(404);

    // 全部消えている
    const list = await SELF.fetch(`${BASE}/api/events/${eventId}/comments`);
    const { comments } = (await list.json()) as { comments: EventComment[] };
    expect(comments).toHaveLength(0);
  });

  it("members_note: 確定メンバーのGETには含まれ、非メンバー・未ログインにはキー自体含まれない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);

    // staff が PATCH で設定
    const patch = await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ membersNote: "Discord招待: https://example.com" }),
    });
    expect(patch.status).toBe(200);
    // PATCH レスポンスの event（公開スキーマ）にも漏れない
    const patched = (await patch.json()) as { event: Record<string, unknown> };
    expect("membersNote" in patched.event).toBe(false);
    expect("members_note" in patched.event).toBe(false);

    // 確定メンバーには membersNote が返る
    const member = await makeMember(eventId, "participant");
    const memberGet = await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      headers: { cookie: member.cookie },
    });
    const memberBody = (await memberGet.json()) as {
      membersNote?: string;
      event: Record<string, unknown>;
    };
    expect(memberBody.membersNote).toBe("Discord招待: https://example.com");
    expect("membersNote" in memberBody.event).toBe(false);

    // 未確定（waitlist）メンバーにはキー自体含まれない
    const waitlisted = await makeMember(eventId, "participant", "waitlist");
    const wlGet = await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      headers: { cookie: waitlisted.cookie },
    });
    expect("membersNote" in ((await wlGet.json()) as object)).toBe(false);

    // 非メンバー（ログイン済み）にもキー自体含まれない
    const outsider = await makeUser();
    const outGet = await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      headers: { cookie: outsider.cookie },
    });
    expect("membersNote" in ((await outGet.json()) as object)).toBe(false);

    // 未ログインにもキー自体含まれない
    const anonGet = await SELF.fetch(`${BASE}/api/events/${eventId}`);
    expect(anonGet.status).toBe(200);
    expect("membersNote" in ((await anonGet.json()) as object)).toBe(false);

    // 公開一覧系にも漏れない
    const pub = await SELF.fetch(`${BASE}/api/public/events`);
    expect(pub.status).toBe(200);
    const pubText = await pub.text();
    expect(pubText).not.toContain("membersNote");
    expect(pubText).not.toContain("members_note");
    expect(pubText).not.toContain("Discord招待");
  });
});
