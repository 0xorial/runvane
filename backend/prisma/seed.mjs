#!/usr/bin/env node
// Idempotent seed: give a fresh database one default agent so a new install can
// chat immediately (after the user adds an LLM provider in Settings). Does
// NOTHING when any agent already exists — safe to run against a populated DB.
//
// Uses better-sqlite3 directly (the same driver the app's Prisma adapter runs
// on) so seeding needs no generated client or build step.
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.DATABASE_URL ?? "file:./backend.sqlite";
if (!url.startsWith("file:")) throw new Error(`seed: expected a file: DATABASE_URL, got ${url}`);
// Relative paths resolve against this script's directory (backend/prisma/),
// matching where migrations put the default DB.
const raw = url.slice("file:".length).split("?")[0];
const dbPath = path.isAbsolute(raw) ? raw : path.resolve(path.dirname(fileURLToPath(import.meta.url)), raw);

const db = new Database(dbPath);
try {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM agents").get();
  if (count > 0) {
    console.log(`Seed: ${count} agent(s) already present — skipping.`);
  } else {
    db.prepare(
      "INSERT INTO agents (id, name, system_prompt, is_default, created_at, updated_at) VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))",
    ).run(randomUUID(), "Default agent", "You are a helpful assistant.");
    console.log("Seed: created default agent. Add an LLM provider in Settings to start chatting.");
  }
} finally {
  db.close();
}
