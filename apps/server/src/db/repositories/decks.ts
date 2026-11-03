import type {
  CreateDeckInput,
  Deck,
  DeckContent,
  DeckSummary,
  UpdateDeckInput,
} from "@eventer/shared";
import { many, one, run, runCount } from "../client.js";
import { eventViewSql } from "../../auth/eventAccess.js";
import { adminIds } from "./eventAccessInvites.js";

interface DeckRow {
  id: string;
  slug: string;
  owner_id: string;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
  /** チームのスライドなら結び付いたチーム (0118) */
  team_entry_id: string | null;
  revision: number;
  last_saved_by: string | null;
}

/** そのデッキを編集できるか (docs/team-participation.md「チームのスライド」)。
 * - 個人のデッキ: 持ち主だけ
 * - チームのスライド: そのチームの**いまの**メンバー（チーム参加のコンテストで、イベントを見られる人）。
 *   作った人（owner_id）に特別な権限は無い。抜けたら編集できなくなり、入ったら編集できる
 * 引数は [userId, userId, adminIds()] の順。`d` はデッキ表の別名 */
function deckEditableSql(d: string): string {
  return `((${d}.team_entry_id IS NULL AND ${d}.owner_id = ?)
    OR (${d}.team_entry_id IS NOT NULL AND EXISTS (SELECT 1 FROM entry edit_entry
      JOIN event edit_event ON edit_event.id = edit_entry.event_id
        AND edit_event.contest_mode = 1 AND edit_event.participation_type = 'team'
      JOIN entry_member edit_member ON edit_member.entry_id = edit_entry.id
      JOIN user edit_user ON edit_user.id = edit_member.user_id AND edit_user.deleted_at IS NULL
      WHERE edit_entry.id = ${d}.team_entry_id AND edit_entry.kind = 'team'
        AND edit_member.user_id = ?
        AND ${eventViewSql("edit_event", "edit_user.id", "?")})))`;
}
const editableArgs = (userId: string) => [userId, userId, adminIds()];

interface EditRow extends DeckRow {
  editable: number;
  team_name: string | null;
  team_event_id: string | null;
  saver_name: string | null;
}

/** 編集画面に返す形。チームと最後に保存した人を足す（公開の閲覧では返さない） */
function toEditDeck(row: EditRow): Deck {
  return {
    ...toDeck(row),
    team: row.team_entry_id && row.team_event_id
      ? { entryId: row.team_entry_id, eventId: row.team_event_id, name: row.team_name ?? "" }
      : null,
    lastSavedBy: row.last_saved_by && row.saver_name ? { id: row.last_saved_by, name: row.saver_name } : null,
  };
}

export type DeckEditLookup =
  | { status: "ok"; deck: Deck }
  | { status: "not_found" }
  | { status: "forbidden" };

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
    revision: row.revision,
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

  /** 編集用の取得。編集できない人には中身を返さない */
  async findForEdit(id: string, userId: string): Promise<DeckEditLookup> {
    const row = await one<EditRow>(
      `SELECT d.*, CASE WHEN ${deckEditableSql("d")} THEN 1 ELSE 0 END AS editable,
              en.name AS team_name, en.event_id AS team_event_id,
              COALESCE(saver.global_name, saver.username) AS saver_name
         FROM deck d
         LEFT JOIN entry en ON en.id = d.team_entry_id
         LEFT JOIN user saver ON saver.id = d.last_saved_by AND saver.deleted_at IS NULL
        WHERE d.id = ?`,
      ...editableArgs(userId),
      id,
    );
    if (!row) return { status: "not_found" };
    if (!row.editable) return { status: "forbidden" };
    return { status: "ok", deck: toEditDeck(row) };
  },

  /** 個人のデッキの一覧（チームのスライドは listTeamDecks）。
   * 退会の完全削除で消える＝R2 の画像も消してよいデッキと同じ集合 (purgeDeleted.ts) */
  async listByOwner(ownerId: string): Promise<DeckSummary[]> {
    const rows = await many<DeckRow>(
      "SELECT * FROM deck WHERE owner_id = ? AND team_entry_id IS NULL ORDER BY updated_at DESC",
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

  /** 自分が編集できるチームのスライド（いまメンバーのチームのもの）。一覧の「チーム: ○○」 */
  async listTeamDecks(userId: string): Promise<DeckSummary[]> {
    const rows = await many<DeckRow & { entry_id: string; team_name: string; event_id: string; event_title: string }>(
      `SELECT d.*, en.id AS entry_id, en.name AS team_name, e.id AS event_id, e.title AS event_title
         FROM deck d
         JOIN entry en ON en.id = d.team_entry_id AND en.kind = 'team'
         JOIN event e ON e.id = en.event_id AND e.contest_mode = 1 AND e.participation_type = 'team'
         JOIN entry_member em ON em.entry_id = en.id AND em.user_id = ?
         JOIN user u ON u.id = em.user_id AND u.deleted_at IS NULL
        WHERE ${eventViewSql("e", "u.id", "?")}
        ORDER BY d.updated_at DESC`,
      userId,
      adminIds(),
    );
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      slideCount: parseContent(r.content).slides.length,
      updatedAt: r.updated_at,
      team: { entryId: r.entry_id, name: r.team_name, eventId: r.event_id, eventTitle: r.event_title },
    }));
  },

  /** 編集できる人の保存。`baseRevision` を添えると、その版のときだけ書く（ほかの人の保存を
   * 黙って上書きしない）。判定と書き込みは同じ UPDATE の中 */
  async updateAsEditor(
    id: string,
    userId: string,
    input: UpdateDeckInput,
  ): Promise<{ status: "ok"; deck: Deck } | { status: "not_found" } | { status: "forbidden" } | { status: "conflict"; deck: Deck }> {
    const base = input.baseRevision ?? null;
    const changed = await runCount(
      `UPDATE deck SET title = COALESCE(?, title), content = COALESCE(?, content), updated_at = ?,
              revision = revision + 1, last_saved_by = ?
        WHERE id = ? AND ${deckEditableSql("deck")} AND (? IS NULL OR revision = ?)`,
      input.title ?? null,
      input.content ? JSON.stringify(input.content) : null,
      Date.now(),
      userId,
      id,
      ...editableArgs(userId),
      base,
      base,
    );
    const after = await this.findForEdit(id, userId);
    if (after.status !== "ok") return after;
    return changed ? { status: "ok", deck: after.deck } : { status: "conflict", deck: after.deck };
  },

  /** 個人のデッキを持ち主が消す。チームのスライドはここでは消せない（メンバー1人がチームの作業を消さない） */
  async deletePersonal(id: string, ownerId: string): Promise<boolean> {
    return (await runCount("DELETE FROM deck WHERE id = ? AND owner_id = ? AND team_entry_id IS NULL", id, ownerId)) > 0;
  },

  async delete(id: string): Promise<void> {
    await run("DELETE FROM deck WHERE id = ?", id);
  },
};
