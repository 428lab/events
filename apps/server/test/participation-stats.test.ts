import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** 一般ユーザーを1人作る（管理者ではない） */
async function makeUser(): Promise<{
  userId: string;
  username: string;
  cookie: string;
}> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `u_${uid.slice(0, 6)}`;
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

/** 公開イベントを作る（startsAt/endsAt/attendanceCheck 指定可） */
async function makeEvent(
  cookie: string,
  opts: { startsAt: number; endsAt: number; attendanceCheck?: boolean },
): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: `参加実績E2E_${crypto.randomUUID().slice(0, 6)}`,
      venueType: "online",
      startsAt: opts.startsAt,
      endsAt: opts.endsAt,
    }),
  });
  expect(create.status).toBe(201);
  const { event } = (await create.json()) as { event: { id: string } };
  const pub = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      status: "published",
      ...(opts.attendanceCheck ? { attendanceCheck: true } : {}),
    }),
  });
  expect(pub.status).toBe(200);
  return event.id;
}

async function join(eventId: string, cookie: string): Promise<void> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(201);
}

async function leave(eventId: string, cookie: string): Promise<void> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/join`, {
    method: "DELETE",
    headers: { cookie },
  });
  expect(res.status).toBe(200);
}

async function stats(username: string) {
  const res = await SELF.fetch(`${BASE}/api/public/users/${username}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    participation: {
      attended: number;
      noShow: number;
      cancelEarly: number;
      cancelLate: number;
      hosted: number;
      staffed: number;
      spoken: number;
    };
  };
  return body.participation;
}

describe("参加実績の集計 (#106)", () => {
  it("事前/直前キャンセルが分かれて記録され、再参加で復活できる", async () => {
    const admin = await loginDev();
    const u = await makeUser();
    const now = Date.now();

    // 開始まで48時間 → 取消は「事前キャンセル」
    const early = await makeEvent(admin, {
      startsAt: now + 48 * 3600_000,
      endsAt: now + 50 * 3600_000,
    });
    await join(early, u.cookie);
    await leave(early, u.cookie);

    // 開始まで1時間 → 取消は「直前キャンセル」
    const late = await makeEvent(admin, {
      startsAt: now + 3600_000,
      endsAt: now + 7200_000,
    });
    await join(late, u.cookie);
    await leave(late, u.cookie);

    const s1 = await stats(u.username);
    expect(s1.cancelEarly).toBe(1);
    expect(s1.cancelLate).toBe(1);
    expect(s1.attended).toBe(0);

    // キャンセル済みイベントはメンバー一覧・マイページに出ない
    const members = await SELF.fetch(`${BASE}/api/events/${early}/members`, {
      headers: { cookie: admin },
    });
    const list = (await members.json()) as { members: { userId: string }[] };
    expect(list.members.map((m) => m.userId)).not.toContain(u.userId);
    const my = await SELF.fetch(`${BASE}/api/me/events`, {
      headers: { cookie: u.cookie },
    });
    if (my.status === 200) {
      const mine = JSON.stringify(await my.json());
      expect(mine).not.toContain(early);
    }

    // 再参加すると復活し、キャンセルのカウントが1つ減る
    await join(early, u.cookie);
    const s2 = await stats(u.username);
    expect(s2.cancelEarly).toBe(0);
    expect(s2.cancelLate).toBe(1);
  });

  it("出席チェックONの終了イベント: attended=1は出席、0は無断欠席。未チェック運用は登録=出席", async () => {
    const admin = await loginDev();
    const u = await makeUser();
    const now = Date.now();

    // 終了済み＋出席チェックON: 登録したが出席記録なし → 無断欠席
    const checked = await makeEvent(admin, {
      startsAt: now - 7200_000,
      endsAt: now - 3600_000,
      attendanceCheck: true,
    });
    await env.DB.prepare(
      "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, 'participant', NULL, 'confirmed', 0, ?)",
    )
      .bind(crypto.randomUUID(), checked, u.userId, Date.now())
      .run();

    // 終了済み＋チェックなし運用: 登録のまま終了 → 出席扱い
    const unchecked = await makeEvent(admin, {
      startsAt: now - 7200_000,
      endsAt: now - 3600_000,
    });
    await env.DB.prepare(
      "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, 'participant', NULL, 'confirmed', 0, ?)",
    )
      .bind(crypto.randomUUID(), unchecked, u.userId, Date.now())
      .run();

    const s1 = await stats(u.username);
    expect(s1.noShow).toBe(1);
    expect(s1.attended).toBe(1);

    // スタッフが出席を付けると無断欠席→出席へ
    const mark = await SELF.fetch(
      `${BASE}/api/events/${checked}/members/${u.userId}/attendance`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ attended: true }),
      },
    );
    expect(mark.status).toBe(200);
    const s2 = await stats(u.username);
    expect(s2.noShow).toBe(0);
    expect(s2.attended).toBe(2);
  });

  it("主催（オーナー）とスタッフ参加が終了済みイベントで数えられる", async () => {
    const owner = await makeUser();
    const staff = await makeUser();
    const now = Date.now();
    const ev = await makeEvent(owner.cookie, {
      startsAt: now - 7200_000,
      endsAt: now - 3600_000,
    });
    await env.DB.prepare(
      "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, 'staff', NULL, 'confirmed', 0, ?)",
    )
      .bind(crypto.randomUUID(), ev, staff.userId, Date.now())
      .run();

    const so = await stats(owner.username);
    expect(so.hosted).toBe(1);
    expect(so.staffed).toBe(0); // オーナー自身のstaff行は staffed に含めない

    const ss = await stats(staff.username);
    expect(ss.hosted).toBe(0);
    expect(ss.staffed).toBe(1);

    // スタッフのメンバー行がない作成イベント（古いテストデータ等）は主催に数えない
    await env.DB.prepare(
      "DELETE FROM event_member WHERE event_id = ? AND user_id = ?",
    )
      .bind(ev, owner.userId)
      .run();
    const so2 = await stats(owner.username);
    expect(so2.hosted).toBe(0);
  });
});

describe("登壇回数 (#107)", () => {
  it("終了済み公開イベントのタイムテーブル担当リンクを数える（同一イベント複数コマは1）", async () => {
    const admin = await loginDev();
    const speaker = await makeUser();
    const now = Date.now();
    const ended = await makeEvent(admin, {
      startsAt: now - 7200_000,
      endsAt: now - 3600_000,
    });
    const upcoming = await makeEvent(admin, {
      startsAt: now + 3600_000,
      endsAt: now + 7200_000,
    });
    // 参加メンバーにして担当リンク（終了済みイベントに2コマ、未来イベントに1コマ）
    for (const ev of [ended, upcoming]) {
      await env.DB.prepare(
        "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, 'participant', NULL, 'confirmed', 0, ?)",
      )
        .bind(crypto.randomUUID(), ev, speaker.userId, Date.now())
        .run();
    }
    const addItem = (ev: string, order: number) =>
      env.DB.prepare(
        "INSERT INTO event_schedule_item (id, event_id, title, description, duration_min, starts_at, speaker_user_id, speaker_name, sort_order, created_at) VALUES (?, ?, 'トーク', '', 20, NULL, ?, '', ?, ?)",
      )
        .bind(crypto.randomUUID(), ev, speaker.userId, order, Date.now())
        .run();
    await addItem(ended, 0);
    await addItem(ended, 1);
    await addItem(upcoming, 0);

    const s = await stats(speaker.username);
    expect(s.spoken).toBe(1); // 終了済みの1イベントのみ（複数コマでも1、未来分は数えない）
  });
});
