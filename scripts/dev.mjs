#!/usr/bin/env node
// Start backend + frontend together. Applies any pending DB migrations first
// so `npm run dev` can never run against an un-migrated database.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backendDir = path.join(repoRoot, "backend");
const frontendDir = path.join(repoRoot, "frontend");
const shell = process.platform === "win32";

if (!existsSync(path.join(backendDir, "node_modules")) || !existsSync(path.join(frontendDir, "node_modules"))) {
  console.error("\x1b[33mDependencies missing. Run `npm run setup` first.\x1b[0m");
  process.exit(1);
}

// Apply pending migrations (idempotent, fast when up to date).
const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], { cwd: backendDir, stdio: "inherit", shell });
if (migrate.status !== 0) {
  console.error("\x1b[31mMigration failed — fix the database before starting.\x1b[0m");
  process.exit(migrate.status ?? 1);
}

/** Spawn a child dev server, prefixing each line so the two streams stay readable. */
function start(name, color, cwd) {
  const child = spawn("npm", ["run", "dev"], { cwd, shell });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) out.write(tag + line + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
}

const children = [
  start("backend", "36", backendDir),
  start("frontend", "35", frontendDir),
];

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill("SIGINT");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
for (const c of children) {
  c.on("exit", (code) => {
    // If one server dies, take the other down too.
    if (!shuttingDown) {
      shutdown();
      process.exitCode = code ?? 1;
    }
  });
}
