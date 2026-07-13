import type {
  CreateLiveSetInput,
  LiveSet,
  LiveSetContent,
  LiveSetSummary,
  UpdateLiveSetInput,
} from "@eventer/shared";
import { defaultLiveSetContent } from "@eventer/shared";
import { many, one, run } from "../client.js";

interface LiveSetRow {
  id: string;
  owner_id: string;
  community_id: string | null;
  name: string;
  content: string;
  created_at: number;
  updated_at: number;
}

function parseContent(json: string): LiveSetContent {
  try {
    const v = JSON.parse(json);
    return v && Array.isArray(v.scenes) ? v : { scenes: [] };
  } catch {
    return { scenes: [] };
  }
}

function toLiveSet(row: LiveSetRow): LiveSet {
  return {
    id: row.id,
    ownerId: row.owner_id,
    communityId: row.community_id,
    name: row.name,
    content: parseContent(row.content),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const liveSetsRepo = {
  async findById(id: string): Promise<LiveSet | null> {
    const row = await one<LiveSetRow>("SELECT * FROM live_set WHERE id = ?", id);
    return row ? toLiveSet(row) : null;
  },

  async listByOwner(ownerId: string): Promise<LiveSetSummary[]> {
    const rows = await many<LiveSetRow>(
      "SELECT * FROM live_set WHERE owner_id = ? ORDER BY updated_at DESC",
      ownerId,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sceneCount: parseContent(r.content).scenes.length,
      updatedAt: r.updated_at,
    }));
  },

  /** 新規作成。デフォルトテンプレのシーン一式を入れる */
  async create(input: CreateLiveSetInput, ownerId: string): Promise<LiveSet> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await run(
      `INSERT INTO live_set (id, owner_id, community_id, name, content, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
      id,
      ownerId,
      input.name || "配信セット",
      JSON.stringify(defaultLiveSetContent()),
      now,
      now,
    );
    return (await this.findById(id))!;
  },

  async update(id: string, input: UpdateLiveSetInput): Promise<LiveSet | null> {
    const current = await this.findById(id);
    if (!current) return null;
    await run(
      "UPDATE live_set SET name = ?, content = ?, community_id = ?, updated_at = ? WHERE id = ?",
      input.name ?? current.name,
      JSON.stringify(input.content ?? current.content),
      input.communityId !== undefined ? input.communityId : current.communityId,
      Date.now(),
      id,
    );
    return this.findById(id);
  },

  async delete(id: string): Promise<void> {
    await run("DELETE FROM live_set WHERE id = ?", id);
  },
};
