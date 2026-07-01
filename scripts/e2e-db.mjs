#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const backendDir = path.join(repoRoot, "backend");
const e2eDir = path.join(repoRoot, ".e2e");
const seedSqlPath = path.join(repoRoot, "tests/integration/fixtures/e2e-seed.sql");

function dbPathFor(name) {
  return path.join(e2eDir, `${name}.sqlite`);
}

function databaseUrlFor(name) {
  return `file:${dbPathFor(name)}`;
}

/**
 * Prepare an isolated, disposable SQLite DB for a test suite under `.e2e/`.
 * Migrates the schema and applies the shared seed. This NEVER touches the real
 * backend.sqlite (rv-stable) or backend.dev.sqlite (rv-dev) — every suite gets
 * its own file so tests can't pollute a DB anyone actually uses.
 *
 * @param {string} name  suite name, e.g. "e2e" or "integration"
 * @param {{ fresh?: boolean }} [opts]
 * @returns {string} the `file:` DATABASE_URL for the prepared DB
 */
export function prepareTestDatabase(name, { fresh = true } = {}) {
  const dbPath = dbPathFor(name);
  const databaseUrl = databaseUrlFor(name);
  mkdirSync(e2eDir, { recursive: true });
  if (fresh && existsSync(dbPath)) unlinkSync(dbPath);
  if (existsSync(dbPath)) return databaseUrl;

  const env = { ...process.env, DATABASE_URL: databaseUrl };
  const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: backendDir,
    env,
    stdio: "inherit",
  });
  if (migrate.status !== 0) {
    throw new Error(`test-db: prisma migrate deploy failed for ${name}`);
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
    throw new Error(`test-db: seed failed for ${name}`);
  }

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
