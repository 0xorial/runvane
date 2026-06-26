import type { ToolSandbox } from "../../../backend/src/contracts/tool-sandbox";

/** One-line explainer of where a conversation's target tools execute. */
export function toolSandboxDescription(env: ToolSandbox): string {
  if (env.kind === "none") return "No sandbox — target tools are disabled for this chat.";
  if (env.kind === "ssh" && env.ssh) {
    const target = `${env.ssh.user ? `${env.ssh.user}@` : ""}${env.ssh.host}${env.ssh.port ? `:${env.ssh.port}` : ""}`;
    return `Tools run over ssh on ${target}.`;
  }
  return "Target tools run alongside the app, sharing its files — no separate sandbox.";
}
