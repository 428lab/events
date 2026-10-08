import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type {
  EncryptedChatPayload,
  Event,
  GroupChatPayload,
  ModerationContentPayload,
} from "@eventer/shared";
import { bindEnv, type Env } from "../src/runtime.js";
import { accountDeletionRepo } from "../src/db/repositories/accountDeletion.js";
import { accountMergeRepo } from "../src/db/repositories/accountMerge.js";
import {
  BASE,
  HOUR,
  loginDev,
  makeMember,
  makeUser,
  type TestUser,
} from "./lib/staffDutyHelpers.js";

/**
 * 参加者チャットを参加者だけに限定する（暗号化）(#582)。
 * 設計は docs/participant-encrypted-chat.md、テスト計画 9 の S2〜S11
 * （S1 のマイグレーションは participant-encrypted-chat-migration.test.ts）。
 *
 * 主眼:
 * - 鍵を受け取れるのは参加確定メンバーだけ（管理者のバイパスも通さない）
 * - 資格を失った人が居れば、**次の取得で**鍵が1世代進み、その人には配られない
 * - 暗号化は一方向（オフに戻せない）
 * - スタッフチャットと部屋・鍵が混ざらない
 */

const DAY = 24 * HOUR;

type Visibility = "public" | "private" | "unlisted";

/** 公開済み・日程確定・チャット有効のイベントを作る（作成者は staff / confirmed）。
 * encrypted=true なら PATCH で暗号化をオンにする（オンにした時刻が入る経路を通す） */
async function setupEvent(
  owner: TestUser,
  opts: { visibility?: Visibility; encrypted?: boolean } = {},
): Promise<string> {
  const startsAt = Date.now() + 7 * DAY;
  const res = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: owner.cookie },
    body: JSON.stringify({
      title: `暗号化チャットの検証_${crypto.randomUUID().slice(0, 6)}`,
      venueType: "offline",
      startsAt,
      endsAt: startsAt + 4 * HOUR,
    }),
  });
  expect(res.status).toBe(201);
  const { event } = (await res.json()) as { event: Event };
  await env.DB.prepare(
    "UPDATE event SET status = 'published', visibility = ?, nonpublic_eligible = 1 WHERE id = ?",
  )
    .bind(opts.visibility ?? "public", event.id)
    .run();
  if (opts.encrypted ?? true) {
    const on = await patchEvent(event.id, owner, { chatEnabled: true, chatEncrypted: true });
    expect(on.status, await on.clone().text()).toBe(200);
  }
  return event.id;
}

function patchEvent(eventId: string, by: TestUser, body: object): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: by.cookie },
    body: JSON.stringify(body),
  });
}

function getEnc(eventId: string, cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/encrypted-chat`, {
    headers: { cookie },
  });
}

function postEnc(eventId: string, cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/encrypted-chat`, {
    method: "POST",
    headers: { cookie },
  });
}

async function payload(res: Response): Promise<EncryptedChatPayload> {
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as EncryptedChatPayload;
}

/** members 部屋の鍵の世代（DB の生の値） */
async function memberKeyVersions(eventId: string): Promise<number[]> {
  const rows = await env.DB.prepare(
    "SELECT version FROM event_group_chat_key WHERE event_id = ? AND audience = 'members' ORDER BY version",
  )
    .bind(eventId)
    .all<{ version: number }>();
  return rows.results.map((r) => r.version);
}

async function memberSigner(
  eventId: string,
  userId: string,
): Promise<{ pubkey: string; revoked_at: number | null } | null> {
  return env.DB.prepare(
    "SELECT pubkey, revoked_at FROM event_group_chat_signer WHERE event_id = ? AND audience = 'members' AND user_id = ?",
  )
    .bind(eventId, userId)
    .first<{ pubkey: string; revoked_at: number | null }>();
}

async function expectDenied(eventId: string, cookie: string): Promise<void> {
  const got = await getEnc(eventId, cookie);
  expect(got.status).toBe(403);
  expect(await got.json()).toEqual({ error: "chat_unavailable" });
  expect((await postEnc(eventId, cookie)).status).toBe(403);
}

