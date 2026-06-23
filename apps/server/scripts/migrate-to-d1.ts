/**
 * 既存 SQLite（eventer.db）のデータを D1 へ移すための SQL と、
 * event_image の blob を R2 へ上げるためのファイルを生成する一回限りのスクリプト。
 *
 * 使い方:
 *   node ... ですでに本番DBを /tmp/eventer-migrate/eventer.db にコピー済みにしておく
 *   cd apps/server && npx tsx scripts/migrate-to-d1.ts <path-to-sqlite>
 *
 * 出力:
 *   /tmp/eventer-migrate/data.sql        … D1 へ流し込む INSERT 群
 *   /tmp/eventer-migrate/images/<id>.bin … R2 へ上げる画像本体
 *   /tmp/eventer-migrate/upload-images.sh … R2 アップロード用コマンド
 */
import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = process.argv[2] ?? "/tmp/eventer-migrate/eventer.db";
const OUT = "/tmp/eventer-migrate";
const IMG_DIR = join(OUT, "images");
mkdirSync(IMG_DIR, { recursive: true });

// コピーに対して開き、WAL を本体へ畳んでから読む（最新の書き込みを取りこぼさない）。
const db = new Database(SRC);
db.pragma("wal_checkpoint(TRUNCATE)");

// FK 依存順（親→子）。session は揮発的なので移行しない。
const TABLES = [
  "user",
  "event",
  "participation_slot",
  "entry",
  "entry_member",
  "event_member",
  "submission",
  "scoring_criterion",
  "score",
  "award_rank",
  "special_award",
  "award_result",
  "event_state",
];

function lit(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "bigint") return String(v);
  if (Buffer.isBuffer(v)) return "NULL"; // blob は別途 R2 へ
  return "'" + String(v).replace(/'/g, "''") + "'";
}

const lines: string[] = ["PRAGMA defer_foreign_keys = TRUE;"];
let counts: Record<string, number> = {};

for (const table of TABLES) {
  const cols = (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map((c) => c.name);
  const rows = db.prepare(`SELECT * FROM ${table}`).all() as Array<
    Record<string, unknown>
  >;
  counts[table] = rows.length;
  for (const row of rows) {
    const vals = cols.map((c) => lit(row[c]));
    lines.push(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${vals.join(", ")});`,
    );
  }
}

// event_image: メタは D1、blob は R2 ファイルへ
const imgs = db
  .prepare("SELECT event_id, mime, data, updated_at FROM event_image")
  .all() as Array<{
  event_id: string;
  mime: string;
  data: Buffer;
  updated_at: number;
}>;
counts["event_image"] = imgs.length;
const uploadCmds: string[] = ["#!/usr/bin/env bash", "set -euo pipefail"];
for (const img of imgs) {
  lines.push(
    `INSERT INTO event_image (event_id, mime, updated_at) VALUES (${lit(
      img.event_id,
    )}, ${lit(img.mime)}, ${lit(img.updated_at)});`,
  );
  const file = join(IMG_DIR, `${img.event_id}.bin`);
  writeFileSync(file, img.data);
  const ct = img.mime.replace(/'/g, "");
  uploadCmds.push(
    `npx wrangler r2 object put "eventer-images/event-images/${img.event_id}" --file="${file}" --content-type="${ct}" --remote`,
  );
}

writeFileSync(join(OUT, "data.sql"), lines.join("\n") + "\n");
writeFileSync(join(OUT, "upload-images.sh"), uploadCmds.join("\n") + "\n");

console.log("row counts:", JSON.stringify(counts, null, 2));
console.log(`wrote ${OUT}/data.sql (${lines.length} statements)`);
console.log(`wrote ${OUT}/upload-images.sh (${imgs.length} images)`);
