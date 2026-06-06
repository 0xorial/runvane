#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { findProjectRoot, resolveFromDir } from "./lib.mjs";

function usage() {
  console.error(`Usage: with-ports.mjs [--cwd <path>] -- <command...>

Runs a command with PORT, BACKEND_PORT, FRONTEND_PORT, FRONTEND_ORIGIN, and VITE_API_BASE_URL set
from the nearest dev-ports.json + dev-ports/registry.json (base * 100 + slot offset).`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep < 0 || sep === argv.length - 1) usage();

let cwd = process.cwd();
const flags = argv.slice(0, sep);
for (let i = 0; i < flags.length; i++) {
  if (flags[i] === "--cwd") {
    const next = flags[++i];
    if (!next) usage();
    cwd = resolve(next);
  } else {
    usage();
  }
}

const command = argv.slice(sep + 1);
const resolved = resolveFromDir(cwd);
const portEnv = { ...resolved.env, PORT: resolved.env.PORT };

const child = spawn(command[0], command.slice(1), {
  cwd,
  stdio: "inherit",
  env: { ...process.env, ...portEnv },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
