#!/usr/bin/env node
import { printReport, recordFragility } from "./ledger.mjs";

const [command, ...args] = process.argv.slice(2);

if (!command || command === "report") {
  printReport();
  process.exit(0);
}

if (command === "fragile") {
  const testId = args[0];
  const note = args.slice(1).join(" ").trim();
  if (!testId) {
    console.error("usage: node test-metrics/cli.mjs fragile <test-id> [note]");
    process.exit(1);
  }
  recordFragility(testId, note || undefined);
  console.log(`fragility +1: ${testId}`);
  process.exit(0);
}

console.error(`unknown command: ${command}`);
console.error("commands: report (default), fragile <test-id> [note]");
process.exit(1);
