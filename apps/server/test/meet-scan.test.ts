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

/** lib/meetToken.ts と同じ署名（先頭16バイト＝32桁hexに切り詰める） */
async function hmac(message: string, secret: string): Promise<string> {
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
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** サーバーが発行するのと同じ形のQRトークンを作る（期限切れ・改竄のケース用） */
async function craftToken(
  userId: string,
  exp: number,
  secret = SESSION_SECRET,
  nonce = "0123456789abcdef",
): Promise<string> {
  const sig = await hmac(`meet:${userId}:${exp}:${nonce}`, secret);
  return `mt1.${userId}.${exp}.${nonce}.${sig}`;
}

/** 取り消しトークンをサーバーと同じ方式で作る（期限切れ・別鍵のケース用） */
async function craftUndoToken(
  scannerId: string,
  targetId: string,
  grants: {
    eventId: string;
    meetCreated: boolean;
    attendedMe: boolean;
    attendedTarget: boolean;
  }[],
  exp: number,
  secret = SESSION_SECRET,
): Promise<string> {
  const json = JSON.stringify({ scannerId, targetId, grants, exp });
  const encoded = btoa(json)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `mu1.${encoded}.${await hmac(`meet-undo:${encoded}`, secret)}`;
}

/** 使用済み記録の件数（掃除の確認用）。接頭辞で他用途と分けている */
async function usedNonceCount(): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM nostr_challenge_used WHERE nonce LIKE 'meet:%'",
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

async function meetNotificationCount(userId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notification WHERE user_id = ? AND type = 'meet'",
  )
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function issueToken(cookie: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/meet/token`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as MeetToken).token;
}

/** 表示中のトークンを添えて問い合わせる（表示側の見張りと同じ呼び方） */
async function currentToken(
  cookie: string,
  current: string,
): Promise<MeetToken> {
  const res = await SELF.fetch(
    `${BASE}/api/meet/token?current=${encodeURIComponent(current)}`,
    { headers: { cookie } },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as MeetToken;
}

async function scan(cookie: string, token: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/meet/scan`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ token }),
  });
}

