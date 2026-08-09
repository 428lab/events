import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { MeetScanResult, MeetToken } from "@eventer/shared";

/**
 * 読み取ったその場で確定する出会い (#330)。
 *
 * 守りたいのは次の4点:
 * - トークンは有効期限内しか使えない（写真を後から渡しても成立しない）
 * - 自分のQRを自分で読んで自分の出席を付けられない
 * - 出席が付くのは staff が絡む組み合わせだけ
 * - 誤って付いた出席・出会いを取り消せる
 */

const BASE = "https://example.com";
/** vitest.config.ts の miniflare バインディングと同じ値 */
const SESSION_SECRET = "test-secret";

async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, `s_${uid.slice(0, 8)}`, "テスト", Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

/** 既定は公開・開催中（1時間前開始〜1時間後終了）・出席チェックON */
async function insertEvent(
  ownerId: string,
  opts: {
    startsAt?: number;
    endsAt?: number;
    status?: string;
    attendanceCheck?: boolean;
  } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, attendance_check, scheduling, created_by, created_at)
     VALUES (?, ?, ?, ?, 'offline', ?, ?, 0, ?, ?)`,
  )
    .bind(
      id,
      `読み取りE2E_${id.slice(0, 6)}`,
      opts.startsAt ?? now - 3600_000,
      opts.endsAt ?? now + 3600_000,
      opts.status ?? "published",
      (opts.attendanceCheck ?? true) ? 1 : 0,
      ownerId,
      now,
    )
    .run();
  return id;
}

async function addMember(
  eventId: string,
  userId: string,
  role: "participant" | "staff" = "participant",
  status = "confirmed",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, ?, 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, role, status, Date.now())
    .run();
}

async function attendedInDb(eventId: string, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT attended FROM event_member WHERE event_id = ? AND user_id = ?",
  )
    .bind(eventId, userId)
    .first<{ attended: number }>();
  return row?.attended ?? -1;
}

async function meetCount(eventId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM event_meet WHERE event_id = ?",
  )
    .bind(eventId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** サーバーが発行するのと同じ形のトークンを作る（期限切れ・改竄のケース用）。
 * 署名は先頭16バイト＝32桁hexに切り詰める（lib/meetToken.ts と同じ） */
async function craftToken(
  userId: string,
  exp: number,
  secret = SESSION_SECRET,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`meet:${userId}:${exp}`),
  );
  const hex = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  return `mt1.${userId}.${exp}.${hex}`;
}

async function issueToken(cookie: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/meet/token`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as MeetToken).token;
}

async function scan(cookie: string, token: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/meet/scan`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ token }),
  });
}

async function undo(cookie: string, body: unknown): Promise<Response> {
  return SELF.fetch(`${BASE}/api/meet/undo`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describe("QRトークンの検証 (#330)", () => {
  it("発行したトークンは自分のIDを含み、未ログインでは発行も読み取りもできない", async () => {
    const a = await makeUser();
    const res = await SELF.fetch(`${BASE}/api/meet/token`, {
      headers: { cookie: a.cookie },
    });
    const { token, expiresAt } = (await res.json()) as MeetToken;
    expect(token.startsWith(`mt1.${a.userId}.`)).toBe(true);
    // 有効期限は数十秒〜数分の短寿命（写真を後から渡して成立させないため）
    expect(expiresAt - Date.now()).toBeGreaterThan(0);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(180_000);

    expect((await SELF.fetch(`${BASE}/api/meet/token`)).status).toBe(401);
    const anon = await SELF.fetch(`${BASE}/api/meet/scan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(anon.status).toBe(401);
  });

  it("期限切れは410、署名改竄は400、壊れた形式は400。どちらも記録されない", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);
    await addMember(eventId, b.userId);

    const expired = await craftToken(
      b.userId,
      Math.floor(Date.now() / 1000) - 10,
    );
    expect((await scan(a.cookie, expired)).status).toBe(410);

    const tampered = await craftToken(
      b.userId,
      Math.floor(Date.now() / 1000) + 100,
      "wrong-secret",
    );
    expect((await scan(a.cookie, tampered)).status).toBe(400);

    expect((await scan(a.cookie, "mt1.broken")).status).toBe(400);
    expect(await meetCount(eventId)).toBe(0);
  });

  it("自分のトークンを自分で読んでも記録されず、自分の出席も付かない", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");
    await addMember(eventId, a.userId);

    const token = await issueToken(a.cookie);
    const res = await scan(a.cookie, token);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("self");
    expect(await attendedInDb(eventId, a.userId)).toBe(0);
    expect(await meetCount(eventId)).toBe(0);
  });

  it("1つのトークンは有効期限内なら複数人が読める（単回限りにしない）", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    const eventId = await insertEvent(owner.userId);
    for (const u of [a, b, c]) await addMember(eventId, u.userId);

    // a が出したQRを b と c が続けて読む（自分のQRを次々に読んでもらう使い方）
    const token = await issueToken(a.cookie);
    expect((await scan(b.cookie, token)).status).toBe(200);
    expect((await scan(c.cookie, token)).status).toBe(200);
    expect(await meetCount(eventId)).toBe(2);
  });
});

