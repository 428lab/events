import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { ScheduleItem } from "@eventer/shared";

/** 退会の猶予期間 (#250)。即時無効化・復帰・30日後の完全削除・引き取り/統合の除外 */

const BASE = "https://example.com";
const DAY = 24 * 60 * 60 * 1000;

interface TestUser {
  userId: string;
  cookie: string;
  handle: string;
}

/** 一般ユーザーを1人作る（セッション付き）。
 * admin=true なら discord_id を ADMIN_DISCORD_IDS(=dev-user) に一致させる */
async function makeUser(admin = false): Promise<TestUser> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const handle = `t_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, NULL, NULL, ?)",
  )
    .bind(uid, admin ? "dev-user" : `t:${uid}`, handle, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + DAY)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}`, handle };
}

/** 既存ユーザーに追加のセッションを発行する（復帰フローの検証用） */
async function newSession(userId: string): Promise<string> {
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, userId, Date.now() + DAY)
    .run();
  return `eventer_session=${sid}`;
}

async function requestDelete(cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/me`, {
    method: "DELETE",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ confirm: true }),
  });
}

async function restore(cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/me/restore`, { method: "POST", headers: { cookie } });
}

async function runPurge(key = "test-cron-secret"): Promise<Response> {
  return SELF.fetch(`${BASE}/api/cron/purge-deleted`, {
    method: "POST",
    headers: { "x-cron-key": key },
  });
}

/** deleted_at を日数分だけ過去に戻す（猶予期間の経過を再現する） */
async function backdateDeletion(userId: string, days: number): Promise<void> {
  await env.DB.prepare("UPDATE user SET deleted_at = deleted_at - ? WHERE id = ?")
    .bind(days * DAY, userId)
    .run();
}

async function userRow(userId: string): Promise<{ deleted_at: number | null } | null> {
  return env.DB.prepare("SELECT deleted_at FROM user WHERE id = ?")
    .bind(userId)
    .first<{ deleted_at: number | null }>();
}

async function makeEvent(createdBy: string): Promise<string> {
  const eventId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, created_by, created_at) VALUES (?, '猶予テスト', 1, 2, 'offline', 'published', ?, ?)",
  )
    .bind(eventId, createdBy, Date.now())
    .run();
  return eventId;
}

async function joinEvent(
  eventId: string,
  userId: string,
  role = "participant",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, created_at) VALUES (?, ?, ?, ?, NULL, 'confirmed', ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, role, Date.now())
    .run();
}

/** nostr のみを唯一の連携として持つアカウントを直接作る（引き取り元） */
async function makeNostrOnlyUser(pubkey: string): Promise<string> {
  const uid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, NULL, NULL, ?)",
  )
    .bind(uid, `nostr:${pubkey}`, `n_${uid.slice(0, 8)}`, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO identity (id, user_id, provider, provider_user_id, email, created_at) VALUES (?, ?, 'nostr', ?, NULL, ?)",
  )
    .bind(crypto.randomUUID(), uid, pubkey, Date.now())
    .run();
  return uid;
}

/** kind:22242 のログインイベントを署名する */
async function nostrLoginEvent(sk: Uint8Array): Promise<object> {
  const res = await SELF.fetch(`${BASE}/api/auth/nostr/challenge`);
  const { challenge } = (await res.json()) as { challenge: string };
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  const created_at = Math.floor(Date.now() / 1000);
  const tags = [
    ["relay", BASE],
    ["challenge", challenge],
  ];
  const serialized = JSON.stringify([0, pubkey, created_at, 22242, tags, ""]);
  const id = bytesToHex(sha256(new TextEncoder().encode(serialized)));
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { id, pubkey, sig, kind: 22242, created_at, tags, content: "" };
}

