import { defineConfig, env } from "prisma/config";

// Prisma 7 CLI configuration (replaces the deprecated `package.json#prisma`
// block and the datasource url in schema.prisma). The app itself does not read
// this — it builds its own better-sqlite3 adapter in src/db/prisma.service.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.mjs",
  },
  datasource: {
    // Same contract as before: every caller of the CLI (scripts/e2e-db.mjs,
    // scripts/dind/rv-db-sync.sh, dev flows) passes an explicit DATABASE_URL.
    url: env("DATABASE_URL"),
  },
});