async function undo(cookie: string, undoToken: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/meet/undo`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ undoToken }),
  });
}

/** 読み取りを1回行い、結果（取り消しトークンつき）を取り出す */
async function scanOk(cookie: string, token: string): Promise<MeetScanResult> {
  const res = await scan(cookie, token);
  expect(res.status).toBe(200);
  return (await res.json()) as MeetScanResult;
}

describe("QRトークンの検証 (#330)", () => {
  it("発行したトークンは自分のIDを含み、未ログインでは発行も読み取りもできない", async () => {
    const a = await makeUser();
    const res = await SELF.fetch(`${BASE}/api/meet/token`, {
      headers: { cookie: a.cookie },
    });
    const { token, expiresAt, consumed } = (await res.json()) as MeetToken;
    expect(token.startsWith(`mt1.${a.userId}.`)).toBe(true);
    expect(consumed).toBe(false);
    // 使い切りなので有効期限は緩めでよい（その場で新規登録する人の
    // OAuth 往復に間に合わせる）。ただし無期限にはしない
    expect(expiresAt - Date.now()).toBeGreaterThan(5 * 60_000);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(20 * 60_000);

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

  it("トークンは使い切り。2回目は used として弾く", async () => {
    // 画面の写真を後から渡されても、目の前の人が読んだ時点で使用済みになる
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    const eventId = await insertEvent(owner.userId);
    for (const u of [a, b, c]) await addMember(eventId, u.userId);

    const token = await issueToken(a.cookie);
    expect((await scan(b.cookie, token)).status).toBe(200);

    // 同じQRを別の人が読んでも、同じ人が読み直しても通らない
    const second = await scan(c.cookie, token);
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toBe("used");
    expect((await scan(b.cookie, token)).status).toBe(409);
    expect(await meetCount(eventId)).toBe(1);

    // 次のトークンを出せば続けて読んでもらえる（行列がここで止まらない）
    expect((await scan(c.cookie, await issueToken(a.cookie))).status).toBe(200);
    expect(await meetCount(eventId)).toBe(2);
  });

  it("自分のQRを自分で読んでも使い切られない（自分のQRを潰せない）", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);
    await addMember(eventId, b.userId);

    const token = await issueToken(a.cookie);
    expect((await scan(a.cookie, token)).status).toBe(400);
    // 消費されていないので、相手はそのまま読める
    expect((await scan(b.cookie, token)).status).toBe(200);
  });

  it("表示側は読まれるまで同じトークンを持ち続け、読まれたら次を受け取る", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);
    await addMember(eventId, b.userId);

    const token = await issueToken(a.cookie);
    // 読まれていないうちは同じQRのまま（読み取り中に切り替わらない）
    const same = await currentToken(a.cookie, token);
    expect(same.token).toBe(token);
    expect(same.consumed).toBe(false);

    await scan(b.cookie, token);
    // 読まれたら次のぶんに切り替わり、描き替えの合図が立つ
    const next = await currentToken(a.cookie, token);
    expect(next.token).not.toBe(token);
    expect(next.consumed).toBe(true);

    // 他人のトークンを添えても、その人のぶんが新しく出るだけ
    const foreign = await currentToken(b.cookie, next.token);
    expect(foreign.token.startsWith(`mt1.${b.userId}.`)).toBe(true);
  });

  it("使用済み記録は有効期限を過ぎたぶんが掃除される", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);
    await addMember(eventId, b.userId);

    // 十分に古い使用済み記録を積んでおく
    await env.DB.prepare(
      "INSERT INTO nostr_challenge_used (nonce, used_at) VALUES (?, ?)",
    )
      .bind("meet:old0000000000", Date.now() - 60 * 60_000)
      .run();
    expect(await usedNonceCount()).toBe(1);

    // 新しい読み取りが1件入り、古い記録は消える
    await scan(b.cookie, await issueToken(a.cookie));
    expect(await usedNonceCount()).toBe(1);
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

  it("失敗の理由を区別して返す（共通イベントなし・時間帯外・どちらが未確定か）", async () => {
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

    // 相手の参加が確定していない（キャンセル待ち）
    const c = await makeUser();
    const d = await makeUser();
    const live = await insertEvent(owner.userId);
    await addMember(live, c.userId);
    await addMember(live, d.userId, "participant", "waitlist");
    const res3 = await scan(c.cookie, await issueToken(d.cookie));
    expect(res3.status).toBe(409);
    expect(((await res3.json()) as { error: string }).error).toBe(
      "not_confirmed_target",
    );
    // 自分の参加が確定していない側は、案内の宛先が変わるので区別する
    const res4 = await scan(d.cookie, await issueToken(c.cookie));
    expect(res4.status).toBe(409);
    expect(((await res4.json()) as { error: string }).error).toBe(
      "not_confirmed_me",
    );
  });

  it("日程調整中の共通イベントがあっても、未確定の理由が時間帯外に隠れない", async () => {
    // diagnoseUnmeetable の1本目が scheduling を見ていないと、日程未確定の
    // 共通イベントに引っ張られて常に outside_window になってしまう
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, attendance_check, scheduling, created_by, created_at)
       VALUES (?, '日程調整中', 0, 0, 'offline', 'published', 0, 1, ?, ?)`,
    )
      .bind(id, owner.userId, Date.now())
      .run();
    await addMember(id, a.userId);
    await addMember(id, b.userId, "participant", "waitlist");

    const res = await scan(a.cookie, await issueToken(b.cookie));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(
      "not_confirmed_target",
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

  it("出席チェックを使わないイベントには出席を付けない", async () => {
    // 出席チェックOFFのイベントは「登録＝出席」で集計されるので立てる意味が無い
    const staff = await makeUser();
    const p = await makeUser();
    const eventId = await insertEvent(staff.userId, { attendanceCheck: false });
    await addMember(eventId, staff.userId, "staff");
    await addMember(eventId, p.userId);

    const body = await scanOk(p.cookie, await issueToken(staff.cookie));
    expect(body.events[0].meetCreated).toBe(true);
    expect(body.events[0].attendedMe).toBe(false);
    expect(await attendedInDb(eventId, p.userId)).toBe(0);
  });

  it("時間帯が重なる別イベントには出席を付けない（いま開催中の1件だけ）", async () => {
    // 開始30分前〜終了2時間後という幅のせいで前後の回が同時に窓に入る。
    // その場に居ない回まで出席にしてしまうと当日の名簿が狂う (#330)
    const staff = await makeUser();
    const p = await makeUser();
    const now = Date.now();
    // 午前の回（1時間前に終了。終了2時間後まで窓に入っている）
    const morning = await insertEvent(staff.userId, {
      startsAt: now - 3 * 3600_000,
      endsAt: now - 3600_000,
    });
    // 午後の回（30分前に開始＝いま開催中）
    const afternoon = await insertEvent(staff.userId, {
      startsAt: now - 30 * 60_000,
      endsAt: now + 3600_000,
    });
    for (const eventId of [morning, afternoon]) {
      await addMember(eventId, staff.userId, "staff");
      await addMember(eventId, p.userId);
    }

    const body = await scanOk(p.cookie, await issueToken(staff.cookie));
    // 出会いはどちらにも残る（同じ日に両方に出ていたのは事実）
    expect(body.events).toHaveLength(2);
    expect(body.events.every((e) => e.meetCreated)).toBe(true);
    // 出席が付くのは、いま開催中の回だけ
    expect(await attendedInDb(afternoon, p.userId)).toBe(1);
    expect(await attendedInDb(morning, p.userId)).toBe(0);
  });
});

