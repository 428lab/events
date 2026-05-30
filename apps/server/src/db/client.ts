import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { env } from "../env.js";

mkdirSync(dirname(env.databasePath), { recursive: true });

export const db: DatabaseType = new Database(env.databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export type DB = DatabaseType;