/** 部屋あり・参加確定2人（a・b。2人とも signer 発行済み）の暗号化チャット */
async function setupRoom(visibility: Visibility = "public") {
  const owner = await makeUser();
  const eventId = await setupEvent(owner, { visibility });
  const a = await makeMember(eventId, "participant");
  const b = await makeMember(eventId, "participant");
  if (visibility !== "public") {
    for (const u of [a, b]) {
      await env.DB.prepare(
        "INSERT INTO event_access_invite (id, event_id, user_id, status, source, created_at) VALUES (?, ?, ?, 'accepted', 'invite', 1)",
      )
        .bind(crypto.randomUUID(), eventId, u.userId)
        .run();
    }
  }
  await payload(await postEnc(eventId, a.cookie));
  await payload(await postEnc(eventId, b.cookie));
  expect(await memberKeyVersions(eventId)).toEqual([1]);
  return { owner, eventId, a, b };
}

/* ===== S2 スタッフチャットと混ざらない ===== */

describe("スタッフチャットと部屋・鍵が混ざらない (#582 S2)", () => {
  it("members の部屋を作っても /staff-chat に members の鍵・signer が出ず、逆も出ない", async () => {
    const { owner, eventId, a } = await setupRoom();
    const staffRes = await SELF.fetch(`${BASE}/api/events/${eventId}/staff-chat`, {
      method: "POST",
      headers: { cookie: owner.cookie },
    });
    expect(staffRes.status).toBe(200);
    const staff = (await staffRes.json()) as GroupChatPayload;
    const members = await payload(await getEnc(eventId, owner.cookie));

    expect(staff.roomId).not.toBe(members.roomId);
    const staffText = JSON.stringify(staff);
    for (const k of members.keys) expect(staffText).not.toContain(k.secret);
    expect(staffText).not.toContain(members.roomId);
    for (const m of members.members) expect(staffText).not.toContain(m.pubkey);

    const encText = JSON.stringify(await payload(await getEnc(eventId, a.cookie)));
    for (const k of staff.keys) expect(encText).not.toContain(k.secret);
    expect(encText).not.toContain(staff.roomId);
    expect(encText).not.toContain(staff.myKey!.pubkey);
  });

  it("参加者の資格喪失で staff の鍵は進まず、staff の資格喪失で members の鍵は進まない", async () => {
    const { owner, eventId, a } = await setupRoom();
    const second = await makeMember(eventId, "staff");
    for (const u of [owner, second]) {
      await SELF.fetch(`${BASE}/api/events/${eventId}/staff-chat`, {
        method: "POST",
        headers: { cookie: u.cookie },
      });
    }
    await payload(await postEnc(eventId, second.cookie));
    // 参加者 a が抜ける → 次の取得で members だけ進む
    await env.DB.prepare("UPDATE event_member SET status = 'canceled' WHERE event_id = ? AND user_id = ?")
      .bind(eventId, a.userId)
      .run();
    await payload(await getEnc(eventId, owner.cookie));
    expect(await memberKeyVersions(eventId)).toEqual([1, 2]);
    const staffVersions = await env.DB.prepare(
      "SELECT version FROM event_group_chat_key WHERE event_id = ? AND audience = 'staff'",
    )
      .bind(eventId)
      .all();
    expect(staffVersions.results).toHaveLength(1);
  });
});

/* ===== S3 ゲート ===== */

