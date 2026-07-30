import { many, one, run } from "../client.js";

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
  }): Promise<VenueOffer> {
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO venue_offer
        (id, venue_id, event_id, request_id, direction, status, organizer_contact, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      id,
      offer.venueId,
      offer.eventId,
      offer.requestId,
      offer.direction,
      offer.organizerContact,
      offer.createdBy,
      Date.now(),
    );
    return (await this.findById(id))!;
  },

  async respond(
    id: string,
    status: "accepted" | "declined",
    organizerContact?: string,
  ): Promise<void> {
    if (organizerContact != null) {
      await run(
        "UPDATE venue_offer SET status = ?, responded_at = ?, organizer_contact = ? WHERE id = ?",
        status,
        Date.now(),
        organizerContact,
        id,
      );
    } else {
      await run(
        "UPDATE venue_offer SET status = ?, responded_at = ? WHERE id = ?",
        status,
        Date.now(),
        id,
      );
    }
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
