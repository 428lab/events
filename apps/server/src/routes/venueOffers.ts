import { Hono } from "hono";
import {
  createVenueOfferInput,
  respondVenueOfferInput,
  type CreateVenueOfferInput,
  type RespondVenueOfferInput,
} from "@eventer/shared";
import type { User } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";
import { valid, zValidator } from "../lib/validator.js";
import { venuesRepo } from "../db/repositories/venues.js";
import { venueOffersRepo, type VenueOffer } from "../db/repositories/venueOffers.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventRequestsRepo } from "../db/repositories/eventRequests.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { notificationsRepo } from "../db/repositories/notifications.js";

/** 会場オファー (#53 PR2)。自由メッセージなしの定型アクション。
 * 連絡先は承諾成立後にのみ相互開示する */

export const venueOfferRoutes = new Hono<AppEnv>();
venueOfferRoutes.use("*", requireAuth);

/** イベントの主催者権限（staff or 作成者 or admin） */
async function isOrganizerOfEvent(
  eventId: string,
  user: User,
): Promise<boolean> {
  if (isAppAdmin(user)) return true;
  const event = await eventsRepo.findById(eventId);
  if (!event) return false;
  if (event.createdBy === user.id) return true;
  const member = await eventMembersRepo.find(eventId, user.id);
  return member?.role === "staff";
}

/** オファー対象（イベント/たまご）の主催者側ユーザーID（通知先） */
async function organizerUserId(offer: {
  eventId: string | null;
  requestId: string | null;
}): Promise<string | null> {
  if (offer.eventId) {
    return (await eventsRepo.findById(offer.eventId))?.createdBy ?? null;
  }
  if (offer.requestId) {
    return (await eventRequestsRepo.findById(offer.requestId))?.createdBy ?? null;
  }
  return null;
}

/** オファー作成（双方向）。
 * 会場オーナー → 会場募集中のイベント/たまごへ「提供できます」
 * 主催者 → 受付中の会場へ「使いたい」 */
venueOfferRoutes.post("/", zValidator("json", createVenueOfferInput), async (c) => {
  const input = valid<CreateVenueOfferInput>(c, "json");
  const user = c.get("user");

  const venue = await venuesRepo.findById(input.venueId);
  if (!venue) return c.json({ error: "venue_not_found" }, 404);

  // 対象（イベント or たまご）の確認
  let targetTitle = "";
  let venueWanted = false;
  if (input.eventId) {
    const event = await eventsRepo.findById(input.eventId);
    if (!event || event.status !== "published") {
      return c.json({ error: "event_not_found" }, 404);
    }
    targetTitle = event.title;
    venueWanted = event.venueWanted;
  } else {
    const req = await eventRequestsRepo.findById(input.requestId!);
    // メンバー限定たまごはオファー対象外（会場オーナーに存在を漏らさない）
    if (!req || req.status !== "open" || req.membersOnly) {
      return c.json({ error: "request_not_found" }, 404);
    }
    targetTitle = req.title;
    venueWanted = req.venueWanted;
  }

  const isVenueOwner = venue.ownerId === user.id;
  const isOrganizer = input.eventId
    ? await isOrganizerOfEvent(input.eventId, user)
    : (await eventRequestsRepo.findById(input.requestId!))?.createdBy === user.id;

  if (isVenueOwner && isOrganizer) {
    return c.json({ error: "self_match" }, 400);
  }

  let direction: VenueOffer["direction"];
  if (isVenueOwner) {
    // 会場側からの提供オファーは「会場探しています」の相手にのみ
    if (!venueWanted) return c.json({ error: "not_wanted" }, 409);
    direction = "venue_to_event";
  } else if (isOrganizer) {
    if (venue.status !== "open") return c.json({ error: "venue_closed" }, 409);
    direction = "event_to_venue";
  } else {
    return c.json({ error: "forbidden" }, 403);
  }

  // 同一ペアの重複オファー防止
  if (
    await venueOffersRepo.findActive(
      input.venueId,
      input.eventId ?? null,
      input.requestId ?? null,
    )
  ) {
    return c.json({ error: "already_offered" }, 409);
  }

  const offer = await venueOffersRepo.create({
    venueId: input.venueId,
    eventId: input.eventId ?? null,
    requestId: input.requestId ?? null,
    direction,
    organizerContact: direction === "event_to_venue" ? (input.contact ?? "") : "",
    createdBy: user.id,
  });

  // 受け手へ通知
  const link = input.eventId
    ? `/events/${input.eventId}`
    : `/requests/${input.requestId}`;
  if (direction === "venue_to_event") {
    const to = await organizerUserId(offer);
    if (to && to !== user.id) {
      await notificationsRepo.create(
        to,
        "venue_offer",
        "会場の提供オファーが届きました🏟️",
        `「${targetTitle}」に会場「${venue.name}」の提供オファー`,
        link,
      );
    }
  } else if (venue.ownerId !== user.id) {
    await notificationsRepo.create(
      venue.ownerId,
      "venue_offer",
      "会場の利用オファーが届きました🏟️",
      `「${targetTitle}」の主催者が会場「${venue.name}」を使いたいそうです`,
      `/venues/${venue.id}`,
    );
  }
  return c.json({ offer }, 201);
});

