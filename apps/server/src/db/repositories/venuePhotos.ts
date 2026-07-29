import type { VenuePhoto } from "@eventer/shared";
import { many, one, run } from "../client.js";

interface Row {
  id: string;
  venue_id: string;
  created_at: number;
}

const toPhoto = (r: Row): VenuePhoto => ({
  id: r.id,
  venueId: r.venue_id,
  createdAt: r.created_at,
});

export const venuePhotosRepo = {
  async findById(id: string): Promise<VenuePhoto | null> {
    const row = await one<Row>("SELECT * FROM venue_photo WHERE id = ?", id);
    return row ? toPhoto(row) : null;
  },

  async listByVenue(venueId: string): Promise<VenuePhoto[]> {
    const rows = await many<Row>(
      "SELECT * FROM venue_photo WHERE venue_id = ? ORDER BY created_at ASC",
      venueId,
    );
    return rows.map(toPhoto);
  },

  async countByVenue(venueId: string): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM venue_photo WHERE venue_id = ?",
      venueId,
    );
    return row?.n ?? 0;
  },

  async create(venueId: string): Promise<VenuePhoto> {
    const id = crypto.randomUUID();
    await run(
      "INSERT INTO venue_photo (id, venue_id, created_at) VALUES (?, ?, ?)",
      id,
      venueId,
      Date.now(),
    );
    return (await this.findById(id))!;
  },

  async delete(id: string): Promise<void> {
    await run("DELETE FROM venue_photo WHERE id = ?", id);
  },
};
