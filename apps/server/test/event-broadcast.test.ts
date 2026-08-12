import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import {
  BROADCAST_MAX_PER_DAY,
  BROADCAST_MAX_PER_EVENT,
  BROADCAST_SEGMENTS,
  broadcastEmailMinutes,
  type BroadcastSegment,
  type EventBroadcastsPayload,
  type SendBroadcastResult,
} from "@eventer/shared";
import { bindEnv, takeEmailSlot, type Env } from "../src/runtime.js";
import { eventBroadcastsRepo } from "../src/db/repositories/eventBroadcasts.js";
import {
  notificationsRepo,
  PartialNotificationError,
} from "../src/db/repositories/notifications.js";
import {
  drainBroadcastEmails,
  sendBroadcast,
  type DrainResult,
} from "../src/lib/broadcast.js";

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
  vi.restoreAllMocks();
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
    // #277 より前のデータ。スタッフなのに参加状態が lost / applied のまま残っている
    // （migration 0061 が整理しているのがこの状態）。区分の条件を status の否定リストで
    // 書くと、この2人が「全員」「スタッフ」から静かに漏れる
    const staffLost = await makeUser();
    const staffApplied = await makeUser();
    const judge = await makeUser();
    const observer = await makeUser();
    const confirmed = await makeUser();
    const waitlist = await makeUser();
    const won = await makeUser();
    const lost = await makeUser();
    // 抽選のあとで枠を消した（slot_id が NULL になり status だけ残る）
    const lostNoSlot = await makeUser();
    // 先着枠で手動で落選にした
    const lostFirstCome = await makeUser();
    const applied = await makeUser();
    const canceled = await makeUser();
    const deleted = await makeUser({ deleted: true });
    const attended = await makeUser();

    await addMember({ eventId, userId: staff.userId, role: "staff" });
    await addMember({ eventId, userId: staff2.userId, role: "staff" });
    await addMember({
      eventId,
      userId: staffLost.userId,
      role: "staff",
      slotId: lottery,
      status: "lost",
    });
    await addMember({
      eventId,
      userId: staffApplied.userId,
      role: "staff",
      slotId: lottery,
      status: "applied",
    });
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
      userId: lostNoSlot.userId,
      slotId: null,
      status: "lost",
    });
    await addMember({
      eventId,
      userId: lostFirstCome.userId,
      slotId: firstCome,
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
      staffLost,
      staffApplied,
      judge,
      observer,
      confirmed,
      waitlist,
      won,
      lost,
      lostNoSlot,
      lostFirstCome,
      applied,
      canceled,
      deleted,
      attended,
    };
  }

  async function ids(
    eventId: string,
    segment: BroadcastSegment,
    // 区分の絞り込みを見るテストでは、誰も除かれない送り主を渡す
    senderId = "not-a-member",
  ): Promise<Set<string>> {
    return new Set(
      await eventBroadcastsRepo.recipientIds(eventId, segment, senderId),
    );
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

  it("送る本人は宛先に入らない（送った内容は履歴で読める）", async () => {
    const c = await makeCast();
    // staff が「スタッフ」に送ると、自分だけ抜けて staff2 が残る
    const asStaff = await ids(c.eventId, "staff", c.staff.userId);
    expect(asStaff.has(c.staff.userId)).toBe(false);
    expect(asStaff.has(c.staff2.userId)).toBe(true);

    // 「全員」でも同じ。自分以外は変わらない
    const allAsStaff = await ids(c.eventId, "all", c.staff.userId);
    const allAsOther = await ids(c.eventId, "all");
    expect(allAsStaff.has(c.staff.userId)).toBe(false);
    expect(allAsStaff.size).toBe(allAsOther.size - 1);
  });

  it("スタッフ・審査員・観覧者はそれぞれの区分だけに入る", async () => {
    const c = await makeCast();
    expect(await ids(c.eventId, "staff")).toEqual(
      new Set([
        c.staff.userId,
        c.staff2.userId,
        c.staffLost.userId,
        c.staffApplied.userId,
      ]),
    );
    expect(await ids(c.eventId, "judge")).toEqual(new Set([c.judge.userId]));
    expect(await ids(c.eventId, "observer")).toEqual(
      new Set([c.observer.userId]),
    );
  });

  it("抽選の当選者は抽選枠の確定者だけ（先着の確定者は入らない）", async () => {
    const c = await makeCast();
    expect(await ids(c.eventId, "lottery_won")).toEqual(new Set([c.won.userId]));
    // 申込中は当選ではない
    const won = await ids(c.eventId, "lottery_won");
    expect(won.has(c.applied.userId)).toBe(false);
    expect(won.has(c.confirmed.userId)).toBe(false);
  });

  it("落選者は枠に関係なく拾える（枠を消した後・先着枠での落選も）", async () => {
    const c = await makeCast();
    // 抽選枠のまま・枠を消した後・先着枠で落選、のどれも同じ区分で拾える
    expect(await ids(c.eventId, "lost")).toEqual(
      new Set([c.lost.userId, c.lostNoSlot.userId, c.lostFirstCome.userId]),
    );
    // スタッフの残骸（status=lost）は参加者向けの落選者区分には入れない
    const lostIds = await ids(c.eventId, "lost");
    expect(lostIds.has(c.staffLost.userId)).toBe(false);
  });

  it("落選者はどこかの区分で必ず拾える（どの区分からも漏れない）", async () => {
    const c = await makeCast();
    for (const u of [c.lost, c.lostNoSlot, c.lostFirstCome]) {
      const found: BroadcastSegment[] = [];
      for (const seg of BROADCAST_SEGMENTS) {
        if ((await ids(c.eventId, seg)).has(u.userId)) found.push(seg);
      }
      expect(found).toEqual(["lost"]);
    }
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

  it("「全員」は取消・落選・退会申請中を除いた全員（申込中は含む）", async () => {
    const c = await makeCast();
    const all = await ids(c.eventId, "all");
    // 参加を取り消した人・退会申請中は届かない/意味がないので外す
    expect(all.has(c.canceled.userId)).toBe(false);
    expect(all.has(c.deleted.userId)).toBe(false);
    // 落選した参加者は参加できないので外す（連絡は「落選者」区分から送る）
    expect(all.has(c.lost.userId)).toBe(false);
    expect(all.has(c.lostNoSlot.userId)).toBe(false);
    expect(all.has(c.lostFirstCome.userId)).toBe(false);
    // 抽選の申込中はまだ当選しうるので含める（先着のキャンセル待ちと同じ扱い）
    expect(all.has(c.applied.userId)).toBe(true);
    expect(all.has(c.waitlist.userId)).toBe(true);
    // 運営側も含める
    expect(all.has(c.staff.userId)).toBe(true);
    expect(all.has(c.judge.userId)).toBe(true);
    expect(all.has(c.observer.userId)).toBe(true);
    expect(all.size).toBe(11);
  });

  it("status が lost/applied のまま残っているスタッフも「全員」「スタッフ」に入る", async () => {
    // #277 より前のデータ（migration 0061 が整理している状態）に対する回帰。
    // 条件を「status NOT IN ('canceled','lost')」で書くと落ちる
    const c = await makeCast();
    const all = await ids(c.eventId, "all");
    const staffIds = await ids(c.eventId, "staff");
    for (const u of [c.staffLost, c.staffApplied]) {
      expect(all.has(u.userId)).toBe(true);
      expect(staffIds.has(u.userId)).toBe(true);
    }
  });

  it("退会申請中はどの区分にも入らない", async () => {
    const c = await makeCast();
    for (const seg of BROADCAST_SEGMENTS) {
      const got = await ids(c.eventId, seg);
      expect(got.has(c.deleted.userId)).toBe(false);
    }
  });

  it("人数の集計が宛先の件数と一致する（送り主を除いた数どうしで）", async () => {
    const c = await makeCast();
    // 画面に出る人数と実際に届く人数がズレると、確認の意味が無くなる。
    // 本人を除く仕様なので、同じ送り主で両方を引いて突き合わせる
    for (const senderId of ["not-a-member", c.staff.userId]) {
      const counts = await eventBroadcastsRepo.countsBySegment(
        c.eventId,
        senderId,
      );
      for (const seg of BROADCAST_SEGMENTS) {
        const got = await ids(c.eventId, seg, senderId);
        expect(counts[seg]).toBe(got.size);
      }
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
      // メールの送り直しも同じ権限（配下すべてに同じミドルウェアがかかっている）
      const retry = await SELF.fetch(
        `${BASE}/api/events/${eventId}/broadcasts/${crypto.randomUUID()}/retry-emails`,
        { method: "POST", headers: { cookie: u.cookie } },
      );
      expect(retry.status).toBe(403);
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

/** 消化1回ぶんの期待値（指定しなかった項目は0） */
function drain(p: Partial<DrainResult> = {}): DrainResult {
  return { sent: 0, failed: 0, skipped: 0, deferred: 0, claimed: 0, ...p };
}

/** 送信待ち1行の生データ（バックオフ・試行回数の検証用） */
async function queueRow(broadcastId: string): Promise<{
  status: string;
  attempts: number;
  deferrals: number;
  next_attempt_at: number;
}> {
  const row = await env.DB.prepare(
    "SELECT status, attempts, deferrals, next_attempt_at FROM event_broadcast_email WHERE broadcast_id = ?",
  )
    .bind(broadcastId)
    .first<{
      status: string;
      attempts: number;
      deferrals: number;
      next_attempt_at: number;
    }>();
  return row!;
}

/** スタッフ1人と、メールを受け取れる参加者 n 人のイベントを作る */
async function makeSendable(participants: number): Promise<{
  eventId: string;
  staff: { userId: string; cookie: string };
  users: Array<{ userId: string; cookie: string }>;
}> {
  const owner = await makeUser();
  const eventId = await makeEvent(owner.userId);
  const staff = await makeUser();
  await addMember({ eventId, userId: staff.userId, role: "staff" });
  const users: Array<{ userId: string; cookie: string }> = [];
  for (let i = 0; i < participants; i++) {
    const u = await makeUser();
    await enableEmail(u.userId, true);
    await addMember({ eventId, userId: u.userId });
    users.push(u);
  }
  return { eventId, staff, users };
}

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
    const created = (await res.json()) as SendBroadcastResult;
    expect(created.recipientCount).toBe(3);
    // メール通知ONの人だけが積まれる
    expect(created.emailQueued).toBe(1);
    expect(created.incomplete).toBe(false);
    expect(created.truncatedFrom).toBeNull();

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
    // 履歴のカウンタも積んだ件数に合っている
    expect(await eventBroadcastsRepo.emailStats(created.id)).toEqual({
      pending: 1,
      sent: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it("退会申請中の人には通知もメールも積まれない", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner.userId);
    const staff = await makeUser();
    await addMember({ eventId, userId: staff.userId, role: "staff" });
    const gone = await makeUser({ deleted: true });
    await enableEmail(gone.userId, true);
    await addMember({ eventId, userId: gone.userId });
    // 送り主は宛先に入らない (#285) ので、届く相手を別に1人置く。
    // これが無いと 0 件になり「退会者を除いた」のか「誰も居ない」のか区別できない
    const other = await makeUser();
    await addMember({ eventId, userId: other.userId });

    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "all",
      title: "お知らせ",
      body: "本文",
    });
    const created = (await res.json()) as SendBroadcastResult;
    // 退会申請中を除いた 1 人（other）だけ。staff 本人は入らない
    expect(created.recipientCount).toBe(1);
    expect(created.emailQueued).toBe(0);
    const n = await env.DB.prepare(
      "SELECT COUNT(1) AS n FROM notification WHERE user_id = ?",
    )
      .bind(gone.userId)
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("同じメールを2通送らない（通知の一括作成側では送信しない）", async () => {
    // createForMany に skipEmail を渡し忘れる（= { skipEmail: false } にする）と、
    // 通知作成のメール配信と送信待ちの消化の両方が走り、メール通知ONの全員に
    // 同じメールが2通届く。送信回数が積んだ件数と一致することで検出する
    const { eventId, staff, users } = await makeSendable(3);
    const sends: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("api.resend.com")) sends.push(String(url));
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    });

    bindWithEmail();
    const result = await sendBroadcast({
      eventId,
      actorUserId: staff.userId,
      segment: "confirmed",
      title: "二重送信の検出",
      body: "本文",
    });
    expect(result.emailQueued).toBe(users.length);
    // 積んだ件数ぶんだけ。2倍になっていたら二重送信
    expect(sends).toHaveLength(users.length);
    expect(await eventBroadcastsRepo.emailStats(result.broadcastId)).toEqual({
      pending: 0,
      sent: users.length,
      failed: 0,
      skipped: 0,
    });
  });

  it("送信待ちは1回の実行で送信予算を超えず、複数回に分けて全員へ届く", async () => {
    // 1リクエストの送信予算 (20) を超える人数
    const TOTAL = 22;
    const { eventId, staff } = await makeSendable(TOTAL);
    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "confirmed",
      title: "順次送信",
      body: "本文",
    });
    const created = (await res.json()) as SendBroadcastResult;
    expect(created.emailQueued).toBe(TOTAL);

    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    });

    // 1回目: 送信予算ぶんだけ送れる
    bindWithEmail();
    expect(await drainBroadcastEmails()).toEqual(drain({ sent: 20, claimed: 20 }));
    let stats = await eventBroadcastsRepo.emailStats(created.id);
    expect(stats).toEqual({ pending: 2, sent: 20, failed: 0, skipped: 0 });

    // 2回目: 残りが送られる
    bindWithEmail();
    expect(await drainBroadcastEmails()).toEqual(drain({ sent: 2, claimed: 2 }));
    stats = await eventBroadcastsRepo.emailStats(created.id);
    expect(stats).toEqual({ pending: 0, sent: 22, failed: 0, skipped: 0 });

    // 3回目は何も残っていない
    bindWithEmail();
    expect(await drainBroadcastEmails()).toEqual(drain());
    expect(calls).toHaveLength(TOTAL);
  });

  it("送信待ちの多い連絡が、あとから出した別イベントの連絡を待たせない", async () => {
    // 先に大量の送信待ちを抱えた連絡を作り、そのあとで別イベントの連絡を出す。
    // 送信待ちを素直に古い順で消化すると、後者は1通も送られない
    const big = await makeSendable(30);
    const bigRes = await postBroadcast(big.eventId, big.staff.cookie, {
      segment: "confirmed",
      title: "大人数",
      body: "本文",
    });
    const bigCreated = (await bigRes.json()) as SendBroadcastResult;
    const urgent = await makeSendable(2);
    const urgentRes = await postBroadcast(urgent.eventId, urgent.staff.cookie, {
      segment: "confirmed",
      title: "急ぎ",
      body: "本文",
    });
    const urgentCreated = (await urgentRes.json()) as SendBroadcastResult;

    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    bindWithEmail();
    await drainBroadcastEmails();

    // あとから出した連絡は1回目の消化で送りきれている
    expect(await eventBroadcastsRepo.emailStats(urgentCreated.id)).toEqual({
      pending: 0,
      sent: 2,
      failed: 0,
      skipped: 0,
    });
    // 大人数のほうは残りの枠ぶんだけ進む
    const bigStats = await eventBroadcastsRepo.emailStats(bigCreated.id);
    expect(bigStats.sent).toBeGreaterThan(0);
    expect(bigStats.pending).toBeGreaterThan(0);
  });

  it("積んだ後にメール通知をオフにした人には送らない", async () => {
    const { eventId, staff, users } = await makeSendable(1);
    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "confirmed",
      title: "オフ検証",
      body: "本文",
    });
    const created = (await res.json()) as SendBroadcastResult;
    expect(created.emailQueued).toBe(1);

    // 送信待ちのまま通知をオフにする
    await env.DB.prepare(
      "UPDATE notification_pref SET email_enabled = 0 WHERE user_id = ?",
    )
      .bind(users[0]!.userId)
      .run();

    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    bindWithEmail();
    expect(await drainBroadcastEmails()).toEqual(
      drain({ skipped: 1, claimed: 1 }),
    );
    expect(await eventBroadcastsRepo.emailStats(created.id)).toEqual({
      pending: 0,
      sent: 0,
      failed: 0,
      skipped: 1,
    });
  });

  it("一時的な失敗（5xx）は再試行回数を消費せず、間隔を空けて送信待ちに戻る", async () => {
    const { eventId, staff } = await makeSendable(1);
    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "confirmed",
      title: "5xx",
      body: "本文",
    });
    const created = (await res.json()) as SendBroadcastResult;

    vi.stubGlobal("fetch", async () => new Response("boom", { status: 500 }));
    bindWithEmail();
    expect(await drainBroadcastEmails()).toEqual(
      drain({ deferred: 1, claimed: 1 }),
    );
    // 失敗にはせず送信待ちのまま。試行回数も消費していない
    expect(await eventBroadcastsRepo.emailStats(created.id)).toEqual({
      pending: 1,
      sent: 0,
      failed: 0,
      skipped: 0,
    });
    const row = await queueRow(created.id);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(0);
    expect(row.deferrals).toBe(1);
    expect(row.next_attempt_at).toBeGreaterThan(Date.now());

    // 次の実行ではまだ取り出さない（間隔を空けている）
    bindWithEmail();
    expect(await drainBroadcastEmails()).toEqual(drain());

    // 待ち時間が過ぎて配信側が復旧すれば送れる
    await env.DB.prepare(
      "UPDATE event_broadcast_email SET next_attempt_at = 0 WHERE broadcast_id = ?",
    )
      .bind(created.id)
      .run();
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    bindWithEmail();
    expect(await drainBroadcastEmails()).toEqual(drain({ sent: 1, claimed: 1 }));
    expect(await eventBroadcastsRepo.emailStats(created.id)).toEqual({
      pending: 0,
      sent: 1,
      failed: 0,
      skipped: 0,
    });
  });

  it("レート超過（429）も一時的な失敗として扱う", async () => {
    const { eventId, staff } = await makeSendable(1);
    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "confirmed",
      title: "429",
      body: "本文",
    });
    const created = (await res.json()) as SendBroadcastResult;

    vi.stubGlobal("fetch", async () => new Response("slow down", { status: 429 }));
    bindWithEmail();
    expect(await drainBroadcastEmails()).toEqual(
      drain({ deferred: 1, claimed: 1 }),
    );
    expect((await eventBroadcastsRepo.emailStats(created.id)).failed).toBe(0);
  });

  it("何度ためしても直らない失敗（422）はその場で失敗にする", async () => {
    const { eventId, staff } = await makeSendable(1);
    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "confirmed",
      title: "422",
      body: "本文",
    });
    const created = (await res.json()) as SendBroadcastResult;

    vi.stubGlobal(
      "fetch",
      async () => new Response("invalid to", { status: 422 }),
    );
    bindWithEmail();
    expect(await drainBroadcastEmails()).toEqual(
      drain({ failed: 1, claimed: 1 }),
    );
    expect(await eventBroadcastsRepo.emailStats(created.id)).toEqual({
      pending: 0,
      sent: 0,
      failed: 1,
      skipped: 0,
    });
  });

  it("一時的な失敗が続きすぎたら最後は失敗に倒す", async () => {
    const { eventId, staff } = await makeSendable(1);
    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "confirmed",
      title: "粘りの上限",
      body: "本文",
    });
    const created = (await res.json()) as SendBroadcastResult;
    // 上限まで見送った状態にしておく
    await env.DB.prepare(
      "UPDATE event_broadcast_email SET deferrals = 12, next_attempt_at = 0 WHERE broadcast_id = ?",
    )
      .bind(created.id)
      .run();

    vi.stubGlobal("fetch", async () => new Response("boom", { status: 500 }));
    bindWithEmail();
    expect(await drainBroadcastEmails()).toEqual(
      drain({ failed: 1, claimed: 1 }),
    );
    expect((await eventBroadcastsRepo.emailStats(created.id)).failed).toBe(1);
  });

  it("失敗したぶんをスタッフが送り直せる（送信回数は消費しない）", async () => {
    const { eventId, staff } = await makeSendable(1);
    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "confirmed",
      title: "送り直し",
      body: "本文",
    });
    const created = (await res.json()) as SendBroadcastResult;
    vi.stubGlobal("fetch", async () => new Response("bad", { status: 422 }));
    bindWithEmail();
    await drainBroadcastEmails();
    expect((await eventBroadcastsRepo.emailStats(created.id)).failed).toBe(1);

    const before = (await (
      await getBroadcasts(eventId, staff.cookie)
    ).json()) as EventBroadcastsPayload;

    const retry = await SELF.fetch(
      `${BASE}/api/events/${eventId}/broadcasts/${created.id}/retry-emails`,
      { method: "POST", headers: { cookie: staff.cookie } },
    );
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ requeued: 1 });
    expect(await eventBroadcastsRepo.emailStats(created.id)).toEqual({
      pending: 1,
      sent: 0,
      failed: 0,
      skipped: 0,
    });

    // 送り直しは新しい送信ではないので、送信回数の残りは変わらない
    const after = (await (
      await getBroadcasts(eventId, staff.cookie)
    ).json()) as EventBroadcastsPayload;
    expect(after.remainingToday).toBe(before.remainingToday);
    expect(after.remainingTotal).toBe(before.remainingTotal);

    // 直っていれば次の消化で届く
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    bindWithEmail();
    expect(await drainBroadcastEmails()).toEqual(drain({ sent: 1, claimed: 1 }));
  });

  it("他イベントの連絡は送り直せない", async () => {
    const a = await makeSendable(1);
    const b = await makeSendable(1);
    const res = await postBroadcast(a.eventId, a.staff.cookie, {
      segment: "confirmed",
      title: "他人の連絡",
      body: "本文",
    });
    const created = (await res.json()) as SendBroadcastResult;
    const bad = await SELF.fetch(
      `${BASE}/api/events/${b.eventId}/broadcasts/${created.id}/retry-emails`,
      { method: "POST", headers: { cookie: b.staff.cookie } },
    );
    expect(bad.status).toBe(404);
  });

  it("送信予算が一部使われていても、その残りぶんしか取り出さない", async () => {
    // 取り出す件数を残り予算に合わせるガード。取り出しすぎると、送る当てのない行を
    // 送信中に倒しては戻すことになる
    const { eventId, staff } = await makeSendable(20);
    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "confirmed",
      title: "予算の一部消費",
      body: "本文",
    });
    const created = (await res.json()) as SendBroadcastResult;
    expect(created.emailQueued).toBe(20);

    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    bindWithEmail();
    // 同じリクエストの中で他の処理が予算を使った状態にする
    for (let i = 0; i < 15; i++) expect(takeEmailSlot()).toBe(true);

    expect(await drainBroadcastEmails()).toEqual(drain({ sent: 5, claimed: 5 }));
    expect(await eventBroadcastsRepo.emailStats(created.id)).toEqual({
      pending: 15,
      sent: 5,
      failed: 0,
      skipped: 0,
    });
  });

  it("取り出した後に予算が尽きたら、残りは手つかずのまま送信待ちに戻す", async () => {
    // 予算は消化中にも減りうる（イベントカードの取得など）。ループ側のガードが無いと
    // 残りは「送信予算切れ」を一時的な失敗として数え、無駄にバックオフがかかる
    const { eventId, staff } = await makeSendable(20);
    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "confirmed",
      title: "途中で予算切れ",
      body: "本文",
    });
    const created = (await res.json()) as SendBroadcastResult;

    // 1通送るたびに、別の処理が1つ予算を使う状況を作る
    vi.stubGlobal("fetch", async () => {
      takeEmailSlot();
      return new Response("{}", { status: 200 });
    });
    bindWithEmail();
    const r = await drainBroadcastEmails();
    expect(r.claimed).toBe(20);
    expect(r.sent).toBe(10);
    // 予算切れは失敗でも見送りでもない（バックオフをかけない）
    expect(r.failed).toBe(0);
    expect(r.deferred).toBe(0);
    expect(await eventBroadcastsRepo.emailStats(created.id)).toEqual({
      pending: 10,
      sent: 10,
      failed: 0,
      skipped: 0,
    });
    const untouched = await env.DB.prepare(
      `SELECT COUNT(1) AS n FROM event_broadcast_email
        WHERE broadcast_id = ? AND status = 'pending'
          AND attempts = 0 AND deferrals = 0 AND next_attempt_at = 0`,
    )
      .bind(created.id)
      .first<{ n: number }>();
    expect(untouched?.n).toBe(10);
  });

  it("メール送信が未設定なら送信待ちには触らない", async () => {
    const { eventId, staff } = await makeSendable(1);
    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "confirmed",
      title: "未設定",
      body: "本文",
    });
    const created = (await res.json()) as SendBroadcastResult;

    // RESEND_API_KEY 無しのまま（beforeAll の bindEnv）
    expect(await drainBroadcastEmails()).toEqual(drain());
    const stats = await eventBroadcastsRepo.emailStats(created.id);
    expect(stats.pending).toBe(1);
    const row = await queueRow(created.id);
    expect(row.attempts).toBe(0);
    expect(row.status).toBe("pending");
  });

  it("宛先が多すぎるときは打ち切り、打ち切ったことを返す", async () => {
    const { eventId, staff } = await makeSendable(3);
    const result = await sendBroadcast(
      {
        eventId,
        actorUserId: staff.userId,
        segment: "confirmed",
        title: "打ち切り",
        body: "本文",
      },
      { maxRecipients: 2 },
    );
    expect(result.recipientCount).toBe(2);
    expect(result.truncatedFrom).toBe(3);
    expect(result.emailQueued).toBe(2);
    const n = await env.DB.prepare(
      "SELECT COUNT(1) AS n FROM notification WHERE type = 'event_broadcast' AND link = ?",
    )
      .bind(`/events/${eventId}`)
      .first<{ n: number }>();
    expect(n?.n).toBe(2);
  });

  it("通知の一括作成が途中で落ちたら、届いたぶんだけ記録して「一部のみ」を返す", async () => {
    const { eventId, staff } = await makeSendable(3);
    // 2人目の固まりで落ちた状況（1人目までは届いている）
    vi.spyOn(notificationsRepo, "createForMany").mockRejectedValueOnce(
      new PartialNotificationError(1, new Error("boom")),
    );
    const result = await sendBroadcast({
      eventId,
      actorUserId: staff.userId,
      segment: "confirmed",
      title: "途中で失敗",
      body: "本文",
    });
    expect(result.incomplete).toBe(true);
    expect(result.recipientCount).toBe(1);
    // 届いていない人にはメールも積まない
    expect(result.emailQueued).toBe(1);

    const list = (await (
      await getBroadcasts(eventId, staff.cookie)
    ).json()) as EventBroadcastsPayload;
    expect(list.broadcasts[0]!.incomplete).toBe(true);
    expect(list.broadcasts[0]!.recipientCount).toBe(1);
  });

  it("1人も作れなかったときは失敗として投げ直す", async () => {
    const { eventId, staff } = await makeSendable(2);
    vi.spyOn(notificationsRepo, "createForMany").mockRejectedValueOnce(
      new PartialNotificationError(0, new Error("boom")),
    );
    await expect(
      sendBroadcast({
        eventId,
        actorUserId: staff.userId,
        segment: "confirmed",
        title: "全滅",
        body: "本文",
      }),
    ).rejects.toBeInstanceOf(PartialNotificationError);
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
    expect(b.incomplete).toBe(false);
    expect(b.email).toEqual({ pending: 1, sent: 0, failed: 0, skipped: 0 });
    expect(b.senderName).not.toBeNull();
    expect(payload.counts.confirmed).toBe(1);
    expect(payload.remainingToday).toBe(BROADCAST_MAX_PER_DAY - 1);
    expect(payload.remainingTotal).toBe(BROADCAST_MAX_PER_EVENT - 1);
  });

  it("メールの内訳は送信の進みに合わせて動く", async () => {
    const { eventId, staff } = await makeSendable(3);
    const res = await postBroadcast(eventId, staff.cookie, {
      segment: "confirmed",
      title: "内訳",
      body: "本文",
    });
    const created = (await res.json()) as SendBroadcastResult;
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    bindWithEmail();
    await drainBroadcastEmails();

    const payload = (await (
      await getBroadcasts(eventId, staff.cookie)
    ).json()) as EventBroadcastsPayload;
    const b = payload.broadcasts.find((x) => x.id === created.id)!;
    expect(b.email).toEqual({ pending: 0, sent: 3, failed: 0, skipped: 0 });
  });

  it("送りきるまでの時間の目安が実測のペースから出る", () => {
    // 1リクエスト20通 x 5分おき = 240通/時。「数分」では実態と桁が違う。
    // 「約25分」のような**表記**は辞書が持つので、ここで見るのは分の値だけ (#363)
    expect(broadcastEmailMinutes(0)).toBe(0);
    expect(broadcastEmailMinutes(100)).toBe(25);
    expect(broadcastEmailMinutes(300)).toBe(75);
    expect(broadcastEmailMinutes(240)).toBe(60);
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