/** 受け手だけが承諾/辞退できる */
venueOfferRoutes.post(
  "/:id/respond",
  zValidator("json", respondVenueOfferInput),
  async (c) => {
    const offer = await venueOffersRepo.findById(c.req.param("id"));
    if (!offer) return c.json({ error: "not_found" }, 404);
    if (offer.status !== "pending") return c.json({ error: "already_responded" }, 409);
    const user = c.get("user");
    const venueOwnerId = await venuesRepo.ownerId(offer.venueId);

    // 受け手 = オファー方向の反対側
    const isReceiver =
      offer.direction === "venue_to_event"
        ? offer.eventId
          ? await isOrganizerOfEvent(offer.eventId, user)
          : (await eventRequestsRepo.findById(offer.requestId!))?.createdBy === user.id
        : venueOwnerId === user.id || isAppAdmin(user);
    if (!isReceiver) return c.json({ error: "forbidden" }, 403);

    const input = valid<RespondVenueOfferInput>(c, "json");
    const accepted = input.action === "accept";
    // 主催者が承諾する側（venue_to_event）なら連絡先を添えられる
    await venueOffersRepo.respond(
      offer.id,
      accepted ? "accepted" : "declined",
      offer.direction === "venue_to_event" ? (input.contact ?? "") : undefined,
    );

    // オファーした側へ結果通知
    const venue = await venuesRepo.findById(offer.venueId);
    if (offer.createdBy !== user.id) {
      await notificationsRepo.create(
        offer.createdBy,
        "venue_offer_result",
        accepted
          ? "会場オファーが承諾されました🎉"
          : "会場オファーは見送られました",
        venue ? `会場「${venue.name}」のオファー` : "",
        accepted
          ? offer.eventId
            ? `/events/${offer.eventId}`
            : `/requests/${offer.requestId}`
          : "",
      );
    }
    return c.json({ ok: true, status: accepted ? "accepted" : "declined" });
  },
);

/** オファーの充実化（相手方の情報＋成立時のみ連絡先） */
async function enrich(offer: VenueOffer, forVenueSide: boolean) {
  const venue = await venuesRepo.findById(offer.venueId);
  const event = offer.eventId ? await eventsRepo.findById(offer.eventId) : null;
  const request = offer.requestId
    ? await eventRequestsRepo.findById(offer.requestId)
    : null;
  const accepted = offer.status === "accepted";
  return {
    ...offer,
    // 主催者側の連絡先は成立後・会場側にのみ
    organizerContact: forVenueSide && accepted ? offer.organizerContact : "",
    venue: venue ? { id: venue.id, name: venue.name, area: venue.area } : null,
    event: event ? { id: event.id, title: event.title } : null,
    request: request ? { id: request.id, title: request.title } : null,
    // 会場の連絡先・住所は成立後・主催者側にのみ
    venueContact:
      !forVenueSide && accepted
        ? ((await venuesRepo.findByIdFull(offer.venueId))?.contact ?? "")
        : "",
    venueAddress:
      !forVenueSide && accepted
        ? ((await venuesRepo.findByIdFull(offer.venueId))?.address ?? "")
        : "",
  };
}

/** 会場に関するオファー一覧（会場オーナーのみ） */
venueOfferRoutes.get("/for-venue/:venueId", async (c) => {
  const venueId = c.req.param("venueId");
  const ownerId = await venuesRepo.ownerId(venueId);
  if (!ownerId) return c.json({ error: "not_found" }, 404);
  const user = c.get("user");
  if (ownerId !== user.id && !isAppAdmin(user)) {
    return c.json({ error: "forbidden" }, 403);
  }
  const offers = await venueOffersRepo.listByVenue(venueId);
  return c.json({
    offers: await Promise.all(offers.map((o) => enrich(o, true))),
  });
});

/** イベントに関するオファー一覧（主催者のみ） */
venueOfferRoutes.get("/for-event/:eventId", async (c) => {
  const eventId = c.req.param("eventId");
  if (!(await isOrganizerOfEvent(eventId, c.get("user")))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const offers = await venueOffersRepo.listByEvent(eventId);
  return c.json({
    offers: await Promise.all(offers.map((o) => enrich(o, false))),
  });
});

/** たまごに関するオファー一覧（投稿者のみ） */
venueOfferRoutes.get("/for-request/:requestId", async (c) => {
  const req = await eventRequestsRepo.findById(c.req.param("requestId"));
  if (!req) return c.json({ error: "not_found" }, 404);
  const user = c.get("user");
  if (req.createdBy !== user.id && !isAppAdmin(user)) {
    return c.json({ error: "forbidden" }, 403);
  }
  const offers = await venueOffersRepo.listByRequest(req.id);
  return c.json({
    offers: await Promise.all(offers.map((o) => enrich(o, false))),
  });
});