describe("読み取りでの出会いの記録 (#330)", () => {
  it("参加者どうしは出会いのみ記録し、出席は付かない（出席チェックONでも記録できる）", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const eventId = await insertEvent(owner.userId, { attendanceCheck: true });
    await addMember(eventId, a.userId);
    await addMember(eventId, b.userId);

    const res = await scan(a.cookie, await issueToken(b.cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as MeetScanResult;
    expect(body.target.id).toBe(b.userId);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      eventId,
      meetCreated: true,
      attendedMe: false,
      attendedTarget: false,
    });
    // 両者とも未出席のままでも出会いは残る（#330 で条件を撤廃）
    expect(await attendedInDb(eventId, a.userId)).toBe(0);
    expect(await attendedInDb(eventId, b.userId)).toBe(0);
    expect(await meetCount(eventId)).toBe(1);

    // 同じ相手をもう一度読んでも増えない（冪等）
    const again = await scan(a.cookie, await issueToken(b.cookie));
    expect(((await again.json()) as MeetScanResult).events[0].meetCreated).toBe(
      false,
    );
    expect(await meetCount(eventId)).toBe(1);
  });

  it("失敗の理由を区別して返す（共通イベントなし・時間帯外・参加が未確定）", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();

    // 共通イベントなし
    const res1 = await scan(a.cookie, await issueToken(b.cookie));
    expect(res1.status).toBe(409);
    expect(((await res1.json()) as { error: string }).error).toBe(
      "no_shared_event",
    );

    // 開催時間帯の外（未来のイベント）
    const now = Date.now();
    const future = await insertEvent(owner.userId, {
      startsAt: now + 7200_000,
      endsAt: now + 10800_000,
    });
    await addMember(future, a.userId);
    await addMember(future, b.userId);
    const res2 = await scan(a.cookie, await issueToken(b.cookie));
    expect(res2.status).toBe(409);
    expect(((await res2.json()) as { error: string }).error).toBe(
      "outside_window",
    );

    // 参加が確定していない（キャンセル待ち）
    const c = await makeUser();
    const live = await insertEvent(owner.userId);
    await addMember(live, c.userId);
    await addMember(live, b.userId, "participant", "waitlist");
    const res3 = await scan(c.cookie, await issueToken(b.cookie));
    expect(res3.status).toBe(409);
    expect(((await res3.json()) as { error: string }).error).toBe(
      "not_confirmed",
    );
  });
});