describe("退会の猶予期間 (#250)", () => {
  it("退会直後はデータを消さず、セッションを破棄して利用不可にする", async () => {
    const a = await makeUser();
    const res = await requestDelete(a.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; purgeAt: number };
    expect(body.ok).toBe(true);
    expect(body.purgeAt).toBeGreaterThan(Date.now() + 29 * DAY);

    // ユーザー行は残り deleted_at が立つ（実データはまだ消えない）
    const row = await userRow(a.userId);
    expect(row?.deleted_at).toBeGreaterThan(0);

    // セッションは全削除され、元の cookie では認証されない
    const sessions = await env.DB.prepare(
      "SELECT COUNT(1) AS n FROM session WHERE user_id = ?",
    )
      .bind(a.userId)
      .first<{ n: number }>();
    expect(sessions?.n).toBe(0);
    const me = await SELF.fetch(`${BASE}/api/auth/me`, {
      headers: { cookie: a.cookie },
    });
    expect(me.status).toBe(401);
  });

  it("退会直後は他ユーザーから見えなくなる（プロフィール・参加者一覧・チャット表示許可）", async () => {
    const host = await makeUser();
    const a = await makeUser();
    const eventId = await makeEvent(host.userId);
    // chat-members は staff/participant 等のメンバーロールで見る
    await joinEvent(eventId, host.userId, "staff");
    await joinEvent(eventId, a.userId);
    await env.DB.prepare(
      "INSERT INTO event_chat_pubkey (event_id, user_id, pubkey, created_at) VALUES (?, ?, 'pk-a', ?)",
    )
      .bind(eventId, a.userId, Date.now())
      .run();
    // フォロー（host → a）
    await env.DB.prepare(
      "INSERT INTO user_follow (follower_id, followee_id, created_at) VALUES (?, ?, ?)",
    )
      .bind(host.userId, a.userId, Date.now())
      .run();

    // 退会前は見えている
    const before = await SELF.fetch(
      `${BASE}/api/public/users/${encodeURIComponent(a.handle)}`,
    );
    expect(before.status).toBe(200);

    expect((await requestDelete(a.cookie)).status).toBe(200);

    // 公開プロフィールは 404
    const after = await SELF.fetch(
      `${BASE}/api/public/users/${encodeURIComponent(a.handle)}`,
    );
    expect(after.status).toBe(404);

    // 参加者一覧から除外される
    const members = await SELF.fetch(`${BASE}/api/events/${eventId}/members`, {
      headers: { cookie: host.cookie },
    });
    expect(members.status).toBe(200);
    const memberIds = (
      (await members.json()) as { members: Array<{ user: { id: string } }> }
    ).members.map((m) => m.user.id);
    expect(memberIds).toContain(host.userId);
    expect(memberIds).not.toContain(a.userId);

    // チャットの表示許可リスト（Nostr pubkey）からも除外される
    const chat = await SELF.fetch(`${BASE}/api/events/${eventId}/chat-members`, {
      headers: { cookie: host.cookie },
    });
    expect(chat.status).toBe(200);
    const pubkeys = (
      (await chat.json()) as { members: Array<{ pubkey: string }> }
    ).members.map((m) => m.pubkey);
    expect(pubkeys).not.toContain("pk-a");

    // フォロー中一覧からも消える
    const following = await SELF.fetch(`${BASE}/api/me/following`, {
      headers: { cookie: host.cookie },
    });
    const followed = (
      (await following.json()) as { following: Array<{ id: string }> }
    ).following.map((u) => u.id);
    expect(followed).not.toContain(a.userId);
  });

  it("猶予期間中に同じログイン方法でログインすると復帰できる", async () => {
    const a = await makeUser();
    const eventId = await makeEvent(a.userId);
    await joinEvent(eventId, a.userId, "host");
    expect((await requestDelete(a.cookie)).status).toBe(200);

    // ログイン（＝新しいセッション）はできるが、まだ利用不可で復帰の案内が返る
    const cookie = await newSession(a.userId);
    const pendingRes = await SELF.fetch(`${BASE}/api/auth/me`, {
      headers: { cookie },
    });
    expect(pendingRes.status).toBe(403);
    const pending = (await pendingRes.json()) as {
      error: string;
      pendingDeletion: { deletedAt: number; purgeAt: number; username: string };
    };
    expect(pending.error).toBe("pending_deletion");
    expect(pending.pendingDeletion.username).toBe(a.handle);
    expect(pending.pendingDeletion.purgeAt).toBe(
      pending.pendingDeletion.deletedAt + 30 * DAY,
    );

    // 復帰API 以外は使えない
    expect(
      (await SELF.fetch(`${BASE}/api/me/events`, { headers: { cookie } })).status,
    ).toBe(401);

    // 復帰
    expect((await restore(cookie)).status).toBe(200);
    expect((await userRow(a.userId))?.deleted_at).toBeNull();

    // 通常どおり使える／他ユーザーからも見える
    const me = await SELF.fetch(`${BASE}/api/auth/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    const profile = await SELF.fetch(
      `${BASE}/api/public/users/${encodeURIComponent(a.handle)}`,
    );
    expect(profile.status).toBe(200);

    // 監査ログに復帰が残る
    const audit = await env.DB.prepare(
      "SELECT COUNT(1) AS n FROM audit_log WHERE action = 'account_restore' AND target_user_id = ?",
    )
      .bind(a.userId)
      .first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it("猶予期間を過ぎた申請は復帰できず、期間内なら復帰後にバッチでも消えない", async () => {
    const a = await makeUser();
    expect((await requestDelete(a.cookie)).status).toBe(200);
    await backdateDeletion(a.userId, 31);
    const cookie = await newSession(a.userId);
    // 猶予期間を過ぎた申請は復帰させない（バッチ待ちの状態）
    expect((await restore(cookie)).status).toBe(410);

    // 29日経過なら復帰できる
    const b = await makeUser();
    expect((await requestDelete(b.cookie)).status).toBe(200);
    await backdateDeletion(b.userId, 29);
    const bCookie = await newSession(b.userId);
    expect((await restore(bCookie)).status).toBe(200);
    expect((await runPurge()).status).toBe(200);
    expect(await userRow(b.userId)).not.toBeNull();
  });

  it("日次バッチは30日を過ぎた申請だけを完全削除する", async () => {
    const old = await makeUser(); // 31日前に申請（削除される）
    const recent = await makeUser(); // 29日前に申請（残る）
    const active = await makeUser(); // 申請していない（残る）
    for (const u of [old, recent]) {
      expect((await requestDelete(u.cookie)).status).toBe(200);
    }
    await backdateDeletion(old.userId, 31);
    await backdateDeletion(recent.userId, 29);

    const res = await runPurge();
    expect(res.status).toBe(200);
    expect(
      (await res.json()) as { purged: number; failed: number; remaining: number },
    ).toEqual({ purged: 1, failed: 0, remaining: 0 });

    expect(await userRow(old.userId)).toBeNull();
    expect(await userRow(recent.userId)).not.toBeNull();
    expect(await userRow(active.userId)).not.toBeNull();

    // 完全削除の監査ログが残る
    const audit = await env.DB.prepare(
      "SELECT target_handle, detail FROM audit_log WHERE action = 'account_delete_completed' AND target_user_id = ?",
    )
      .bind(old.userId)
      .first<{ target_handle: string; detail: string }>();
    expect(audit?.target_handle).toBe(old.handle);
    expect(JSON.parse(audit!.detail).requestedAt).toBeGreaterThan(0);

    // 2回目の実行では対象が無い
    const again = await runPurge();
    expect((await again.json()) as { purged: number }).toEqual({
      purged: 0,
      failed: 0,
      remaining: 0,
    });
  });

  it("日次バッチは cron キーが無い／違うと実行されない", async () => {
    const a = await makeUser();
    expect((await requestDelete(a.cookie)).status).toBe(200);
    await backdateDeletion(a.userId, 31);

    expect((await runPurge("wrong")).status).toBe(403);
    expect(
      (await SELF.fetch(`${BASE}/api/cron/purge-deleted`, { method: "POST" }))
        .status,
    ).toBe(403);
    expect(await userRow(a.userId)).not.toBeNull();
  });

  it("猶予期間中のアカウントは連携の引き取り (#238) の対象外", async () => {
    const me = await makeUser();
    const sk = schnorr.utils.randomSecretKey();
    const pubkey = bytesToHex(schnorr.getPublicKey(sk));
    // 実績なし＝本来なら引き取れる空アカウントだが、退会申請中にする
    const orphan = await makeNostrOnlyUser(pubkey);
    await env.DB.prepare("UPDATE user SET deleted_at = ? WHERE id = ?")
      .bind(Date.now(), orphan)
      .run();

    const res = await SELF.fetch(`${BASE}/api/auth/nostr/login`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ event: await nostrLoginEvent(sk) }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("account_deleted");

    // 相手のアカウントも identity も無傷
    expect(await userRow(orphan)).not.toBeNull();
    const identity = await env.DB.prepare(
      "SELECT user_id FROM identity WHERE provider = 'nostr' AND provider_user_id = ?",
    )
      .bind(pubkey)
      .first<{ user_id: string }>();
    expect(identity?.user_id).toBe(orphan);
  });

  it("猶予期間中のアカウントはアカウント統合 (#240) の相手にならない", async () => {
    const me = await makeUser();
    const other = await makeUser();
    // 統合コードは退会前に発行しておく（コード自体は有効なまま）
    const codeRes = await SELF.fetch(`${BASE}/api/me/merge-code`, {
      method: "POST",
      headers: { cookie: other.cookie },
    });
    const { code } = (await codeRes.json()) as { code: string };
    expect((await requestDelete(other.cookie)).status).toBe(200);

    const res = await SELF.fetch(`${BASE}/api/me/merge`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ code, keep: "me" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_code");
    // どちらのアカウントも残っている
    expect(await userRow(me.userId)).not.toBeNull();
    expect(await userRow(other.userId)).not.toBeNull();
  });

  it("猶予期間中もハンドルは予約され、他の人に奪われない", async () => {
    const a = await makeUser();
    const b = await makeUser();
    expect((await requestDelete(a.cookie)).status).toBe(200);

    const res = await SELF.fetch(`${BASE}/api/me/username`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: b.cookie },
      body: JSON.stringify({ username: a.handle }),
    });
    expect(res.status).toBe(409);
  });

  it("完全削除の手動実行は app admin だけが叩ける", async () => {
    const stranger = await makeUser();
    const admin = await makeUser(true);
    const path = `${BASE}/api/admin/run-purge-deleted`;

    expect((await SELF.fetch(path, { method: "POST" })).status).toBe(401);
    expect(
      (await SELF.fetch(path, { method: "POST", headers: { cookie: stranger.cookie } }))
        .status,
    ).toBe(403);
    const ok = await SELF.fetch(path, {
      method: "POST",
      headers: { cookie: admin.cookie },
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()) as { purged: number }).toHaveProperty("purged");
  });
});

/* ------------------------------------------------------------------
 * 猶予期間中に「表示名のコピー」や「連絡先の新規開示」が漏れないこと
 * ---------------------------------------------------------------- */

/** 個人エントリー（参加確定時に表示名をコピーしたもの）＋成果物を作る */
async function makeIndividualEntry(
  eventId: string,
  userId: string,
  name: string,
): Promise<string> {
  const entryId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO entry (id, event_id, kind, name, created_at) VALUES (?, ?, 'individual', ?, ?)",
  )
    .bind(entryId, eventId, name, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO entry_member (id, entry_id, user_id, is_leader) VALUES (?, ?, ?, 1)",
  )
    .bind(crypto.randomUUID(), entryId, userId)
    .run();
  await env.DB.prepare(
    "INSERT INTO submission (id, entry_id, presentation_url, source_code_url, updated_at) VALUES (?, ?, 'https://example.com/slides', NULL, ?)",
  )
    .bind(crypto.randomUUID(), entryId, Date.now())
    .run();
  return entryId;
}

/** そのエントリーを1位にする（表彰結果に entryName が出る経路） */
async function makeAwardResult(eventId: string, entryId: string): Promise<void> {
  const rankId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO award_rank (id, event_id, name, content, rank_order, created_at) VALUES (?, ?, '最優秀賞', '', 0, ?)",
  )
    .bind(rankId, eventId, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO award_result (id, event_id, entry_id, award_rank_id, special_award_id) VALUES (?, ?, ?, ?, NULL)",
  )
    .bind(crypto.randomUUID(), eventId, entryId, rankId)
    .run();
}

async function createVenue(cookie: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/venues`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name: `猶予会場_${crypto.randomUUID().slice(0, 6)}`,
      area: "東京都渋谷区",
      address: "道玄坂1-2-3 テストビル4F",
      contact: "X: @venue_secret",
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { venue: { id: string } }).venue.id;
}

async function openVenueIds(): Promise<string[]> {
  const res = await SELF.fetch(`${BASE}/api/public/venues`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { venues: { id: string }[] }).venues.map((v) => v.id);
}

describe("退会の猶予期間: 表示名のコピーと連絡先の開示 (#250)", () => {
  it("個人エントリーの表示名・ユーザーIDが entries / submissions / 表彰 / 採点結果に出ない（復帰で戻る）", async () => {
    const host = await makeUser();
    const a = await makeUser();
    const eventId = await makeEvent(host.userId);
    await joinEvent(eventId, host.userId, "staff");
    await joinEvent(eventId, a.userId);
    // entry.name は参加確定時にコピーされた表示名（user テーブルを見ない）
    const entryId = await makeIndividualEntry(eventId, a.userId, a.handle);
    await makeAwardResult(eventId, entryId);

    const paths = [
      `${BASE}/api/events/${eventId}/entries`,
      `${BASE}/api/events/${eventId}/submissions`,
      `${BASE}/api/events/${eventId}/awards`,
      `${BASE}/api/events/${eventId}/scores/results`,
    ];
    // 退会前は表示名が出ている（公開イベントなので未ログインでも見える）
    for (const path of paths) {
      const res = await SELF.fetch(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(a.handle);
    }

    expect((await requestDelete(a.cookie)).status).toBe(200);

    // 退会申請後は表示名もユーザーIDも出ない（成果物URLは残す）
    for (const path of paths) {
      const res = await SELF.fetch(path);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(a.handle);
      expect(text).not.toContain(a.userId);
      expect(text).toContain("退会済みユーザー");
    }
    const entries = (await (
      await SELF.fetch(`${BASE}/api/events/${eventId}/entries`)
    ).json()) as {
      entries: { id: string; name: string; memberUserIds: string[]; submission: unknown }[];
    };
    const entry = entries.entries.find((e) => e.id === entryId)!;
    expect(entry.name).toBe("退会済みユーザー");
    expect(entry.memberUserIds).toEqual([]);
    expect(entry.submission).toBeTruthy(); // 成果物URLは消していない

    // 復帰すれば元の表示名に戻る（データを消していないので復元できる）
    expect((await restore(await newSession(a.userId))).status).toBe(200);
    const back = (await (
      await SELF.fetch(`${BASE}/api/events/${eventId}/entries`)
    ).json()) as { entries: { id: string; name: string; memberUserIds: string[] }[] };
    const restored = back.entries.find((e) => e.id === entryId)!;
    expect(restored.name).toBe(a.handle);
    expect(restored.memberUserIds).toEqual([a.userId]);
  });

  it("猶予期間中のオーナーの会場は公開一覧から消え、新規オファーも拒否される", async () => {
    const owner = await makeUser();
    const organizer = await makeUser();
    const eventId = await makeEvent(organizer.userId);
    const venueId = await createVenue(owner.cookie);

    expect(await openVenueIds()).toContain(venueId);

    expect((await requestDelete(owner.cookie)).status).toBe(200);

    // 公開一覧から消える（承諾で連絡先・非公開住所が開示される経路を塞ぐ）
    expect(await openVenueIds()).not.toContain(venueId);
    // 件数も一覧と揃っている
    const listBody = (await (await SELF.fetch(`${BASE}/api/public/venues`)).json()) as {
      venues: unknown[];
      total: number;
    };
    expect(listBody.total).toBe(listBody.venues.length);

    // 一覧を経由せず直接 API を叩いてもオファーは作れない
    const offer = await SELF.fetch(`${BASE}/api/venue-offers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: organizer.cookie },
      body: JSON.stringify({ venueId, eventId, contact: "X: @organizer" }),
    });
    expect(offer.status).toBe(409);
    expect(((await offer.json()) as { error: string }).error).toBe("venue_unavailable");

    // 復帰すれば元どおり出る
    expect((await restore(await newSession(owner.userId))).status).toBe(200);
    expect(await openVenueIds()).toContain(venueId);
  });

  it("退会申請中の主催者が出したオファーは承諾できない（連絡先を渡さない）", async () => {
    const owner = await makeUser();
    const organizer = await makeUser();
    const eventId = await makeEvent(organizer.userId);
    const venueId = await createVenue(owner.cookie);

    const created = await SELF.fetch(`${BASE}/api/venue-offers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: organizer.cookie },
      body: JSON.stringify({ venueId, eventId, contact: "X: @organizer_secret" }),
    });
    expect(created.status).toBe(201);
    const offerId = ((await created.json()) as { offer: { id: string } }).offer.id;

    // 主催者が退会申請 → 会場側が承諾しても連絡先は開示しない
    expect((await requestDelete(organizer.cookie)).status).toBe(200);
    const accept = await SELF.fetch(`${BASE}/api/venue-offers/${offerId}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ action: "accept" }),
    });
    expect(accept.status).toBe(409);
    expect(((await accept.json()) as { error: string }).error).toBe(
      "counterparty_unavailable",
    );
    const still = await env.DB.prepare("SELECT status FROM venue_offer WHERE id = ?")
      .bind(offerId)
      .first<{ status: string }>();
    expect(still?.status).toBe("pending");

    // 会場側の一覧にも主催者の連絡先は出ない
    const forVenue = await SELF.fetch(`${BASE}/api/venue-offers/for-venue/${venueId}`, {
      headers: { cookie: owner.cookie },
    });
    expect(await forVenue.text()).not.toContain("organizer_secret");

    // 見送り（連絡先の開示を伴わない）はできる
    const decline = await SELF.fetch(`${BASE}/api/venue-offers/${offerId}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ action: "decline" }),
    });
    expect(decline.status).toBe(200);
  });

  it("抽選は退会申請中の申込者を当選させない（枠を無駄にしない）", async () => {
    const host = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const eventId = await makeEvent(host.userId);
    await joinEvent(eventId, host.userId, "staff");

    const slotId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO participation_slot (id, event_id, name, capacity, selection_type, sort_order, created_at) VALUES (?, ?, '一般枠', 1, 'lottery', 0, ?)",
    )
      .bind(slotId, eventId, Date.now())
      .run();
    for (const u of [a, b]) {
      await env.DB.prepare(
        "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, created_at) VALUES (?, ?, ?, 'participant', ?, 'applied', ?)",
      )
        .bind(crypto.randomUUID(), eventId, u.userId, slotId, Date.now())
        .run();
    }

    // a が退会申請 → 抽選の母集団から外れる（定員1を b が取る）
    expect((await requestDelete(a.cookie)).status).toBe(200);
    const draw = await SELF.fetch(
      `${BASE}/api/events/${eventId}/slots/${slotId}/draw`,
      { method: "POST", headers: { cookie: host.cookie } },
    );
    expect(draw.status).toBe(200);
    expect((await draw.json()) as { drawn: number; confirmed: number; lost: number }).toEqual(
      { drawn: 1, confirmed: 1, lost: 0 },
    );

    const statusOf = async (userId: string) =>
      (
        await env.DB.prepare(
          "SELECT status FROM event_member WHERE event_id = ? AND user_id = ?",
        )
          .bind(eventId, userId)
          .first<{ status: string }>()
      )?.status;
    expect(await statusOf(b.userId)).toBe("confirmed");
    // 申込のまま据え置き（当選も落選もさせない＝復帰したら申込に戻る）
    expect(await statusOf(a.userId)).toBe("applied");
    // 当落の通知も飛ばない
    const notified = await env.DB.prepare(
      "SELECT COUNT(1) AS n FROM notification WHERE user_id = ? AND type IN ('lottery_won','lottery_lost')",
    )
      .bind(a.userId)
      .first<{ n: number }>();
    expect(notified?.n).toBe(0);

    // 手動の当選操作も対象外
    const manual = await SELF.fetch(
      `${BASE}/api/events/${eventId}/slots/${slotId}/members/${a.userId}/status`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: host.cookie },
        body: JSON.stringify({ status: "confirmed" }),
      },
    );
    expect(manual.status).toBe(404);
    expect(await statusOf(a.userId)).toBe("applied");
  });
});

