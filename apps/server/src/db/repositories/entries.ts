import type { Entry, Submission } from "@eventer/shared";
import { DELETED_USER_DISPLAY_NAME } from "@eventer/shared";
import { one, many, run, batch } from "../client.js";

interface EntryRow {
  id: string;
  event_id: string;
  kind: string;
  name: string;
  team_id: string | null;
  presentation_order: number | null;
  created_at: number;
  /** entryAnonymizedSql の判定結果（1 = 表示名を伏せる） */
  anonymized: number;
}

/** 個人エントリーの表示名を伏せるべきか判定する SQL 断片 (#250)。1 なら伏せる。
 *
 * 個人エントリーの name は参加確定時にユーザーの表示名をコピーした値で、
 * entry テーブル自体は user を参照しないため deleted_at では除外されない。
 * そのままだと退会申請中のユーザーの表示名が Entry 一覧・成果物一覧・
 * 表彰結果・採点結果（公開イベントなら未ログインでも見える）に残ってしまう。
 *
 * entry は成果物URL を持つので行は消さず、メンバーが全員退会申請中のときだけ
 * 表示名を伏せる。復帰すれば元の name がそのまま戻る。
 * alias はクエリ側の entry テーブル別名。
 *
 * 伏せ字の文言そのものは SQL に埋め込まず TS 側（entryDisplayName）で差し替える。
 * SELECT 句に定数リテラルを書くと、文言に ' が入った途端にクエリが壊れる／
 * バインドパラメータにすると SELECT 句の位置に応じて引数の順番がずれる、という
 * どちらの落とし穴も避けるため。 */
export function entryAnonymizedSql(alias: string): string {
  return `CASE WHEN ${alias}.kind = 'individual'
                 AND EXISTS (SELECT 1 FROM entry_member em
                              WHERE em.entry_id = ${alias}.id)
                 AND NOT EXISTS (SELECT 1 FROM entry_member em
                                   JOIN user u ON u.id = em.user_id
                                  WHERE em.entry_id = ${alias}.id
                                    AND u.deleted_at IS NULL)
               THEN 1 ELSE 0 END`;
}

/** entryAnonymizedSql の結果を反映した表示名を返す (#250) */
export function entryDisplayName(name: string, anonymized: number): string {
  return anonymized ? DELETED_USER_DISPLAY_NAME : name;
}

const SELECT_ENTRY = `SELECT e.*, ${entryAnonymizedSql("e")} AS anonymized
  FROM entry e`;

interface SubmissionRow {
  presentation_url: string | null;
  source_code_url: string | null;
  updated_at: number;
}

function toSubmission(row: SubmissionRow | null): Submission | null {
  if (!row) return null;
  return {
    presentationUrl: row.presentation_url,
    sourceCodeUrl: row.source_code_url,
    updatedAt: row.updated_at,
  };
}

/** エントリーのメンバー。退会申請中 (#250) は除外する
 * （memberUserIds はそのままユーザーIDとして公開APIに出るため） */
async function memberUserIds(entryId: string): Promise<string[]> {
  const rows = await many<{ user_id: string }>(
    `SELECT em.user_id FROM entry_member em
       JOIN user u ON u.id = em.user_id AND u.deleted_at IS NULL
      WHERE em.entry_id = ?`,
    entryId,
  );
  return rows.map((r) => r.user_id);
}

async function submissionFor(entryId: string): Promise<Submission | null> {
  const row = await one<SubmissionRow>(
    "SELECT presentation_url, source_code_url, updated_at FROM submission WHERE entry_id = ?",
    entryId,
  );
  return toSubmission(row);
}

async function toEntry(row: EntryRow): Promise<Entry> {
  return {
    id: row.id,
    eventId: row.event_id,
    kind: row.kind,
    name: entryDisplayName(row.name, row.anonymized),
    teamId: row.team_id,
    presentationOrder: row.presentation_order,
    createdAt: row.created_at,
    memberUserIds: await memberUserIds(row.id),
    submission: await submissionFor(row.id),
  };
}

export const entriesRepo = {
  async findById(id: string): Promise<Entry | null> {
    const row = await one<EntryRow>(`${SELECT_ENTRY} WHERE e.id = ?`, id);
    return row ? await toEntry(row) : null;
  },

  async listByEvent(eventId: string): Promise<Entry[]> {
    const rows = await many<EntryRow>(
      `${SELECT_ENTRY} WHERE e.event_id = ?
         ORDER BY COALESCE(e.presentation_order, 1e9), e.created_at ASC`,
      eventId,
    );
    return Promise.all(rows.map(toEntry));
  },

  /** 個人参加: そのユーザーの Entry を返す（無ければ null） */
  async findIndividualEntry(
    eventId: string,
    userId: string,
  ): Promise<Entry | null> {
    const row = await one<EntryRow>(
      `${SELECT_ENTRY}
         JOIN entry_member em ON em.entry_id = e.id
         WHERE e.event_id = ? AND e.kind = 'individual' AND em.user_id = ?
         LIMIT 1`,
      eventId,
      userId,
    );
    return row ? await toEntry(row) : null;
  },

  /** 個人 Entry を作成（参加登録時）。既にあればそれを返す */
  async createIndividual(
    eventId: string,
    userId: string,
    name: string,
  ): Promise<Entry> {
    const existing = await this.findIndividualEntry(eventId, userId);
    if (existing) return existing;
    const id = crypto.randomUUID();
    await batch([
      {
        sql: `INSERT INTO entry (id, event_id, kind, name, created_at)
         VALUES (?, ?, 'individual', ?, ?)`,
        args: [id, eventId, name, Date.now()],
      },
      {
        sql: `INSERT INTO entry_member (id, entry_id, user_id, is_leader)
         VALUES (?, ?, ?, 1)`,
        args: [crypto.randomUUID(), id, userId],
      },
    ]);
    return (await this.findById(id))!;
  },

  /** 個人参加解除: そのユーザーの個人 Entry を削除 */
  async removeIndividualEntry(eventId: string, userId: string): Promise<void> {
    const entry = await this.findIndividualEntry(eventId, userId);
    if (entry) await run("DELETE FROM entry WHERE id = ?", entry.id);
  },

  async isMember(entryId: string, userId: string): Promise<boolean> {
    const row = await one(
      "SELECT 1 FROM entry_member WHERE entry_id = ? AND user_id = ?",
      entryId,
      userId,
    );
    return Boolean(row);
  },

  async upsertSubmission(
    entryId: string,
    presentationUrl: string | null,
    sourceCodeUrl: string | null,
  ): Promise<Submission> {
    const existing = await one<{ id: string }>(
      "SELECT id FROM submission WHERE entry_id = ?",
      entryId,
    );
    if (existing) {
      await run(
        `UPDATE submission SET presentation_url = ?, source_code_url = ?, updated_at = ?
         WHERE entry_id = ?`,
        presentationUrl,
        sourceCodeUrl,
        Date.now(),
        entryId,
      );
    } else {
      await run(
        `INSERT INTO submission (id, entry_id, presentation_url, source_code_url, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        entryId,
        presentationUrl,
        sourceCodeUrl,
        Date.now(),
      );
    }
    return (await submissionFor(entryId))!;
  },
};
