import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { EventComment, EventPhoto, PhotoComment } from "@eventer/shared";

const BASE = "https://example.com";

/** イベント内コンテンツのモデレーション（他人のコメント・写真の削除）が
 * 「そのイベントの参加確定 staff メンバー」だけに絞られていることの検証 (#275)。
 * web は myRole === "staff" でしか削除UIを出さないので、サーバーもそれに揃える。 */

/** dev-login（DevUser=イベント作成者＝staff・アプリ運営管理者） */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** 非adminのユーザーを1人作る（メンバーにはしない） */
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

/** 非adminのメンバーを1人作る */
async function makeMember(
  eventId: string,
  role: "participant" | "staff" | "judge" | "observer",
  status = "confirmed",
): Promise<{ userId: string; cookie: string }> {
  const u = await makeUser();
  await addMember(eventId, u.userId, role, status);
  return u;
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

/** コミュニティを作り、owner を1人つける */
async function makeCommunity(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO community (id, slug, name, description, owner_id, created_at) VALUES (?, ?, ?, '', ?, ?)",
  )
    .bind(id, `c-${id.slice(0, 8)}`, `community_${id.slice(0, 4)}`, ownerId, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
  )
    .bind(crypto.randomUUID(), id, ownerId, Date.now())
    .run();
  return id;
}

/** 公開イベントを作る。communityId を渡すとそのコミュニティに紐付ける。
 * DevUser（＝アプリ運営管理者）の staff メンバー行は外し、
 * 「イベントに参加していないサイト管理者」の状態を作る */
async function setupEvent(
  cookie: string,
  communityId: string | null,
): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "モデレーションE2E",
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
  return event.id;
}

/** DevUser（アプリ運営管理者）のメンバー行を外す */
async function dropDevUserMembership(eventId: string): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM event_member WHERE event_id = ? AND user_id = (SELECT id FROM user WHERE discord_id = 'dev-user')",
  )
    .bind(eventId)
    .run();
}

/** 1x1 PNG */
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  ),
  (ch) => ch.charCodeAt(0),
);

async function uploadPhoto(eventId: string, cookie: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`, {
    method: "POST",
    headers: { "content-type": "image/png", cookie },
    body: PNG,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { photo: EventPhoto }).photo.id;
}

async function postComment(
  eventId: string,
  cookie: string,
  body: string,
): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ body }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { comment: EventComment }).comment.id;
}

async function postPhotoComment(
  eventId: string,
  photoId: string,
  cookie: string,
  body: string,
): Promise<string> {
  const res = await SELF.fetch(
    `${BASE}/api/events/${eventId}/photos/${photoId}/comments`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ body }),
    },
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { comment: PhotoComment }).comment.id;
}

function del(path: string, cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api${path}`, {
    method: "DELETE",
    headers: { cookie },
  });
}