describe("鍵を受け取れる人 (#582 S3)", () => {
  for (const role of ["participant", "staff", "judge", "observer"] as const) {
    it(`confirmed の ${role} は POST/GET で鍵一式を受け取る`, async () => {
      const owner = await makeUser();
      const eventId = await setupEvent(owner);
      const u = await makeMember(eventId, role);
      const created = await payload(await postEnc(eventId, u.cookie));
      expect(created.roomId).toMatch(/^[0-9a-f]{64}$/);
      expect(created.keys).toHaveLength(1);
      expect(created.myKey!.pubkey).toMatch(/^[0-9a-f]{64}$/);
      expect(created.members.map((m) => m.userId)).toEqual([u.userId]);
      expect(created.members[0]!.role).toBe(role);
      expect(created.encryptedAt).toBeGreaterThan(0);
      const got = await getEnc(eventId, u.cookie);
      expect(got.headers.get("cache-control")).toContain("no-store");
      // hiddenSignal.rev は読んだ時刻（D-POLL-MIN 第5段階）なので、それ以外が同じ
      const read = await payload(got);
      expect(read.hiddenSignal!.rev).toBeGreaterThanOrEqual(created.hiddenSignal!.rev);
      expect({ ...read, hiddenSignal: { ...read.hiddenSignal, rev: 0 } })
        .toEqual({ ...created, hiddenSignal: { ...created.hiddenSignal, rev: 0 } });
    });
  }

  for (const status of ["waitlist", "applied", "lost", "canceled"]) {
    it(`${status} の参加者は 403`, async () => {
      const owner = await makeUser();
      const eventId = await setupEvent(owner);
      await payload(await postEnc(eventId, owner.cookie));
      const u = await makeMember(eventId, "participant", status);
      await expectDenied(eventId, u.cookie);
    });
  }

  it("非メンバーは 403", async () => {
    const owner = await makeUser();
    const eventId = await setupEvent(owner);
    await payload(await postEnc(eventId, owner.cookie));
    await expectDenied(eventId, (await makeUser()).cookie);
  });

  it("アプリ運営管理者・コミュニティ管理者でも、確定メンバーでなければ 403", async () => {
    const owner = await makeUser();
    const eventId = await setupEvent(owner);
    await payload(await postEnc(eventId, owner.cookie));
    await expectDenied(eventId, await loginDev());

    const communityAdmin = await makeUser();
    const communityId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO community (id, slug, name, owner_id, created_at) VALUES (?, ?, 'コミュ', ?, ?)",
    )
      .bind(communityId, `c-${communityId.slice(0, 8)}`, communityAdmin.userId, Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
    )
      .bind(crypto.randomUUID(), communityId, communityAdmin.userId, Date.now())
      .run();
    await env.DB.prepare("UPDATE event SET community_id = ? WHERE id = ?")
      .bind(communityId, eventId)
      .run();
    await expectDenied(eventId, communityAdmin.cookie);
  });

  it("締め出し中（平文の鍵・members signer のどちらでも）は 403", async () => {
    const { eventId, a, b } = await setupRoom();
    // a: members signer の鍵で締め出し
    const aKey = (await memberSigner(eventId, a.userId))!.pubkey;
    await env.DB.prepare(
      "INSERT INTO event_chat_blocked (event_id, pubkey, created_at, created_by) VALUES (?, ?, ?, NULL)",
    )
      .bind(eventId, aKey, Date.now())
      .run();
    await expectDenied(eventId, a.cookie);
    // b: 平文の発言鍵で締め出し（暗号化前に平文チャットに参加していた人）
    const plainKey = "ab".repeat(32);
    await env.DB.prepare(
      "INSERT INTO event_chat_key (event_id, user_id, pubkey, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind(eventId, b.userId, plainKey, Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO event_chat_blocked (event_id, pubkey, created_at, created_by) VALUES (?, ?, ?, NULL)",
    )
      .bind(eventId, plainKey, Date.now())
      .run();
    await expectDenied(eventId, b.cookie);
  });

  it("退会申請中は 403（セッションが残っていても）", async () => {
    const { eventId, a } = await setupRoom();
    await env.DB.prepare("UPDATE user SET deleted_at = ? WHERE id = ?")
      .bind(Date.now(), a.userId)
      .run();
    expect((await getEnc(eventId, a.cookie)).status).not.toBe(200);
  });

  it("暗号化オフ・chatEnabled=false・未公開・日程調整中は 403", async () => {
    const owner = await makeUser();
    const off = await setupEvent(owner, { encrypted: false });
    await expectDenied(off, owner.cookie);

    const disabled = await setupEvent(owner);
    await env.DB.prepare("UPDATE event SET chat_enabled = 0 WHERE id = ?").bind(disabled).run();
    await expectDenied(disabled, owner.cookie);

    const draft = await setupEvent(owner);
    await env.DB.prepare("UPDATE event SET status = 'draft' WHERE id = ?").bind(draft).run();
    await expectDenied(draft, owner.cookie);

    const scheduling = await setupEvent(owner);
    await env.DB.prepare("UPDATE event SET scheduling = 1 WHERE id = ?").bind(scheduling).run();
    await expectDenied(scheduling, owner.cookie);
  });

  it("部屋が未開設なら GET は 404、POST で開設", async () => {
    const owner = await makeUser();
    const eventId = await setupEvent(owner);
    expect((await getEnc(eventId, owner.cookie)).status).toBe(404);
    await payload(await postEnc(eventId, owner.cookie));
    expect((await getEnc(eventId, owner.cookie)).status).toBe(200);
  });
});

/* ===== S4 設定の規則 ===== */

