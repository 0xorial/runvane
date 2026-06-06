#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot, formatEnvPorts, resolveFromDir } from "./lib.mjs";

const cwdFlag = process.argv.indexOf("--cwd");
const startDir = cwdFlag >= 0 ? process.argv[cwdFlag + 1] : process.cwd();
if (cwdFlag >= 0 && !startDir) {
  console.error("Usage: sync-env.mjs [--cwd <path>]");
  process.exit(1);
}

const projectRoot = findProjectRoot(startDir);
const resolved = resolveFromDir(startDir);
const outPath = join(projectRoot, ".env.ports");

writeFileSync(outPath, formatEnvPorts(resolved), "utf8");
console.log(`Wrote ${outPath} (base ${resolved.base})`);
