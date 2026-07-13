import type { BgmTrack } from "@eventer/shared";
import { many, one, run } from "../client.js";

interface Row {
  id: string;
  owner_id: string | null;
  name: string;
  credit_text: string;
  r2_key: string;
  created_at: number;
}

function toTrack(row: Row): BgmTrack {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    creditText: row.credit_text,
    createdAt: row.created_at,
  };
}

export const bgmTracksRepo = {
  async findById(id: string): Promise<(BgmTrack & { r2Key: string }) | null> {
    const row = await one<Row>("SELECT * FROM bgm_track WHERE id = ?", id);
    return row ? { ...toTrack(row), r2Key: row.r2_key } : null;
  },

  /** ビルトイン（owner NULL）＋自分の曲 */
  async listForUser(userId: string): Promise<BgmTrack[]> {
    const rows = await many<Row>(
      `SELECT * FROM bgm_track WHERE owner_id IS NULL OR owner_id = ?
       ORDER BY owner_id IS NULL DESC, created_at DESC`,
      userId,
    );
    return rows.map(toTrack);
  },

  async create(
    ownerId: string | null,
    name: string,
    creditText: string,
    r2Key: string,
  ): Promise<BgmTrack> {
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO bgm_track (id, owner_id, name, credit_text, r2_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      ownerId,
      name,
      creditText,
      r2Key,
      Date.now(),
    );
    return (await this.findById(id))!;
  },

  async delete(id: string): Promise<void> {
    await run("DELETE FROM bgm_track WHERE id = ?", id);
  },
};
