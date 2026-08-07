import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type {
  AuditLogsPayload,
  EventComment,
  EventPhoto,
  EventQaPayload,
  ModerationContentPayload,
  ModerationEventsPayload,
  PhotoComment,
  UserPhoto,
} from "@eventer/shared";

const BASE = "https://example.com";

/** 運営によるイベント内コンテンツの非表示 (#278)。
 *
 * 見るのは3点:
 * - 非表示にすると **そのイベントのスタッフから見ても** 通常の経路から消えること
 * - 復元すると戻ること
 * - 管理者以外は対処できないこと（イベントのスタッフでも管理画面は触れない）
 *
 * 通常の削除（そのイベントのスタッフ）が今までどおりであることは
 * moderation-event-staff.test.ts (#275) が見ている。 */

/** dev-login（DevUser = イベント作成者 = staff かつアプリ運営管理者） */
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

async function makeMember(
  eventId: string,
  role: "participant" | "staff" | "judge" | "observer",
): Promise<{ userId: string; username: string; cookie: string }> {
  const u = await makeUser();
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, 'confirmed', 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, u.userId, role, Date.now())
    .run();
  return u;
}

/** 公開イベント（Q&A・写真公開つき）を作る */
async function setupEvent(cookie: string): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "運営モデレーションE2E",
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
    body: JSON.stringify({
      status: "published",
      qaEnabled: true,
      photosPublic: true,
    }),
  });
  expect(patch.status).toBe(200);
  return event.id;
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

async function postPhotoComment(
  eventId: string,
  photoId: string,
  cookie: string,
): Promise<string> {
  const res = await SELF.fetch(
    `${BASE}/api/events/${eventId}/photos/${photoId}/comments`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ body: "写真コメント" }),
    },
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { comment: PhotoComment }).comment.id;
}

async function postComment(eventId: string, cookie: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ body: "イベントコメント" }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { comment: EventComment }).comment.id;
}

async function postQuestion(eventId: string, cookie: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/questions`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ body: "質問です", anonymous: false }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { question: { id: string } }).question.id;
}

/* ===== 通常の読み出し経路 ===== */

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

async function listComments(eventId: string): Promise<EventComment[]> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/comments`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { comments: EventComment[] }).comments;
}

async function listQuestions(
  eventId: string,
  cookie: string,
): Promise<EventQaPayload> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/questions`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as EventQaPayload;
}

async function publicPhotos(username: string): Promise<UserPhoto[]> {
  const res = await SELF.fetch(`${BASE}/api/public/users/${username}/photos`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { photos: UserPhoto[] }).photos;
}

/* ===== 管理画面の経路 ===== */

function moderate(
  action: "hide" | "restore",
  eventId: string,
  kind: string,
  id: string,
  cookie: string,
): Promise<Response> {
  return SELF.fetch(
    `${BASE}/api/admin/moderation/events/${eventId}/${action}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind, id }),
    },
  );
}

async function hide(
  eventId: string,
  kind: string,
  id: string,
  cookie: string,
): Promise<void> {
  const res = await moderate("hide", eventId, kind, id, cookie);
  expect(res.status).toBe(200);
  expect((await res.json()) as { changed: boolean }).toMatchObject({
    changed: true,
  });
}

async function restore(
  eventId: string,
  kind: string,
  id: string,
  cookie: string,
): Promise<void> {
  const res = await moderate("restore", eventId, kind, id, cookie);
  expect(res.status).toBe(200);
  expect((await res.json()) as { changed: boolean }).toMatchObject({
    changed: true,
  });
}

