#!/usr/bin/env node
import { listProjects } from "./lib.mjs";

for (const project of listProjects()) {
  console.log(`${project.name} (base ${project.base}, ${project.range.start}-${project.range.end})`);
  for (const [slot, port] of Object.entries(project.ports)) {
    console.log(`  ${slot.padEnd(16)} ${port}`);
  }
  console.log();
}