describe("設定の規則 (#582 S4)", () => {
  it("オフ→オンで chat_encrypted_at が入り、オン→オフは 409、オンの再送は時刻を変えない", async () => {
    const owner = await makeUser();
    const eventId = await setupEvent(owner, { encrypted: false });
    const before = Date.now();
    const on = await patchEvent(eventId, owner, { chatEncrypted: true });
    expect(on.status).toBe(200);
    expect(((await on.json()) as { event: Event }).event.chatEncrypted).toBe(true);
    const row = await env.DB.prepare("SELECT chat_encrypted, chat_encrypted_at FROM event WHERE id = ?")
      .bind(eventId)
      .first<{ chat_encrypted: number; chat_encrypted_at: number }>();
    expect(row!.chat_encrypted).toBe(1);
    expect(row!.chat_encrypted_at).toBeGreaterThanOrEqual(before);

    const offRes = await patchEvent(eventId, owner, { chatEncrypted: false });
    expect(offRes.status).toBe(409);
    expect(await offRes.json()).toEqual({ error: "chat_encrypted_locked" });

    // 編集フォームは現在値を送り返す（オンのまま）。時刻は最初の1回のまま
    expect((await patchEvent(eventId, owner, { chatEncrypted: true, title: "変更" })).status).toBe(200);
    const again = await env.DB.prepare("SELECT chat_encrypted_at FROM event WHERE id = ?")
      .bind(eventId)
      .first<{ chat_encrypted_at: number }>();
    expect(again!.chat_encrypted_at).toBe(row!.chat_encrypted_at);
  });

  it("非公開で chatEnabled=true を暗号化オフのまま保存すると 400、暗号化オンと一緒なら通る", async () => {
    const owner = await makeUser();
    const eventId = await setupEvent(owner, { visibility: "private", encrypted: false });
    const bad = await patchEvent(eventId, owner, { chatEnabled: true });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "chat_encryption_required" });
    const ok = await patchEvent(eventId, owner, { chatEnabled: true, chatEncrypted: true });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { event: Event }).event).toMatchObject({
      visibility: "private",
      chatEnabled: true,
      chatEncrypted: true,
    });
  });

  it("公開→非公開: 暗号化オンなら chatEnabled 維持、オフなら false", async () => {
    const owner = await makeUser();
    for (const encrypted of [true, false]) {
      const eventId = await setupEvent(owner, { encrypted });
      if (!encrypted) {
        expect((await patchEvent(eventId, owner, { chatEnabled: true })).status).toBe(200);
      }
      const cur = await SELF.fetch(`${BASE}/api/events/${eventId}`, { headers: { cookie: owner.cookie } });
      const { event } = (await cur.json()) as { event: Event };
      expect(event.chatEnabled).toBe(true);
      const res = await patchEvent(eventId, owner, {
        visibility: "private",
        confirmVisibilityChange: true,
        expectedAccessRevision: event.accessRevision,
      });
      expect(res.status, await res.clone().text()).toBe(200);
      const after = ((await res.json()) as { event: Event }).event;
      expect(after.visibility).toBe("private");
      expect(after.chatEnabled).toBe(encrypted);
    }
  });

  it("複製は暗号化設定を引き継ぎ、時刻は複製時刻になる", async () => {
    const owner = await makeUser();
    const eventId = await setupEvent(owner);
    const before = Date.now();
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/duplicate`, {
      method: "POST",
      headers: { cookie: owner.cookie },
    });
    expect(res.status).toBe(201);
    const { event } = (await res.json()) as { event: Event };
    const row = await env.DB.prepare("SELECT chat_encrypted, chat_encrypted_at FROM event WHERE id = ?")
      .bind(event.id)
      .first<{ chat_encrypted: number; chat_encrypted_at: number }>();
    expect(row!.chat_encrypted).toBe(1);
    expect(row!.chat_encrypted_at).toBeGreaterThanOrEqual(before);
  });
});

/* ===== S5 遅延ローテーション ===== */

describe("遅延ローテーション (#582 S5)", () => {
  /** 共通の検査: 別メンバーの GET で鍵が1世代進み、抜けた人の signer に revoked_at、
   * 抜けた人の GET/POST は 403、残った人は新しい世代を受け取る */
  async function assertRotatedOnNextGet(
    eventId: string,
    lost: TestUser,
    remaining: TestUser,
  ): Promise<void> {
    expect(await memberKeyVersions(eventId)).toEqual([1]); // まだ回っていない（遅延）
    const next = await payload(await getEnc(eventId, remaining.cookie));
    expect(next.keys.map((k) => k.version)).toEqual([1, 2]);
    expect(await memberKeyVersions(eventId)).toEqual([1, 2]);
    expect((await memberSigner(eventId, lost.userId))!.revoked_at).not.toBeNull();
    const gone = next.members.find((m) => m.userId === lost.userId);
    if (gone) expect(gone.revokedAt).not.toBeNull();
    const denied = await getEnc(eventId, lost.cookie);
    expect([403, 404]).toContain(denied.status);
  }

  it("本人の参加取消（DELETE /join）", async () => {
    const { eventId, a, b } = await setupRoom();
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/join`, {
      method: "DELETE",
      headers: { cookie: a.cookie },
    });
    expect(res.status).toBe(200);
    await assertRotatedOnNextGet(eventId, a, b);
  });

  it("staff による状態変更（confirmed → waitlist）", async () => {
    const { eventId, a, b } = await setupRoom();
    await env.DB.prepare("UPDATE event_member SET status = 'waitlist' WHERE event_id = ? AND user_id = ?")
      .bind(eventId, a.userId)
      .run();
    await assertRotatedOnNextGet(eventId, a, b);
  });

  it("ロール変更（participant → staff は資格のまま、staff → participant は取消）", async () => {
    const { owner, eventId, a, b } = await setupRoom();
    const up = await SELF.fetch(`${BASE}/api/events/${eventId}/members/${a.userId}/role`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ role: "staff" }),
    });
    expect(up.status).toBe(200);
    await payload(await getEnc(eventId, b.cookie));
    expect(await memberKeyVersions(eventId)).toEqual([1]); // 資格は失っていない
    const down = await SELF.fetch(`${BASE}/api/events/${eventId}/members/${a.userId}/role`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ role: "participant" }),
    });
    expect(down.status).toBe(200);
    await assertRotatedOnNextGet(eventId, a, b);
  });

  it("抽選で落選（lost）", async () => {
    const { eventId, a, b } = await setupRoom();
    await env.DB.prepare("UPDATE event_member SET status = 'lost' WHERE event_id = ? AND user_id = ?")
      .bind(eventId, a.userId)
      .run();
    await assertRotatedOnNextGet(eventId, a, b);
  });

  it("閲覧権の取消（非公開イベント）", async () => {
    const { owner, eventId, a, b } = await setupRoom("private");
    const list = await SELF.fetch(`${BASE}/api/events/${eventId}/access-invites`, {
      headers: { cookie: owner.cookie },
    });
    const body = (await list.json()) as {
      accessRevision: number;
      invites: Array<{ id: string; userId: string }>;
    };
    const inv = body.invites.find((i) => i.userId === a.userId)!;
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/access-invites/${inv.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({
        expectedAccessRevision: body.accessRevision,
        confirmCancelParticipation: true,
      }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    await assertRotatedOnNextGet(eventId, a, b);
  });

  it("締め出し（運営のモデレーション画面から members signer の鍵で）", async () => {
    const { eventId, a, b } = await setupRoom();
    const admin = await loginDev();
    const res = await SELF.fetch(
      `${BASE}/api/admin/moderation/events/${eventId}/chat-authors/block`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ pubkey: (await memberSigner(eventId, a.userId))!.pubkey }),
      },
    );
    expect(res.status).toBe(200);
    await assertRotatedOnNextGet(eventId, a, b);
  });

  it("2人同時に抜けても1世代だけ進む", async () => {
    const { owner, eventId, a, b } = await setupRoom();
    await env.DB.prepare(
      "UPDATE event_member SET status = 'canceled' WHERE event_id = ? AND user_id IN (?, ?)",
    )
      .bind(eventId, a.userId, b.userId)
      .run();
    const next = await payload(await getEnc(eventId, owner.cookie));
    expect(next.keys.map((k) => k.version)).toEqual([1, 2]);
    expect((await memberSigner(eventId, a.userId))!.revoked_at).not.toBeNull();
    expect((await memberSigner(eventId, b.userId))!.revoked_at).not.toBeNull();
    // 照合は済んでいるので、続けて取得しても増えない
    await payload(await getEnc(eventId, owner.cookie));
    expect(await memberKeyVersions(eventId)).toEqual([1, 2]);
  });

  it("誰も抜けていなければ GET で世代が増えない", async () => {
    const { eventId, a, b } = await setupRoom();
    for (let i = 0; i < 3; i++) {
      await payload(await getEnc(eventId, a.cookie));
      await payload(await getEnc(eventId, b.cookie));
    }
    expect(await memberKeyVersions(eventId)).toEqual([1]);
  });
});