async function listComments(eventId: string): Promise<EventComment[]> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/comments`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { comments: EventComment[] }).comments;
}

async function listPhotos(
  eventId: string,
  cookie: string,
): Promise<EventPhoto[]> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { photos: EventPhoto[] }).photos;
}

async function listPhotoComments(
  eventId: string,
  photoId: string,
  cookie: string,
): Promise<PhotoComment[]> {
  const res = await SELF.fetch(
    `${BASE}/api/events/${eventId}/photos/${photoId}/comments`,
    { headers: { cookie } },
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { comments: PhotoComment[] }).comments;
}

describe("イベント内コンテンツのモデレーションはイベントの staff のみ (#275)", () => {
  it("コメント削除: コミュニティのオーナーもサイト管理者も、そのイベントの staff でなければ403", async () => {
    const admin = await loginDev();
    const owner = await makeUser();
    const communityId = await makeCommunity(owner.userId);
    const eventId = await setupEvent(admin, communityId);
    await dropDevUserMembership(eventId);
    const author = await makeMember(eventId, "participant");
    const commentId = await postComment(eventId, author.cookie, "消される運命");

    // どちらも他人のコメントは消せない
    for (const cookie of [owner.cookie, admin]) {
      expect((await del(`/events/${eventId}/comments/${commentId}`, cookie)).status).toBe(403);
    }
    // 403 が素通りしていない（コメントは残っている）
    expect(await listComments(eventId)).toHaveLength(1);

    // イベントの staff に加われば消せる
    await addMember(eventId, owner.userId, "staff");
    expect(
      (await del(`/events/${eventId}/comments/${commentId}`, owner.cookie)).status,
    ).toBe(200);
    expect(await listComments(eventId)).toHaveLength(0);
  });

  it("写真・写真コメントの削除: コミュニティのオーナーもサイト管理者も、そのイベントの staff でなければ403", async () => {
    const admin = await loginDev();
    const owner = await makeUser();
    const communityId = await makeCommunity(owner.userId);
    const eventId = await setupEvent(admin, communityId);
    await dropDevUserMembership(eventId);
    const author = await makeMember(eventId, "participant");
    const staff = await makeMember(eventId, "staff");
    const photoId = await uploadPhoto(eventId, author.cookie);
    const commentId = await postPhotoComment(
      eventId,
      photoId,
      author.cookie,
      "いい写真",
    );

    for (const cookie of [owner.cookie, admin]) {
      expect(
        (await del(`/events/${eventId}/photos/${photoId}/comments/${commentId}`, cookie))
          .status,
      ).toBe(403);
      expect((await del(`/events/${eventId}/photos/${photoId}`, cookie)).status).toBe(403);
    }
    // 403 が素通りしていない（写真もコメントも残っている）
    expect(await listPhotos(eventId, staff.cookie)).toHaveLength(1);
    expect(await listPhotoComments(eventId, photoId, staff.cookie)).toHaveLength(1);

    // イベントの staff は消せる
    expect(
      (
        await del(
          `/events/${eventId}/photos/${photoId}/comments/${commentId}`,
          staff.cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (await del(`/events/${eventId}/photos/${photoId}`, staff.cookie)).status,
    ).toBe(200);
    expect(await listPhotos(eventId, staff.cookie)).toHaveLength(0);
  });

  it("参加が確定していない staff は他人のコンテンツを消せない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin, null);
    const author = await makeMember(eventId, "participant");
    const onHold = await makeMember(eventId, "staff", "waitlist");
    const commentId = await postComment(eventId, author.cookie, "残るはず");
    const photoId = await uploadPhoto(eventId, author.cookie);
    const photoCommentId = await postPhotoComment(
      eventId,
      photoId,
      author.cookie,
      "残るはず",
    );

    expect(
      (await del(`/events/${eventId}/comments/${commentId}`, onHold.cookie)).status,
    ).toBe(403);
    expect(
      (
        await del(
          `/events/${eventId}/photos/${photoId}/comments/${photoCommentId}`,
          onHold.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (await del(`/events/${eventId}/photos/${photoId}`, onHold.cookie)).status,
    ).toBe(403);

    // 何も消えていない
    expect(await listComments(eventId)).toHaveLength(1);
    expect(await listPhotos(eventId, admin)).toHaveLength(1);
    expect(await listPhotoComments(eventId, photoId, admin)).toHaveLength(1);
  });

  it("投稿者本人は参加が確定していなくても自分のコンテンツを取り下げられる", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin, null);
    const author = await makeMember(eventId, "participant");
    const commentId = await postComment(eventId, author.cookie, "取り下げる");
    const photoId = await uploadPhoto(eventId, author.cookie);

    // 投稿後にキャンセル待ちへ回されても、自分の投稿は消せる
    await env.DB.prepare(
      "UPDATE event_member SET status = 'waitlist' WHERE event_id = ? AND user_id = ?",
    )
      .bind(eventId, author.userId)
      .run();
    expect(
      (await del(`/events/${eventId}/comments/${commentId}`, author.cookie)).status,
    ).toBe(200);
    expect(
      (await del(`/events/${eventId}/photos/${photoId}`, author.cookie)).status,
    ).toBe(200);
    expect(await listComments(eventId)).toHaveLength(0);
  });
});
