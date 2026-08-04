import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { AUDIT_LOG_PAGE_SIZE } from "@eventer/shared";
import type { AuditLogsPayload } from "@eventer/shared";

const BASE = "https://example.com";

interface AuditRow {
  id: string;
  action: string;
  actor_user_id: string | null;
  actor_handle: string;
  target_user_id: string | null;
  target_handle: string;
  detail: string;
  created_at: number;
}

/** ユーザーを1人作る（セッション付き）。
 * admin=true なら discord_id を ADMIN_DISCORD_IDS(=dev-user) に一致させる */
async function makeUser(admin = false): Promise<{
  userId: string;
  handle: string;
  cookie: string;
}> {
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
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, handle, cookie: `eventer_session=${sid}` };
}

async function auditRows(action?: string): Promise<AuditRow[]> {
  const stmt = action
    ? env.DB.prepare(
        "SELECT * FROM audit_log WHERE action = ? ORDER BY created_at DESC",
      ).bind(action)
    : env.DB.prepare("SELECT * FROM audit_log ORDER BY created_at DESC");
  const res = await stmt.all<AuditRow>();
  return res.results;
}

async function issueCode(cookie: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/me/merge-code`, {
    method: "POST",
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { code: string }).code;
}

/** nostr のみを唯一の連携として持つ空アカウント（引き取り元） */
async function makeNostrOnlyUser(pubkey: string): Promise<{
  userId: string;
  handle: string;
}> {
  const uid = crypto.randomUUID();
  const handle = `n_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, NULL, NULL, ?)",
  )
    .bind(uid, `nostr:${pubkey}`, handle, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO identity (id, user_id, provider, provider_user_id, email, created_at) VALUES (?, ?, 'nostr', ?, NULL, ?)",
  )
    .bind(crypto.randomUUID(), uid, pubkey, Date.now())
    .run();
  return { userId: uid, handle };
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

async function fetchLogs(
  cookie: string | null,
  query = "",
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/admin/audit-logs${query}`, {
    headers: cookie ? { cookie } : {},
  });
}

/** 一覧APIの検証用にダミー行を直接積む（本体処理を通さない） */
async function seedLogs(action: string, n: number, base = 0): Promise<void> {
  for (let i = 0; i < n; i++) {
    await env.DB.prepare(
      `INSERT INTO audit_log
         (id, action, actor_user_id, actor_handle, target_user_id, target_handle, detail, created_at)
       VALUES (?, ?, NULL, ?, NULL, '', '', ?)`,
    )
      .bind(crypto.randomUUID(), action, `seed_${i}`, base + i)
      .run();
  }
}

describe("監査ログの記録 (#248)", () => {
  it("アカウント統合で account_merge が記録される", async () => {
    const me = await makeUser();
    const other = await makeUser();
    const code = await issueCode(other.cookie);
    const res = await SELF.fetch(`${BASE}/api/me/merge`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ code, keep: "me" }),
    });
    expect(res.status).toBe(200);

    const rows = await auditRows("account_merge");
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(me.userId);
    expect(rows[0].actor_handle).toBe(me.handle);
    expect(rows[0].target_user_id).toBe(other.userId);
    expect(rows[0].target_handle).toBe(other.handle);
    expect(JSON.parse(rows[0].detail)).toEqual({
      keep: "me",
      winnerId: me.userId,
      loserId: other.userId,
    });
    expect(rows[0].created_at).toBeGreaterThan(0);

    // 負け側のユーザー行は消えているが、記録は残る（FKなし）
    const gone = await env.DB.prepare("SELECT id FROM user WHERE id = ?")
      .bind(other.userId)
      .first();
    expect(gone).toBeNull();
    expect(await auditRows("account_merge")).toHaveLength(1);
  });

  it("退会で account_delete が記録され、ユーザー行が消えても残り続ける", async () => {
    const me = await makeUser();
    const res = await SELF.fetch(`${BASE}/api/me`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ confirm: true }),
    });
    expect(res.status).toBe(200);

    // ユーザー行は消えている
    const gone = await env.DB.prepare("SELECT id FROM user WHERE id = ?")
      .bind(me.userId)
      .first();
    expect(gone).toBeNull();

    // FK を張っていないので記録は残り、ハンドルから本人を辿れる
    const rows = await auditRows("account_delete");
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(me.userId);
    expect(rows[0].actor_handle).toBe(me.handle);
    expect(rows[0].target_user_id).toBe(me.userId);
    expect(rows[0].target_handle).toBe(me.handle);
    const detail = JSON.parse(rows[0].detail) as Record<string, unknown>;
    expect(typeof detail.ghostId).toBe("string");
    expect(detail.r2Objects).toBe(0);
  });

  it("連携の引き取りで identity_takeover が記録される", async () => {
    const me = await makeUser();
    const sk = schnorr.utils.randomSecretKey();
    const pubkey = bytesToHex(schnorr.getPublicKey(sk));
    const orphan = await makeNostrOnlyUser(pubkey);

    const res = await SELF.fetch(`${BASE}/api/auth/nostr/login`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ event: await nostrLoginEvent(sk) }),
    });
    expect(res.status).toBe(200);

    const rows = await auditRows("identity_takeover");
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(me.userId);
    expect(rows[0].actor_handle).toBe(me.handle);
    // 引き取られた側の行は消えるが、ハンドルは記録に残る
    expect(rows[0].target_user_id).toBe(orphan.userId);
    expect(rows[0].target_handle).toBe(orphan.handle);
    expect(JSON.parse(rows[0].detail)).toEqual({ provider: "nostr" });
  });

  it("運用設定の変更で admin_setting_change が記録される", async () => {
    const admin = await makeUser(true);
    const relays = ["wss://relay1.example.com"];
    const res = await SELF.fetch(
      `${BASE}/api/admin/settings/chat-relays`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: admin.cookie },
        body: JSON.stringify({ relays }),
      },
    );
    expect(res.status).toBe(200);

    const rows = await auditRows("admin_setting_change");
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(admin.userId);
    expect(JSON.parse(rows[0].detail)).toEqual({
      key: "chat_relays",
      relays,
      reset: false,
    });
  });

  it("チャンネルのリセットで chat_channel_reset が記録される", async () => {
    const staff = await makeUser();
    const eventId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, created_by, created_at)
       VALUES (?, '監査ログE2E', 1, 2, 'offline', 'published', ?, ?)`,
    )
      .bind(eventId, staff.userId, Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, created_at) VALUES (?, ?, ?, 'staff', NULL, 'confirmed', ?)",
    )
      .bind(crypto.randomUUID(), eventId, staff.userId, Date.now())
      .run();

    const res = await SELF.fetch(
      `${BASE}/api/events/${eventId}/chat-channel`,
      { method: "DELETE", headers: { cookie: staff.cookie } },
    );
    expect(res.status).toBe(200);

    const rows = await auditRows("chat_channel_reset");
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(staff.userId);
    expect(rows[0].actor_handle).toBe(staff.handle);
    expect(rows[0].target_user_id).toBeNull();
    expect(JSON.parse(rows[0].detail)).toEqual({ eventId });
  });
});