/* ===== S6 即時ローテーション（退会） ===== */

describe("退会の即時ローテーション (#582 S6)", () => {
  it("退会申請で、本人が現役 signer を持つ全 members 部屋が1世代進む", async () => {
    const r1 = await setupRoom();
    const owner2 = await makeUser();
    const e2 = await setupEvent(owner2);
    await env.DB.prepare(
      "INSERT INTO event_member (id, event_id, user_id, role, status, created_at) VALUES (?, ?, ?, 'participant', 'confirmed', ?)",
    )
      .bind(crypto.randomUUID(), e2, r1.a.userId, Date.now())
      .run();
    await payload(await postEnc(e2, r1.a.cookie));
    const del = await SELF.fetch(`${BASE}/api/me`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie: r1.a.cookie },
      body: JSON.stringify({ confirm: true }),
    });
    expect(del.status).toBe(200);
    expect(await memberKeyVersions(r1.eventId)).toEqual([1, 2]);
    expect(await memberKeyVersions(e2)).toEqual([1, 2]);
    expect((await memberSigner(r1.eventId, r1.a.userId))!.revoked_at).not.toBeNull();
  });

  it("purge でも回る（signer が現役なら）。purge の戻り値に部屋の分が積まれる", async () => {
    const { eventId, a } = await setupRoom();
    // 申請を経ずに purge 対象にする（申請時のフックを通らない経路の多重防御を見る）
    await env.DB.prepare("UPDATE user SET deleted_at = ? WHERE id = ?")
      .bind(Date.now() - 31 * DAY, a.userId)
      .run();
    bindEnv(env as unknown as Env);
    const ghost = await accountDeletionRepo.ensureDeletedUser();
    const cost = await accountDeletionRepo.deleteAccount(a.userId, ghost.id);
    // staff 側の列挙 1 ＋ members 側の列挙 1 ＋ 回した members の部屋 1
    expect(cost).toBe(3);
    expect(await memberKeyVersions(eventId)).toEqual([1, 2]);
    // signer 行は user 削除の CASCADE で消える
    expect(await memberSigner(eventId, a.userId)).toBeNull();
  });
});

