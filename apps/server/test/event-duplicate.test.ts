import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type {
  AwardRank,
  EventStaffingPayload,
  EventTodosPayload,
  Event,
  EventMemberWithUser,
  ParticipationSlot,
  ScoringCriterion,
  SpecialAward,
} from "@eventer/shared";

const BASE = "https://example.com";

/** dev-login（DevUser=staff/管理者）してセッションcookieを返す */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** 非adminのユーザーを1人作る（メンバーにはしない）。 */
async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, `u_${uid.slice(0, 6)}`, "テスト", Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

/** 非adminのメンバーを1人作る（status を指定可） */
async function makeMember(
  eventId: string,
  role: "participant" | "staff" | "judge" | "observer",
  status = "confirmed",
): Promise<{ userId: string; cookie: string }> {
  const u = await makeUser();
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, ?, 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, u.userId, role, status, Date.now())
    .run();
  return u;
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** 複製元イベントを一式（設定・枠・採点基準・表彰・コメント・メンバー）作る */
async function setupSourceEvent(cookie: string): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "複製元イベント",
      subtitle: "副題テスト",
      description: "説明文です",
      venueType: "hybrid",
      venueOffline: "会場A",
      venueOnline: "https://example.com/meet",
      startsAt: 1700000000000,
      endsAt: 1700003600000,
      contestMode: true,
      venueWanted: true,
      scheduleAnonymous: true,
    }),
  });
  expect(create.status).toBe(201);
  const { event } = await json<{ event: Event }>(create);

  const patch = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      status: "published",
      membersNote: "参加者限定メモ: https://example.com/discord",
      photosPublic: true,
      attendanceCheck: true,
      // 出会いランキング (#418) の設定もコピーされること
      meetRanking: "anonymous",
    }),
  });
  expect(patch.status).toBe(200);

  // 参加枠
  const slot = await SELF.fetch(`${BASE}/api/events/${event.id}/slots`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name: "一般枠",
      capacity: 10,
      selectionType: "lottery",
    }),
  });
  expect(slot.status).toBe(201);

  // カスタム採点基準（デフォルト4件に追加して5件になる）
  const criterion = await SELF.fetch(`${BASE}/api/events/${event.id}/criteria`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: "デザイン", description: "見た目", maxLevel: 5 }),
  });
  expect(criterion.status).toBe(201);

  // 表彰の定義
  const rank = await SELF.fetch(`${BASE}/api/events/${event.id}/award-ranks`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: "最優秀賞", content: "賞金あり" }),
  });
  expect(rank.status).toBe(201);
  const special = await SELF.fetch(
    `${BASE}/api/events/${event.id}/special-awards`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "オーディエンス賞", content: null }),
    },
  );
  expect(special.status).toBe(201);

  return event.id;
}