/** タイムテーブルの取得（公開GET） */
async function getTimetable(
  eventId: string,
  cookie?: string,
): Promise<ScheduleItem[]> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
    headers: cookie ? { cookie } : {},
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: ScheduleItem[] }).items;
}

/** 編集画面と同じ形（取得した項目をそのまま保存し直す）でタイムテーブルを保存 */
async function saveTimetable(
  eventId: string,
  cookie: string,
  items: ScheduleItem[],
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      items: items.map((it) => ({
        title: it.title,
        description: it.description,
        durationMin: it.durationMin,
        startsAt: it.startsAt,
        // 編集画面 (ScheduleEditor) は表示用の speaker ではなく
        // 生の speakerUserId を持ち回して保存する
        speakerUserId: it.speakerUserId,
        speakerName: it.speakerName,
        materialUrl: it.materialUrl,
      })),
    }),
  });
}

describe("退会の猶予期間: タイムテーブルの登壇者リンク (#250)", () => {
  it("猶予期間中に保存しても登壇者リンクが消えず、復帰で登壇者表示が戻る", async () => {
    const host = await makeUser();
    const speaker = await makeUser();
    const eventId = await makeEvent(host.userId);
    await joinEvent(eventId, host.userId, "staff");
    await joinEvent(eventId, speaker.userId);

    const created = await SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: host.cookie },
      body: JSON.stringify({
        items: [
          {
            title: "LT 1",
            durationMin: 10,
            speakerUserId: speaker.userId,
            speakerName: "",
          },
        ],
      }),
    });
    expect(created.status).toBe(200);
    expect((await getTimetable(eventId))[0]?.speaker?.id).toBe(speaker.userId);

    // 退会申請 → 表示は匿名化されるが、生のリンクはレスポンスに残る
    expect((await requestDelete(speaker.cookie)).status).toBe(200);
    const hidden = await getTimetable(eventId);
    expect(hidden[0]?.speaker).toBeNull();
    expect(hidden[0]?.speakerName).toBe("");
    expect(hidden[0]?.speakerUserId).toBe(speaker.userId);

    // 猶予期間中に staff が編集画面から保存し直しても、リンクは失われない
    expect((await saveTimetable(eventId, host.cookie, hidden)).status).toBe(200);
    const afterSave = await getTimetable(eventId);
    expect(afterSave[0]?.speaker).toBeNull();
    expect(afterSave[0]?.speakerUserId).toBe(speaker.userId);
    expect(
      (
        await env.DB.prepare(
          "SELECT speaker_user_id FROM event_schedule_item WHERE event_id = ?",
        )
          .bind(eventId)
          .first<{ speaker_user_id: string | null }>()
      )?.speaker_user_id,
    ).toBe(speaker.userId);

    // 復帰すれば登壇者情報が戻る
    expect((await restore(await newSession(speaker.userId))).status).toBe(200);
    const restored = await getTimetable(eventId);
    expect(restored[0]?.speaker?.id).toBe(speaker.userId);
    expect(restored[0]?.speaker?.username).toBe(speaker.handle);
  });
});

