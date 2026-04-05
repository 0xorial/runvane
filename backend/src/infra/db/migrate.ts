import fs from "node:fs";
import path from "node:path";

import { logger } from "../logger.js";
import type { SqliteDb } from "./client.js";

function ensureMigrationsTable(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

export function runMigrations(db: SqliteDb, dir?: string): void {
  ensureMigrationsTable(db);

  const migrationsDir = dir
    ? path.resolve(dir)
    : path.resolve(process.cwd(), "migrations");

  if (!fs.existsSync(migrationsDir)) return;

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    db
      .prepare("SELECT id FROM _migrations")
      .all()
      .map((r) => String((r as { id: string }).id)),
  );

  const insertApplied = db.prepare(
    "INSERT INTO _migrations (id, applied_at) VALUES (?, ?)",
  );

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    logger.info("[migrate] schema up to date");
    return;
  }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      db.exec(sql);
      insertApplied.run(file, now);
    });
    tx();
    logger.info(`[migrate] applied ${file}`);
  }
  logger.info(`[migrate] ${pending.length} migration(s) applied`);
}