/* ===== S7 再有効化 ===== */

describe("資格を取り戻した人は全世代を受け取る (#582 S7)", () => {
  it("再参加: POST で同じ signer が再有効化され、不在中の世代も届く", async () => {
    const { eventId, a, b } = await setupRoom();
    const firstKey = (await payload(await getEnc(eventId, a.cookie))).myKey!;
    await env.DB.prepare("UPDATE event_member SET status = 'canceled' WHERE event_id = ? AND user_id = ?")
      .bind(eventId, a.userId)
      .run();
    await payload(await getEnc(eventId, b.cookie)); // ここで回る
    await env.DB.prepare("UPDATE event_member SET status = 'confirmed' WHERE event_id = ? AND user_id = ?")
      .bind(eventId, a.userId)
      .run();
    expect((await payload(await getEnc(eventId, a.cookie))).myKey).toBeNull();
    const back = await payload(await postEnc(eventId, a.cookie));
    expect(back.myKey).toEqual(firstKey);
    expect(back.keys.map((k) => k.version)).toEqual([1, 2]);
    expect((await memberSigner(eventId, a.userId))!.revoked_at).toBeNull();
  });

  it("締め出し解除: 解除後の POST で戻れる", async () => {
    const { eventId, a, b } = await setupRoom();
    const admin = await loginDev();
    const pubkey = (await memberSigner(eventId, a.userId))!.pubkey;
    const act = (action: string) =>
      SELF.fetch(`${BASE}/api/admin/moderation/events/${eventId}/chat-authors/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ pubkey }),
      });
    expect((await act("block")).status).toBe(200);
    await payload(await getEnc(eventId, b.cookie));
    await expectDenied(eventId, a.cookie);
    expect((await act("unblock")).status).toBe(200);
    const back = await payload(await postEnc(eventId, a.cookie));
    expect(back.myKey!.pubkey).toBe(pubkey);
    expect(back.keys.map((k) => k.version)).toEqual([1, 2]);
  });
});

/* ===== S8 平文経路 ===== */

describe("平文の参加者チャットの経路 (#582 S8)", () => {
  it("暗号化オンの公開イベント: 書き込み系は 409 chat_encrypted、chat-members は 200", async () => {
    const owner = await makeUser();
    const eventId = await setupEvent(owner);
    const p = await makeMember(eventId, "participant");
    const post = (path: string, cookie: string, body?: object) =>
      SELF.fetch(`${BASE}/api/events/${eventId}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body ?? {}),
      });
    for (const [path, who] of [
      ["/chat-key", p],
      ["/chat-key/ephemeral", p],
      ["/chat-channel", owner],
      ["/chat-channel/create", owner],
    ] as const) {
      const res = await post(path, who.cookie);
      expect(res.status, path).toBe(409);
      expect(await res.json()).toEqual({ error: "chat_encrypted" });
    }
    const del = await SELF.fetch(`${BASE}/api/events/${eventId}/chat-channel`, {
      method: "DELETE",
      headers: { cookie: owner.cookie },
    });
    expect(del.status).toBe(409);
    const members = await SELF.fetch(`${BASE}/api/events/${eventId}/chat-members`, {
      headers: { cookie: p.cookie },
    });
    expect(members.status).toBe(200);
    // 平文の一時鍵の取得（過去ログの読み取り用）は残る（未発行なので 404）
    const eph = await SELF.fetch(`${BASE}/api/events/${eventId}/chat-key/ephemeral`, {
      headers: { cookie: p.cookie },
    });
    expect(eph.status).toBe(404);
  });

  it("非公開イベント: 平文の経路は 403 のまま。暗号化オンなら /chat-hidden だけ通る", async () => {
    const owner = await makeUser();
    const noteId = "cd".repeat(32);
    const plain = await setupEvent(owner, { visibility: "private", encrypted: false });
    const hidePlain = await SELF.fetch(`${BASE}/api/events/${plain}/chat-hidden`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ noteId }),
    });
    expect(hidePlain.status).toBe(403);

    const enc = await setupEvent(owner, { visibility: "private" });
    for (const path of ["/chat-members", "/chat-key/ephemeral"]) {
      const res = await SELF.fetch(`${BASE}/api/events/${enc}${path}`, {
        headers: { cookie: owner.cookie },
      });
      expect(res.status, path).toBe(403);
    }
    const hide = await SELF.fetch(`${BASE}/api/events/${enc}/chat-hidden`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ noteId }),
    });
    expect(hide.status).toBe(200);
    await payload(await postEnc(enc, owner.cookie));
    expect((await payload(await getEnc(enc, owner.cookie))).hiddenNoteIds).toEqual([noteId]);
    const unhide = await SELF.fetch(`${BASE}/api/events/${enc}/chat-hidden/${noteId}`, {
      method: "DELETE",
      headers: { cookie: owner.cookie },
    });
    expect(unhide.status).toBe(200);
  });

  it("平文の過去ログ: 公開イベントでは plaintextChannelId が返り、非公開では常に null", async () => {
    const owner = await makeUser();
    const pub = await setupEvent(owner);
    const channel = "ef".repeat(32);
    await env.DB.prepare("UPDATE event SET chat_channel_id = ? WHERE id = ?").bind(channel, pub).run();
    expect((await payload(await postEnc(pub, owner.cookie))).plaintextChannelId).toBe(channel);

    const priv = await setupEvent(owner, { visibility: "private" });
    await env.DB.prepare("UPDATE event SET chat_channel_id = ? WHERE id = ?").bind(channel, priv).run();
    expect((await payload(await postEnc(priv, owner.cookie))).plaintextChannelId).toBeNull();
  });
});