describe("退会の猶予期間: 完全削除のサブリクエスト予算 (#250)", () => {
  it("データ量の多いユーザーが居ても詰まらず、残りは remaining に計上される", async () => {
    // 先頭のユーザーだけで予算を超える量の R2 プレフィックス（デッキ）を持たせる
    const heavy = await makeUser();
    const light = await makeUser();
    expect((await requestDelete(heavy.cookie)).status).toBe(200);
    expect((await requestDelete(light.cookie)).status).toBe(200);
    // heavy のほうが古い申請＝先に処理される
    await backdateDeletion(heavy.userId, 32);
    await backdateDeletion(light.userId, 31);
    for (let i = 0; i < 60; i += 1) {
      await env.DB.prepare(
        "INSERT INTO deck (id, slug, owner_id, title, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?)",
      )
        .bind(
          crypto.randomUUID(),
          `slug-${crypto.randomUUID()}`,
          heavy.userId,
          Date.now(),
          Date.now(),
        )
        .run();
    }

    const res = await runPurge();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      purged: number;
      failed: number;
      remaining: number;
    };
    // 予算を超える1人でも必ず処理される（永久に詰まらない）
    expect(body.purged).toBe(1);
    expect(body.failed).toBe(0);
    expect(await userRow(heavy.userId)).toBeNull();
    // 予算を使い切ったので後続は翌日に回り、remaining として報告される
    expect(body.remaining).toBeGreaterThanOrEqual(1);
    expect(await userRow(light.userId)).not.toBeNull();

    // 翌日の実行で残りが片付く
    const again = await runPurge();
    expect(
      ((await again.json()) as { purged: number }).purged,
    ).toBeGreaterThanOrEqual(1);
    expect(await userRow(light.userId)).toBeNull();
  });
});

