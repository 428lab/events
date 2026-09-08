import { cardDesignAssetIds, cardDesignSchema, type CardDesign, type SavedCardDesign } from "@eventer/shared";
import { batch, many, one, runCount } from "../client.js";

export interface CardAssetRow {
  id: string;
  event_id: string;
  object_key: string;
  content_type: string;
  width: number;
  height: number;
  created_at: number;
}

export const cardDesignsRepo = {
  async get(eventId: string): Promise<SavedCardDesign> {
    const row = await one<{ revision: number; document_json: string }>(
      "SELECT revision, document_json FROM event_card_design WHERE event_id = ?", eventId,
    );
    return row ? { revision: row.revision, design: cardDesignSchema.parse(JSON.parse(row.document_json)) }
      : { revision: 0, design: null };
  },

  /** Conditional write + asset references form one transaction. A request-specific token
   * prevents a losing writer from changing the winning writer's reference rows. */
  async save(eventId: string, revision: number, design: CardDesign): Promise<boolean> {
    const token = crypto.randomUUID();
    const ownedWrite = "EXISTS (SELECT 1 FROM event_card_design WHERE event_id = ? AND write_token = ?)";
    const changes = await batch([
      { sql: `INSERT INTO event_card_design (event_id, revision, document_json, write_token, updated_at)
          SELECT ?, 1, ?, ?, ? WHERE ? = 0 OR EXISTS (SELECT 1 FROM event_card_design WHERE event_id = ?)
          ON CONFLICT(event_id) DO UPDATE SET revision = event_card_design.revision + 1,
            document_json = excluded.document_json, write_token = excluded.write_token,
            updated_at = excluded.updated_at WHERE event_card_design.revision = ?`,
        args: [eventId, JSON.stringify(design), token, Date.now(), revision, eventId, revision] },
      { sql: `DELETE FROM event_card_design_asset WHERE event_id = ? AND ${ownedWrite}`,
        args: [eventId, eventId, token] },
      ...cardDesignAssetIds(design).map(assetId => ({
        sql: `INSERT INTO event_card_design_asset (event_id, asset_id) SELECT ?, ? WHERE ${ownedWrite}`,
        args: [eventId, assetId, eventId, token],
      })),
    ]);
    return changes[0] === 1;
  },

  assets(eventId: string): Promise<CardAssetRow[]> {
    return many<CardAssetRow>("SELECT * FROM event_card_asset WHERE event_id = ? AND ready = 1 ORDER BY created_at, id", eventId);
  },

  async objectKeys(eventId: string): Promise<string[]> {
    const rows = await many<{ object_key: string }>("SELECT object_key FROM event_card_asset WHERE event_id = ?", eventId);
    return rows.map(r => r.object_key);
  },

  asset(eventId: string, id: string): Promise<CardAssetRow | null> {
    return one<CardAssetRow>("SELECT * FROM event_card_asset WHERE event_id = ? AND id = ? AND ready = 1", eventId, id);
  },

  /** Atomic protection against deleting a file in a concurrently saved design. */
  async removeUnusedAsset(eventId: string, id: string): Promise<boolean> {
    return (await runCount(`DELETE FROM event_card_asset WHERE event_id = ? AND id = ?
      AND NOT EXISTS (SELECT 1 FROM event_card_design_asset WHERE event_id = ? AND asset_id = ?)`,
      eventId, id, eventId, id)) === 1;
  },
};