describe("監査ログの閲覧API (#248)", () => {
  it("運営管理者のみ 200（一般ユーザーは403・未認証は401）", async () => {
    const admin = await makeUser(true);
    const user = await makeUser();
    expect((await fetchLogs(admin.cookie)).status).toBe(200);
    expect((await fetchLogs(user.cookie)).status).toBe(403);
    expect((await fetchLogs(null)).status).toBe(401);
  });

  it("新しい順に返り、action で絞り込める", async () => {
    const admin = await makeUser(true);
    await seedLogs("account_merge", 3, 1000);
    await seedLogs("account_delete", 2, 2000);

    const all = (await (
      await fetchLogs(admin.cookie)
    ).json()) as AuditLogsPayload;
    expect(all.total).toBe(5);
    expect(all.logs).toHaveLength(5);
    expect(all.page).toBe(1);
    expect(all.limit).toBe(AUDIT_LOG_PAGE_SIZE);
    // created_at 降順
    const times = all.logs.map((l) => l.createdAt);
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const filtered = (await (
      await fetchLogs(admin.cookie, "?action=account_delete")
    ).json()) as AuditLogsPayload;
    expect(filtered.total).toBe(2);
    expect(filtered.logs.every((l) => l.action === "account_delete")).toBe(true);

    // 未知の action は0件（エラーにしない）
    const none = (await (
      await fetchLogs(admin.cookie, "?action=nope")
    ).json()) as AuditLogsPayload;
    expect(none.total).toBe(0);
    expect(none.logs).toHaveLength(0);
  });

  it("ページングが効く（1ページ50件）", async () => {
    const admin = await makeUser(true);
    const total = AUDIT_LOG_PAGE_SIZE + 5;
    await seedLogs("account_merge", total, 1000);

    const p1 = (await (
      await fetchLogs(admin.cookie, "?page=1")
    ).json()) as AuditLogsPayload;
    expect(p1.total).toBe(total);
    expect(p1.logs).toHaveLength(AUDIT_LOG_PAGE_SIZE);

    const p2 = (await (
      await fetchLogs(admin.cookie, "?page=2")
    ).json()) as AuditLogsPayload;
    expect(p2.page).toBe(2);
    expect(p2.total).toBe(total);
    expect(p2.logs).toHaveLength(5);
    // ページ間で重複しない
    const ids = new Set(p1.logs.map((l) => l.id));
    expect(p2.logs.some((l) => ids.has(l.id))).toBe(false);

    // 不正な page は1ページ目にフォールバック
    const bad = (await (
      await fetchLogs(admin.cookie, "?page=0")
    ).json()) as AuditLogsPayload;
    expect(bad.page).toBe(1);
    expect(bad.logs).toHaveLength(AUDIT_LOG_PAGE_SIZE);
  });
});