describe("イベントの複製 (#7)", () => {
  it("staff が複製すると設定・枠・採点基準・表彰の定義がコピーされ、メンバー・コメントはコピーされない", async () => {
    const admin = await loginDev();
    const srcId = await setupSourceEvent(admin);

    // 複製されないもの: 参加者メンバーとコメント
    const member = await makeMember(srcId, "participant");
    const comment = await SELF.fetch(`${BASE}/api/events/${srcId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: member.cookie },
      body: JSON.stringify({ body: "元イベントのコメント" }),
    });
    expect(comment.status).toBe(201);

    const dup = await SELF.fetch(`${BASE}/api/events/${srcId}/duplicate`, {
      method: "POST",
      headers: { cookie: admin },
    });
    expect(dup.status).toBe(201);
    const { event } = await json<{ event: Event }>(dup);

    // 下書き・タイトル「のコピー」・設定コピー・日時リセット・日程調整オン
    expect(event.status).toBe("draft");
    expect(event.title).toBe("複製元イベントのコピー");
    expect(event.subtitle).toBe("副題テスト");
    expect(event.description).toBe("説明文です");
    expect(event.venueType).toBe("hybrid");
    expect(event.venueOffline).toBe("会場A");
    expect(event.venueOnline).toBe("https://example.com/meet");
    expect(event.contestMode).toBe(true);
    expect(event.venueWanted).toBe(true);
    expect(event.scheduleAnonymous).toBe(true);
    expect(event.photosPublic).toBe(true);
    expect(event.attendanceCheck).toBe(true);
    expect(event.meetRanking).toBe("anonymous");
    expect(event.startsAt).toBe(0);
    expect(event.endsAt).toBe(0);
    expect(event.scheduling).toBe(true);
    expect(event.id).not.toBe(srcId);
    // slug は新規生成される
    const src = await json<{ event: Event }>(
      await SELF.fetch(`${BASE}/api/events/${srcId}`, {
        headers: { cookie: admin },
      }),
    );
    expect(event.slug).not.toBe(src.event.slug);

    // 参加枠の定義がコピーされる（人数カウントは0）
    const slots = await json<{ slots: ParticipationSlot[] }>(
      await SELF.fetch(`${BASE}/api/events/${event.id}/slots`, {
        headers: { cookie: admin },
      }),
    );
    expect(slots.slots).toHaveLength(1);
    expect(slots.slots[0].name).toBe("一般枠");
    expect(slots.slots[0].capacity).toBe(10);
    expect(slots.slots[0].selectionType).toBe("lottery");
    expect(slots.slots[0].confirmedCount).toBe(0);
    expect(slots.slots[0].appliedCount).toBe(0);

    // 採点基準がコピーされる（デフォルト4件＋カスタム1件、順序も維持）
    const criteria = await json<{ criteria: ScoringCriterion[] }>(
      await SELF.fetch(`${BASE}/api/events/${event.id}/criteria`, {
        headers: { cookie: admin },
      }),
    );
    expect(criteria.criteria.map((c) => c.name)).toEqual([
      "技術力",
      "独自性",
      "完成度",
      "プレゼン",
      "デザイン",
    ]);
    const design = criteria.criteria[4];
    expect(design.description).toBe("見た目");
    expect(design.maxLevel).toBe(5);

    // 表彰の定義がコピーされ、受賞結果は空
    const awards = await json<{
      ranks: AwardRank[];
      specials: SpecialAward[];
      results: unknown[];
    }>(
      await SELF.fetch(`${BASE}/api/events/${event.id}/awards`, {
        headers: { cookie: admin },
      }),
    );
    expect(awards.ranks).toHaveLength(1);
    expect(awards.ranks[0].name).toBe("最優秀賞");
    expect(awards.ranks[0].content).toBe("賞金あり");
    expect(awards.specials).toHaveLength(1);
    expect(awards.specials[0].name).toBe("オーディエンス賞");
    expect(awards.results).toHaveLength(0);

    // メンバーは複製実行者(staff)のみ。元の参加者はコピーされない
    const members = await json<{ members: EventMemberWithUser[] }>(
      await SELF.fetch(`${BASE}/api/events/${event.id}/members`, {
        headers: { cookie: admin },
      }),
    );
    expect(members.members).toHaveLength(1);
    expect(members.members[0].role).toBe("staff");
    expect(members.members[0].userId).not.toBe(member.userId);

    // コメントはコピーされない（下書きなので staff で閲覧）
    const comments = await json<{ comments: unknown[] }>(
      await SELF.fetch(`${BASE}/api/events/${event.id}/comments`, {
        headers: { cookie: admin },
      }),
    );
    expect(comments.comments).toHaveLength(0);
  });

  it("非staff（参加者・非メンバー・未ログイン）は複製できない", async () => {
    const admin = await loginDev();
    const srcId = await setupSourceEvent(admin);

    const participant = await makeMember(srcId, "participant");
    const asParticipant = await SELF.fetch(
      `${BASE}/api/events/${srcId}/duplicate`,
      { method: "POST", headers: { cookie: participant.cookie } },
    );
    expect(asParticipant.status).toBe(403);

    const outsider = await makeUser();
    const asOutsider = await SELF.fetch(
      `${BASE}/api/events/${srcId}/duplicate`,
      { method: "POST", headers: { cookie: outsider.cookie } },
    );
    expect(asOutsider.status).toBe(403);

    const anon = await SELF.fetch(`${BASE}/api/events/${srcId}/duplicate`, {
      method: "POST",
    });
    expect([401, 403]).toContain(anon.status);
  });

  it("members_note もコピーされ、複製後の GET で staff に見える", async () => {
    const admin = await loginDev();
    const srcId = await setupSourceEvent(admin);

    const dup = await SELF.fetch(`${BASE}/api/events/${srcId}/duplicate`, {
      method: "POST",
      headers: { cookie: admin },
    });
    expect(dup.status).toBe(201);
    const { event } = await json<{ event: Event }>(dup);

    const got = await json<{ event: Event; membersNote?: string }>(
      await SELF.fetch(`${BASE}/api/events/${event.id}`, {
        headers: { cookie: admin },
      }),
    );
    expect(got.membersNote).toBe("参加者限定メモ: https://example.com/discord");
    // 公開スキーマの event には漏れない
    expect("membersNote" in got.event).toBe(false);
    expect("members_note" in got.event).toBe(false);
  });
});

/* ===== 準備 TODO の複製 (#393 9.6) ===== */

describe("複製で準備 TODO を持ち越す (#393 7.)", () => {
  /** 題名・補足・依存の辺・並び順はコピーする。
   * **日付・担当・状態はコピーしない**（複製は開催日時を 0 に戻すので、
   * 期限を持ち越すと「作った瞬間に全部が遅れになった段取り」ができる。
   * 募集締切と抽選日時をコピーしないのとまったく同じ理由） */
  it("題名と依存はコピーされ、日付・担当・完了はコピーされない", async () => {
    const cookie = await loginDev();
    const src = await setupSourceEvent(cookie);
    const staff = await makeMember(src, "staff");

    const mk = async (body: Record<string, unknown>): Promise<string> => {
      const res = await SELF.fetch(`${BASE}/api/events/${src}/todos`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      });
      expect(res.status, await res.clone().text()).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    const venue = await mk({
      title: "会場を押さえる",
      note: "電話は◯◯さん",
      startsOn: "2026-09-01",
      dueOn: "2026-09-05",
      assigneeUserId: staff.userId,
    });
    const notice = await mk({ title: "告知を出す", dueOn: "2026-09-10" });
    // 「告知を出す」は「会場を押さえる」を待つ
    const dep = await SELF.fetch(
      `${BASE}/api/events/${src}/todos/${notice}/deps`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ dependsOnId: venue }),
      },
    );
    expect(dep.status).toBe(201);
    // 複製元では1件を完了にしておく
    const done = await SELF.fetch(`${BASE}/api/events/${src}/todos/${venue}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ status: "done" }),
    });
    expect(done.status).toBe(200);

    const dup = await SELF.fetch(`${BASE}/api/events/${src}/duplicate`, {
      method: "POST",
      headers: { cookie },
    });
    expect(dup.status).toBe(201);
    const copyId = ((await dup.json()) as { event: { id: string } }).event.id;

    const get = async (eventId: string): Promise<EventTodosPayload> => {
      const res = await SELF.fetch(`${BASE}/api/events/${eventId}/todos`, {
        headers: { cookie },
      });
      expect(res.status).toBe(200);
      return (await res.json()) as EventTodosPayload;
    };
    const copied = await get(copyId);

    expect(copied.todos.map((t) => t.title)).toEqual([
      "会場を押さえる",
      "告知を出す",
    ]);
    expect(copied.todos[0]!.note).toBe("電話は◯◯さん");
    for (const t of copied.todos) {
      expect(t.startsOn).toBeNull();
      expect(t.dueOn).toBeNull();
      expect(t.status).toBe("open");
      expect(t.doneAt).toBeNull();
      expect(t.assigneeState).toBe("unassigned");
      expect(t.assignee).toBeNull();
    }

    // **辺は複製先の id を指す**（複製元の id を指していない）
    const newIds = copied.todos.map((t) => t.id);
    expect(copied.deps).toHaveLength(1);
    expect(newIds).toContain(copied.deps[0]!.todoId);
    expect(newIds).toContain(copied.deps[0]!.dependsOnId);
    expect([venue, notice]).not.toContain(copied.deps[0]!.todoId);
    expect([venue, notice]).not.toContain(copied.deps[0]!.dependsOnId);
    const byId = new Map(copied.todos.map((t) => [t.id, t.title]));
    expect(byId.get(copied.deps[0]!.todoId)).toBe("告知を出す");
    expect(byId.get(copied.deps[0]!.dependsOnId)).toBe("会場を押さえる");

    // 複製元は変わっていない
    const origin = await get(src);
    expect(origin.todos.find((t) => t.id === venue)!.status).toBe("done");
    expect(origin.todos.find((t) => t.id === venue)!.dueOn).toBe("2026-09-05");
    expect(origin.todos.find((t) => t.id === venue)!.assignee!.id).toBe(
      staff.userId,
    );
  });
});

