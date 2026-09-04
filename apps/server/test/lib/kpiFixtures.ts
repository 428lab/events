import { SELF, env } from "cloudflare:test";
import { expect } from "vitest";
import type { CommunityKpiPayload, KpiPayload } from "@eventer/shared";

/**
 * KPI のテストが共有する土台（#266）。
 *
 * `kpi-trends.test.ts`（前期間比と時系列）と `kpi-shared-metrics.test.ts`
 * （全体KPIとコミュニティKPIで共通の数え方）が使う。各ファイルに写し取ると、
 * 「本番と同じ形でデータを作る」約束——たとえばイベント作成時に作成者の staff
 * メンバー行を必ず作ること——が片方だけ古くなり、そのファイルだけ
 * 「主催しただけの人が参加者に数えられる」類のバグを検出できなくなる。
 */

export const BASE = "https://example.com";
export const DAY = 86400000;

/** JST の 'YYYY-MM-DD'（サーバーの jd() と同じ基準） */
export function jstDay(at: number): string {
  return new Date(at + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** N日前の JST 日付。日次系列・user_active_day の day 列と同じ基準 */
export function dayAgo(n: number): string {
  return jstDay(Date.now() - n * DAY);
}

export async function makeUser(
  opts: { admin?: boolean; createdAt?: number } = {},
): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at, deleted_at) VALUES (?, ?, ?, NULL, NULL, ?, NULL)",
  )
    .bind(
      uid,
      opts.admin ? "dev-user" : `t:${uid}`,
      `u_${uid.slice(0, 8)}`,
      opts.createdAt ?? Date.now(),
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + DAY)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

export async function makeCommunity(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO community (id, slug, name, description, owner_id, created_at) VALUES (?, ?, ?, '', ?, ?)",
  )
    .bind(id, `c-${id.slice(0, 8)}`, `community_${id.slice(0, 4)}`, ownerId, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
  )
    .bind(crypto.randomUUID(), id, ownerId, Date.now())
    .run();
  return id;
}

/** イベントを1件作る（作成者の staff 行つき＝本番と同じ形） */
export async function makeEvent(opts: {
  createdBy: string;
  endsAt: number;
  communityId?: string;
  createdAt?: number;
}): Promise<string> {
  const id = crypto.randomUUID();
  const createdAt = opts.createdAt ?? opts.endsAt;
  await env.DB.prepare(
    `INSERT INTO event (id, title, description, starts_at, ends_at, venue_type,
       status, created_by, created_at, attendance_check, scheduling, community_id)
     VALUES (?, ?, '', ?, ?, 'online', 'published', ?, ?, 0, 0, ?)`,
  )
    .bind(
      id,
      `e_${id.slice(0, 8)}`,
      opts.endsAt - 3600000,
      opts.endsAt,
      opts.createdBy,
      createdAt,
      opts.communityId ?? null,
    )
    .run();
  await join({ eventId: id, userId: opts.createdBy, role: "staff", createdAt });
  return id;
}

export async function join(opts: {
  eventId: string;
  userId: string;
  role?: string;
  status?: string;
  createdAt?: number;
  canceledAt?: number;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO event_member (id, event_id, user_id, role, created_at, status,
       attended, canceled_at, canceled_scheduling)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0)`,
  )
    .bind(
      crypto.randomUUID(),
      opts.eventId,
      opts.userId,
      opts.role ?? "participant",
      opts.createdAt ?? Date.now(),
      opts.status ?? "confirmed",
      opts.canceledAt ?? null,
    )
    .run();
}

/** 閲覧UU（visitor cookie で日次重複排除された1行） */
export async function addUniqueView(
  eventId: string,
  day: string,
  visitorId: string,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_view_unique (event_id, day, visitor_id) VALUES (?, ?, ?)",
  )
    .bind(eventId, day, visitorId)
    .run();
}

/** 表示回数（流入元ごとの日次集計） */
export async function addViewStat(
  eventId: string,
  day: string,
  source: string,
  views: number,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_view_stat (event_id, day, source, country, views) VALUES (?, ?, ?, 'XX', ?)",
  )
    .bind(eventId, day, source, views)
    .run();
}

export async function addAudit(action: string, at: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO audit_log (id, action, actor_user_id, actor_handle, target_user_id, target_handle, detail, created_at) VALUES (?, ?, NULL, '', NULL, '', '', ?)",
  )
    .bind(crypto.randomUUID(), action, at)
    .run();
}

export async function makeVenue(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO venue (id, owner_id, name, created_at, updated_at) VALUES (?, ?, 'v', ?, ?)",
  )
    .bind(id, ownerId, Date.now(), Date.now())
    .run();
  return id;
}

export async function makeOffer(
  venueId: string,
  createdBy: string,
  createdAt: number,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO venue_offer (id, venue_id, event_id, direction, status, created_by, created_at) VALUES (?, ?, NULL, 'venue_to_event', 'pending', ?, ?)",
  )
    .bind(crypto.randomUUID(), venueId, createdBy, createdAt)
    .run();
}

/** たまご（イベントのリクエスト） */
export async function makeEgg(createdBy: string, createdAt: number): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO event_request (id, title, description, status, created_by, created_at) VALUES (?, ?, '', 'open', ?, ?)",
  )
    .bind(id, `egg_${id.slice(0, 6)}`, createdBy, createdAt)
    .run();
  return id;
}

export async function reactEgg(
  requestId: string,
  userId: string,
  kind: "attend" | "host",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_request_reaction (request_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(requestId, userId, kind, Date.now())
    .run();
}

export async function markActive(day: string, userId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO user_active_day (day, user_id) VALUES (?, ?)",
  )
    .bind(day, userId)
    .run();
}

export async function getKpi(cookie: string, days?: number): Promise<KpiPayload> {
  const res = await SELF.fetch(
    `${BASE}/api/admin/kpi${days ? `?days=${days}` : ""}`,
    { headers: { cookie } },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as KpiPayload;
}

export async function getCommunityKpi(
  communityId: string,
  cookie: string,
  days?: number,
): Promise<CommunityKpiPayload> {
  const res = await SELF.fetch(
    `${BASE}/api/communities/${communityId}/kpi${days ? `?days=${days}` : ""}`,
    { headers: { cookie } },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as CommunityKpiPayload;
}
