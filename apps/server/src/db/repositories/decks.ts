import type {
  CreateDeckInput,
  Deck,
  DeckContent,
  DeckSummary,
  UpdateDeckInput,
} from "@eventer/shared";
import { many, one, run } from "../client.js";

interface DeckRow {
  id: string;
  slug: string;
  owner_id: string;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
}

function parseContent(json: string): DeckContent {
  try {
    const v = JSON.parse(json);
    return v && Array.isArray(v.slides) ? v : { slides: [] };
  } catch {
    return { slides: [] };
  }
}

function toDeck(row: DeckRow): Deck {
  return {
    id: row.id,
    slug: row.slug,
    ownerId: row.owner_id,
    title: row.title,
    content: parseContent(row.content),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function genSlug(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

export const decksRepo = {
  async findById(id: string): Promise<Deck | null> {
    const row = await one<DeckRow>("SELECT * FROM deck WHERE id = ?", id);
    return row ? toDeck(row) : null;
  },

  async findBySlug(slug: string): Promise<Deck | null> {
    const row = await one<DeckRow>("SELECT * FROM deck WHERE slug = ?", slug);
    return row ? toDeck(row) : null;
  },

  async listByOwner(ownerId: string): Promise<DeckSummary[]> {
    const rows = await many<DeckRow>(
      "SELECT * FROM deck WHERE owner_id = ? ORDER BY updated_at DESC",
      ownerId,
    );
    return rows.map((r) => {
      const c = parseContent(r.content);
      return {
        id: r.id,
        slug: r.slug,
        title: r.title,
        slideCount: c.slides.length,
        updatedAt: r.updated_at,
      };
    });
  },

  async create(input: CreateDeckInput, ownerId: string): Promise<Deck> {
    const id = crypto.randomUUID();
    let slug = genSlug();
    while (await this.findBySlug(slug)) slug = genSlug();
    const now = Date.now();
    const content: DeckContent = {
      slides: [{ id: crypto.randomUUID(), background: "#ffffff", elements: [] }],
    };
    await run(
      `INSERT INTO deck (id, slug, owner_id, title, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      slug,
      ownerId,
      input.title ?? "",
      JSON.stringify(content),
      now,
      now,
    );
    return (await this.findById(id))!;
  },

  async update(id: string, input: UpdateDeckInput): Promise<Deck | null> {
    const current = await this.findById(id);
    if (!current) return null;
    await run(
      "UPDATE deck SET title = ?, content = ?, updated_at = ? WHERE id = ?",
      input.title ?? current.title,
      JSON.stringify(input.content ?? current.content),
      Date.now(),
      id,
    );
    return this.findById(id);
  },

  async delete(id: string): Promise<void> {
    await run("DELETE FROM deck WHERE id = ?", id);
  },
};
