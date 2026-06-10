#!/usr/bin/env node
// Idempotent seed: give a fresh database one default agent so a new install can
// chat immediately (after the user adds an LLM provider in Settings). Does
// NOTHING when any agent already exists — safe to run against a populated DB.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

try {
  const count = await prisma.agent.count();
  if (count > 0) {
    console.log(`Seed: ${count} agent(s) already present — skipping.`);
  } else {
    await prisma.agent.create({
      data: {
        id: randomUUID(),
        name: "Default agent",
        systemPrompt: "You are a helpful assistant.",
        isDefault: 1,
      },
    });
    console.log("Seed: created default agent. Add an LLM provider in Settings to start chatting.");
  }
} finally {
  await prisma.$disconnect();
}
