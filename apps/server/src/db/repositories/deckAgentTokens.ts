import { batch, many, one, runCount } from "../client.js";
import { ACTIVE } from "./users.js";
import { deckEditableSql, editableArgs } from "./decks.js";

/** docs/agent-deck-token.md. Only the SHA-256 of a token is stored. */
export const DECK_AGENT_TOKEN_TTL_MS = 60 * 60 * 1000;
export const DECK_AGENT_TOKEN_DAILY_ISSUES = 20;
export const DECK_AGENT_TOKEN_MAX_WRITES = 100;
export const DECK_AGENT_TOKEN_MAX_IMAGES = 50;

export interface DeckAgentTokenRow {
  id: string;
  owner_id: string;
  deck_id: string | null;
  /** チームのスライドに結び付いたトークン（発行の時点で決まる）。個人のトークンは null */
  team_deck_id: string | null;
  write_count: number;
  image_count: number;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

/** A token row joined with its deck as the owner sees it in the issuing screen. */
export interface DeckAgentTokenListRow extends DeckAgentTokenRow {
  deck_slug: string | null;
  deck_title: string | null;
}

export const deckAgentTokensRepo = {
  /** Inserts only while the owner has issued fewer than the daily cap in the last 24h. */
  async issue(input: { id: string; ownerId: string; tokenHash: string; now: number }): Promise<boolean> {
    const { id, ownerId, tokenHash, now } = input;
    const changes = await runCount(
      `INSERT INTO deck_agent_token (id, owner_id, token_hash, created_at, expires_at)
       SELECT ?, ?, ?, ?, ? WHERE
       (SELECT COUNT(*) FROM deck_agent_token WHERE owner_id = ? AND created_at > ?) < ?`,
      id, ownerId, tokenHash, now, now + DECK_AGENT_TOKEN_TTL_MS,
      ownerId, now - 86_400_000, DECK_AGENT_TOKEN_DAILY_ISSUES,
    );
    return changes === 1;
  },

  /** Tokens still usable now, newest first. Deck columns are null until the agent's first write
   * or after the owner deleted the deck. */
  listActive(ownerId: string, now: number): Promise<DeckAgentTokenListRow[]> {
    return many<DeckAgentTokenListRow>(
      `SELECT t.id, t.owner_id, t.deck_id, t.team_deck_id, t.write_count, t.image_count, t.created_at,
              t.expires_at, t.revoked_at, d.slug AS deck_slug, d.title AS deck_title
       FROM deck_agent_token t LEFT JOIN deck d ON d.id = t.deck_id
       WHERE t.owner_id = ? AND t.team_deck_id IS NULL AND t.revoked_at IS NULL AND t.expires_at > ?
       ORDER BY t.created_at DESC`,
      ownerId, now,
    );
  },

  async revoke(id: string, ownerId: string, now: number): Promise<boolean> {
    const changes = await runCount(
      "UPDATE deck_agent_token SET revoked_at = ? WHERE id = ? AND owner_id = ? AND revoked_at IS NULL",
      now, id, ownerId,
    );
    return changes === 1;
  },

  /** The only Bearer lookup. Unknown, expired, revoked and owners in deletion all read as null. */
  findUsable(tokenHash: string, now: number): Promise<DeckAgentTokenRow | null> {
    return one<DeckAgentTokenRow>(
      `SELECT t.id, t.owner_id, t.deck_id, t.team_deck_id, t.write_count, t.image_count, t.created_at,
              t.expires_at, t.revoked_at
       FROM deck_agent_token t JOIN user u ON u.id = t.owner_id AND u.${ACTIVE}
       WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.expires_at > ?`,
      tokenHash, now,
    );
  },

  /** First write: bind the deck to the token and insert it in one atomic batch.
   * Returns false when another request bound a deck first or the write budget is spent. */
  async createBoundDeck(input: {
    tokenId: string; ownerId: string; deckId: string; slug: string;
    title: string; content: string; now: number;
  }): Promise<boolean> {
    const { tokenId, ownerId, deckId, slug, title, content, now } = input;
    const [bound, inserted] = await batch([
      {
        sql: `UPDATE deck_agent_token SET deck_id = ?, write_count = write_count + 1, last_write_id = ?
              WHERE id = ? AND deck_id IS NULL AND write_count < ?`,
        args: [deckId, deckId, tokenId, DECK_AGENT_TOKEN_MAX_WRITES],
      },
      {
        sql: `INSERT INTO deck (id, slug, owner_id, title, content, created_at, updated_at)
              SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS
              (SELECT 1 FROM deck_agent_token WHERE id = ? AND deck_id = ? AND last_write_id = ?)`,
        args: [deckId, slug, ownerId, title, content, now, now, tokenId, deckId, deckId],
      },
    ]);
    return bound === 1 && inserted === 1;
  },

  /** Later writes replace only the bound deck, and only while it is still the owner's. */
  async replaceBoundDeck(input: {
    tokenId: string; ownerId: string; deckId: string; title: string; content: string; now: number;
  }): Promise<"replaced" | "limit" | "gone"> {
    const { tokenId, ownerId, deckId, title, content, now } = input;
    const writeId = crypto.randomUUID();
    const [counted, updated] = await batch([
      {
        sql: `UPDATE deck_agent_token SET write_count = write_count + 1, last_write_id = ?
              WHERE id = ? AND deck_id = ? AND write_count < ?
                AND EXISTS (SELECT 1 FROM deck WHERE id = ? AND owner_id = ?)`,
        args: [writeId, tokenId, deckId, DECK_AGENT_TOKEN_MAX_WRITES, deckId, ownerId],
      },
      {
        // 版を進める: 持ち主が編集画面を開いたまま AI が書き直しても、画面の古い中身で
        // 黙って上書きしない（編集画面の保存が 409 deck_conflict になる）
        sql: `UPDATE deck SET title = ?, content = ?, updated_at = ?, revision = revision + 1, last_saved_by = owner_id
              WHERE id = ? AND owner_id = ? AND EXISTS
              (SELECT 1 FROM deck_agent_token WHERE id = ? AND last_write_id = ?)`,
        args: [title, content, now, deckId, ownerId, tokenId, writeId],
      },
    ]);
    if (counted === 1 && updated === 1) return "replaced";
    const deck = await one<{ id: string }>("SELECT id FROM deck WHERE id = ? AND owner_id = ?", deckId, ownerId);
    return deck ? "limit" : "gone";
  },

  /** チームのスライドのトークンを発行する（docs/agent-deck-token.md「チームのスライド」）。
   * 判定と書き込みは同じ INSERT の中: 発行者がそのスライドを（AI のロックを除けば）編集できること
   * （いまのメンバー・イベントが終わっていない・チーム参加のコンテスト）、そのスライドに有効な
   * トークンがまだ無いこと、1日の上限。入らなかった理由は読み直して返す */
  async issueForTeamDeck(input: { id: string; ownerId: string; tokenHash: string; deckId: string; now: number }):
    Promise<"ok" | "busy" | "forbidden" | "limit"> {
    const { id, ownerId, tokenHash, deckId, now } = input;
    const changes = await runCount(
      `INSERT INTO deck_agent_token (id, owner_id, token_hash, team_deck_id, created_at, expires_at)
       SELECT ?, ?, ?, d.id, ?, ? FROM deck d
        WHERE d.id = ? AND d.team_entry_id IS NOT NULL AND ${deckEditableSql("d", false)}
          AND NOT EXISTS (SELECT 1 FROM deck_agent_token busy
            WHERE busy.team_deck_id = d.id AND busy.revoked_at IS NULL AND busy.expires_at > ?)
          AND (SELECT COUNT(*) FROM deck_agent_token WHERE owner_id = ? AND created_at > ?) < ?`,
      id, ownerId, tokenHash, now, now + DECK_AGENT_TOKEN_TTL_MS,
      deckId, ...editableArgs(ownerId, false),
      now,
      ownerId, now - 86_400_000, DECK_AGENT_TOKEN_DAILY_ISSUES,
    );
    if (changes === 1) return "ok";
    if (await this.activeForTeamDeck(deckId, now)) return "busy";
    const editable = await one<{ id: string }>(
      `SELECT d.id FROM deck d WHERE d.id = ? AND d.team_entry_id IS NOT NULL AND ${deckEditableSql("d", false)}`,
      deckId, ...editableArgs(ownerId, false),
    );
    return editable ? "limit" : "forbidden";
  },

  /** そのチームのスライドに有効なトークン（あれば1本）と発行した人 */
  activeForTeamDeck(deckId: string, now: number): Promise<{ id: string; expires_at: number; owner_id: string; owner_name: string | null } | null> {
    return one(
      `SELECT t.id, t.expires_at, t.owner_id, COALESCE(u.global_name, u.username) AS owner_name
         FROM deck_agent_token t LEFT JOIN user u ON u.id = t.owner_id AND u.${ACTIVE}
        WHERE t.team_deck_id = ? AND t.revoked_at IS NULL AND t.expires_at > ?
        ORDER BY t.created_at DESC LIMIT 1`,
      deckId, now,
    );
  },

  /** チームのメンバーなら誰でも、そのチームのスライドの AI を止められる（発行した人でなくても）。
   * メンバーかどうかは AI のロックを除いた編集判定で見る */
  async revokeForTeamDeck(deckId: string, userId: string, now: number): Promise<number> {
    return runCount(
      `UPDATE deck_agent_token SET revoked_at = ?
        WHERE team_deck_id = ? AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM deck d WHERE d.id = deck_agent_token.team_deck_id AND ${deckEditableSql("d", false)})`,
      now, deckId, ...editableArgs(userId, false),
    );
  },

  /** チームのスライドを AI が書き直す。発行した人がいまも（AI のロックを除けば）編集できるときだけ
   * （抜けた・イベントが終わった・チーム参加をやめたら書けない）。版を進め、最後に保存した人は発行した人 */
  async replaceTeamDeck(input: {
    tokenId: string; ownerId: string; deckId: string; title: string; content: string; now: number;
  }): Promise<"replaced" | "limit" | "gone"> {
    const { tokenId, ownerId, deckId, title, content, now } = input;
    const writeId = crypto.randomUUID();
    const [counted, updated] = await batch([
      {
        sql: `UPDATE deck_agent_token SET write_count = write_count + 1, last_write_id = ?
              WHERE id = ? AND team_deck_id = ? AND write_count < ?
                AND EXISTS (SELECT 1 FROM deck d WHERE d.id = ? AND d.team_entry_id IS NOT NULL AND ${deckEditableSql("d", false)})`,
        args: [writeId, tokenId, deckId, DECK_AGENT_TOKEN_MAX_WRITES, deckId, ...editableArgs(ownerId, false)],
      },
      {
        sql: `UPDATE deck SET title = ?, content = ?, updated_at = ?, revision = revision + 1, last_saved_by = ?
              WHERE id = ? AND EXISTS (SELECT 1 FROM deck_agent_token WHERE id = ? AND last_write_id = ?)`,
        args: [title, content, now, ownerId, deckId, tokenId, writeId],
      },
    ]);
    if (counted === 1 && updated === 1) return "replaced";
    return (await this.findTeamDeck(deckId, ownerId)) ? "limit" : "gone";
  },

  /** 発行した人がいまも（AI のロックを除けば）編集できるチームのスライド */
  findTeamDeck(deckId: string, ownerId: string): Promise<{ id: string; slug: string; title: string } | null> {
    return one<{ id: string; slug: string; title: string }>(
      `SELECT d.id, d.slug, d.title FROM deck d
        WHERE d.id = ? AND d.team_entry_id IS NOT NULL AND ${deckEditableSql("d", false)}`,
      deckId, ...editableArgs(ownerId, false),
    );
  },

  /** Reserves one image slot. False once the per-token image budget is spent. */
  async countImage(tokenId: string): Promise<boolean> {
    const changes = await runCount(
      "UPDATE deck_agent_token SET image_count = image_count + 1 WHERE id = ? AND image_count < ?",
      tokenId, DECK_AGENT_TOKEN_MAX_IMAGES,
    );
    return changes === 1;
  },

  findDeck(deckId: string, ownerId: string): Promise<{ id: string; slug: string; title: string } | null> {
    return one<{ id: string; slug: string; title: string }>(
      "SELECT id, slug, title FROM deck WHERE id = ? AND owner_id = ?", deckId, ownerId,
    );
  },
};

/** D1 surfaces UNIQUE failures as messages; only deck id/slug collisions are retryable. */
export function deckIdentityConflict(error: unknown): boolean {
  let current = error;
  for (let i = 0; current instanceof Error && i < 4; i++) {
    if (/UNIQUE constraint failed: (?:deck\.(?:id|slug)|deck_agent_token\.deck_id)(?:\s|:|$)/.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}
