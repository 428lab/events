import {
  AI_CREATE_EVENT_LIMIT_PER_HOUR,
  AI_EVENT_DESCRIPTION_MAX,
  isDatetimeOrderInvalid,
  isoToEpochMs,
} from "@eventer/shared";
import type {
  AiCreateEventInput,
  AiListMyEventsInput,
  AiSearchEventsInput,
  Event,
  MyEventSummary,
  User,
} from "@eventer/shared";
import { env } from "../../runtime.js";
import { canViewEvent } from "../../auth/eventAccess.js";
import { eventsRepo } from "../../db/repositories/events.js";
import { eventMembersRepo } from "../../db/repositories/eventMembers.js";
import { participationSlotsRepo } from "../../db/repositories/participationSlots.js";
import { communitiesRepo } from "../../db/repositories/communities.js";
import { eventWarikanRepo } from "../../db/repositories/eventWarikan.js";
import { createEventFor } from "../eventCrud.js";
import { splitMyEvents } from "../me.js";
import { warikanViewerFor } from "../eventWarikan.js";

/**
 * AI 向け API `/api/ai/v1` (#581) のハンドラ本体。設計は docs/ai-integration.md §5。
 *
 * REST（routes/ai/index.ts）と MCP ツール（PR3）が同じ関数を呼ぶ。入力は検証済み
 * （REST は zValidator、MCP は inputSchema）で受け、Hono の Context には触らない。
 *
 * 権限の判定は書き直さず、既存の関数（canViewEvent・LEDGER_AUDIENCE_SQL・
 * canAttachCommunity・公開検索の条件）を呼ぶだけ（§4.5）。
 * 応答は AI が読みやすい平坦な JSON（ID・名前・ISO 日時・URL）。
 * 説明文（本文）を返すのは get_event だけで、4,000 字で切る（§6.4）。
 */

export type AiResult<T> =
  | { ok: true; status?: 200 | 201; data: T }
  | { ok: false; status: 400 | 403 | 404 | 409 | 429; error: string };

const ok = <T>(data: T, status?: 201): AiResult<T> => ({ ok: true, status, data });
const fail = (status: 400 | 403 | 404 | 409 | 429, error: string): AiResult<never> => ({
  ok: false,
  status,
  error,
});

/** epoch ms → ISO 8601（UTC）。未定（0 以下）と null は null */
function iso(ms: number | null | undefined): string | null {
  return ms && ms > 0 ? new Date(ms).toISOString() : null;
}

function eventUrls(e: Pick<Event, "id" | "slug">) {
  return {
    view: `${env.appBaseUrl}/events/${e.id}`,
    short: `${env.appBaseUrl}/e/${e.slug}`,
  };
}

/** 一覧用の要約。説明文（本文）は載せない（§6.4） */
function eventSummary(e: Event) {
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    subtitle: e.subtitle,
    status: e.status,
    visibility: e.visibility,
    startsAt: iso(e.startsAt),
    endsAt: iso(e.endsAt),
    scheduling: e.scheduling,
    venueType: e.venueType,
    venueOffline: e.venueOffline,
    venueOnline: e.venueOnline,
    communityId: e.communityId,
    participantCount: e.participantCount,
    capacityTotal: e.capacityTotal,
    urls: eventUrls(e),
  };
}

function myEventSummary(e: MyEventSummary) {
  return {
    ...eventSummary(e),
    myRole: e.myRole,
    myStatus: e.myStatus,
    attended: e.attended,
  };
}

/** whoami: 接続しているアカウント */
export async function whoami(user: User) {
  return ok({
    id: user.id,
    username: user.username,
    displayName: user.globalName ?? user.username,
    profileUrl: `${env.appBaseUrl}/users/${encodeURIComponent(user.username)}`,
  });
}

/** list_my_events: GET /api/me/events と同じ分岐（下書きも含む・本人が見られるものだけ）。
 * limit 件まで（§4.6）。upcoming は開催日が近い順で日程調整中（日付なし）は末尾、past は新しい順 */
export async function listMyEvents(user: User, input: AiListMyEventsInput) {
  const all = await eventMembersRepo.listEventsForUser(user.id);
  const { ongoing, past } = splitMyEvents(all, Date.now());
  const events =
    input.phase === "past"
      ? [...past].sort((a, b) => b.startsAt - a.startsAt)
      : [...ongoing].sort(
          (a, b) => Number(a.scheduling) - Number(b.scheduling) || a.startsAt - b.startsAt,
        );
  return ok({
    phase: input.phase,
    events: events.slice(0, input.limit).map(myEventSummary),
    total: events.length,
    truncated: events.length > input.limit,
  });
}

/** search_events: 公開検索（public.ts の searchEvents）と同じ条件。公開・公開中のものだけ */
export async function searchEvents(_user: User, input: AiSearchEventsInput) {
  const opts = {
    q: input.q?.trim() || undefined,
    from: input.from ? (isoToEpochMs(input.from) ?? undefined) : undefined,
    to: input.to ? (isoToEpochMs(input.to) ?? undefined) : undefined,
    phase: input.phase,
    sort: "soon",
    limit: input.limit,
    offset: 0,
  } as const;
  const total = await eventsRepo.countSearchPublished(opts);
  const events = await eventsRepo.searchPublished(opts);
  return ok({
    events: events.map(eventSummary),
    total,
    limit: input.limit,
    hasMore: events.length < total,
  });
}

