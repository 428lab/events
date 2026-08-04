import type { VenuePhoto } from "@eventer/shared";
import { many, one, run } from "../client.js";

interface Row {
  id: string;
  venue_id: string;
  user_id: string | null;
  status: string;
  created_at: number;
  user_name?: string | null;
  user_avatar?: string | null;
}

const toPhoto = (r: Row): VenuePhoto => ({
  id: r.id,
  venueId: r.venue_id,
  userId: r.user_id,
  userName: r.user_name ?? null,
  userAvatarUrl: r.user_avatar ?? null,
  status: r.status as VenuePhoto["status"],
  createdAt: r.created_at,
});

const SELECT = `SELECT p.*, u.global_name AS user_name, u.avatar_url AS user_avatar
  FROM venue_photo p LEFT JOIN user u ON u.id = p.user_id
    AND u.deleted_at IS NULL`;
// 退会申請中 (#250) は ON 側で外す。写真自体は残し投稿者名だけ匿名化する
// （完全削除時も venue_photo.user_id は SET NULL で写真は残る）

export const venuePhotosRepo = {
  async findById(id: string): Promise<VenuePhoto | null> {
    const row = await one<Row>(`${SELECT} WHERE p.id = ?`, id);
    return row ? toPhoto(row) : null;
  },

  /** 会場の写真。status 指定でフィルタ（省略で全件=オーナー用） */
  async listByVenue(
    venueId: string,
    status?: "approved" | "pending",
  ): Promise<VenuePhoto[]> {
    const rows = await many<Row>(
      `${SELECT} WHERE p.venue_id = ? ${status ? "AND p.status = ?" : ""}
        ORDER BY p.created_at ASC, p.id ASC`,
      ...(status ? [venueId, status] : [venueId]),
    );
    return rows.map(toPhoto);
  },

  async countByVenue(
    venueId: string,
    status: "approved" | "pending",
  ): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM venue_photo WHERE venue_id = ? AND status = ?",
      venueId,
      status,
    );
    return row?.n ?? 0;
  },

  async create(
    venueId: string,
    userId: string | null,
    status: "approved" | "pending",
  ): Promise<VenuePhoto> {
    const id = crypto.randomUUID();
    await run(
      "INSERT INTO venue_photo (id, venue_id, user_id, status, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      venueId,
      userId,
      status,
      Date.now(),
    );
    return (await this.findById(id))!;
  },

  async setStatus(id: string, status: "approved" | "pending"): Promise<void> {
    await run("UPDATE venue_photo SET status = ? WHERE id = ?", status, id);
  },

  async delete(id: string): Promise<void> {
    await run("DELETE FROM venue_photo WHERE id = ?", id);
  },

  /** その会場で行われた（=承諾済みオファーのある）イベントの確定参加者か */
  async isEventParticipantAtVenue(
    venueId: string,
    userId: string,
  ): Promise<boolean> {
    const row = await one<{ n: number }>(
      `SELECT 1 AS n FROM venue_offer vo
        JOIN event_member em ON em.event_id = vo.event_id
       WHERE vo.venue_id = ? AND vo.status = 'accepted'
         AND vo.event_id IS NOT NULL
         AND em.user_id = ? AND em.status = 'confirmed'
       LIMIT 1`,
      venueId,
      userId,
    );
    return Boolean(row);
  },
};
