#!/usr/bin/env node
// Register seats in a running runvane harness: one ssh sandbox and one agent
// per seat, keyed by name so re-running updates instead of duplicating.
//
//   node scripts/terra/seed-seats.mjs --api http://127.0.0.1:52230 --seats ~/seats.json
//
// seats.json: see seats.example.json. With ANTHROPIC_API_KEY in the
// environment the Anthropic provider is configured and verified first; the key
// is read from the environment only, never from the file.
//
// Per seat the agent gets Claude-Code-like gates: exec runs the allowlisted
// prefixes without asking and asks for anything else, reads are allowed inside
// `roots`, writes inside `roots` ask. A chat uses the seat by picking its
// sandbox and agent.
import { readFileSync } from "node:fs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const api = arg("api", "").replace(/\/$/, "");
const seatsFile = arg("seats", "");
if (!api || !seatsFile) {
  console.error("usage: seed-seats.mjs --api http://host:port --seats seats.json");
  process.exit(2);
}
const plan = JSON.parse(readFileSync(seatsFile, "utf8"));

async function call(method, path, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

async function configureAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return;
  await call("PUT", "/api/settings/llm_provider", {
    provider_id: "anthropic",
    settings: { api_key: key, base_url: "https://api.anthropic.com" },
  });
  const tested = await call("POST", "/api/settings/llm_provider/test_connection", { provider_id: "anthropic" });
  if (!tested.ok) throw new Error(`anthropic connection test failed: ${tested.detail}`);
  console.log(`anthropic: verified, ${tested.models.length} models`);
}

async function upsertSandbox(seat) {
  const { sandboxes } = await call("GET", "/api/tool-sandboxes");
  const existing = sandboxes.find((s) => s.name === seat.name);
  const body = { name: seat.name, ssh: seat.ssh };
  const row = existing
    ? await call("PUT", `/api/tool-sandboxes/${existing.id}`, body)
    : await call("POST", "/api/tool-sandboxes", body);
  console.log(
    `sandbox "${seat.name}": ${existing ? "updated" : "created"} (${row.id}) -> ${seat.ssh.user}@${seat.ssh.host}`,
  );
}

function agentConfig(seat) {
  return {
    tools: {
      exec: { policy: "custom", rules: { default_cwd: seat.cwd } },
      filesystem_read: { policy: "allow", rules: { allowed_roots: seat.roots } },
      filesystem_write: { policy: "ask", rules: { writable_roots: seat.roots } },
    },
  };
}

async function upsertAgent(seat) {
  const agents = await call("GET", "/api/agents");
  const list = Array.isArray(agents) ? agents : agents.agents;
  const existing = list.find((a) => a.name === seat.name);
  const body = {
    name: seat.name,
    system_prompt:
      seat.system_prompt ??
      `You work on the "${seat.name}" seat: shell and files run as ${seat.ssh.user} on ${seat.ssh.host}, ` +
        `starting in ${seat.cwd}. Keep changes inside ${seat.roots.join(", ")}.`,
    model_reference: plan.model,
    default_llm_configuration: agentConfig(seat),
  };
  const row = existing
    ? await call("PUT", `/api/agents/${existing.id}`, body)
    : await call("POST", "/api/agents", body);
  console.log(`agent "${seat.name}": ${existing ? "updated" : "created"} (${row.id ?? existing?.id})`);
}

await configureAnthropic();
for (const seat of plan.seats) {
  await upsertSandbox(seat);
  await upsertAgent(seat);
}
console.log("done. In a chat, pick the seat's sandbox and agent.");
