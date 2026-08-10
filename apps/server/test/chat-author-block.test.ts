import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type {
  AuditLogsPayload,
  ChatMembersPayload,
  ModerationContentPayload,
} from "@eventer/shared";

const BASE = "https://example.com";

/** チャットの発言者単位の締め出し (#283)。
 *
 * 見るのは5点:
 * - 締め出すと、その発言者の鍵が表示許可リストから外れること
 *   （＝クライアントは許可リストで絞って描画するので、過去の発言がまとめて消える）
 * - 締め出された本人がチャットに繋がれず、発言用の鍵も手に入らないこと
 * - 解除すると元に戻ること
 * - 管理者以外は締め出しも一覧閲覧もできないこと
 * - 監査ログに対象と操作が残ること
 *
 * 1件ずつの非表示 (#278) は admin-content-moderation.test.ts が見ている。 */

async function deleteReq(path: string, cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api${path}`, {
    method: "DELETE",
    headers: { cookie },
  });
}

/** dev-login（DevUser = アプリ運営管理者） */
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
  const username = `b_${uid.slice(0, 8)}`;
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

/** 公開・開催中のイベント行を直接作る */
async function insertEvent(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, created_by, created_at)
     VALUES (?, ?, ?, ?, 'offline', 'published', ?, ?)`,
  )
    .bind(id, `締め出しE2E_${id.slice(0, 6)}`, now - 3600_000, now + 3600_000, ownerId, now)
    .run();
  return id;
}

async function addMember(
  eventId: string,
  userId: string,
  role: "participant" | "staff" = "participant",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, created_at) VALUES (?, ?, ?, ?, NULL, 'confirmed', ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, role, Date.now())
    .run();
}

