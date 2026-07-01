#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const backendDir = path.join(repoRoot, "backend");
const e2eDir = path.join(repoRoot, ".e2e");
const migrationsDir = path.join(backendDir, "prisma", "migrations");
const schemaPath = path.join(backendDir, "prisma", "schema.prisma");
const seedSqlPath = path.join(repoRoot, "tests/integration/fixtures/e2e-seed.sql");

function dbPathFor(name) {
  return path.join(e2eDir, `${name}.sqlite`);
}

function databaseUrlFor(name) {
  return `file:${dbPathFor(name)}`;
}

/** Hash of everything that determines the DB's content: schema, migrations, seed. */
function templateHash() {
  const h = createHash("sha256");
  h.update(readFileSync(schemaPath));
  h.update(readFileSync(seedSqlPath));
  for (const dirent of readdirSync(migrationsDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!dirent.isDirectory()) continue;
    h.update(dirent.name);
    const sqlPath = path.join(migrationsDir, dirent.name, "migration.sql");
    if (existsSync(sqlPath)) h.update(readFileSync(sqlPath));
  }
  return h.digest("hex").slice(0, 16);
}

/** migrate + seed into `dbPath` via the prisma CLI (the slow path, ~3s). */
function buildDatabase(dbPath, label) {
  const env = { ...process.env, DATABASE_URL: `file:${dbPath}` };
  const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: backendDir,
    env,
    stdio: "inherit",
  });
  if (migrate.status !== 0) {
    throw new Error(`test-db: prisma migrate deploy failed for ${label}`);
  }
  const seed = spawnSync(
    "npx",
    ["prisma", "db", "execute", "--stdin", "--schema", "prisma/schema.prisma"],
    {
      cwd: backendDir,
      env,
      input: readFileSync(seedSqlPath),
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  if (seed.status !== 0) {
    throw new Error(`test-db: seed failed for ${label}`);
  }
}

/**
 * Return a migrated+seeded template DB, building it only when the schema,
 * migrations, or seed changed (content-hashed filename). Fresh runs then just
 * COPY the template (~ms) instead of spawning `npx prisma` twice (~3s).
 */
function ensureTemplate() {
  mkdirSync(e2eDir, { recursive: true });
  const templatePath = path.join(e2eDir, `template-${templateHash()}.sqlite`);
  if (existsSync(templatePath)) return templatePath;
  // Stale templates (older schema/seed) are dead weight — drop them.
  for (const f of readdirSync(e2eDir)) {
    if (/^template-[0-9a-f]{16}\.sqlite/.test(f)) rmSync(path.join(e2eDir, f), { force: true });
  }
  const building = `${templatePath}.building`;
  buildDatabase(building, "template");
  renameSync(building, templatePath);
  return templatePath;
}

/**
 * Prepare an isolated, disposable SQLite DB for a test suite under `.e2e/`.
 * Copies a content-hashed, migrated+seeded template. This NEVER touches the
 * real backend.sqlite (rv-stable) or backend.dev.sqlite (rv-dev) — every suite
 * gets its own file so tests can't pollute a DB anyone actually uses.
 *
 * @param {string} name  suite name, e.g. "e2e" or "integration"
 * @param {{ fresh?: boolean }} [opts]
 * @returns {string} the `file:` DATABASE_URL for the prepared DB
 */
export function prepareTestDatabase(name, { fresh = true } = {}) {
  const dbPath = dbPathFor(name);
  const databaseUrl = databaseUrlFor(name);
  mkdirSync(e2eDir, { recursive: true });
  if (!fresh && existsSync(dbPath)) return databaseUrl;
  // Drop the DB and its WAL/SHM sidecars so the copy starts clean.
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
  }
  copyFileSync(ensureTemplate(), dbPath);
  return databaseUrl;
}

// --- e2e suite bindings (public API consumed by e2e-servers.mjs) ---
export const e2eDatabaseUrl = databaseUrlFor("e2e");
export function prepareE2eDatabase({ fresh = true } = {}) {
  return prepareTestDatabase("e2e", { fresh });
}

// --- integration suite bindings (consumed by run-integration.mjs) ---
export const integrationDatabaseUrl = databaseUrlFor("integration");
export function prepareIntegrationDatabase({ fresh = true } = {}) {
  return prepareTestDatabase("integration", { fresh });
}
