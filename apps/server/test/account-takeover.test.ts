import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const BASE = "https://example.com";

/** 一般ユーザーを1人作る（セッション付き） */
async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, NULL, NULL, ?)",
  )
    .bind(uid, `t:${uid}`, `t_${uid.slice(0, 8)}`, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
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

async function loginWith(cookie: string, event: object): Promise<Response> {
  return SELF.fetch(`${BASE}/api/auth/nostr/login`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ event }),
  });
}

describe("連携の引き取りガード (#238)", () => {
  it("空アカウントからは引き取れて、旧アカウントの行は削除される", async () => {
    const me = await makeUser();
    const sk = schnorr.utils.randomSecretKey();
    const pubkey = bytesToHex(schnorr.getPublicKey(sk));
    const orphanId = await makeNostrOnlyUser(pubkey);

    const res = await loginWith(me.cookie, await nostrLoginEvent(sk));
    expect(res.status).toBe(200);

    // identity は自分に付き、旧アカウントの行は消えている
    const ident = await env.DB.prepare(
      "SELECT user_id FROM identity WHERE provider='nostr' AND provider_user_id = ?",
    )
      .bind(pubkey)
      .first<{ user_id: string }>();
    expect(ident?.user_id).toBe(me.userId);
    const gone = await env.DB.prepare("SELECT id FROM user WHERE id = ?")
      .bind(orphanId)
      .first();
    expect(gone).toBeNull();
  });

  it("運営が非表示にした投稿しかなくても引き取れない (#278)", async () => {
    const me = await makeUser();
    const sk = schnorr.utils.randomSecretKey();
    const pubkey = bytesToHex(schnorr.getPublicKey(sk));
    const activeId = await makeNostrOnlyUser(pubkey);
    const eventId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, created_by, created_at) VALUES (?, '実績E2E', 1, 2, 'offline', 'published', ?, ?)",
    )
      .bind(eventId, me.userId, Date.now())
      .run();
    // 唯一の実績が「運営が非表示にしたコメント」だけ、という状態を作る。
    // ここを実績なし扱いにすると、荒らし投稿しかないアカウントが乗っ取れてしまう
    await env.DB.prepare(
      "INSERT INTO event_comment (id, event_id, user_id, body, created_at, admin_hidden_at, admin_hidden_by) VALUES (?, ?, ?, '荒らし', ?, ?, 'admin')",
    )
      .bind(crypto.randomUUID(), eventId, activeId, Date.now(), Date.now())
      .run();

    const res = await loginWith(me.cookie, await nostrLoginEvent(sk));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(
      "account_in_use",
    );
  });

  it("利用実績のあるアカウントからは引き取れない（409 account_in_use）", async () => {
    const me = await makeUser();
    const sk = schnorr.utils.randomSecretKey();
    const pubkey = bytesToHex(schnorr.getPublicKey(sk));
    const activeId = await makeNostrOnlyUser(pubkey);
    // 利用実績: イベント参加を1件つける
    const eventId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, created_by, created_at) VALUES (?, '実績E2E', 1, 2, 'offline', 'published', ?, ?)",
    )
      .bind(eventId, me.userId, Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, created_at) VALUES (?, ?, ?, 'participant', NULL, 'confirmed', ?)",
    )
      .bind(crypto.randomUUID(), eventId, activeId, Date.now())
      .run();

    const res = await loginWith(me.cookie, await nostrLoginEvent(sk));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(
      "account_in_use",
    );
    // identity もアカウントも無傷
    const ident = await env.DB.prepare(
      "SELECT user_id FROM identity WHERE provider='nostr' AND provider_user_id = ?",
    )
      .bind(pubkey)
      .first<{ user_id: string }>();
    expect(ident?.user_id).toBe(activeId);
    const still = await env.DB.prepare("SELECT id FROM user WHERE id = ?")
      .bind(activeId)
      .first();
    expect(still).not.toBeNull();
  });

  it("ユーザー資産（live_set等）を持つアカウントも引き取れない（FK違反での中途孤児化防止）", async () => {
    const me = await makeUser();
    const sk = schnorr.utils.randomSecretKey();
    const pubkey = bytesToHex(schnorr.getPublicKey(sk));
    const ownerId = await makeNostrOnlyUser(pubkey);
    // live_set は FK が RESTRICT（ON DELETE 指定なし）なので、判定から漏れると
    // unlink 後の削除が FK 違反で落ちて孤児化する回帰ケース
    await env.DB.prepare(
      "INSERT INTO live_set (id, owner_id, community_id, name, content, created_at, updated_at) VALUES (?, ?, NULL, '配信セット', '{}', ?, ?)",
    )
      .bind(crypto.randomUUID(), ownerId, Date.now(), Date.now())
      .run();

    const res = await loginWith(me.cookie, await nostrLoginEvent(sk));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(
      "account_in_use",
    );
    // identity・アカウントとも無傷（unlink を先行させない実装の検証）
    const ident = await env.DB.prepare(
      "SELECT user_id FROM identity WHERE provider='nostr' AND provider_user_id = ?",
    )
      .bind(pubkey)
      .first<{ user_id: string }>();
    expect(ident?.user_id).toBe(ownerId);
  });

  it("複数連携のあるアカウントからは従来どおり 409 already_linked", async () => {
    const me = await makeUser();
    const sk = schnorr.utils.randomSecretKey();
    const pubkey = bytesToHex(schnorr.getPublicKey(sk));
    const otherId = await makeNostrOnlyUser(pubkey);
    await env.DB.prepare(
      "INSERT INTO identity (id, user_id, provider, provider_user_id, email, created_at) VALUES (?, ?, 'google', ?, NULL, ?)",
    )
      .bind(crypto.randomUUID(), otherId, `g-${otherId}`, Date.now())
      .run();

    const res = await loginWith(me.cookie, await nostrLoginEvent(sk));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(
      "already_linked",
    );
  });
});