describe("読み取りによる出席の自動付与 (#330)", () => {
  it("staff のQRを参加者が読むと、その参加者が出席になる", async () => {
    const staff = await makeUser();
    const p = await makeUser();
    const eventId = await insertEvent(staff.userId);
    await addMember(eventId, staff.userId, "staff");
    await addMember(eventId, p.userId);

    const res = await scan(p.cookie, await issueToken(staff.cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as MeetScanResult;
    expect(body.events[0].attendedMe).toBe(true);
    expect(body.events[0].attendedTarget).toBe(false);
    expect(await attendedInDb(eventId, p.userId)).toBe(1);
    // staff 側は参加者のQRを読んでいないので出席は付かない
    expect(await attendedInDb(eventId, staff.userId)).toBe(0);
  });

  it("参加者のQRを staff が読んでも、その参加者が出席になる", async () => {
    const staff = await makeUser();
    const p = await makeUser();
    const eventId = await insertEvent(staff.userId);
    await addMember(eventId, staff.userId, "staff");
    await addMember(eventId, p.userId);

    const res = await scan(staff.cookie, await issueToken(p.cookie));
    const body = (await res.json()) as MeetScanResult;
    expect(body.events[0].attendedTarget).toBe(true);
    expect(body.events[0].attendedMe).toBe(false);
    expect(await attendedInDb(eventId, p.userId)).toBe(1);
    expect(await attendedInDb(eventId, staff.userId)).toBe(0);
  });

  it("参加者どうしでは、何度読み合っても出席は付かない", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);
    await addMember(eventId, b.userId);

    await scan(a.cookie, await issueToken(b.cookie));
    await scan(b.cookie, await issueToken(a.cookie));
    expect(await attendedInDb(eventId, a.userId)).toBe(0);
    expect(await attendedInDb(eventId, b.userId)).toBe(0);
  });

  it("既に出席済みなら「この読み取りで付けた」とは数えない", async () => {
    const staff = await makeUser();
    const p = await makeUser();
    const eventId = await insertEvent(staff.userId);
    await addMember(eventId, staff.userId, "staff");
    await addMember(eventId, p.userId);
    await env.DB.prepare(
      "UPDATE event_member SET attended = 1 WHERE event_id = ? AND user_id = ?",
    )
      .bind(eventId, p.userId)
      .run();

    const res = await scan(p.cookie, await issueToken(staff.cookie));
    const body = (await res.json()) as MeetScanResult;
    expect(body.events[0].attendedMe).toBe(false);
    expect(await attendedInDb(eventId, p.userId)).toBe(1);
  });
});

describe("読み取りの取り消し (#330)", () => {
  it("出会いの記録と、この読み取りで付いた出席を戻せる", async () => {
    const staff = await makeUser();
    const p = await makeUser();
    const eventId = await insertEvent(staff.userId);
    await addMember(eventId, staff.userId, "staff");
    await addMember(eventId, p.userId);

    const res = await scan(p.cookie, await issueToken(staff.cookie));
    const body = (await res.json()) as MeetScanResult;
    expect(await meetCount(eventId)).toBe(1);
    expect(await attendedInDb(eventId, p.userId)).toBe(1);

    const undoRes = await undo(p.cookie, {
      userId: body.target.id,
      events: body.events.map((e) => ({
        eventId: e.eventId,
        revokeMyAttendance: e.attendedMe,
        revokeTargetAttendance: e.attendedTarget,
      })),
    });
    expect(undoRes.status).toBe(200);
    expect(((await undoRes.json()) as { undone: number }).undone).toBe(1);
    expect(await meetCount(eventId)).toBe(0);
    expect(await attendedInDb(eventId, p.userId)).toBe(0);
  });

  it("一般参加者は取り消しに乗せても相手の出席を外せない", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);
    await addMember(eventId, b.userId);
    // b は受付で出席済み（この読み取りとは無関係に付いた出席）
    await env.DB.prepare(
      "UPDATE event_member SET attended = 1 WHERE event_id = ? AND user_id = ?",
    )
      .bind(eventId, b.userId)
      .run();
    await scan(a.cookie, await issueToken(b.cookie));

    const res = await undo(a.cookie, {
      userId: b.userId,
      events: [
        {
          eventId,
          revokeMyAttendance: true,
          revokeTargetAttendance: true,
        },
      ],
    });
    expect(res.status).toBe(200);
    // 出会いは消えるが、staff でない a は相手の出席を動かせない
    expect(await meetCount(eventId)).toBe(0);
    expect(await attendedInDb(eventId, b.userId)).toBe(1);
  });

  it("自分自身への取り消しは受け付けない", async () => {
    const a = await makeUser();
    const res = await undo(a.cookie, {
      userId: a.userId,
      events: [{ eventId: crypto.randomUUID() }],
    });
    expect(res.status).toBe(400);
  });
});
