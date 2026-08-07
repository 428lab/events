import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import {
  EVENT_COMMENT_LIMIT,
  EVENT_PHOTO_LIMIT,
  EVENT_QUESTION_LIMIT,
  MODERATION_EVENT_LIMIT,
  PHOTO_COMMENT_LIMIT,
} from "@eventer/shared";
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

/** 管理画面の画像配信（非表示にした写真も見られる経路）。
 * R2 のストリームは必ず読み切る（テスト間でストレージを片付けられなくなるため） */
async function adminImage(
  eventId: string,
  photoId: string,
  cookie: string,
): Promise<{ status: number; contentType: string | null; bytes: number }> {
  const res = await SELF.fetch(
    `${BASE}/api/admin/moderation/events/${eventId}/photos/${photoId}/image`,
    { headers: { cookie } },
  );
  const body = await res.arrayBuffer();
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    bytes: body.byteLength,
  };
}

/** そのイベントで非表示になっている note の一覧（スタッフから見えるもの） */
async function hiddenNoteIds(
  eventId: string,
  cookie: string,
): Promise<string[]> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/chat-members`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { hiddenNoteIds: string[] }).hiddenNoteIds;
}

/** スタッフによるチャットの非表示 / 解除 */
async function staffHideChat(
  eventId: string,
  noteId: string,
  cookie: string,
): Promise<void> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/chat-hidden`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ noteId }),
  });
  expect(res.status).toBe(200);
}

async function staffUnhideChat(
  eventId: string,
  noteId: string,
  cookie: string,
): Promise<void> {
  const res = await SELF.fetch(
    `${BASE}/api/events/${eventId}/chat-hidden/${noteId}`,
    { method: "DELETE", headers: { cookie } },
  );
  expect(res.status).toBe(200);
}

