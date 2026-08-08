import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

/** 公開プロフィールが返す参加履歴（年表 #308 の元データ）の絞り込みと公開範囲。
 * 年表は「参加が確定した公開イベント」だけを、新しい順で見せる。 */

const BASE = "https://example.com";

async function makeUser(): Promise<{
  userId: string;
  username: string;
  cookie: string;
}> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `tl_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, username, "年表テスト", Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, username, cookie: `eventer_session=${sid}` };
}

/** イベントを作る。publish=false なら下書きのまま残す */
async function makeEvent(
  cookie: string,
  opts: {
    startsAt: number;
    endsAt: number;
    attendanceCheck?: boolean;
    publish?: boolean;
    title?: string;
  },
): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: opts.title ?? `年表E2E_${crypto.randomUUID().slice(0, 6)}`,
      venueType: "online",
      startsAt: opts.startsAt,
      endsAt: opts.endsAt,
    }),
  });
  expect(create.status).toBe(201);
  const { event } = (await create.json()) as { event: { id: string } };
  if (opts.publish === false) return event.id;
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

/** 参加者としてメンバー行を直に入れる（過去イベントは join API を通せないため） */
async function addMember(
  eventId: string,
  userId: string,
  opts: { role?: string; attended?: boolean; status?: string } = {},
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      eventId,
      userId,
      opts.role ?? "participant",
      opts.status ?? "confirmed",
      opts.attended ? 1 : 0,
      Date.now(),
    )
    .run();
}

interface ProfileBody {
  id: string;
  events: {
    id: string;
    title: string;
    startsAt: number;
    myRole: string;
    status: string;
  }[];
  speakerEventIds: string[];
}

/** 未ログインで公開プロフィールを取る（cookie を渡せば閲覧者ありで取る） */
async function profile(username: string, cookie?: string): Promise<ProfileBody> {
  const res = await SELF.fetch(`${BASE}/api/public/users/${username}`, {
    headers: cookie ? { cookie } : {},
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ProfileBody;
}

describe("参加履歴の年表 (#308)", () => {
  it("参加が確定した公開イベントが新しい順に並ぶ", async () => {
    const owner = await makeUser();
    const u = await makeUser();
    const now = Date.now();

    const old = await makeEvent(owner.cookie, {
      startsAt: now - 400 * 86400_000,
      endsAt: now - 400 * 86400_000 + 3600_000,
    });
    const recent = await makeEvent(owner.cookie, {
      startsAt: now - 10 * 86400_000,
      endsAt: now - 10 * 86400_000 + 3600_000,
    });
    const future = await makeEvent(owner.cookie, {
      startsAt: now + 30 * 86400_000,
      endsAt: now + 30 * 86400_000 + 3600_000,
    });
    for (const ev of [old, recent, future]) await addMember(ev, u.userId);

    const body = await profile(u.username);
    expect(body.events.map((e) => e.id)).toEqual([future, recent, old]);
  });

  it("出席チェックを使う終了済みイベントで出席記録が無い回は出ない", async () => {
    const owner = await makeUser();
    const u = await makeUser();
    const now = Date.now();

    const noShow = await makeEvent(owner.cookie, {
      startsAt: now - 7200_000,
      endsAt: now - 3600_000,
      attendanceCheck: true,
    });
    const attended = await makeEvent(owner.cookie, {
      startsAt: now - 7200_000,
      endsAt: now - 3600_000,
      attendanceCheck: true,
    });
    await addMember(noShow, u.userId, { attended: false });
    await addMember(attended, u.userId, { attended: true });

    const ids = (await profile(u.username)).events.map((e) => e.id);
    expect(ids).toContain(attended);
    expect(ids).not.toContain(noShow);
  });

  it("出席チェックを使うイベントでも、これから開催される回は参加予定として出る", async () => {
    const owner = await makeUser();
    const u = await makeUser();
    const now = Date.now();

    // まだ開催前なので「出席記録が無い＝行っていない」とは言えない
    const upcoming = await makeEvent(owner.cookie, {
      startsAt: now + 7 * 86400_000,
      endsAt: now + 7 * 86400_000 + 3600_000,
      attendanceCheck: true,
    });
    await addMember(upcoming, u.userId, { attended: false });

    const ids = (await profile(u.username)).events.map((e) => e.id);
    expect(ids).toContain(upcoming);
  });

  it("下書きイベントと取消済みの参加は混ざらない", async () => {
    const owner = await makeUser();
    const u = await makeUser();
    const now = Date.now();

    const draft = await makeEvent(owner.cookie, {
      startsAt: now + 86400_000,
      endsAt: now + 86400_000 + 3600_000,
      publish: false,
    });
    const canceled = await makeEvent(owner.cookie, {
      startsAt: now + 2 * 86400_000,
      endsAt: now + 2 * 86400_000 + 3600_000,
    });
    const kept = await makeEvent(owner.cookie, {
      startsAt: now + 3 * 86400_000,
      endsAt: now + 3 * 86400_000 + 3600_000,
    });
    await addMember(draft, u.userId);
    await addMember(canceled, u.userId, { status: "canceled" });
    await addMember(kept, u.userId);

    const ids = (await profile(u.username)).events.map((e) => e.id);
    expect(ids).toEqual([kept]);
  });

  it("未ログインでも他人のページで参加履歴が見える", async () => {
    const owner = await makeUser();
    const u = await makeUser();
    const other = await makeUser();
    const now = Date.now();
    const ev = await makeEvent(owner.cookie, {
      startsAt: now - 86400_000,
      endsAt: now - 86400_000 + 3600_000,
    });
    await addMember(ev, u.userId);

    // 未ログイン / 別のログインユーザー / 本人 のどれでも同じ内容が見える
    const anon = await profile(u.username);
    const viewer = await profile(u.username, other.cookie);
    const self = await profile(u.username, u.cookie);
    for (const body of [anon, viewer, self]) {
      expect(body.events.map((e) => e.id)).toEqual([ev]);
    }
  });

  it("登壇したイベントだけが speakerEventIds に入り、下書きは入らない", async () => {
    const owner = await makeUser();
    const u = await makeUser();
    const now = Date.now();

    const spoke = await makeEvent(owner.cookie, {
      startsAt: now - 86400_000,
      endsAt: now - 86400_000 + 3600_000,
    });
    const justJoined = await makeEvent(owner.cookie, {
      startsAt: now - 2 * 86400_000,
      endsAt: now - 2 * 86400_000 + 3600_000,
    });
    const draft = await makeEvent(owner.cookie, {
      startsAt: now - 3 * 86400_000,
      endsAt: now - 3 * 86400_000 + 3600_000,
      publish: false,
    });
    await addMember(spoke, u.userId);
    await addMember(justJoined, u.userId);
    for (const ev of [spoke, draft]) {
      await env.DB.prepare(
        "INSERT INTO event_schedule_item (id, event_id, title, description, duration_min, starts_at, speaker_user_id, speaker_name, material_url, sort_order, created_at) VALUES (?, ?, 'LT', '', 10, NULL, ?, '', '', 0, ?)",
      )
        .bind(crypto.randomUUID(), ev, u.userId, Date.now())
        .run();
    }

    const body = await profile(u.username);
    expect(body.speakerEventIds).toEqual([spoke]);
    expect(body.events.map((e) => e.id)).toContain(justJoined);
  });

  it("スタッフ・審査員は出席チェックの有無に関わらず残る", async () => {
    const owner = await makeUser();
    const staff = await makeUser();
    const judge = await makeUser();
    const now = Date.now();
    const ev = await makeEvent(owner.cookie, {
      startsAt: now - 7200_000,
      endsAt: now - 3600_000,
      attendanceCheck: true,
    });
    await addMember(ev, staff.userId, { role: "staff" });
    await addMember(ev, judge.userId, { role: "judge" });

    const s = await profile(staff.username);
    const j = await profile(judge.username);
    expect(s.events.map((e) => e.id)).toEqual([ev]);
    expect(s.events[0].myRole).toBe("staff");
    expect(j.events.map((e) => e.id)).toEqual([ev]);
    expect(j.events[0].myRole).toBe("judge");
  });
});
