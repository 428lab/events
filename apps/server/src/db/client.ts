import type { D1Database } from "@cloudflare/workers-types";
import { getDb } from "../runtime.js";

export { getDb };
export type DB = D1Database;

/** 1行取得（無ければ null）。better-sqlite3 の prepare().get() 相当。 */
export function one<T = Record<string, unknown>>(
  sql: string,
  ...args: unknown[]
): Promise<T | null> {
  return getDb()
    .prepare(sql)
    .bind(...args)
    .first<T>();
}

/** 全行取得。better-sqlite3 の prepare().all() 相当。 */
export async function many<T = Record<string, unknown>>(
  sql: string,
  ...args: unknown[]
): Promise<T[]> {
  const r = await getDb()
    .prepare(sql)
    .bind(...args)
    .all<T>();
  return r.results;
}

/** 書き込み。better-sqlite3 の prepare().run() 相当。 */
export async function run(sql: string, ...args: unknown[]): Promise<void> {
  await getDb()
    .prepare(sql)
    .bind(...args)
    .run();
}

/** run と同じだが変更行数を返す（条件付きUPDATEの成否判定用） */
export async function runCount(
  sql: string,
  ...args: unknown[]
): Promise<number> {
  const res = await getDb()
    .prepare(sql)
    .bind(...args)
    .run();
  return res.meta?.changes ?? 0;
}

/** 複数文をアトミックに実行（D1 batch）。better-sqlite3 の transaction 相当。
 * 文ごとの変更行数を返す（使わない呼び出し側は無視してよい）。 */
export async function batch(
  stmts: Array<{ sql: string; args?: unknown[] }>,
): Promise<number[]> {
  const db = getDb();
  const res = await db.batch(
    stmts.map((s) => db.prepare(s.sql).bind(...(s.args ?? []))),
  );
  return res.map((r) => r.meta?.changes ?? 0);
}
