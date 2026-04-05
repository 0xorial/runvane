import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const DEFAULT_DB_PATH = path.resolve(process.cwd(), "data/backend.db");

export type SqliteDb = Database.Database;

export function resolveDbPath(raw: string | undefined): string {
  const p = String(raw || "").trim();
  return p ? path.resolve(p) : DEFAULT_DB_PATH;
}

export function openDatabase(dbPathRaw?: string): SqliteDb {
  const dbPath = resolveDbPath(dbPathRaw);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  return db;
}