/** スタッフによる Q&A の非表示 / 解除 */
function staffSetQuestionHidden(
  eventId: string,
  qid: string,
  hidden: boolean,
  cookie: string,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/questions/${qid}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ hidden }),
  });
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

  it("公開プロフィールのコメント数が、実際に並ぶコメントと一致する", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const owner = await makeMember(eventId, "participant");
    const kept = await makeMember(eventId, "participant");
    const hiddenBy = await makeMember(eventId, "participant");
    const leaving = await makeMember(eventId, "participant");
    const photoId = await uploadPhoto(eventId, owner.cookie);
    await postPhotoComment(eventId, photoId, kept.cookie);
    const toHide = await postPhotoComment(eventId, photoId, hiddenBy.cookie);
    await postPhotoComment(eventId, photoId, leaving.cookie);

    await hide(eventId, "photo_comment", toHide, admin);
    // 退会申請中 (#250) の投稿者ぶんも一覧からは落ちるので、数からも落ちる必要がある
    await env.DB.prepare("UPDATE user SET deleted_at = ? WHERE id = ?")
      .bind(Date.now(), leaving.userId)
      .run();

    const shown = await listPhotoComments(eventId, photoId, owner.cookie);
    expect(shown).toHaveLength(1);
    // イベント内の一覧と公開プロフィールのギャラリー、どちらの数も一致すること
    const inEvent = await listPhotos(eventId, owner.cookie);
    expect(inEvent.find((p) => p.id === photoId)?.commentCount).toBe(
      shown.length,
    );
    const onProfile = await publicPhotos(owner.username);
    expect(onProfile.find((p) => p.id === photoId)?.commentCount).toBe(
      shown.length,
    );
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

  it("他イベントのIDを差し込んでも対処できない（4種すべて・非表示も復元も）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const otherId = await setupEvent(admin);
    const poster = await makeMember(eventId, "participant");
    const photoId = await uploadPhoto(eventId, poster.cookie);
    const targets: Array<[string, string]> = [
      ["photo", photoId],
      ["photo_comment", await postPhotoComment(eventId, photoId, poster.cookie)],
      ["event_comment", await postComment(eventId, poster.cookie)],
      ["question", await postQuestion(eventId, poster.cookie)],
    ];

    // 他イベントのIDでは非表示にできない
    for (const [kind, id] of targets) {
      const res = await moderate("hide", otherId, kind, id, admin);
      expect(res.status, kind).toBe(200);
      expect((await res.json()) as { changed: boolean }, kind).toMatchObject({
        changed: false,
      });
    }
    const untouched = await adminContent(eventId, admin);
    for (const [kind, id] of targets) {
      expect(untouched.items.find((i) => i.id === id)?.hiddenAt, kind).toBeNull();
    }

    // 正しいイベントで対処したあと、他イベントのIDでは復元もできない
    for (const [kind, id] of targets) {
      await hide(eventId, kind, id, admin);
      const res = await moderate("restore", otherId, kind, id, admin);
      expect(res.status, kind).toBe(200);
      expect((await res.json()) as { changed: boolean }, kind).toMatchObject({
        changed: false,
      });
    }
    const stillHidden = await adminContent(eventId, admin);
    for (const [kind, id] of targets) {
      expect(
        stillHidden.items.find((i) => i.id === id)?.hiddenAt,
        kind,
      ).not.toBeNull();
    }
  });

  it("チャット: 他イベントのIDで対処しても、そのイベントの非表示は動かない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const otherId = await setupEvent(admin);
    const staff = await makeMember(eventId, "staff");
    const noteId = "b".repeat(64);

    await hide(otherId, "chat_message", noteId, admin);
    expect(await hiddenNoteIds(eventId, staff.cookie)).not.toContain(noteId);

    // 逆向きも同じ。正しいイベントで対処したものを他イベントから復元できない
    await hide(eventId, "chat_message", noteId, admin);
    const res = await moderate(
      "restore",
      otherId,
      "chat_message",
      noteId,
      admin,
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { changed: boolean }).toMatchObject({
      changed: true, // otherId 側の行が消えるだけ
    });
    expect(await hiddenNoteIds(eventId, staff.cookie)).toContain(noteId);
  });

  it("管理画面の画像は管理者だけが見られ、他イベントのIDでは引けない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const otherId = await setupEvent(admin);
    const poster = await makeMember(eventId, "participant");
    const staff = await makeMember(eventId, "staff");
    const photoId = await uploadPhoto(eventId, poster.cookie);

    const ok = await adminImage(eventId, photoId, admin);
    expect(ok.status).toBe(200);
    expect(ok.contentType).toBe("image/png");
    expect(ok.bytes).toBe(PNG.byteLength);

    // 非表示にしたあとも管理画面からは見られる（復元してよいか判断するため）
    await hide(eventId, "photo", photoId, admin);
    expect((await adminImage(eventId, photoId, admin)).status).toBe(200);

    // 管理者以外は不可（そのイベントのスタッフでも・投稿者本人でも）
    for (const cookie of [staff.cookie, poster.cookie]) {
      expect((await adminImage(eventId, photoId, cookie)).status).toBe(403);
    }
    const anon = await SELF.fetch(
      `${BASE}/api/admin/moderation/events/${eventId}/photos/${photoId}/image`,
    );
    expect(anon.status).toBe(401);

    // 他イベントのIDでは引けない
    expect((await adminImage(otherId, photoId, admin)).status).toBe(404);
  });

  it("運営が対処したコンテンツは投稿者もスタッフも削除できず、理由が返る", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const poster = await makeMember(eventId, "participant");
    const staff = await makeMember(eventId, "staff");
    const photoId = await uploadPhoto(eventId, poster.cookie);
    const photoCommentId = await postPhotoComment(
      eventId,
      photoId,
      poster.cookie,
    );
    const commentId = await postComment(eventId, poster.cookie);
    const qid = await postQuestion(eventId, poster.cookie);
    await hide(eventId, "photo", photoId, admin);
    await hide(eventId, "photo_comment", photoCommentId, admin);
    await hide(eventId, "event_comment", commentId, admin);
    await hide(eventId, "question", qid, admin);

    const paths: Array<[string, string]> = [
      [`/api/events/${eventId}/photos/${photoId}`, "content_hidden"],
      [
        `/api/events/${eventId}/photos/${photoId}/comments/${photoCommentId}`,
        "content_hidden",
      ],
      [`/api/events/${eventId}/comments/${commentId}`, "content_hidden"],
      [`/api/events/${eventId}/questions/${qid}`, "question_hidden"],
    ];
    // 投稿者本人にもそのイベントのスタッフにも、404 ではなく理由の分かる 409 を返す
    for (const cookie of [poster.cookie, staff.cookie]) {
      for (const [path, error] of paths) {
        const res = await SELF.fetch(`${BASE}${path}`, {
          method: "DELETE",
          headers: { cookie },
        });
        // Q&A の削除は投稿者本人しかできないので、スタッフには 403 が先に返る
        if (cookie === staff.cookie && path.includes("/questions/")) {
          expect(res.status, path).toBe(403);
          continue;
        }
        expect(res.status, path).toBe(409);
        expect((await res.json()) as { error: string }, path).toMatchObject({
          error,
        });
      }
    }
    // 実際に消えていない（復元すれば戻る）
    await restore(eventId, "photo", photoId, admin);
    expect((await listPhotos(eventId, poster.cookie)).map((p) => p.id)).toContain(
      photoId,
    );
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

  it("ユーザー指定の検索は、古いイベントも候補に出す", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const poster = await makeMember(eventId, "participant");
    const commentId = await postComment(eventId, poster.cookie);
    // 2年前の投稿にする。期間で打ち切ると候補から消えてしまい、
    // 運営には「対象なし」に見えてしまう
    const old = Date.now() - 2 * 365 * 24 * 60 * 60 * 1000;
    await env.DB.batch([
      env.DB.prepare("UPDATE event_comment SET created_at = ? WHERE id = ?").bind(
        old,
        commentId,
      ),
      env.DB.prepare(
        "UPDATE event SET starts_at = ?, ends_at = ? WHERE id = ?",
      ).bind(old, old + 3600000, eventId),
    ]);

    const res = await SELF.fetch(
      `${BASE}/api/admin/moderation/events?userId=${poster.userId}`,
      { headers: { cookie: admin } },
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as ModerationEventsPayload;
    expect(payload.events.map((e) => e.id)).toContain(eventId);
  });

  it("候補が上限を超えたら、切れたことが分かる形で返る", async () => {
    const admin = await loginDev();
    const host = await makeUser();
    // 上限より1件多く主催イベントを作る（打ち切りの判定は +1 件で見ている）
    const now = Date.now();
    await env.DB.batch(
      Array.from({ length: MODERATION_EVENT_LIMIT + 1 }, (_, i) =>
        env.DB.prepare(
          `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, created_by, created_at)
           VALUES (?, '打ち切りテスト', ?, ?, 'offline', 'published', ?, ?)`,
        ).bind(crypto.randomUUID(), now + i, now + i + 1, host.userId, now),
      ),
    );

    const res = await SELF.fetch(
      `${BASE}/api/admin/moderation/events?userId=${host.userId}`,
      { headers: { cookie: admin } },
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as ModerationEventsPayload;
    expect(payload.events).toHaveLength(MODERATION_EVENT_LIMIT);
    expect(payload.truncated).toBe(true);
  });

  it("チャット: 2回目の対処は記録を上書きしない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const noteId = "c".repeat(64);

    await hide(eventId, "chat_message", noteId, admin);
    const first = await env.DB.prepare(
      "SELECT admin_hidden_at, admin_hidden_by FROM event_chat_hidden WHERE event_id = ? AND note_id = ?",
    )
      .bind(eventId, noteId)
      .first<{ admin_hidden_at: number; admin_hidden_by: string }>();

    // 2回目は何も変えない。上書きすると「最初に誰がいつ対処したか」が消える
    const again = await moderate("hide", eventId, "chat_message", noteId, admin);
    expect(again.status).toBe(200);
    expect((await again.json()) as { changed: boolean }).toMatchObject({
      changed: false,
    });
    const second = await env.DB.prepare(
      "SELECT admin_hidden_at, admin_hidden_by FROM event_chat_hidden WHERE event_id = ? AND note_id = ?",
    )
      .bind(eventId, noteId)
      .first<{ admin_hidden_at: number; admin_hidden_by: string }>();
    expect(second).toEqual(first);

    // 監査ログも1件だけ（2回目は記録しない）
    const { logs } = await auditActions(admin);
    expect(
      logs.filter(
        (l) => l.action === "content_hide" && l.detail.includes(noteId),
      ),
    ).toHaveLength(1);
  });

  it("チャットの監査ログには、発言者を記録できていないことが残る", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const noteId = "d".repeat(64);
    await hide(eventId, "chat_message", noteId, admin);

    const { logs } = await auditActions(admin);
    const log = logs.find(
      (l) => l.action === "content_hide" && l.detail.includes(noteId),
    );
    expect(log).toBeDefined();
    // 発言者はサーバーに記録が無いので当事者は空。空欄が記録漏れに見えないよう、
    // 「記録できていない」ことを detail に残す
    expect(log?.targetUserId).toBeNull();
    const detail = JSON.parse(log!.detail) as Record<string, unknown>;
    expect(detail).toMatchObject({
      eventId,
      kind: "chat_message",
      contentId: noteId,
      authorUnrecorded: true,
    });
    expect(String(detail.authorUnrecordedReason)).not.toBe("");
  });

  it("復元も非表示と同じ検証を通す（noteIdの形式・イベントの存在）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const missingEvent = crypto.randomUUID();
    const noteId = "e".repeat(64);

    for (const action of ["hide", "restore"] as const) {
      // note の形式
      const bad = await moderate(
        action,
        eventId,
        "chat_message",
        "not-a-note-id",
        admin,
      );
      expect(bad.status, action).toBe(400);
      expect((await bad.json()) as { error: string }, action).toMatchObject({
        error: "invalid_note_id",
      });
      // イベントの存在
      const gone = await moderate(
        action,
        missingEvent,
        "chat_message",
        noteId,
        admin,
      );
      expect(gone.status, action).toBe(404);
    }
  });

  it("Q&A: スタッフが先に非表示にしていても、運営の対処は解除されない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const poster = await makeMember(eventId, "participant");
    const staff = await makeMember(eventId, "staff");
    const qid = await postQuestion(eventId, poster.cookie);

    // スタッフが先に非表示 → 運営が非表示 → スタッフが解除
    expect(
      (await staffSetQuestionHidden(eventId, qid, true, staff.cookie)).status,
    ).toBe(200);
    await hide(eventId, "question", qid, admin);
    expect(
      (await staffSetQuestionHidden(eventId, qid, false, staff.cookie)).status,
    ).toBe(404);

    expect(
      (await listQuestions(eventId, staff.cookie)).questions.map((q) => q.id),
    ).not.toContain(qid);
    const row = await env.DB.prepare(
      "SELECT hidden, admin_hidden_at, admin_prev_hidden FROM event_question WHERE id = ?",
    )
      .bind(qid)
      .first<{
        hidden: number;
        admin_hidden_at: number | null;
        admin_prev_hidden: number | null;
      }>();
    expect(row?.hidden).toBe(1);
    expect(row?.admin_hidden_at).not.toBeNull();
    // 運営が対処する前の状態（スタッフが非表示にしていた）を控えてある
    expect(row?.admin_prev_hidden).toBe(1);
  });

  it("Q&A: 運営の復元はスタッフの非表示までは取り消さない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const poster = await makeMember(eventId, "participant");
    const staff = await makeMember(eventId, "staff");
    const staffHiddenQid = await postQuestion(eventId, poster.cookie);
    const plainQid = await postQuestion(eventId, poster.cookie);

    await staffSetQuestionHidden(eventId, staffHiddenQid, true, staff.cookie);
    await hide(eventId, "question", staffHiddenQid, admin);
    await hide(eventId, "question", plainQid, admin);

    // 管理画面では、運営が対処したあとも「スタッフも非表示にしていた」が分かる
    const hiddenView = await adminContent(eventId, admin);
    expect(
      hiddenView.items.find((i) => i.id === staffHiddenQid)?.staffHidden,
    ).toBe(true);
    expect(hiddenView.items.find((i) => i.id === plainQid)?.staffHidden).toBe(
      false,
    );

    await restore(eventId, "question", staffHiddenQid, admin);
    await restore(eventId, "question", plainQid, admin);

    // スタッフが非表示にしていたものはスタッフの非表示のまま戻る
    const staffView = await listQuestions(eventId, staff.cookie);
    expect(staffView.questions.find((q) => q.id === staffHiddenQid)?.hidden).toBe(
      true,
    );
    // 参加者には見えないまま（スタッフの判断が取り消されていない）
    expect(
      (await listQuestions(eventId, poster.cookie)).questions.map((q) => q.id),
    ).not.toContain(staffHiddenQid);
    // スタッフが触っていなかったものは普通に見える状態へ戻る
    expect(
      (await listQuestions(eventId, poster.cookie)).questions.map((q) => q.id),
    ).toContain(plainQid);

    // 戻したあとはスタッフが解除できる
    expect(
      (await staffSetQuestionHidden(eventId, staffHiddenQid, false, staff.cookie))
        .status,
    ).toBe(200);
    expect(
      (await listQuestions(eventId, poster.cookie)).questions.map((q) => q.id),
    ).toContain(staffHiddenQid);
  });

  it("チャット: スタッフが先に非表示にしていても、運営の対処は解除されない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const staff = await makeMember(eventId, "staff");
    const noteId = "f".repeat(64);

    // スタッフが先に非表示 → 運営が非表示 → スタッフが解除
    await staffHideChat(eventId, noteId, staff.cookie);
    await hide(eventId, "chat_message", noteId, admin);
    await staffUnhideChat(eventId, noteId, staff.cookie);
    expect(await hiddenNoteIds(eventId, staff.cookie)).toContain(noteId);
  });

  it("チャット: 運営の復元はスタッフの非表示までは取り消さない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const staff = await makeMember(eventId, "staff");
    const staffHiddenNote = "1".repeat(64);
    const plainNote = "2".repeat(64);

    await staffHideChat(eventId, staffHiddenNote, staff.cookie);
    await hide(eventId, "chat_message", staffHiddenNote, admin);
    await hide(eventId, "chat_message", plainNote, admin);

    // 管理画面では、運営が対処したあとも「スタッフも非表示にしていた」が分かる
    const view = await adminContent(eventId, admin);
    expect(view.chat.hidden.find((h) => h.noteId === staffHiddenNote)).toMatchObject(
      { staffHidden: true },
    );
    expect(view.chat.hidden.find((h) => h.noteId === plainNote)).toMatchObject({
      staffHidden: false,
    });

    await restore(eventId, "chat_message", staffHiddenNote, admin);
    await restore(eventId, "chat_message", plainNote, admin);

    // スタッフが非表示にしていたぶんは非表示のまま残る
    const after = await hiddenNoteIds(eventId, staff.cookie);
    expect(after).toContain(staffHiddenNote);
    expect(after).not.toContain(plainNote);
    // 戻したあとはスタッフが解除できる
    await staffUnhideChat(eventId, staffHiddenNote, staff.cookie);
    expect(await hiddenNoteIds(eventId, staff.cookie)).not.toContain(
      staffHiddenNote,
    );
  });

  it("非表示にしても、上限のための件数は減らない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const poster = await makeMember(eventId, "participant");
    const photoId = await uploadPhoto(eventId, poster.cookie);
    // 写真コメントの上限は写真ごとなので、非表示にしない写真に載せる
    const commentPhotoId = await uploadPhoto(eventId, poster.cookie);
    const photoCommentId = await postPhotoComment(
      eventId,
      commentPhotoId,
      poster.cookie,
    );
    const commentId = await postComment(eventId, poster.cookie);
    const qid = await postQuestion(eventId, poster.cookie);

    // それぞれ上限ちょうどまで直接埋める（API 経由だと時間がかかるだけなので）
    const now = Date.now();
    const fill = (sql: string, n: number, extra: (i: number) => unknown[]) =>
      env.DB.batch(
        Array.from({ length: n }, (_, i) =>
          env.DB.prepare(sql).bind(...extra(i)),
        ),
      );
    await fill(
      "INSERT INTO event_photo (id, event_id, user_id, created_at) VALUES (?, ?, ?, ?)",
      EVENT_PHOTO_LIMIT - 2,
      (i) => [crypto.randomUUID(), eventId, poster.userId, now + i],
    );
    await fill(
      "INSERT INTO event_photo_comment (id, photo_id, user_id, body, created_at) VALUES (?, ?, ?, '埋め', ?)",
      PHOTO_COMMENT_LIMIT - 1,
      (i) => [crypto.randomUUID(), commentPhotoId, poster.userId, now + i],
    );
    await fill(
      "INSERT INTO event_comment (id, event_id, user_id, body, created_at) VALUES (?, ?, ?, '埋め', ?)",
      EVENT_COMMENT_LIMIT - 1,
      (i) => [crypto.randomUUID(), eventId, poster.userId, now + i],
    );
    await fill(
      "INSERT INTO event_question (id, event_id, user_id, body, created_at) VALUES (?, ?, ?, '埋め', ?)",
      EVENT_QUESTION_LIMIT - 1,
      (i) => [crypto.randomUUID(), eventId, poster.userId, now + i],
    );

    // 4種とも非表示にする。行は残っているので、上限の空きが増えてはいけない
    await hide(eventId, "photo", photoId, admin);
    await hide(eventId, "photo_comment", photoCommentId, admin);
    await hide(eventId, "event_comment", commentId, admin);
    await hide(eventId, "question", qid, admin);

    const another = await makeMember(eventId, "participant");
    const attempts: Array<[string, RequestInit, string]> = [
      [
        `/api/events/${eventId}/photos`,
        {
          method: "POST",
          headers: { "content-type": "image/png", cookie: another.cookie },
          body: PNG,
        },
        "photo_limit",
      ],
      [
        `/api/events/${eventId}/photos/${commentPhotoId}/comments`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: another.cookie,
          },
          body: JSON.stringify({ body: "もう1件" }),
        },
        "comment_limit",
      ],
      [
        `/api/events/${eventId}/comments`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: another.cookie,
          },
          body: JSON.stringify({ body: "もう1件" }),
        },
        "comment_limit",
      ],
      [
        `/api/events/${eventId}/questions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: another.cookie,
          },
          body: JSON.stringify({ body: "もう1件", anonymous: false }),
        },
        "question_limit",
      ],
    ];
    for (const [path, init, error] of attempts) {
      const res = await SELF.fetch(`${BASE}${path}`, init);
      expect(res.status, path).toBe(409);
      expect((await res.json()) as { error: string }, path).toMatchObject({
        error,
      });
    }
  });
});