describe("読み取りの取り消し (#330)", () => {
  it("出会いの記録と、この読み取りで付いた出席を戻し、通知も残さない", async () => {
    const staff = await makeUser();
    const p = await makeUser();
    const eventId = await insertEvent(staff.userId);
    await addMember(eventId, staff.userId, "staff");
    await addMember(eventId, p.userId);

    const body = await scanOk(p.cookie, await issueToken(staff.cookie));
    expect(await meetCount(eventId)).toBe(1);
    expect(await attendedInDb(eventId, p.userId)).toBe(1);
    expect(await meetNotificationCount(staff.userId)).toBe(1);

    const undoRes = await undo(p.cookie, body.undoToken);
    expect(undoRes.status).toBe(200);
    const undoBody = (await undoRes.json()) as {
      undone: number;
      attendanceRevoked: boolean;
    };
    expect(undoBody.undone).toBe(1);
    expect(undoBody.attendanceRevoked).toBe(true);
    expect(await meetCount(eventId)).toBe(0);
    expect(await attendedInDb(eventId, p.userId)).toBe(0);
    // 取り消したのに「出会いました」が残っていると読み手が混乱する
    expect(await meetNotificationCount(staff.userId)).toBe(0);
  });

  it("取り消しトークンは発行者本人しか使えない", async () => {
    const staff = await makeUser();
    const p = await makeUser();
    const other = await makeUser();
    const eventId = await insertEvent(staff.userId);
    await addMember(eventId, staff.userId, "staff");
    await addMember(eventId, p.userId);
    await addMember(eventId, other.userId);

    const body = await scanOk(p.cookie, await issueToken(staff.cookie));
    // 横取りしたトークンは効かない
    expect((await undo(other.cookie, body.undoToken)).status).toBe(403);
    expect(await meetCount(eventId)).toBe(1);
    expect(await attendedInDb(eventId, p.userId)).toBe(1);
  });

  it("期限切れ・改竄された取り消しトークンは受け付けない", async () => {
    const staff = await makeUser();
    const p = await makeUser();
    const eventId = await insertEvent(staff.userId);
    await addMember(eventId, staff.userId, "staff");
    await addMember(eventId, p.userId);
    const body = await scanOk(p.cookie, await issueToken(staff.cookie));

    // ペイロードだけ差し替える（署名が合わなくなる）
    const [, encoded, sig] = body.undoToken.split(".");
    const tampered = `mu1.${encoded.slice(0, -2)}AA.${sig}`;
    expect((await undo(p.cookie, tampered)).status).toBe(400);
    expect((await undo(p.cookie, "mu1.broken")).status).toBe(400);

    const expired = await craftUndoToken(
      p.userId,
      staff.userId,
      [{ eventId, meetCreated: true, attendedMe: true, attendedTarget: false }],
      Math.floor(Date.now() / 1000) - 10,
    );
    expect((await undo(p.cookie, expired)).status).toBe(410);

    // どのケースでも何も戻っていない
    expect(await meetCount(eventId)).toBe(1);
    expect(await attendedInDb(eventId, p.userId)).toBe(1);
  });

  it("受付で正規に付いた出席は、自分では外せない", async () => {
    // トークンに attendedMe が入っていない＝この読み取りでは付けていない、
    // という記録があるので、staff の userId を拾っても解除には使えない
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

    const body = await scanOk(p.cookie, await issueToken(staff.cookie));
    expect(body.events[0].attendedMe).toBe(false);
    const res = await undo(p.cookie, body.undoToken);
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { attendanceRevoked: boolean }).attendanceRevoked,
    ).toBe(false);
    expect(await attendedInDb(eventId, p.userId)).toBe(1);

    // 自作のトークンでも外せない（署名できないため）
    const forged = await craftUndoToken(
      p.userId,
      staff.userId,
      [{ eventId, meetCreated: false, attendedMe: true, attendedTarget: false }],
      Math.floor(Date.now() / 1000) + 100,
      "wrong-secret",
    );
    expect((await undo(p.cookie, forged)).status).toBe(400);
    expect(await attendedInDb(eventId, p.userId)).toBe(1);
  });

  it("他人が記録した出会いは消せない", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);
    await addMember(eventId, b.userId);

    // b が先に a を読んで記録済みにする
    await scanOk(b.cookie, await issueToken(a.cookie));
    expect(await meetCount(eventId)).toBe(1);

    // a が読み直しても meetCreated=false。その取り消しでは行は消えない
    const body = await scanOk(a.cookie, await issueToken(b.cookie));
    expect(body.events[0].meetCreated).toBe(false);
    const res = await undo(a.cookie, body.undoToken);
    expect(((await res.json()) as { undone: number }).undone).toBe(0);
    expect(await meetCount(eventId)).toBe(1);
  });
});
