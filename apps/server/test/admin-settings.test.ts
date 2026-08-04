import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { AppSettingsPayload, ChatMembersPayload } from "@eventer/shared";
import { CHAT_RELAYS } from "@eventer/shared";

const BASE = "https://example.com";

/** ユーザーを1人作る（セッション付き）。
 * admin=true なら discord_id を ADMIN_DISCORD_IDS(=dev-user) に一致させる */
async function makeUser(admin = false): Promise<{
  userId: string;
  cookie: string;
}> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(
      uid,
      admin ? "dev-user" : `nostr:${uid}`,
      `s_${uid.slice(0, 8)}`,
      "テスト",
      Date.now(),
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

async function getSettings(cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/admin/settings`, { headers: { cookie } });
}

async function putRelays(cookie: string, relays: unknown): Promise<Response> {
  return SELF.fetch(`${BASE}/api/admin/settings/chat-relays`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ relays }),
  });
}

/** チャット付きイベントと確定メンバーを用意して chat-members を取る */
async function chatMembersFor(cookie: string, userId: string) {
  const eventId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, created_by, created_at)
     VALUES (?, ?, ?, ?, 'offline', 'published', ?, ?)`,
  )
    .bind(eventId, "設定E2E", now - 3600_000, now + 3600_000, userId, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, created_at) VALUES (?, ?, ?, 'participant', NULL, 'confirmed', ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, Date.now())
    .run();
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/chat-members`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ChatMembersPayload;
}

describe("運用設定: チャットリレー (#199)", () => {
  it("GET/PUT は app admin のみ（一般ユーザーは403）", async () => {
    const user = await makeUser();
    expect((await getSettings(user.cookie)).status).toBe(403);
    expect(
      (await putRelays(user.cookie, ["wss://relay.example.com"])).status,
    ).toBe(403);
    // 未認証は401
    expect((await SELF.fetch(`${BASE}/api/admin/settings`)).status).toBe(401);
  });

  it("未設定時は既定値が返り、chatRelaysCustom=false", async () => {
    const admin = await makeUser(true);
    const res = await getSettings(admin.cookie);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as AppSettingsPayload;
    expect(payload.chatRelays).toEqual([...CHAT_RELAYS]);
    expect(payload.chatRelaysCustom).toBe(false);
  });

  it("不正なURLや上限超過は400", async () => {
    const admin = await makeUser(true);
    // wss:// 以外は拒否
    expect(
      (await putRelays(admin.cookie, ["https://relay.example.com"])).status,
    ).toBe(400);
    expect((await putRelays(admin.cookie, ["wss://"])).status).toBe(400);
    expect(
      (await putRelays(admin.cookie, [`wss://a.example/${"x".repeat(200)}`]))
        .status,
    ).toBe(400);
    // 6件以上は拒否
    const six = Array.from(
      { length: 6 },
      (_v, i) => `wss://relay${i}.example.com`,
    );
    expect((await putRelays(admin.cookie, six)).status).toBe(400);
    // 配列以外も拒否
    expect((await putRelays(admin.cookie, "wss://a.example")).status).toBe(400);
  });

  it("設定すると chat-members のリレーに反映される", async () => {
    const admin = await makeUser(true);
    const custom = ["wss://relay1.example.com", "wss://relay2.example.com:7777/chat"];
    const res = await putRelays(admin.cookie, custom);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as AppSettingsPayload;
    expect(payload.chatRelays).toEqual(custom);
    expect(payload.chatRelaysCustom).toBe(true);

    // GET でも同じ値
    const got = (await (await getSettings(admin.cookie)).json()) as AppSettingsPayload;
    expect(got.chatRelays).toEqual(custom);
    expect(got.chatRelaysCustom).toBe(true);

    // 参加者向けの chat-members にも配信される
    const chat = await chatMembersFor(admin.cookie, admin.userId);
    expect(chat.relays).toEqual(custom);
  });

  it("relays=[] で既定に戻る", async () => {
    const admin = await makeUser(true);
    await putRelays(admin.cookie, ["wss://relay1.example.com"]);
    const res = await putRelays(admin.cookie, []);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as AppSettingsPayload;
    expect(payload.chatRelays).toEqual([...CHAT_RELAYS]);
    expect(payload.chatRelaysCustom).toBe(false);

    const chat = await chatMembersFor(admin.cookie, admin.userId);
    expect(chat.relays).toEqual([...CHAT_RELAYS]);
  });

  it("壊れた設定値は既定値にフォールバックする", async () => {
    const admin = await makeUser(true);
    await env.DB.prepare(
      "INSERT INTO app_setting (key, value, updated_at) VALUES ('chat_relays', ?, ?)",
    )
      .bind("not-json", Date.now())
      .run();
    const chat = await chatMembersFor(admin.cookie, admin.userId);
    expect(chat.relays).toEqual([...CHAT_RELAYS]);
  });
});
