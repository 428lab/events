import type {
  CreateVenueInput,
  UpdateVenueInput,
  Venue,
  VenueOwnerView,
} from "@eventer/shared";
import { many, one, run } from "../client.js";

interface VenueRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  area: string;
  address: string;
  address_public: number;
  capacity: number | null;
  equipment: string;
  terms: string;
  contact: string;
  image_updated_at: number | null;
  status: string;
  created_at: number;
  updated_at: number;
}

/** 公開ビュー（非公開住所・連絡先を落とす） */
function toVenue(row: VenueRow): Venue {
  const addressPublic = row.address_public === 1;
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    area: row.area,
    address: addressPublic ? row.address : "",
    addressPublic,
    capacity: row.capacity,
    equipment: row.equipment,
    terms: row.terms,
    status: row.status as Venue["status"],
    imageUpdatedAt: row.image_updated_at,
    createdAt: row.created_at,
  };
}

/** オーナー/マッチング相手向け（連絡先・住所込み） */
function toOwnerView(row: VenueRow): VenueOwnerView {
  return { ...toVenue(row), address: row.address, contact: row.contact };
}

export const venuesRepo = {
  async findById(id: string): Promise<Venue | null> {
    const row = await one<VenueRow>("SELECT * FROM venue WHERE id = ?", id);
    return row ? toVenue(row) : null;
  },

  /** オーナー本人・マッチング成立相手向け（連絡先・非公開住所込み） */
  async findByIdFull(id: string): Promise<VenueOwnerView | null> {
    const row = await one<VenueRow>("SELECT * FROM venue WHERE id = ?", id);
    return row ? toOwnerView(row) : null;
  },

  async ownerId(id: string): Promise<string | null> {
    const row = await one<{ owner_id: string }>(
      "SELECT owner_id FROM venue WHERE id = ?",
      id,
    );
    return row?.owner_id ?? null;
  },

  /** 公開一覧（提供受付中のみ・新着順） */
  async listOpen(limit: number, offset: number): Promise<Venue[]> {
    const rows = await many<VenueRow>(
      "SELECT * FROM venue WHERE status = 'open' ORDER BY created_at DESC LIMIT ? OFFSET ?",
      limit,
      offset,
    );
    return rows.map(toVenue);
  },

  async countOpen(): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM venue WHERE status = 'open'",
    );
    return row?.n ?? 0;
  },

  /** 自分の会場（停止中も含む） */
  async listByOwner(ownerId: string): Promise<VenueOwnerView[]> {
    const rows = await many<VenueRow>(
      "SELECT * FROM venue WHERE owner_id = ? ORDER BY created_at DESC",
      ownerId,
    );
    return rows.map(toOwnerView);
  },

  async create(input: CreateVenueInput, ownerId: string): Promise<VenueOwnerView> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await run(
      `INSERT INTO venue
        (id, owner_id, name, description, area, address, address_public,
         capacity, equipment, terms, contact, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      id,
      ownerId,
      input.name,
      input.description ?? "",
      input.area,
      input.address ?? "",
      input.addressPublic ? 1 : 0,
      input.capacity ?? null,
      input.equipment ?? "",
      input.terms ?? "",
      input.contact ?? "",
      now,
      now,
    );
    return (await this.findByIdFull(id))!;
  },

  async update(
    id: string,
    input: UpdateVenueInput,
  ): Promise<VenueOwnerView | null> {
    const row = await one<VenueRow>("SELECT * FROM venue WHERE id = ?", id);
    if (!row) return null;
    const next = {
      name: input.name ?? row.name,
      description: input.description ?? row.description,
      area: input.area ?? row.area,
      address: input.address ?? row.address,
      addressPublic:
        input.addressPublic != null
          ? input.addressPublic
          : row.address_public === 1,
      capacity: input.capacity !== undefined ? input.capacity : row.capacity,
      equipment: input.equipment ?? row.equipment,
      terms: input.terms ?? row.terms,
      contact: input.contact ?? row.contact,
      status: input.status ?? row.status,
    };
    await run(
      `UPDATE venue SET
         name = ?, description = ?, area = ?, address = ?, address_public = ?,
         capacity = ?, equipment = ?, terms = ?, contact = ?, status = ?, updated_at = ?
       WHERE id = ?`,
      next.name,
      next.description,
      next.area,
      next.address,
      next.addressPublic ? 1 : 0,
      next.capacity,
      next.equipment,
      next.terms,
      next.contact,
      next.status,
      Date.now(),
      id,
    );
    return this.findByIdFull(id);
  },

  async delete(id: string): Promise<void> {
    await run("DELETE FROM venue WHERE id = ?", id);
  },

  async imageUpdatedAt(id: string): Promise<number | null> {
    const row = await one<{ image_updated_at: number | null }>(
      "SELECT image_updated_at FROM venue WHERE id = ?",
      id,
    );
    return row?.image_updated_at ?? null;
  },

  async setImageUpdated(id: string, ts: number): Promise<void> {
    await run("UPDATE venue SET image_updated_at = ? WHERE id = ?", ts, id);
  },
};