async function adminContent(
  eventId: string,
  cookie: string,
): Promise<ModerationContentPayload> {
  const res = await SELF.fetch(
    `${BASE}/api/admin/moderation/events/${eventId}`,
    { headers: { cookie } },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as ModerationContentPayload;
}

async function auditActions(cookie: string): Promise<AuditLogsPayload> {
  const res = await SELF.fetch(`${BASE}/api/admin/audit-logs`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as AuditLogsPayload;
}

describe("運営によるイベント内コンテンツの非表示 (#278)", () => {
  it("写真: 非表示にするとスタッフからも消え、復元で戻る", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const poster = await makeMember(eventId, "participant");
    const staff = await makeMember(eventId, "staff");
    const photoId = await uploadPhoto(eventId, poster.cookie);

    expect((await listPhotos(eventId, staff.cookie)).map((p) => p.id)).toContain(
      photoId,
    );

    await hide(eventId, "photo", photoId, admin);

    // そのイベントのスタッフから見ても消えている
    expect(
      (await listPhotos(eventId, staff.cookie)).map((p) => p.id),
    ).not.toContain(photoId);
    // 投稿者本人からも消えている
    expect(
      (await listPhotos(eventId, poster.cookie)).map((p) => p.id),
    ).not.toContain(photoId);
    // 画像そのものも配信されない
    const img = await SELF.fetch(
      `${BASE}/api/events/${eventId}/photos/${photoId}/image`,
      { headers: { cookie: staff.cookie } },
    );
    expect(img.status).toBe(404);
    // 公開プロフィールのギャラリーからも消えている
    expect((await publicPhotos(poster.username)).map((p) => p.id)).not.toContain(
      photoId,
    );

    await restore(eventId, "photo", photoId, admin);
    expect((await listPhotos(eventId, staff.cookie)).map((p) => p.id)).toContain(
      photoId,
    );
    expect((await publicPhotos(poster.username)).map((p) => p.id)).toContain(
      photoId,
    );
  });

  it("写真コメント: 非表示にすると一覧からもコメント数からも消える", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const poster = await makeMember(eventId, "participant");
    const staff = await makeMember(eventId, "staff");
    const photoId = await uploadPhoto(eventId, poster.cookie);
    const commentId = await postPhotoComment(eventId, photoId, poster.cookie);

    expect(
      (await listPhotoComments(eventId, photoId, staff.cookie)).map((x) => x.id),
    ).toContain(commentId);
    const before = await listPhotos(eventId, staff.cookie);
    expect(before.find((p) => p.id === photoId)?.commentCount).toBe(1);

    await hide(eventId, "photo_comment", commentId, admin);

    expect(
      (await listPhotoComments(eventId, photoId, staff.cookie)).map((x) => x.id),
    ).not.toContain(commentId);
    const after = await listPhotos(eventId, staff.cookie);
    expect(after.find((p) => p.id === photoId)?.commentCount).toBe(0);

    await restore(eventId, "photo_comment", commentId, admin);
    expect(
      (await listPhotoComments(eventId, photoId, staff.cookie)).map((x) => x.id),
    ).toContain(commentId);
  });

  it("イベントコメント: 非表示にすると一覧から消え、復元で戻る", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const poster = await makeMember(eventId, "participant");
    const commentId = await postComment(eventId, poster.cookie);

    expect((await listComments(eventId)).map((x) => x.id)).toContain(commentId);
    await hide(eventId, "event_comment", commentId, admin);
    expect((await listComments(eventId)).map((x) => x.id)).not.toContain(
      commentId,
    );
    await restore(eventId, "event_comment", commentId, admin);
    expect((await listComments(eventId)).map((x) => x.id)).toContain(commentId);
  });

  it("Q&A: 非表示にするとスタッフの一覧からも消え、スタッフは操作もできない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const poster = await makeMember(eventId, "participant");
    const staff = await makeMember(eventId, "staff");
    const qid = await postQuestion(eventId, poster.cookie);

    // スタッフは非表示のものも見える（canModerate）ので、ここが本命の検証
    const beforeStaff = await listQuestions(eventId, staff.cookie);
    expect(beforeStaff.canModerate).toBe(true);
    expect(beforeStaff.questions.map((q) => q.id)).toContain(qid);

    await hide(eventId, "question", qid, admin);

    expect(
      (await listQuestions(eventId, staff.cookie)).questions.map((q) => q.id),
    ).not.toContain(qid);
    expect(
      (await listQuestions(eventId, poster.cookie)).questions.map((q) => q.id),
    ).not.toContain(qid);

    // スタッフの「非表示を解除する」では戻せない
    const patch = await SELF.fetch(
      `${BASE}/api/events/${eventId}/questions/${qid}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: staff.cookie },
        body: JSON.stringify({ hidden: false }),
      },
    );
    expect(patch.status).toBe(404);
    expect(
      (await listQuestions(eventId, staff.cookie)).questions.map((q) => q.id),
    ).not.toContain(qid);
    // レスポンスだけでなく行も動いていないこと。運営が対処した質問の hidden を
    // スタッフが下ろせてしまうと、運営が復元したときに元に戻らなくなる
    const row = await env.DB.prepare(
      "SELECT hidden, admin_hidden_at FROM event_question WHERE id = ?",
    )
      .bind(qid)
      .first<{ hidden: number; admin_hidden_at: number | null }>();
    expect(row?.hidden).toBe(1);
    expect(row?.admin_hidden_at).not.toBeNull();

    await restore(eventId, "question", qid, admin);
    expect(
      (await listQuestions(eventId, staff.cookie)).questions.map((q) => q.id),
    ).toContain(qid);
  });

  it("Q&A: 非表示にするとピックアップも解除される", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const poster = await makeMember(eventId, "participant");
    const qid = await postQuestion(eventId, poster.cookie);
    const pick = await SELF.fetch(`${BASE}/api/events/${eventId}/qa/pick`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ questionId: qid }),
    });
    expect(pick.status).toBe(200);

    await hide(eventId, "question", qid, admin);
    expect((await listQuestions(eventId, admin)).pickedQuestionId).toBeNull();
    // 一覧に無いピックアップは読み出し側でも無視されるが、列自体を片付けないと
    // 復元したとたんに投影画面へ戻ってきてしまう
    const row = await env.DB.prepare(
      "SELECT qa_picked_question_id AS picked FROM event WHERE id = ?",
    )
      .bind(eventId)
      .first<{ picked: string | null }>();
    expect(row?.picked).toBeNull();
  });

  it("チャット: 非表示はスタッフの解除では戻らず、運営の復元で戻る", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const staff = await makeMember(eventId, "staff");
    const noteId = "a".repeat(64);

    await hide(eventId, "chat_message", noteId, admin);
    const members = await SELF.fetch(
      `${BASE}/api/events/${eventId}/chat-members`,
      { headers: { cookie: staff.cookie } },
    );
    expect(members.status).toBe(200);
    expect(
      ((await members.json()) as { hiddenNoteIds: string[] }).hiddenNoteIds,
    ).toContain(noteId);

    // スタッフの解除では戻らない
    const unhide = await SELF.fetch(
      `${BASE}/api/events/${eventId}/chat-hidden/${noteId}`,
      { method: "DELETE", headers: { cookie: staff.cookie } },
    );
    expect(unhide.status).toBe(200);
    const still = await SELF.fetch(
      `${BASE}/api/events/${eventId}/chat-members`,
      { headers: { cookie: staff.cookie } },
    );
    expect(
      ((await still.json()) as { hiddenNoteIds: string[] }).hiddenNoteIds,
    ).toContain(noteId);

    await restore(eventId, "chat_message", noteId, admin);
    const after = await SELF.fetch(
      `${BASE}/api/events/${eventId}/chat-members`,
      { headers: { cookie: staff.cookie } },
    );
    expect(
      ((await after.json()) as { hiddenNoteIds: string[] }).hiddenNoteIds,
    ).not.toContain(noteId);
  });

  it("管理画面の一覧には非表示のものも出る（復元の判断ができる）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const poster = await makeMember(eventId, "participant");
    const commentId = await postComment(eventId, poster.cookie);
    await hide(eventId, "event_comment", commentId, admin);

    const payload = await adminContent(eventId, admin);
    const item = payload.items.find((i) => i.id === commentId);
    expect(item).toBeDefined();
    expect(item?.kind).toBe("event_comment");
    expect(item?.body).toBe("イベントコメント");
    expect(item?.hiddenAt).not.toBeNull();
    expect(item?.authorHandle).toBe(poster.username);
  });

  it("管理者以外は対処できない（そのイベントのスタッフでも）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const staff = await makeMember(eventId, "staff");
    const poster = await makeMember(eventId, "participant");
    const commentId = await postComment(eventId, poster.cookie);

    for (const cookie of [staff.cookie, poster.cookie]) {
      expect(
        (await moderate("hide", eventId, "event_comment", commentId, cookie))
          .status,
      ).toBe(403);
      expect(
        (await moderate("restore", eventId, "event_comment", commentId, cookie))
          .status,
      ).toBe(403);
      const list = await SELF.fetch(
        `${BASE}/api/admin/moderation/events/${eventId}`,
        { headers: { cookie } },
      );
      expect(list.status).toBe(403);
      const search = await SELF.fetch(
        `${BASE}/api/admin/moderation/events?q=E2E`,
        { headers: { cookie } },
      );
      expect(search.status).toBe(403);
    }
    // 未ログインも通さない
    const anon = await SELF.fetch(
      `${BASE}/api/admin/moderation/events/${eventId}`,
    );
    expect(anon.status).toBe(401);
    // 権限が無い側の操作で実際に変わっていないこと
    expect((await listComments(eventId)).map((x) => x.id)).toContain(commentId);
  });

  it("他イベントのIDを差し込んでも対処できない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const otherId = await setupEvent(admin);
    const poster = await makeMember(eventId, "participant");
    const commentId = await postComment(eventId, poster.cookie);

    const res = await moderate(
      "hide",
      otherId,
      "event_comment",
      commentId,
      admin,
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { changed: boolean }).toMatchObject({
      changed: false,
    });
    expect((await listComments(eventId)).map((x) => x.id)).toContain(commentId);
  });

  it("対処と復元が監査ログに残る", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const poster = await makeMember(eventId, "participant");
    const commentId = await postComment(eventId, poster.cookie);

    await hide(eventId, "event_comment", commentId, admin);
    await restore(eventId, "event_comment", commentId, admin);

    const { logs } = await auditActions(admin);
    const mine = logs.filter(
      (l) =>
        (l.action === "content_hide" || l.action === "content_restore") &&
        l.detail.includes(commentId),
    );
    expect(mine.map((l) => l.action).sort()).toEqual([
      "content_hide",
      "content_restore",
    ]);
    for (const log of mine) {
      // 対象の投稿者を残す（誰の投稿に対処したかを後から追えるように）
      expect(log.targetUserId).toBe(poster.userId);
      expect(log.targetHandle).toBe(poster.username);
      const detail = JSON.parse(log.detail) as Record<string, unknown>;
      expect(detail).toMatchObject({ eventId, kind: "event_comment" });
      // 本文は記録しない（監査ログに個人情報を入れない方針 #248）
      expect(log.detail).not.toContain("イベントコメント");
    }
  });

  it("対処するイベントを、投稿したユーザーからも探せる", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const poster = await makeMember(eventId, "participant");
    await postComment(eventId, poster.cookie);

    const res = await SELF.fetch(
      `${BASE}/api/admin/moderation/events?userId=${poster.userId}`,
      { headers: { cookie: admin } },
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as ModerationEventsPayload;
    expect(payload.events.map((e) => e.id)).toContain(eventId);

    // タイトルの部分一致でも探せる
    const byTitle = await SELF.fetch(
      `${BASE}/api/admin/moderation/events?q=${encodeURIComponent("運営モデレーション")}`,
      { headers: { cookie: admin } },
    );
    expect(
      ((await byTitle.json()) as ModerationEventsPayload).events.map(
        (e) => e.id,
      ),
    ).toContain(eventId);
  });
});