/* ===== S9 配信 ===== */

describe("配信画面のチャット (#582 S9)", () => {
  async function setSource(eventId: string, owner: TestUser): Promise<Response> {
    return SELF.fetch(`${BASE}/api/events/${eventId}/live-state`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ chatSource: "event" }),
    });
  }

  it("非公開＋暗号化オンなら chatSource=event が通り、暗号化オフでは 403", async () => {
    const owner = await makeUser();
    const enc = await setupEvent(owner, { visibility: "private" });
    expect((await setSource(enc, owner)).status).toBe(200);
    const plain = await setupEvent(owner, { visibility: "private", encrypted: false });
    expect((await setSource(plain, owner)).status).toBe(403);
  });
});

/* ===== S10 モデレーション ===== */

describe("運営のモデレーション画面 (#582 S10)", () => {
  it("appAdmin の payload に encryptedChat の鍵一式が載り、非 admin は画面ごと 403", async () => {
    const { owner, eventId, a } = await setupRoom();
    const admin = await loginDev();
    const res = await SELF.fetch(`${BASE}/api/admin/moderation/events/${eventId}`, {
      headers: { cookie: admin },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModerationContentPayload;
    const mine = await payload(await getEnc(eventId, a.cookie));
    expect(body.encryptedChat).toEqual({
      roomId: mine.roomId,
      keys: mine.keys,
      members: mine.members,
    });
    const denied = await SELF.fetch(`${BASE}/api/admin/moderation/events/${eventId}`, {
      headers: { cookie: owner.cookie },
    });
    expect(denied.status).toBe(403);
  });

  it("部屋が無ければ encryptedChat は null", async () => {
    const owner = await makeUser();
    const eventId = await setupEvent(owner);
    const res = await SELF.fetch(`${BASE}/api/admin/moderation/events/${eventId}`, {
      headers: { cookie: await loginDev() },
    });
    expect(((await res.json()) as ModerationContentPayload).encryptedChat).toBeNull();
  });

  it("members signer の鍵での締め出しは人単位: 平文の鍵も一覧に並び、どちらで解除しても解ける", async () => {
    const { eventId, a, b } = await setupRoom();
    const plainKey = "12".repeat(32);
    await env.DB.prepare(
      "INSERT INTO event_chat_key (event_id, user_id, pubkey, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind(eventId, a.userId, plainKey, Date.now())
      .run();
    const admin = await loginDev();
    const signerKey = (await memberSigner(eventId, a.userId))!.pubkey;
    const act = (action: string, pubkey: string) =>
      SELF.fetch(`${BASE}/api/admin/moderation/events/${eventId}/chat-authors/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ pubkey }),
      });
    expect(await (await act("block", signerKey)).json()).toEqual({ ok: true, changed: true });
    // 同じ人の平文の鍵で締め出し直しても2本目は立たない
    expect(await (await act("block", plainKey)).json()).toEqual({ ok: true, changed: false });
    const view = (await (
      await SELF.fetch(`${BASE}/api/admin/moderation/events/${eventId}`, { headers: { cookie: admin } })
    ).json()) as ModerationContentPayload;
    const blockedKeys = view.chat.blocked.map((x) => x.pubkey).sort();
    expect(blockedKeys).toEqual([plainKey, signerKey].sort());
    expect(new Set(view.chat.blocked.map((x) => x.userId))).toEqual(new Set([a.userId]));
    // 参加者に返す一覧からは外れ、運営の一覧には残る
    expect((await payload(await getEnc(eventId, b.cookie))).members.map((m) => m.userId)).not.toContain(a.userId);
    expect(view.encryptedChat!.members.map((m) => m.userId)).toContain(a.userId);
    // 平文の鍵の側で解除しても解ける（人単位）
    expect(await (await act("unblock", plainKey)).json()).toEqual({ ok: true, changed: true });
    const blockedRows = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_chat_blocked WHERE event_id = ?")
      .bind(eventId)
      .first<{ n: number }>();
    expect(blockedRows!.n).toBe(0);
  });
});

/* ===== S11 統合 ===== */

describe("アカウント統合 (#582 S11)", () => {
  it("両アカウントが同じ members 部屋に signer を持つとき、勝ち側だけが残る", async () => {
    const { eventId, a, b } = await setupRoom();
    const winnerKey = (await memberSigner(eventId, b.userId))!.pubkey;
    bindEnv(env as unknown as Env);
    await accountMergeRepo.mergeUsers(b.userId, a.userId);
    const rows = await env.DB.prepare(
      "SELECT user_id, pubkey FROM event_group_chat_signer WHERE event_id = ? AND audience = 'members'",
    )
      .bind(eventId)
      .all<{ user_id: string; pubkey: string }>();
    expect(rows.results).toEqual([{ user_id: b.userId, pubkey: winnerKey }]);
  });
});