describe("退会の猶予期間: actor として作った通知 (#250)", () => {
  it("退会申請でフォロワー・同席者の通知一覧から名前が消える", async () => {
    const actor = await makeUser();
    const follower = await makeUser();
    const other = await makeUser();
    const otherEventId = await makeEvent(other.userId);
    const ownEventId = await makeEvent(actor.userId);
    await joinEvent(otherEventId, actor.userId);
    await joinEvent(otherEventId, other.userId, "staff");

    // routes/follows.ts / routes/eventMeets.ts と同じ形の通知を作る
    const addNotification = async (
      userId: string,
      type: string,
      title: string,
      link: string,
    ) => {
      await env.DB.prepare(
        "INSERT INTO notification (id, user_id, type, title, body, link, read_at, created_at) VALUES (?, ?, ?, ?, '', ?, 0, ?)",
      )
        .bind(crypto.randomUUID(), userId, type, title, link, Date.now())
        .run();
    };
    await addNotification(
      follower.userId,
      "followee_created_event",
      `${actor.handle} さんがイベントを公開しました`,
      `/events/${ownEventId}`,
    );
    await addNotification(
      follower.userId,
      "followee_joined_event",
      `${actor.handle} さんがイベントに参加しました`,
      `/events/${otherEventId}`,
    );
    await addNotification(
      other.userId,
      "meet",
      `${actor.handle} さんと出会いました`,
      `/users/${actor.handle}`,
    );
    // 巻き込んではいけない通知（別のフォロイーが同じイベントに参加した通知）
    await addNotification(
      follower.userId,
      "followee_joined_event",
      `${other.handle} さんがイベントに参加しました`,
      `/events/${otherEventId}`,
    );

    expect((await requestDelete(actor.cookie)).status).toBe(200);

    const titlesFor = async (cookie: string) => {
      const res = await SELF.fetch(`${BASE}/api/notifications`, {
        headers: { cookie },
      });
      expect(res.status).toBe(200);
      return ((await res.json()) as { notifications: Array<{ title: string }> })
        .notifications.map((n) => n.title);
    };
    const followerTitles = await titlesFor(follower.cookie);
    expect(followerTitles.some((t) => t.includes(actor.handle))).toBe(false);
    // 他人の通知は残る
    expect(followerTitles).toContain(
      `${other.handle} さんがイベントに参加しました`,
    );
    expect((await titlesFor(other.cookie)).some((t) => t.includes(actor.handle))).toBe(
      false,
    );
  });
});
