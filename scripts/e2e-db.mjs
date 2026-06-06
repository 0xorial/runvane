#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const backendDir = path.join(repoRoot, "backend");
const e2eDir = path.join(repoRoot, ".e2e");
const e2eDbPath = path.join(e2eDir, "e2e.sqlite");
const seedSqlPath = path.join(backendDir, "test/fixtures/e2e-seed.sql");

export const e2eDatabaseUrl = `file:${e2eDbPath}`;

export function prepareE2eDatabase({ fresh = true } = {}) {
  mkdirSync(e2eDir, { recursive: true });
  if (fresh && existsSync(e2eDbPath)) unlinkSync(e2eDbPath);
  if (existsSync(e2eDbPath)) return e2eDatabaseUrl;

  const env = { ...process.env, DATABASE_URL: e2eDatabaseUrl };
  const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: backendDir,
    env,
    stdio: "inherit",
  });
  if (migrate.status !== 0) {
    throw new Error("e2e-db: prisma migrate deploy failed");
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
    throw new Error("e2e-db: seed failed");
  }

  return e2eDatabaseUrl;
}