async function postJson(
  path: string,
  cookie: string,
  body?: unknown,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** 一時鍵を発行して発言鍵として登録する (#223)。秘密鍵も返るので所有証明にも使える */
async function joinChat(
  eventId: string,
  cookie: string,
): Promise<{ secret: string; pubkey: string }> {
  const res = await postJson(`/events/${eventId}/chat-key/ephemeral`, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as { secret: string; pubkey: string };
}

async function chatMembers(
  eventId: string,
  cookie: string,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/chat-members`, {
    headers: { cookie },
  });
}

/** 表示許可リストに載っている pubkey の集合 */
async function visiblePubkeys(
  eventId: string,
  cookie: string,
): Promise<Set<string>> {
  const res = await chatMembers(eventId, cookie);
  expect(res.status).toBe(200);
  const payload = (await res.json()) as ChatMembersPayload;
  return new Set(payload.members.map((m) => m.pubkey));
}

/** 管理画面が「締め出し中」として受け取る行（鍵1本＝1行） */
async function blockedAuthors(
  eventId: string,
  cookie: string,
): Promise<ModerationContentPayload["chat"]["blocked"]> {
  const res = await SELF.fetch(
    `${BASE}/api/admin/moderation/events/${eventId}`,
    { headers: { cookie } },
  );
  expect(res.status).toBe(200);
  const { chat } = (await res.json()) as ModerationContentPayload;
  return chat.blocked;
}

/** 管理画面が「締め出し中」として受け取る pubkey の集合 */
async function blockedPubkeys(
  eventId: string,
  cookie: string,
): Promise<Set<string>> {
  const rows = await blockedAuthors(eventId, cookie);
  return new Set(rows.map((b) => b.pubkey));
}

function block(eventId: string, cookie: string, pubkey: string) {
  return postJson(
    `/admin/moderation/events/${eventId}/chat-authors/block`,
    cookie,
    { pubkey },
  );
}

function unblock(eventId: string, cookie: string, pubkey: string) {
  return postJson(
    `/admin/moderation/events/${eventId}/chat-authors/unblock`,
    cookie,
    { pubkey },
  );
}

/** このイベントに関する監査ログだけを拾う（ログはアプリ全体で1本なので絞る） */
async function auditFor(
  cookie: string,
  action: string,
  eventId: string,
): Promise<Array<{ targetHandle: string; detail: Record<string, unknown> }>> {
  const res = await SELF.fetch(
    `${BASE}/api/admin/audit-logs?action=${action}`,
    { headers: { cookie } },
  );
  expect(res.status).toBe(200);
  const { logs } = (await res.json()) as AuditLogsPayload;
  return logs
    .map((l) => ({
      targetHandle: l.targetHandle,
      detail: JSON.parse(l.detail || "{}") as Record<string, unknown>,
    }))
    .filter((l) => l.detail.eventId === eventId);
}

describe("チャットの発言者単位の締め出し (#283)", () => {
  it("締め出すと発言者が表示許可リストから外れ、解除すると戻る", async () => {
    const admin = await loginDev();
    const owner = await makeUser();
    const noisy = await makeUser();
    const other = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, noisy.userId);
    await addMember(eventId, other.userId);

    const noisyKey = await joinChat(eventId, noisy.cookie);
    const otherKey = await joinChat(eventId, other.cookie);

    // 締め出す前は2人とも許可リストに載っている
    const before = await visiblePubkeys(eventId, other.cookie);
    expect(before.has(noisyKey.pubkey)).toBe(true);
    expect(before.has(otherKey.pubkey)).toBe(true);

    const res = await block(eventId, admin, noisyKey.pubkey);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, changed: true });

    // 許可リストから外れる ＝ その人のこれまでの発言がまとめて描かれなくなる
    const after = await visiblePubkeys(eventId, other.cookie);
    expect(after.has(noisyKey.pubkey)).toBe(false);
    // 巻き添えが無いこと
    expect(after.has(otherKey.pubkey)).toBe(true);

    // 冪等: 2回目は状態を変えない
    const again = await block(eventId, admin, noisyKey.pubkey);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, changed: false });

    // 解除すると元に戻る（許可リストの行は消していないので鍵の登録し直しは要らない）
    const off = await unblock(eventId, admin, noisyKey.pubkey);
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ ok: true, changed: true });
    const restored = await visiblePubkeys(eventId, other.cookie);
    expect(restored.has(noisyKey.pubkey)).toBe(true);

    // 解除も冪等
    const offAgain = await unblock(eventId, admin, noisyKey.pubkey);
    expect(await offAgain.json()).toEqual({ ok: true, changed: false });
  });

  it("締め出された本人はチャットに繋がれず、発言用の鍵も手に入らない", async () => {
    const admin = await loginDev();
    const owner = await makeUser();
    const noisy = await makeUser();
    const other = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, noisy.userId);
    await addMember(eventId, other.userId);
    const noisyKey = await joinChat(eventId, noisy.cookie);
    await joinChat(eventId, other.cookie);

    expect((await block(eventId, admin, noisyKey.pubkey)).status).toBe(200);

    // 許可リストごと 403（理由は返さない。画面の文言は EventChat.tsx 側）
    const members = await chatMembers(eventId, noisy.cookie);
    expect(members.status).toBe(403);
    expect(await members.json()).toEqual({ error: "chat_unavailable" });

    // 既に持っている一時鍵も取り直せない ＝ 署名器が手に入らず、このアプリからは投稿できない。
    // ここを塞がないと、画面を再読み込みするだけで復帰してしまう
    const get = await SELF.fetch(
      `${BASE}/api/events/${eventId}/chat-key/ephemeral`,
      { headers: { cookie: noisy.cookie } },
    );
    expect(get.status).toBe(403);
    const post = await postJson(
      `/events/${eventId}/chat-key/ephemeral`,
      noisy.cookie,
    );
    expect(post.status).toBe(403);

    // 締め出し中の鍵での登録も受け付けない
    const proof = await chatKeyProof(eventId, noisyKey);
    const reregister = await postJson(`/events/${eventId}/chat-key`, noisy.cookie, {
      proof,
    });
    expect(reregister.status).toBe(403);

    // **締め出されていない別の鍵**での登録も受け付けない。
    // 締め出しは鍵ではなく人に対する操作なので、他の経路と同じく人で止める
    // （ここが通ると、締め出された人だけ 200 が返る不揃いが残る）
    const fresh = makeOwnKey();
    await linkKey(noisy.userId, fresh.pubkey);
    const withFresh = await postJson(`/events/${eventId}/chat-key`, noisy.cookie, {
      proof: await chatKeyProof(eventId, fresh),
    });
    expect(withFresh.status).toBe(403);
    expect(await withFresh.json()).toEqual({ error: "chat_unavailable" });

    // 他の人は今までどおり
    expect((await chatMembers(eventId, other.cookie)).status).toBe(200);

    // 解除すれば本人も戻る
    expect((await unblock(eventId, admin, noisyKey.pubkey)).status).toBe(200);
    expect((await chatMembers(eventId, noisy.cookie)).status).toBe(200);
  });

  it("締め出し中の鍵の登録は、鍵の使用状況より先に締め出しで止まる", async () => {
    const admin = await loginDev();
    const owner = await makeUser();
    const noisy = await makeUser();
    const other = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, noisy.userId);
    await addMember(eventId, other.userId);
    await joinChat(eventId, noisy.cookie);
    const otherKey = await joinChat(eventId, other.cookie);

    // 「他人が使用中」かつ「締め出し中」の鍵を登録しようとした場合。
    // 使用状況 (409) を先に返すと、繋がらない事実より先に別の情報が出てしまう
    expect((await block(eventId, admin, otherKey.pubkey)).status).toBe(200);
    const proof = await chatKeyProof(eventId, otherKey);
    const res = await postJson(`/events/${eventId}/chat-key`, noisy.cookie, {
      proof,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "chat_unavailable" });

    // 締め出しが無ければ従来どおり「使用中」で弾かれる（この確認の空振り防止）。
    // 使用状況まで判定が進むのは、その鍵がアカウントに登録されている場合だけ (#332)
    expect((await unblock(eventId, admin, otherKey.pubkey)).status).toBe(200);
    await linkKey(noisy.userId, otherKey.pubkey);
    const again = await postJson(`/events/${eventId}/chat-key`, noisy.cookie, {
      proof: await chatKeyProof(eventId, otherKey),
    });
    expect(again.status).toBe(409);
  });

  it("締め出されたスタッフはチャットのスタッフ操作もできない", async () => {
    const admin = await loginDev();
    const owner = await makeUser();
    const staff = await makeUser();
    const other = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, staff.userId, "staff");
    await addMember(eventId, other.userId);
    const staffKey = await joinChat(eventId, staff.cookie);
    await joinChat(eventId, other.cookie);

    // 部屋がある状態にしておく（作り直しが通ってしまったことを検出するため）
    const channelId = "cc".repeat(32);
    await env.DB.prepare("UPDATE event SET chat_channel_id = ? WHERE id = ?")
      .bind(channelId, eventId)
      .run();

    // 締め出す前は通ること＝この後の 403 が「そもそもスタッフ操作ができない」
    // ではなく、締め出しによるものだと言えるようにする
    const noteId = "ab".repeat(32);
    expect(
      (await postJson(`/events/${eventId}/chat-hidden`, staff.cookie, { noteId }))
        .status,
    ).toBe(200);

    expect((await block(eventId, admin, staffKey.pubkey)).status).toBe(200);

    // 締め出された人はチャットから切り離された人なので、スタッフ操作も一切できない
    const hide = await postJson(`/events/${eventId}/chat-hidden`, staff.cookie, {
      noteId: "cd".repeat(32),
    });
    expect(hide.status).toBe(403);
    expect(await hide.json()).toEqual({ error: "chat_unavailable" });
    expect(
      (await deleteReq(`/events/${eventId}/chat-hidden/${noteId}`, staff.cookie))
        .status,
    ).toBe(403);
    // ここがいちばん効く: 部屋を作り直されると**全員の**履歴が画面から消える
    expect(
      (await deleteReq(`/events/${eventId}/chat-channel`, staff.cookie)).status,
    ).toBe(403);
    expect(
      (await postJson(`/events/${eventId}/chat-channel/official`, staff.cookie))
        .status,
    ).toBe(403);
    expect(
      (
        await postJson(`/events/${eventId}/chat-channel`, staff.cookie, {
          channelEvent: {
            id: "ef".repeat(32),
            pubkey: "12".repeat(32),
            sig: "34".repeat(64),
            kind: 40,
            created_at: 1,
            tags: [],
            content: "{}",
          },
        })
      ).status,
    ).toBe(403);

    // 実際に何も起きていないこと（拒否されたつもりで通っていた、を防ぐ）
    const view = await chatMembers(eventId, other.cookie);
    expect(view.status).toBe(200);
    const payload = (await view.json()) as ChatMembersPayload;
    expect(payload.channelId).toBe(channelId);
    expect(payload.hiddenNoteIds).toEqual([noteId]);

    // 解除すればスタッフ操作も元どおり
    expect((await unblock(eventId, admin, staffKey.pubkey)).status).toBe(200);
    expect(
      (await deleteReq(`/events/${eventId}/chat-channel`, staff.cookie)).status,
    ).toBe(200);
  });

  /** 鍵が1人1つでなくなった (#332) ので、1人が同じイベントで複数の鍵を持つ。
   * 締め出しは「鍵」ではなく「人」に対する操作なので、どの鍵を指して締め出しても
   * その人の鍵はまとめて許可リストから外れる（外した鍵ぶんだけ消えて、
   * 別の鍵で書いた発言が残ってしまうと、締め出した意味が無くなる） */
  it("鍵を複数持っている人でも、締め出せば発言はまとめて消える (#332)", async () => {
    const admin = await loginDev();
    const owner = await makeUser();
    const noisy = await makeUser();
    const other = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, noisy.userId);
    await addMember(eventId, other.userId);
    const otherKey = await joinChat(eventId, other.cookie);

    // 端末を変えて2つの鍵で発言してきた状態を作る
    // （一時鍵で参加したあと、自分の鍵が使える端末でも参加した）
    const first = await joinChat(eventId, noisy.cookie);
    const second = makeOwnKey();
    await linkKey(noisy.userId, second.pubkey);
    expect(
      (
        await postJson(`/events/${eventId}/chat-key`, noisy.cookie, {
          proof: await chatKeyProof(eventId, second),
        })
      ).status,
    ).toBe(200);
    const before = await visiblePubkeys(eventId, other.cookie);
    expect(before.has(first.pubkey)).toBe(true);
    expect(before.has(second.pubkey)).toBe(true);

    // 古いほうの鍵を指して締め出す
    expect((await block(eventId, admin, first.pubkey)).status).toBe(200);

    const after = await visiblePubkeys(eventId, other.cookie);
    expect(after.has(first.pubkey)).toBe(false);
    expect(after.has(second.pubkey)).toBe(false);
    expect(after.has(otherKey.pubkey)).toBe(true);
    // 本人はチャットに繋がれない（鍵を登録し直しても履歴で判定するので外れない）
    expect((await chatMembers(eventId, noisy.cookie)).status).toBe(403);

    // 管理画面には**その人の鍵が全部**「締め出し中」として出る。
    // 締め出した鍵しか出ないと、別の鍵の発言に「締め出す」ボタンが出てしまい、
    // 押すと締め出しが2本になって、片方を解除しても人としては戻らなくなる
    expect(await blockedPubkeys(eventId, admin)).toEqual(
      new Set([first.pubkey, second.pubkey]),
    );
    // その鍵たちが**同じ1人のもの**だと分かる形で出す。分からないと、管理画面は
    // 「締め出している発言者」に同じ人を鍵の数だけ並べ、件数も人数にならない
    const blockedRows = await blockedAuthors(eventId, admin);
    expect(blockedRows.map((b) => b.userId)).toEqual([
      noisy.userId,
      noisy.userId,
    ]);
    // その別の鍵を指して締め出しても、状態は増えない（人単位で冪等）
    const twice = await block(eventId, admin, second.pubkey);
    expect(twice.status).toBe(200);
    expect(await twice.json()).toEqual({ ok: true, changed: false });

    // 解除は**どの鍵を指しても**その人の締め出しをまとめて解く
    expect((await unblock(eventId, admin, second.pubkey)).status).toBe(200);
    expect(await blockedPubkeys(eventId, admin)).toEqual(new Set());
    const restored = await visiblePubkeys(eventId, other.cookie);
    expect(restored.has(first.pubkey)).toBe(true);
    expect(restored.has(second.pubkey)).toBe(true);
    expect((await chatMembers(eventId, noisy.cookie)).status).toBe(200);
  });

  it("あるイベントでの締め出しは、同じ人・同じ鍵でも別のイベントに波及しない", async () => {
    const admin = await loginDev();
    const owner = await makeUser();
    const noisy = await makeUser();
    const other = await makeUser();
    const eventA = await insertEvent(owner.userId);
    const eventB = await insertEvent(owner.userId);
    for (const ev of [eventA, eventB]) {
      await addMember(ev, noisy.userId);
      await addMember(ev, other.userId);
    }
    await joinChat(eventA, other.cookie);
    await joinChat(eventB, other.cookie);

    // 同じ人が同じ鍵で両方のイベントに参加している状態を作る
    // （自分の鍵で参加すれば実際にこうなる）。
    // 鍵が別々だと「イベントで絞れているか」を確かめたことにならない
    const shared = makeOwnKey();
    await linkKey(noisy.userId, shared.pubkey);
    for (const ev of [eventA, eventB]) {
      const proof = await chatKeyProof(ev, shared);
      expect(
        (await postJson(`/events/${ev}/chat-key`, noisy.cookie, { proof }))
          .status,
      ).toBe(200);
    }
    expect((await visiblePubkeys(eventB, other.cookie)).has(shared.pubkey)).toBe(
      true,
    );

    expect((await block(eventA, admin, shared.pubkey)).status).toBe(200);

    // A では効く
    expect((await visiblePubkeys(eventA, other.cookie)).has(shared.pubkey)).toBe(
      false,
    );
    expect((await chatMembers(eventA, noisy.cookie)).status).toBe(403);

    // B には波及しない。ここが崩れると「1つのイベントの締め出しが
    // その人のすべてのイベントのチャットを止める」ことになる
    expect((await visiblePubkeys(eventB, other.cookie)).has(shared.pubkey)).toBe(
      true,
    );
    expect((await chatMembers(eventB, noisy.cookie)).status).toBe(200);
    // 発言用の鍵も B では今までどおり手に入る
    expect(
      (await postJson(`/events/${eventB}/chat-key/ephemeral`, noisy.cookie))
        .status,
    ).toBe(200);
  });

  it("管理者以外は締め出しも一覧閲覧もできない", async () => {
    const admin = await loginDev();
    const owner = await makeUser();
    const staff = await makeUser();
    const noisy = await makeUser();
    const eventId = await insertEvent(owner.userId);
    // そのイベントのスタッフでも管理画面の経路は触れない（別系統 #278）
    await addMember(eventId, staff.userId, "staff");
    await addMember(eventId, noisy.userId);
    const noisyKey = await joinChat(eventId, noisy.cookie);

    for (const cookie of [staff.cookie, noisy.cookie]) {
      expect((await block(eventId, cookie, noisyKey.pubkey)).status).toBe(403);
      expect((await unblock(eventId, cookie, noisyKey.pubkey)).status).toBe(403);
      const list = await SELF.fetch(
        `${BASE}/api/admin/moderation/events/${eventId}`,
        { headers: { cookie } },
      );
      expect(list.status).toBe(403);
    }
    // 未ログインも同じ
    const anon = await SELF.fetch(
      `${BASE}/api/admin/moderation/events/${eventId}/chat-authors/block`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pubkey: noisyKey.pubkey }),
      },
    );
    expect(anon.status).toBe(401);

    // 締め出されていないことを確認（拒否されたつもりで通っていた、を防ぐ）
    expect((await visiblePubkeys(eventId, staff.cookie)).has(noisyKey.pubkey)).toBe(
      true,
    );
    // 管理者なら通る
    expect((await block(eventId, admin, noisyKey.pubkey)).status).toBe(200);
  });

  it("管理画面には締め出し中の発言者も出る（誰を締め出したか一覧でき、解除できる）", async () => {
    const admin = await loginDev();
    const owner = await makeUser();
    const noisy = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, noisy.userId);
    const noisyKey = await joinChat(eventId, noisy.cookie);
    expect((await block(eventId, admin, noisyKey.pubkey)).status).toBe(200);

    const res = await SELF.fetch(
      `${BASE}/api/admin/moderation/events/${eventId}`,
      { headers: { cookie: admin } },
    );
    expect(res.status).toBe(200);
    const { chat } = (await res.json()) as ModerationContentPayload;
    // 締め出し中も members に残す（誰の発言かを画面に出せないと解除の判断ができない）
    expect(chat.members.map((m) => m.pubkey)).toContain(noisyKey.pubkey);
    expect(chat.blocked.map((b) => b.pubkey)).toEqual([noisyKey.pubkey]);
    expect(chat.blocked[0].blockedAt).toBeGreaterThan(0);
    // 誰の鍵かも添える（画面が人ごとにまとめるのに要る #332）
    expect(chat.blocked[0].userId).toBe(noisy.userId);
  });

  it("監査ログに対象と操作が残る", async () => {
    const admin = await loginDev();
    const owner = await makeUser();
    const noisy = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, noisy.userId);
    const noisyKey = await joinChat(eventId, noisy.cookie);

    await block(eventId, admin, noisyKey.pubkey);
    // 冪等な再送では2件目を残さない
    await block(eventId, admin, noisyKey.pubkey);
    const blocked = await auditFor(admin, "chat_author_block", eventId);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].detail.pubkey).toBe(noisyKey.pubkey);
    expect(blocked[0].targetHandle).toBe(noisy.username);

    await unblock(eventId, admin, noisyKey.pubkey);
    const unblocked = await auditFor(admin, "chat_author_unblock", eventId);
    expect(unblocked).toHaveLength(1);
    expect(unblocked[0].detail.pubkey).toBe(noisyKey.pubkey);
  });

  it("鍵の形式が不正なら 400、存在しないイベントは 404", async () => {
    const admin = await loginDev();
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId);

    expect((await block(eventId, admin, "not-a-pubkey")).status).toBe(400);
    expect((await block(eventId, admin, "AB".repeat(32))).status).toBe(400);
    const missing = await block(
      "00000000-0000-0000-0000-000000000000",
      admin,
      "ab".repeat(32),
    );
    expect(missing.status).toBe(404);
  });
});

// ---- Nostr 署名ヘルパー（event-chat.test.ts と同じ形） ----
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/** 自分の鍵（本番では手元の署名手段が持つ鍵）を1つ作る */
function makeOwnKey(): { secret: string; pubkey: string } {
  const sk = schnorr.utils.randomSecretKey();
  return { secret: bytesToHex(sk), pubkey: bytesToHex(schnorr.getPublicKey(sk)) };
}

/** その鍵を「このアカウントに登録された鍵」にする (#332)。
 * 登録できるのはアカウントに登録された鍵だけなので、これが無いと 403 になる */
async function linkKey(userId: string, pubkey: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO identity (id, user_id, provider, provider_user_id, email, created_at)
     VALUES (?, ?, 'nostr', ?, NULL, ?)`,
  )
    .bind(crypto.randomUUID(), userId, pubkey, Date.now())
    .run();
}

/** 一時鍵の秘密鍵で、その鍵の所有証明（kind:27888）を作る */
async function chatKeyProof(
  eventId: string,
  key: { secret: string; pubkey: string },
) {
  const res = await SELF.fetch(`${BASE}/api/auth/nostr/challenge`);
  const { challenge } = (await res.json()) as { challenge: string };
  const createdAt = Math.floor(Date.now() / 1000);
  const tags = [
    ["purpose", "eventer-chat-key"],
    ["eventer-event", eventId],
    ["challenge", challenge],
  ];
  const serialized = JSON.stringify([
    0,
    key.pubkey,
    createdAt,
    27888,
    tags,
    "",
  ]);
  const id = bytesToHex(sha256(new TextEncoder().encode(serialized)));
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), hexToBytes(key.secret)));
  return { id, pubkey: key.pubkey, sig, kind: 27888, created_at: createdAt, tags, content: "" };
}
