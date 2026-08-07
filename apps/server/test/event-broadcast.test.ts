import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import {
  BROADCAST_MAX_PER_DAY,
  BROADCAST_MAX_PER_EVENT,
  BROADCAST_SEGMENTS,
  type BroadcastSegment,
  type EventBroadcastsPayload,
} from "@eventer/shared";
import { bindEnv, type Env } from "../src/runtime.js";
import { eventBroadcastsRepo } from "../src/db/repositories/eventBroadcasts.js";
import { drainBroadcastEmails } from "../src/lib/broadcast.js";

/**
 * 参加者への一斉連絡 (#172)。
 * 区分の絞り込み・権限・メールの順次送信・送信回数の上限を検証する。
 */

const BASE = "https://example.com";

beforeAll(() => {
  bindEnv(env as unknown as Env);
});

/** メール送信を有効にした状態でバインドし直す（送信予算もここでリセットされる）。
 * テスト側アイソレートから lib を直接呼ぶときだけ効く（SELF.fetch の中は別） */
function bindWithEmail(): void {
  bindEnv({ ...(env as object), RESEND_API_KEY: "test-key" } as unknown as Env);
}

afterEach(() => {
  vi.unstubAllGlobals();
  bindEnv(env as unknown as Env);
});

async function makeUser(opts: { deleted?: boolean } = {}): Promise<{
  userId: string;
  cookie: string;
}> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at, deleted_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
  )
    .bind(
      uid,
      `nostr:${uid}`,
      `u_${uid.slice(0, 6)}`,
      `表示_${uid.slice(0, 4)}`,
      Date.now(),
      opts.deleted ? Date.now() : null,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

/** メールを受け取れる状態にする（検証済みアドレス＋通知ON） */
async function enableEmail(userId: string, enabled = true): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO identity (id, user_id, provider, provider_user_id, email, created_at) VALUES (?, ?, 'google', ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      userId,
      crypto.randomUUID(),
      `${userId.slice(0, 8)}@example.com`,
      Date.now(),
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO notification_pref (user_id, email_enabled, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET email_enabled = excluded.email_enabled`,
  )
    .bind(userId, enabled ? 1 : 0, Date.now())
    .run();
}

async function makeEvent(createdBy: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO event (id, title, description, starts_at, ends_at, venue_type, venue_offline,
       participation_type, status, created_by, created_at)
     VALUES (?, '一斉連絡テスト', '', ?, ?, 'online', NULL, 'individual', 'published', ?, ?)`,
  )
    .bind(id, Date.now() + 86400000, Date.now() + 90000000, createdBy, Date.now())
    .run();
  return id;
}

async function makeSlot(
  eventId: string,
  selectionType: "first_come" | "lottery",
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO participation_slot (id, event_id, name, capacity, selection_type, sort_order, draw_at, created_at)
     VALUES (?, ?, ?, 10, ?, 0, NULL, ?)`,
  )
    .bind(id, eventId, `枠_${selectionType}`, selectionType, Date.now())
    .run();
  return id;
}

async function addMember(opts: {
  eventId: string;
  userId: string;
  role?: string;
  status?: string;
  slotId?: string | null;
  attended?: boolean;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      opts.eventId,
      opts.userId,
      opts.role ?? "participant",
      opts.slotId ?? null,
      opts.status ?? "confirmed",
      opts.attended ? 1 : 0,
      Date.now(),
    )
    .run();
}

/** 一斉連絡を1件送る（スタッフの cookie で叩く） */
async function postBroadcast(
  eventId: string,
  cookie: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/broadcasts`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getBroadcasts(
  eventId: string,
  cookie: string,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/broadcasts`, {
    headers: { cookie },
  });
}

/* ===================== 区分の絞り込み ===================== */

describe("送信先の区分", () => {
  /** 主要なロール・状態を1イベントに一通り並べた状態を作る */
  async function makeCast() {
    const owner = await makeUser();
    const eventId = await makeEvent(owner.userId);
    const firstCome = await makeSlot(eventId, "first_come");
    const lottery = await makeSlot(eventId, "lottery");

    const staff = await makeUser();
    const staff2 = await makeUser();
    const judge = await makeUser();
    const observer = await makeUser();
    const confirmed = await makeUser();
    const waitlist = await makeUser();
    const won = await makeUser();
    const lost = await makeUser();
    const applied = await makeUser();
    const canceled = await makeUser();
    const deleted = await makeUser({ deleted: true });
    const attended = await makeUser();

    await addMember({ eventId, userId: staff.userId, role: "staff" });
    await addMember({ eventId, userId: staff2.userId, role: "staff" });
    await addMember({ eventId, userId: judge.userId, role: "judge" });
    await addMember({ eventId, userId: observer.userId, role: "observer" });
    await addMember({ eventId, userId: confirmed.userId, slotId: firstCome });
    await addMember({
      eventId,
      userId: waitlist.userId,
      slotId: firstCome,
      status: "waitlist",
    });
    await addMember({ eventId, userId: won.userId, slotId: lottery });
    await addMember({
      eventId,
      userId: lost.userId,
      slotId: lottery,
      status: "lost",
    });
    await addMember({
      eventId,
      userId: applied.userId,
      slotId: lottery,
      status: "applied",
    });
    await addMember({
      eventId,
      userId: canceled.userId,
      slotId: firstCome,
      status: "canceled",
    });
    await addMember({ eventId, userId: deleted.userId, slotId: firstCome });
    await addMember({
      eventId,
      userId: attended.userId,
      slotId: firstCome,
      attended: true,
    });

    return {
      eventId,
      staff,
      staff2,
      judge,
      observer,
      confirmed,
      waitlist,
      won,
      lost,
      applied,
      canceled,
      deleted,
      attended,
    };
  }

  async function ids(
    eventId: string,
    segment: BroadcastSegment,
  ): Promise<Set<string>> {
    return new Set(await eventBroadcastsRepo.recipientIds(eventId, segment));
  }

  it("「確定」に運営側（スタッフ・審査員・観覧者）は入らない", async () => {
    const c = await makeCast();
    const got = await ids(c.eventId, "confirmed");
    // 参加者ロールで status=confirmed の人だけ
    expect(got).toEqual(
      new Set([c.confirmed.userId, c.won.userId, c.attended.userId]),
    );
    expect(got.has(c.staff.userId)).toBe(false);
    expect(got.has(c.staff2.userId)).toBe(false);
    expect(got.has(c.judge.userId)).toBe(false);
    expect(got.has(c.observer.userId)).toBe(false);
  });

  it("スタッフ・審査員・観覧者はそれぞれの区分だけに入る", async () => {
    const c = await makeCast();
    expect(await ids(c.eventId, "staff")).toEqual(
      new Set([c.staff.userId, c.staff2.userId]),
    );
    expect(await ids(c.eventId, "judge")).toEqual(new Set([c.judge.userId]));
    expect(await ids(c.eventId, "observer")).toEqual(
      new Set([c.observer.userId]),
    );
  });

  it("抽選の当選者・落選者は抽選枠の人だけ（先着の確定者は入らない）", async () => {
    const c = await makeCast();
    expect(await ids(c.eventId, "lottery_won")).toEqual(new Set([c.won.userId]));
    expect(await ids(c.eventId, "lottery_lost")).toEqual(
      new Set([c.lost.userId]),
    );
    // 申込中はどちらでもない
    const won = await ids(c.eventId, "lottery_won");
    expect(won.has(c.applied.userId)).toBe(false);
  });

  it("キャンセル待ちは先着枠の待機者だけ", async () => {
    const c = await makeCast();
    expect(await ids(c.eventId, "waitlist")).toEqual(
      new Set([c.waitlist.userId]),
    );
  });

  it("出席した人 / 出席しなかった人が分かれる", async () => {
    const c = await makeCast();
    expect(await ids(c.eventId, "attended")).toEqual(
      new Set([c.attended.userId]),
    );
    const notAttended = await ids(c.eventId, "not_attended");
    expect(notAttended.has(c.attended.userId)).toBe(false);
    // 確定している参加者のうち出席記録がない人
    expect(notAttended).toEqual(new Set([c.confirmed.userId, c.won.userId]));
  });

  it("全員には取消・退会申請中が入らない", async () => {
    const c = await makeCast();
    const all = await ids(c.eventId, "all");
    expect(all.has(c.canceled.userId)).toBe(false);
    expect(all.has(c.deleted.userId)).toBe(false);
    // 運営側・申込中・落選も「全員」には含む
    expect(all.has(c.staff.userId)).toBe(true);
    expect(all.has(c.applied.userId)).toBe(true);
    expect(all.has(c.lost.userId)).toBe(true);
    expect(all.size).toBe(10);
  });

  it("退会申請中はどの区分にも入らない", async () => {
    const c = await makeCast();
    for (const seg of BROADCAST_SEGMENTS) {
      const got = await ids(c.eventId, seg);
      expect(got.has(c.deleted.userId)).toBe(false);
    }
  });

  it("人数の集計が宛先の件数と一致する", async () => {
    const c = await makeCast();
    const counts = await eventBroadcastsRepo.countsBySegment(c.eventId);
    for (const seg of BROADCAST_SEGMENTS) {
      const got = await ids(c.eventId, seg);
      expect(counts[seg]).toBe(got.size);
    }
  });
});

/* ===================== 権限 ===================== */

describe("権限", () => {
  async function setup() {
    const owner = await makeUser();
    const eventId = await makeEvent(owner.userId);
    const staff = await makeUser();
    await addMember({ eventId, userId: staff.userId, role: "staff" });
    return { eventId, owner, staff };
  }

  it("そのイベントのスタッフは送信も履歴閲覧もできる", async () => {
    const { eventId, staff } = await setup();
    const list = await getBroadcasts(eventId, staff.cookie);
    expect(list.status).toBe(200);
    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "all",
      title: "お知らせ",
      body: "本文です",
    });
    expect(res.status).toBe(200);
  });

  it("参加者・審査員・観覧者は送信も履歴閲覧もできない", async () => {
    const { eventId } = await setup();
    for (const role of ["participant", "judge", "observer"] as const) {
      const u = await makeUser();
      await addMember({ eventId, userId: u.userId, role });
      expect((await getBroadcasts(eventId, u.cookie)).status).toBe(403);
      expect(
        (
          await postBroadcast(eventId, u.cookie, {
            segment: "all",
            title: "だめ",
            body: "だめ",
          })
        ).status,
      ).toBe(403);
    }
  });

  it("確定していないスタッフは送信できない", async () => {
    const { eventId } = await setup();
    const pending = await makeUser();
    await addMember({
      eventId,
      userId: pending.userId,
      role: "staff",
      status: "waitlist",
    });
    expect((await getBroadcasts(eventId, pending.cookie)).status).toBe(403);
    expect(
      (
        await postBroadcast(eventId, pending.cookie, {
          segment: "all",
          title: "だめ",
          body: "だめ",
        })
      ).status,
    ).toBe(403);
  });

  it("アプリ運営管理者でもそのイベントのスタッフでなければできない", async () => {
    const { eventId } = await setup();
    const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    expect((await getBroadcasts(eventId, cookie)).status).toBe(403);
    expect(
      (
        await postBroadcast(eventId, cookie, {
          segment: "all",
          title: "だめ",
          body: "だめ",
        })
      ).status,
    ).toBe(403);
  });

  it("コミュニティ管理者でもそのイベントのスタッフでなければできない", async () => {
    const { eventId, owner } = await setup();
    const manager = await makeUser();
    const communityId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO community (id, slug, name, description, owner_id, created_at) VALUES (?, ?, ?, '', ?, ?)",
    )
      .bind(
        communityId,
        `c-${communityId.slice(0, 8)}`,
        `community_${communityId.slice(0, 4)}`,
        manager.userId,
        Date.now(),
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
    )
      .bind(crypto.randomUUID(), communityId, manager.userId, Date.now())
      .run();
    await env.DB.prepare("UPDATE event SET community_id = ? WHERE id = ?")
      .bind(communityId, eventId)
      .run();
    // オーナーはイベントのメンバーではない前提（setup では staff にしていない）
    expect(owner.userId).not.toBe(manager.userId);

    expect((await getBroadcasts(eventId, manager.cookie)).status).toBe(403);
    expect(
      (
        await postBroadcast(eventId, manager.cookie, {
          segment: "all",
          title: "だめ",
          body: "だめ",
        })
      ).status,
    ).toBe(403);
  });

  it("メンバーでない人・未ログインは弾かれる", async () => {
    const { eventId } = await setup();
    const stranger = await makeUser();
    expect((await getBroadcasts(eventId, stranger.cookie)).status).toBe(403);

    const anon = await SELF.fetch(`${BASE}/api/events/${eventId}/broadcasts`);
    expect(anon.status).toBe(401);
  });
});

/* ===================== 配信 ===================== */

describe("配信", () => {
  it("アプリ内通知は送信時に全員ぶん作られ、メールは送信待ちに積まれる", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner.userId);
    const staff = await makeUser();
    await addMember({ eventId, userId: staff.userId, role: "staff" });

    const withEmail = await makeUser();
    await enableEmail(withEmail.userId, true);
    const emailOff = await makeUser();
    await enableEmail(emailOff.userId, false);
    const noPref = await makeUser(); // 通知設定の行そのものが無い
    for (const u of [withEmail, emailOff, noPref]) {
      await addMember({ eventId, userId: u.userId });
    }

    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "confirmed",
      title: "会場が変わりました",
      body: "本文です",
    });
    expect(res.status).toBe(200);
    const created = (await res.json()) as {
      recipientCount: number;
      emailQueued: number;
    };
    expect(created.recipientCount).toBe(3);
    // メール通知ONの人だけが積まれる
    expect(created.emailQueued).toBe(1);

    // アプリ内通知は3人ぶん
    for (const u of [withEmail, emailOff, noPref]) {
      const row = await env.DB.prepare(
        "SELECT COUNT(1) AS n FROM notification WHERE user_id = ? AND type = 'event_broadcast'",
      )
        .bind(u.userId)
        .first<{ n: number }>();
      expect(row?.n).toBe(1);
    }

    // 送信待ちはメール通知ONの人だけ
    const queued = await env.DB.prepare(
      `SELECT user_id FROM event_broadcast_email q
         JOIN event_broadcast b ON b.id = q.broadcast_id
        WHERE b.event_id = ?`,
    )
      .bind(eventId)
      .all<{ user_id: string }>();
    expect(queued.results.map((r) => r.user_id)).toEqual([withEmail.userId]);
  });

  it("退会申請中の人には通知もメールも積まれない", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner.userId);
    const staff = await makeUser();
    await addMember({ eventId, userId: staff.userId, role: "staff" });
    const gone = await makeUser({ deleted: true });
    await enableEmail(gone.userId, true);
    await addMember({ eventId, userId: gone.userId });

    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "all",
      title: "お知らせ",
      body: "本文",
    });
    const created = (await res.json()) as {
      recipientCount: number;
      emailQueued: number;
    };
    // staff 本人のみ
    expect(created.recipientCount).toBe(1);
    expect(created.emailQueued).toBe(0);
    const n = await env.DB.prepare(
      "SELECT COUNT(1) AS n FROM notification WHERE user_id = ?",
    )
      .bind(gone.userId)
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("送信待ちは1回の実行で送信予算を超えず、複数回に分けて全員へ届く", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner.userId);
    const staff = await makeUser();
    await addMember({ eventId, userId: staff.userId, role: "staff" });

    // 1リクエストの送信予算 (20) を超える人数
    const TOTAL = 22;
    for (let i = 0; i < TOTAL; i++) {
      const u = await makeUser();
      await enableEmail(u.userId, true);
      await addMember({ eventId, userId: u.userId });
    }
    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "confirmed",
      title: "順次送信",
      body: "本文",
    });
    const created = (await res.json()) as { id: string; emailQueued: number };
    expect(created.emailQueued).toBe(TOTAL);

    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    });

    // 1回目: 送信予算ぶんだけ送れる
    bindWithEmail();
    const first = await drainBroadcastEmails();
    expect(first.sent).toBe(20);
    expect(first.failed).toBe(0);
    let stats = await eventBroadcastsRepo.emailStats(created.id);
    expect(stats).toEqual({ pending: 2, sent: 20, failed: 0, skipped: 0 });

    // 2回目: 残りが送られる
    bindWithEmail();
    const second = await drainBroadcastEmails();
    expect(second.sent).toBe(2);
    stats = await eventBroadcastsRepo.emailStats(created.id);
    expect(stats).toEqual({ pending: 0, sent: 22, failed: 0, skipped: 0 });

    // 3回目は何も残っていない
    bindWithEmail();
    expect(await drainBroadcastEmails()).toEqual({
      sent: 0,
      failed: 0,
      skipped: 0,
    });
    expect(calls).toHaveLength(TOTAL);
  });

  it("積んだ後にメール通知をオフにした人には送らない", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner.userId);
    const staff = await makeUser();
    await addMember({ eventId, userId: staff.userId, role: "staff" });
    const u = await makeUser();
    await enableEmail(u.userId, true);
    await addMember({ eventId, userId: u.userId });

    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "confirmed",
      title: "オフ検証",
      body: "本文",
    });
    const created = (await res.json()) as { id: string; emailQueued: number };
    expect(created.emailQueued).toBe(1);

    // 送信待ちのまま通知をオフにする
    await env.DB.prepare(
      "UPDATE notification_pref SET email_enabled = 0 WHERE user_id = ?",
    )
      .bind(u.userId)
      .run();

    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    bindWithEmail();
    const r = await drainBroadcastEmails();
    expect(r).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(await eventBroadcastsRepo.emailStats(created.id)).toEqual({
      pending: 0,
      sent: 0,
      failed: 0,
      skipped: 1,
    });
  });

  it("送信に失敗すると規定回数まで送信待ちに戻り、超えたら失敗になる", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner.userId);
    const staff = await makeUser();
    await addMember({ eventId, userId: staff.userId, role: "staff" });
    const u = await makeUser();
    await enableEmail(u.userId, true);
    await addMember({ eventId, userId: u.userId });

    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "confirmed",
      title: "失敗検証",
      body: "本文",
    });
    const created = (await res.json()) as { id: string };

    vi.stubGlobal("fetch", async () => new Response("boom", { status: 500 }));
    for (let i = 1; i <= 2; i++) {
      bindWithEmail();
      const r = await drainBroadcastEmails();
      expect(r.failed).toBe(1);
      expect((await eventBroadcastsRepo.emailStats(created.id)).pending).toBe(1);
    }
    bindWithEmail();
    await drainBroadcastEmails();
    expect(await eventBroadcastsRepo.emailStats(created.id)).toEqual({
      pending: 0,
      sent: 0,
      failed: 1,
      skipped: 0,
    });
  });

  it("メール送信が未設定なら送信待ちには触らない", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner.userId);
    const staff = await makeUser();
    await addMember({ eventId, userId: staff.userId, role: "staff" });
    const u = await makeUser();
    await enableEmail(u.userId, true);
    await addMember({ eventId, userId: u.userId });
    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "confirmed",
      title: "未設定",
      body: "本文",
    });
    const created = (await res.json()) as { id: string };

    // RESEND_API_KEY 無しのまま（beforeAll の bindEnv）
    expect(await drainBroadcastEmails()).toEqual({
      sent: 0,
      failed: 0,
      skipped: 0,
    });
    const stats = await eventBroadcastsRepo.emailStats(created.id);
    expect(stats.pending).toBe(1);
    const row = await env.DB.prepare(
      "SELECT attempts FROM event_broadcast_email WHERE broadcast_id = ?",
    )
      .bind(created.id)
      .first<{ attempts: number }>();
    expect(row?.attempts).toBe(0);
  });
});

/* ===================== 送信状況・履歴 ===================== */

describe("送信状況と履歴", () => {
  it("履歴に区分・人数・メールの内訳が出る", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner.userId);
    const staff = await makeUser();
    await addMember({ eventId, userId: staff.userId, role: "staff" });
    const u = await makeUser();
    await enableEmail(u.userId, true);
    await addMember({ eventId, userId: u.userId });

    await postBroadcast(eventId, staff.cookie, {
      segment: "confirmed",
      title: "件名です",
      body: "本文です",
    });

    const res = await getBroadcasts(eventId, staff.cookie);
    const payload = (await res.json()) as EventBroadcastsPayload;
    expect(payload.broadcasts).toHaveLength(1);
    const b = payload.broadcasts[0]!;
    expect(b.segment).toBe("confirmed");
    expect(b.title).toBe("件名です");
    expect(b.body).toBe("本文です");
    expect(b.recipientCount).toBe(1);
    expect(b.email).toEqual({ pending: 1, sent: 0, failed: 0, skipped: 0 });
    expect(b.senderName).not.toBeNull();
    expect(payload.counts.confirmed).toBe(1);
    expect(payload.remainingToday).toBe(BROADCAST_MAX_PER_DAY - 1);
    expect(payload.remainingTotal).toBe(BROADCAST_MAX_PER_EVENT - 1);
  });
});

/* ===================== 送信回数の上限 ===================== */

describe("送信回数の上限", () => {
  /** 過去の送信を直接積む（created_at を指定できる） */
  async function seedBroadcasts(
    eventId: string,
    userId: string,
    count: number,
    createdAt: number,
  ): Promise<void> {
    for (let i = 0; i < count; i++) {
      await env.DB.prepare(
        `INSERT INTO event_broadcast (id, event_id, created_by, segment, title, body, recipient_count, created_at)
         VALUES (?, ?, ?, 'all', '過去', '過去', 0, ?)`,
      )
        .bind(crypto.randomUUID(), eventId, userId, createdAt)
        .run();
    }
  }

  it("直近24時間の上限に達すると送信できない", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner.userId);
    const staff = await makeUser();
    await addMember({ eventId, userId: staff.userId, role: "staff" });
    await seedBroadcasts(
      eventId,
      staff.userId,
      BROADCAST_MAX_PER_DAY,
      Date.now() - 60_000,
    );

    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "all",
      title: "上限",
      body: "本文",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "broadcast_limit_day" });
  });

  it("24時間より前の送信は日次の上限に数えない", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner.userId);
    const staff = await makeUser();
    await addMember({ eventId, userId: staff.userId, role: "staff" });
    await seedBroadcasts(
      eventId,
      staff.userId,
      BROADCAST_MAX_PER_DAY,
      Date.now() - 25 * 60 * 60 * 1000,
    );

    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "all",
      title: "翌日",
      body: "本文",
    });
    expect(res.status).toBe(200);
  });

  it("通算の上限に達すると、日次に余裕があっても送信できない", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner.userId);
    const staff = await makeUser();
    await addMember({ eventId, userId: staff.userId, role: "staff" });
    await seedBroadcasts(
      eventId,
      staff.userId,
      BROADCAST_MAX_PER_EVENT,
      Date.now() - 25 * 60 * 60 * 1000,
    );

    const list = await getBroadcasts(eventId, staff.cookie);
    const payload = (await list.json()) as EventBroadcastsPayload;
    expect(payload.remainingToday).toBe(BROADCAST_MAX_PER_DAY);
    expect(payload.remainingTotal).toBe(0);

    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "all",
      title: "通算上限",
      body: "本文",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "broadcast_limit_total" });
  });

  it("上限に達したイベントの送信回数は他のイベントに影響しない", async () => {
    const owner = await makeUser();
    const staff = await makeUser();
    const full = await makeEvent(owner.userId);
    const other = await makeEvent(owner.userId);
    await addMember({ eventId: full, userId: staff.userId, role: "staff" });
    await addMember({ eventId: other, userId: staff.userId, role: "staff" });
    await seedBroadcasts(
      full,
      staff.userId,
      BROADCAST_MAX_PER_DAY,
      Date.now() - 60_000,
    );

    expect(
      (
        await postBroadcast(full, staff.cookie, {
          segment: "all",
          title: "だめ",
          body: "本文",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await postBroadcast(other, staff.cookie, {
          segment: "all",
          title: "いける",
          body: "本文",
        })
      ).status,
    ).toBe(200);
  });
});

/* ===================== 入力の検証 ===================== */

describe("入力の検証", () => {
  async function setup() {
    const owner = await makeUser();
    const eventId = await makeEvent(owner.userId);
    const staff = await makeUser();
    await addMember({ eventId, userId: staff.userId, role: "staff" });
    return { eventId, staff };
  }

  it("空・長すぎ・未知の区分は 400", async () => {
    const { eventId, staff } = await setup();
    const cases: Array<Record<string, unknown>> = [
      { segment: "all", title: "", body: "本文" },
      { segment: "all", title: "件名", body: "" },
      { segment: "all", title: "あ".repeat(101), body: "本文" },
      { segment: "all", title: "件名", body: "あ".repeat(2001) },
      { segment: "everyone", title: "件名", body: "本文" },
    ];
    for (const body of cases) {
      const res = await postBroadcast(eventId, staff.cookie, body);
      expect(res.status).toBe(400);
    }
  });

  it("件名の制御文字は弾き、本文の改行はまとめる", async () => {
    const { eventId, staff } = await setup();
    // 件名にゼロ幅スペース
    const bad = await postBroadcast(eventId, staff.cookie, {
      segment: "all",
      title: `件名${"\u200b"}`,
      body: "本文",
    });
    expect(bad.status).toBe(400);

    // 本文の bidi 制御も弾く
    const badBody = await postBroadcast(eventId, staff.cookie, {
      segment: "all",
      title: "件名",
      body: `本文${"\u202e"}`,
    });
    expect(badBody.status).toBe(400);

    // 改行だらけの本文は空行1つぶんに詰められる
    const ok = await postBroadcast(eventId, staff.cookie, {
      segment: "all",
      title: "  件名\tの\n途中  ",
      body: "1行目\r\n\r\n\r\n\r\n2行目\n\n\n\n\n3行目\n\n\n",
    });
    expect(ok.status).toBe(200);
    const list = await getBroadcasts(eventId, staff.cookie);
    const payload = (await list.json()) as EventBroadcastsPayload;
    const b = payload.broadcasts[0]!;
    expect(b.title).toBe("件名 の 途中");
    expect(b.body).toBe("1行目\n\n2行目\n\n3行目");
  });
});
