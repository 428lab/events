import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import type { EventNameCard, Gamification } from "@eventer/shared";

/**
 * 「登壇 N 回」を数える4か所 (#394 / #383 の経路 10〜13)。
 *
 * 0067 は `listPublicSpokenEventIds` に「未割り当ては参加者に見せないので、
 * ここでも数えない」とコメントまで書いて条件を入れたが、**同じことを数えている
 * 他の4か所には入っていなかった**。ネタ出し中のコマの担当に指名されただけの人の
 * 「登壇 N 回」が、公開プロフィールと名刺で1つ増えていた。
 *
 * 裏方 (#383) を足すと、**準備の担当に指名されただけの人の登壇が公開の数字として
 * 増える**。同じ穴なので本 PR でまとめて塞ぐ。条件は
 * `eventSchedule.ts` の `publicItemWhere` 1か所が持つ。
 *
 * **4つを1つのテストにまとめない**。4つとも別の SQL で、
 * 片方だけ直っていた事故が実際に起きているため。
 */

const BASE = "https://example.com";

beforeAll(() => {
  // 何もしない（このファイルは API 越しだけで確かめる）。
  // beforeAll を置いているのは他のテストと形をそろえるため
});

async function insertUser(): Promise<{ userId: string; username: string }> {
  const uid = crypto.randomUUID();
  const username = `sp_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, username, "テスト", Date.now())
    .run();
  return { userId: uid, username };
}

async function addMember(
  eventId: string,
  userId: string,
  role: "staff" | "participant",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, 'confirmed', 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, role, Date.now())
    .run();
}

/** 終了済みの公開イベント。ゲーミフィケーションの「有効イベント」の条件
 * （確定メンバー4人以上）も満たせるよう、あとから人を足す */
async function insertEndedEvent(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, attendance_check, created_by, created_at)
     VALUES (?, ?, ?, ?, 'online', 'published', 0, ?, ?)`,
  )
    .bind(id, `登壇の数え方E2E_${id.slice(0, 6)}`, now - 7200_000, now - 3600_000, ownerId, now)
    .run();
  await addMember(id, ownerId, "staff");
  return id;
}

/** タイムテーブルの1コマを直に入れる。**数え方の SQL そのもの**を見たいので、
 * 保存 API ではなく行を作る（placement / visibility の組み合わせを直接置ける） */
async function addItem(
  eventId: string,
  speakerUserId: string,
  placement: "all" | "unassigned" | "tracks",
  visibility: "public" | "staff",
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO event_schedule_item
       (id, event_id, title, description, duration_min, starts_at,
        speaker_user_id, speaker_name, sort_order, created_at, placement, visibility)
     VALUES (?, ?, 'コマ', '', 20, NULL, ?, '', 0, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      eventId,
      speakerUserId,
      Date.now(),
      placement,
      visibility,
    )
    .run();
}

async function publicProfile(username: string): Promise<{
  participation: { spoken: number };
  gamification: Gamification;
}> {
  const res = await SELF.fetch(`${BASE}/api/public/users/${username}`);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    participation: { spoken: number };
    gamification: Gamification;
  };
}

async function nameCards(
  eventId: string,
  cookie: string,
): Promise<Map<string, EventNameCard>> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/name-cards`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  const { cards } = (await res.json()) as { cards: EventNameCard[] };
  return new Map(cards.map((c) => [c.id, c]));
}

/** 4経路ぶんの題材を1回だけ組む。
 * - 裏方の担当 (staff)
 * - 未割り当ての担当 (unassigned。**いま漏れている側** #394)
 * - 表のコマの担当 (public。数に入る側＝絞りすぎていないことの確認)
 * - 何もリンクされていない対照
 *
 * XP の重みを直に書かず**対照との差**で見る。重みが変わってもこのテストは
 * 「裏方は数えない」だけを見続ける */
async function seed(): Promise<{
  eventId: string;
  cookie: string;
  staffOnly: { userId: string; username: string };
  unassigned: { userId: string; username: string };
  shown: { userId: string; username: string };
  control: { userId: string; username: string };
}> {
  const login = await SELF.fetch(`${BASE}/api/auth/dev-login`, {
    method: "POST",
  });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const me = (await (
    await SELF.fetch(`${BASE}/api/auth/me`, { headers: { cookie } })
  ).json()) as { user: { id: string } };

  const eventId = await insertEndedEvent(me.user.id);
  const staffOnly = await insertUser();
  const unassigned = await insertUser();
  const shown = await insertUser();
  const control = await insertUser();
  for (const u of [staffOnly, unassigned, shown, control]) {
    await addMember(eventId, u.userId, "participant");
  }
  await addItem(eventId, staffOnly.userId, "all", "staff");
  await addItem(eventId, unassigned.userId, "unassigned", "public");
  await addItem(eventId, shown.userId, "all", "public");
  return { eventId, cookie, staffOnly, unassigned, shown, control };
}

describe("登壇 N 回に裏方と未割り当てを数えない (#394)", () => {
  it("経路10: 公開プロフィールの参加実績", async () => {
    const s = await seed();
    expect((await publicProfile(s.staffOnly.username)).participation.spoken).toBe(0);
    expect((await publicProfile(s.unassigned.username)).participation.spoken).toBe(0);
    // 表のコマの担当は従来どおり数える（絞りすぎていないことの確認）
    expect((await publicProfile(s.shown.username)).participation.spoken).toBe(1);
  });

  it("経路11: 名刺のゲーミフィケーション（イベント内の集計）", async () => {
    const s = await seed();
    const cards = await nameCards(s.eventId, s.cookie);
    const control = cards.get(s.control.userId)!.gamification.xp;
    expect(cards.get(s.staffOnly.userId)!.gamification.xp).toBe(control);
    expect(cards.get(s.unassigned.userId)!.gamification.xp).toBe(control);
    expect(cards.get(s.shown.userId)!.gamification.xp).toBeGreaterThan(control);
  });

  it("経路12: 名刺の参加実績（終了済み公開イベント）", async () => {
    const s = await seed();
    const cards = await nameCards(s.eventId, s.cookie);
    expect(cards.get(s.staffOnly.userId)!.participation.spoken).toBe(0);
    expect(cards.get(s.unassigned.userId)!.participation.spoken).toBe(0);
    expect(cards.get(s.shown.userId)!.participation.spoken).toBe(1);
  });

  it("経路13: ゲーミフィケーションの数え上げ", async () => {
    const s = await seed();
    const control = (await publicProfile(s.control.username)).gamification.xp;
    expect((await publicProfile(s.staffOnly.username)).gamification.xp).toBe(
      control,
    );
    expect((await publicProfile(s.unassigned.username)).gamification.xp).toBe(
      control,
    );
    expect(
      (await publicProfile(s.shown.username)).gamification.xp,
    ).toBeGreaterThan(control);
  });
});