/** get_event: 詳細 + 参加枠 + 自分の参加状態。canViewEvent を通す。見えなければ 404 */
export async function getEvent(user: User, idOrSlug: string) {
  const event =
    (await eventsRepo.findById(idOrSlug)) ?? (await eventsRepo.findBySlug(idOrSlug));
  if (!event || !(await canViewEvent(event, user))) return fail(404, "not_found");
  const member = await eventMembersRepo.find(event.id, user.id);
  const slots = await participationSlotsRepo.listByEvent(event.id);
  const community = event.communityId
    ? await communitiesRepo.findById(event.communityId)
    : null;
  const chars = [...event.description];
  const truncated = chars.length > AI_EVENT_DESCRIPTION_MAX;
  return ok({
    event: {
      ...eventSummary(event),
      description: truncated
        ? chars.slice(0, AI_EVENT_DESCRIPTION_MAX).join("")
        : event.description,
      descriptionTruncated: truncated,
      scheduleAnonymous: event.scheduleAnonymous,
      registrationDeadline: iso(event.registrationDeadline),
    },
    slots: slots.map((s) => ({
      id: s.id,
      name: s.name,
      capacity: s.capacity,
      selectionType: s.selectionType,
      drawAt: iso(s.drawAt),
      confirmedCount: s.confirmedCount,
      waitlistCount: s.waitlistCount,
      appliedCount: s.appliedCount,
    })),
    myRole: member?.role ?? null,
    myStatus: member?.status ?? null,
    community: community
      ? { id: community.id, slug: community.slug, name: community.name }
      : null,
  });
}

/** get_warikan: 帳簿と精算行。イベントの閲覧権と帳簿の audience（LEDGER_AUDIENCE_SQL）の
 * どちらかが無ければ 404。自分が from/to の精算行に mine: true */
export async function getWarikan(user: User, eventId: string) {
  const event = await eventsRepo.findById(eventId);
  if (!event || !(await canViewEvent(event, user))) return fail(404, "not_found");
  const viewer = await warikanViewerFor(event.id, user.id);
  if (!viewer) return fail(404, "not_found");
  const ledger = await eventWarikanRepo.ledger(event.id, viewer);
  return ok({
    ...ledger,
    settlements: ledger.settlements.map((s) => ({
      ...s,
      mine: s.fromUserId === user.id || s.toUserId === user.id,
    })),
  });
}

/** list_my_communities: GET /api/communities/mine と同じ（owner/admin のみ）。
 * create_event の communityId の候補。説明文は載せない（§6.4） */
export async function listMyCommunities(user: User) {
  const communities = await communitiesRepo.listOwnedByUser(user.id);
  return ok({
    communities: communities.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      url: `${env.appBaseUrl}/c/${c.slug}`,
    })),
  });
}

/**
 * create_event: 下書きを作る（§5.3）。画面の POST /api/events と同じ本体（createEventFor）を通す。
 * 常に draft（eventsRepo.create が固定）・created_via='ai'・1時間10件まで。
 * スコープ（write）の確認は呼び出し側（REST は requireScope、MCP も同じ）で行う
 */
export async function createEvent(user: User, input: AiCreateEventInput) {
  const startsAt = input.startsAt ? isoToEpochMs(input.startsAt) : 0;
  const endsAt = input.endsAt ? isoToEpochMs(input.endsAt) : 0;
  if (startsAt === null || endsAt === null) return fail(400, "invalid_date");
  // 日程調整にしないなら日時は必須。終了は開始以降（作成入力と同じく同時刻は許す）
  if (!input.scheduling && !(startsAt > 0 && endsAt > 0)) return fail(400, "invalid_date");
  if (isDatetimeOrderInvalid(startsAt, endsAt)) return fail(400, "invalid_date");

  const since = Date.now() - 60 * 60 * 1000;
  if ((await eventsRepo.countCreatedVia(user.id, "ai", since)) >= AI_CREATE_EVENT_LIMIT_PER_HOUR) {
    return fail(429, "ai_create_rate_limited");
  }

  const result = await createEventFor(
    user,
    {
      title: input.title,
      subtitle: input.subtitle ?? "",
      description: input.description ?? "",
      startsAt,
      endsAt,
      venueType: input.venueType,
      venueOffline: input.venueOffline ?? null,
      venueOnline: input.venueOnline ?? null,
      visibility: input.visibility,
      communityId: input.communityId ?? null,
      scheduling: input.scheduling,
      scheduleAnonymous: input.scheduleAnonymous,
      contestMode: input.contestMode,
      aggregateSelfEntry: input.aggregateSelfEntry,
      venueWanted: input.venueWanted,
    },
    "ai",
  );
  if (!result.ok) return fail(result.status, result.error);
  const e = result.event;
  return ok(
    {
      event: {
        id: e.id,
        slug: e.slug,
        title: e.title,
        status: e.status,
        visibility: e.visibility,
        startsAt: iso(e.startsAt),
        endsAt: iso(e.endsAt),
        scheduling: e.scheduling,
      },
      urls: {
        view: `${env.appBaseUrl}/events/${e.id}`,
        edit: `${env.appBaseUrl}/events/${e.id}/edit`,
        short: `${env.appBaseUrl}/e/${e.slug}`,
      },
      next: "下書きです。edit を開いて内容を確認し、公開ボタンを押してください",
    },
    201,
  );
}
