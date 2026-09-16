import {eventViewSql} from "../../auth/eventAccess.js";
import {adminIds} from "./eventAccessInvites.js";
import { many, one, runCount } from "../client.js";

export interface VenueOfferRow {
  id: string;
  venue_id: string;
  event_id: string | null;
  request_id: string | null;
  direction: string; // venue_to_event / event_to_venue
  status: string; // pending / accepted / declined
  organizer_contact: string;
  created_by: string;
  created_at: number;
  responded_at: number | null;
}

export interface VenueOffer {
  id: string;
  venueId: string;
  eventId: string | null;
  requestId: string | null;
  direction: "venue_to_event" | "event_to_venue";
  status: "pending" | "accepted" | "declined";
  organizerContact: string;
  createdBy: string;
  createdAt: number;
  respondedAt: number | null;
}

function toOffer(r: VenueOfferRow): VenueOffer {
  return {
    id: r.id,
    venueId: r.venue_id,
    eventId: r.event_id,
    requestId: r.request_id,
    direction: r.direction as VenueOffer["direction"],
    status: r.status as VenueOffer["status"],
    organizerContact: r.organizer_contact,
    createdBy: r.created_by,
    createdAt: r.created_at,
    respondedAt: r.responded_at,
  };
}

const venueManager = `(v.owner_id=u.id OR EXISTS(SELECT 1 FROM venue_admin va WHERE va.venue_id=v.id AND va.user_id=u.id))`;
const appAdmin = `u.discord_id IN(SELECT value FROM json_each(?1))`;
const organizer = `COALESCE((${appAdmin} OR e.created_by=u.id OR EXISTS(SELECT 1 FROM event_member m WHERE m.event_id=e.id AND m.user_id=u.id AND m.role='staff' AND m.status<>'canceled') OR r.created_by=u.id),0)`;
const currentParties = `FROM user u JOIN venue v ON v.id=o.venue_id
  LEFT JOIN event e ON e.id=o.event_id LEFT JOIN event_request r ON r.id=o.request_id
  WHERE u.id=?2 AND u.deleted_at IS NULL AND (o.event_id IS NULL OR ${eventViewSql("e","u.id","?1")})`;

export const venueOffersRepo = {
  async findById(id: string): Promise<VenueOffer | null> {
    const row = await one<VenueOfferRow>(
      "SELECT * FROM venue_offer WHERE id = ?",
      id,
    );
    return row ? toOffer(row) : null;
  },

  /** 同一の会場×対象で pending/accepted が既にあるか（重複オファー防止） */
  async findActive(
    venueId: string,
    eventId: string | null,
    requestId: string | null,
  ): Promise<VenueOffer | null> {
    const row = await one<VenueOfferRow>(
      `SELECT * FROM venue_offer
        WHERE venue_id = ? AND status IN ('pending','accepted')
          AND ${eventId ? "event_id = ?" : "request_id = ?"}`,
      venueId,
      (eventId ?? requestId)!,
    );
    return row ? toOffer(row) : null;
  },

  /** 同一ペア×同一オファー者の直近 declined 時刻（クールダウン判定用）。
   * 辞退した側が逆方向に申し込むケースはブロックしない */
  async lastDeclinedAt(
    venueId: string,
    eventId: string | null,
    requestId: string | null,
    createdBy: string,
  ): Promise<number | null> {
    const row = await one<{ t: number | null }>(
      `SELECT MAX(responded_at) AS t FROM venue_offer
        WHERE venue_id = ? AND status = 'declined' AND created_by = ?
          AND ${eventId ? "event_id = ?" : "request_id = ?"}`,
      venueId,
      createdBy,
      (eventId ?? requestId)!,
    );
    return row?.t ?? null;
  },

  async create(offer: {
    venueId: string;
    eventId: string | null;
    requestId: string | null;
    direction: VenueOffer["direction"];
    organizerContact: string;
    createdBy: string;
  }): Promise<VenueOffer | null> {
    const id = crypto.randomUUID();
    const changed=await runCount(`WITH o AS(SELECT ?3 venue_id,?4 event_id,?5 request_id,?6 direction)
      INSERT INTO venue_offer(id,venue_id,event_id,request_id,direction,status,organizer_contact,created_by,created_at)
      SELECT ?7,venue_id,event_id,request_id,direction,'pending',?8,?2,?9 FROM o WHERE EXISTS(
        SELECT 1 ${currentParties} AND EXISTS(SELECT 1 FROM user owner WHERE owner.id=v.owner_id AND owner.deleted_at IS NULL)
        AND ((o.event_id IS NOT NULL AND e.status='published') OR (o.event_id IS NULL AND r.status='open' AND r.members_only=0))
        AND CASE WHEN direction='venue_to_event' THEN ${venueManager} AND NOT ${organizer} AND v.status='open' AND COALESCE(e.venue_wanted,r.venue_wanted)=1
          ELSE ${organizer} AND NOT ${venueManager} END)`,
      adminIds(),offer.createdBy,offer.venueId,offer.eventId,offer.requestId,offer.direction,id,offer.organizerContact,Date.now());
    if (!changed) return null;

    return (await this.findById(id))!;
  },

  async respond(id:string,status:"accepted"|"declined",organizerContact:string|undefined,actorId:string):Promise<boolean> {
    return (await runCount(`UPDATE venue_offer AS o SET status=?3,responded_at=?4,organizer_contact=COALESCE(?5,organizer_contact)
      WHERE o.id=?6 AND o.status='pending' AND EXISTS(SELECT 1 ${currentParties}
        AND CASE WHEN o.direction='venue_to_event' THEN ${organizer} ELSE (${venueManager} OR ${appAdmin}) END
        AND (?3<>'accepted' OR (EXISTS(SELECT 1 FROM user sender WHERE sender.id=o.created_by AND sender.deleted_at IS NULL)
          AND EXISTS(SELECT 1 FROM user owner WHERE owner.id=v.owner_id AND owner.deleted_at IS NULL))))`,
      adminIds(),actorId,status,Date.now(),organizerContact??null,id)) > 0;
  },

  /** 会場側のオファー一覧（その会場に届いた/送った） */
  async listByVenue(venueId: string): Promise<VenueOffer[]> {
    const rows = await many<VenueOfferRow>(
      "SELECT * FROM venue_offer WHERE venue_id = ? ORDER BY created_at DESC",
      venueId,
    );
    return rows.map(toOffer);
  },

  async listByEvent(eventId: string): Promise<VenueOffer[]> {
    const rows = await many<VenueOfferRow>(
      "SELECT * FROM venue_offer WHERE event_id = ? ORDER BY created_at DESC",
      eventId,
    );
    return rows.map(toOffer);
  },

  async listByRequest(requestId: string): Promise<VenueOffer[]> {
    const rows = await many<VenueOfferRow>(
      "SELECT * FROM venue_offer WHERE request_id = ? ORDER BY created_at DESC",
      requestId,
    );
    return rows.map(toOffer);
  },
};
