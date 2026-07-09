import { defaultAgentId } from "../../tests/e2e/harness/client";
import { stubLlmConfigure, stubLlmReset } from "../../tests/e2e/harness/stub-llm";
import { E2E_LLM_TIMEOUT_MS } from "../../tests/e2e/timeouts";
import { beat, expect, test } from "../_shared/demo-test";
import { demoClick, demoKeyOn, demoTypeInto, installDemoOverlay } from "../_shared/overlay";
import { plannerReply } from "../_shared/planner";

const MODEL = "gpt-4o";
const STREAM_MS = 20;

const PROMPT = "Briefly: how does TLS 1.3 improve on TLS 1.2?";
const TITLE = "TLS 1.3 vs 1.2";

const TLS_MARKDOWN = `**TLS 1.3 improves on 1.2 in four big ways:**

- **1-RTT handshake** (and 0-RTT resumption) — roughly halves connection latency.
- **Trimmed cipher suites** — legacy/insecure options (RSA key exchange, CBC, RC4) are gone, so misconfiguration is far harder.
- **Forward secrecy by default** via ephemeral key exchange.
- **Encrypted handshake** — certificate details are hidden from passive observers.`;

test("transparent-runtime", async ({ app, request }) => {
  await stubLlmReset(request);
  await stubLlmConfigure(request, [
    { responses: [{ text: TITLE }] },
    {
      model: MODEL,
      responses: [{ text: plannerReply(TLS_MARKDOWN, "Summarize the concrete improvements."), streamMs: STREAM_MS }],
    },
  ]);

  await installDemoOverlay(app.page);
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  await demoTypeInto(app.chat.userInput.textarea, PROMPT, 10);
  await demoKeyOn(app.page, app.chat.userInput.textarea, "Shift+Enter");
  await app.chat.transcript.waitForAssistantReply(E2E_LLM_TIMEOUT_MS);
  await beat(500);

  // The collapsed planning row opens the full details (prompt, reasoning,
  // action) in the right-hand panel.
  const row = app.chat.transcript.prepareRow("Decision planning", 0);
  await demoClick(app.page, row.getByTestId("thought-collapsed-row"));
  await expect(app.chat.transcript.detailPanel).toBeVisible();
  await beat(1600);
});