describe("複製でスタッフの役割の定義を持ち越す (#384 7.)", () => {
  /** コピーするのは役割の**名前と並び順だけ**。
   * 持ち場（時間帯×役割×人数）と割り当てはコピー**できない**: 複製は
   * タイムテーブルをコピーしないので、ぶら下げる先の項目が複製先に無い */
  it("役割の名前と並び順はコピーされ、持ち場と割り当てはコピーされない", async () => {
    const cookie = await loginDev();
    const src = await setupSourceEvent(cookie);
    const staff = await makeMember(src, "staff");

    // 役割を2つ（並び順つき）
    const mkDuty = async (name: string): Promise<string> => {
      const res = await SELF.fetch(`${BASE}/api/events/${src}/staffing/duties`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name }),
      });
      expect(res.status, await res.clone().text()).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    const reception = await mkDuty("受付");
    await mkDuty("配信");

    // 複製元にはタイムテーブルの項目＋持ち場＋割り当ても作っておく
    // （これらが**コピーされない**ことを見るため）
    const cur = await SELF.fetch(`${BASE}/api/events/${src}/timetable`, {
      headers: { cookie },
    });
    const version = ((await cur.json()) as { version?: number }).version ?? 0;
    const tt = await SELF.fetch(`${BASE}/api/events/${src}/timetable`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        version,
        items: [{ title: "開会", durationMin: 30 }],
      }),
    });
    expect(tt.status).toBe(200);
    const itemId = ((await tt.json()) as { items: Array<{ id: string }> })
      .items[0]!.id;
    const put = await SELF.fetch(
      `${BASE}/api/events/${src}/staffing/items/${itemId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ slots: [{ dutyId: reception, required: 2 }] }),
      },
    );
    expect(put.status).toBe(200);
    const getStaffing = async (eventId: string): Promise<EventStaffingPayload> => {
      const res = await SELF.fetch(`${BASE}/api/events/${eventId}/staffing`, {
        headers: { cookie },
      });
      expect(res.status).toBe(200);
      return (await res.json()) as EventStaffingPayload;
    };
    const before = await getStaffing(src);
    const assign = await SELF.fetch(
      `${BASE}/api/events/${src}/staffing/slots/${before.slots[0]!.id}/assignees`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ userId: staff.userId }),
      },
    );
    expect(assign.status).toBe(201);

    const dup = await SELF.fetch(`${BASE}/api/events/${src}/duplicate`, {
      method: "POST",
      headers: { cookie },
    });
    expect(dup.status).toBe(201);
    const copyId = ((await dup.json()) as { event: { id: string } }).event.id;

    const copied = await getStaffing(copyId);
    // 名前と並び順はそのまま。id は新しく振り直される
    expect(copied.duties.map((d) => d.name)).toEqual(["受付", "配信"]);
    expect(copied.duties.map((d) => d.id)).not.toContain(reception);
    // 持ち場・割り当ては無い（タイムテーブルをコピーしないため、置く先が無い）
    expect(copied.slots).toEqual([]);

    // 複製元は変わっていない
    const origin = await getStaffing(src);
    expect(origin.duties.map((d) => d.name)).toEqual(["受付", "配信"]);
    expect(origin.slots).toHaveLength(1);
    expect(origin.slots[0]!.assignees).toHaveLength(1);
  });
});

describe("日程調整中イベントの直接日時確定 (#138)", () => {
  it("PATCH scheduling:false で調整終了＋日時確定。日時なしは 400", async () => {
    const login = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        title: "直接確定E2E",
        venueType: "online",
        scheduling: true,
        startsAt: 0,
        endsAt: 0,
      }),
    });
    const { event } = (await create.json()) as { event: { id: string } };

    // 日時なしで scheduling:false → 400
    const bad = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ scheduling: false }),
    });
    expect(bad.status).toBe(400);

    // 日時つき → 調整終了・日時反映
    const now = Date.now();
    const ok = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        scheduling: false,
        startsAt: now + 3600_000,
        endsAt: now + 7200_000,
      }),
    });
    expect(ok.status).toBe(200);
    const got = (await (
      await SELF.fetch(`${BASE}/api/events/${event.id}`, { headers: { cookie } })
    ).json()) as { event: { scheduling: boolean; startsAt: number } };
    expect(got.event.scheduling).toBe(false);
    expect(got.event.startsAt).toBe(now + 3600_000);
  });
});
