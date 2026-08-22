import { SELF, env } from "cloudflare:test";
import { expect } from "vitest";
import type { EventStaffingPayload, ScheduleItem } from "@eventer/shared";

/**
 * 役割と持ち場 (#384) のテストで共有する土台。
 *
 * `staff-duty.test.ts`（漏れ・担当者が外れる4通り）と
 * `staff-duty-slots.test.ts`（所有チェック・上限・CASCADE）の2本が使う。
 * 各ファイルに写し取ると、イベントの作り方が変わったときに片方だけ直る。
 */

export const BASE = "https://example.com";
export const HOUR = 3600_000;

export interface TestUser {
  userId: string;
  cookie: string;
  username: string;
}

/** アプリ運営管理者ではない一般ユーザー（どのイベントのメンバーでもない） */
export async function makeUser(): Promise<TestUser> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `u_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, username, `担当${username}`, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 24 * HOUR)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}`, username };
}

export type Role = "participant" | "staff" | "judge" | "observer";

export async function makeMember(
  eventId: string,
  role: Role,
  status = "confirmed",
): Promise<TestUser> {
  const u = await makeUser();
  await env.DB.prepare(
    `INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, 0, ?)`,
  )
    .bind(crypto.randomUUID(), eventId, u.userId, role, status, Date.now())
    .run();
  return u;
}

/** 開発用ログイン。**この利用者はアプリ運営管理者**なので、
 * 「そのイベントの staff だから通った」ことの証拠には使えない */
export async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

export async function setupEvent(
  cookie: string,
  startsAt = Date.now() + 24 * HOUR,
): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: `持ち場のE2E_${crypto.randomUUID().slice(0, 6)}`,
      venueType: "offline",
      startsAt,
      endsAt: startsAt + 8 * HOUR,
    }),
  });
  expect(create.status).toBe(201);
  const { event } = (await create.json()) as { event: { id: string } };
  const patch = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ status: "published" }),
  });
  expect(patch.status).toBe(200);
  return event.id;
}

/** タイムテーブルに項目を作る（保存には読んだ時点の版を送り返す #340） */
export async function putTimetable(
  eventId: string,
  cookie: string,
  body: Record<string, unknown>,
): Promise<{ items: ScheduleItem[]; version: number }> {
  const cur = await SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
    headers: { cookie },
  });
  const version = ((await cur.json()) as { version?: number }).version ?? 0;
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/timetable`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ version, ...body }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as { items: ScheduleItem[]; version: number };
}

/** 公開の項目を1つ持つタイムテーブルを作り、その項目の id を返す */
export async function makePublicItem(
  eventId: string,
  cookie: string,
  title = "開会のあいさつ",
): Promise<string> {
  const saved = await putTimetable(eventId, cookie, {
    items: [{ title, durationMin: 30 }],
  });
  return saved.items[0]!.id;
}

export async function getStaffing(
  eventId: string,
  cookie: string,
): Promise<EventStaffingPayload> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/staffing`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as EventStaffingPayload;
}

export async function createDuty(
  eventId: string,
  cookie: string,
  name: string,
): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/staffing/duties`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** その項目の持ち場一式を置く（宣言型の PUT。検証は呼び出し側で） */
export async function putSlots(
  eventId: string,
  cookie: string,
  itemId: string,
  slots: Array<{ dutyId: string; required: number }>,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/staffing/items/${itemId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ slots }),
  });
}

export async function addAssignee(
  eventId: string,
  cookie: string,
  slotId: string,
  userId: string,
): Promise<{ status: number; error: string | null; id: string | null }> {
  const res = await SELF.fetch(
    `${BASE}/api/events/${eventId}/staffing/slots/${slotId}/assignees`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId }),
    },
  );
  const body = (await res.json()) as { error?: string; id?: string };
  return { status: res.status, error: body.error ?? null, id: body.id ?? null };
}

/** 公開セッション1つ＋役割1つ＋持ち場1つ（必要2人）を持つイベント */
export async function setupBoard(name = "受付"): Promise<{
  cookie: string;
  eventId: string;
  itemId: string;
  dutyId: string;
  slotId: string;
}> {
  const cookie = await loginDev();
  const eventId = await setupEvent(cookie);
  const itemId = await makePublicItem(eventId, cookie);
  const dutyId = await createDuty(eventId, cookie, name);
  const put = await putSlots(eventId, cookie, itemId, [{ dutyId, required: 2 }]);
  expect(put.status).toBe(200);
  const seen = await getStaffing(eventId, cookie);
  return { cookie, eventId, itemId, dutyId, slotId: seen.slots[0]!.id };
}
