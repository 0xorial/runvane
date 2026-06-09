import { defaultAgentId } from "../../tests/e2e/harness/client";
import { stubLlmConfigure, stubLlmReset, type StubModelScript } from "../../tests/e2e/harness/stub-llm";
import { E2E_LLM_TIMEOUT_MS } from "../../tests/e2e/timeouts";
import { beat, expect, test } from "../_shared/demo-test";
import {
  demoClick,
  demoKeyOnly,
  demoSteerShortcut,
  demoTypeOnly,
  installDemoOverlay,
} from "../_shared/overlay";
import { plannerReply } from "../_shared/planner";

const MODEL = "gpt-4o";
const NGINX_STREAM_MS = 35;
const STEERED_STREAM_MS = 28;

const CONVERSATION_TITLE = "Nginx reverse proxy setup";

const NGINX_PROMPT =
  "Give me a detailed nginx reverse proxy guide: TLS, HTTP/2, caching, rate limiting, and security headers.";

const STEER_TEXT = "Actually — stop. Just give me the 3 essential commands, nothing else.";
const QUICK_TYPE_MS = 6;

const NGINX_MARKDOWN = `# Production Nginx reverse proxy

## 1. TLS termination
\`\`\`nginx
server {
  listen 443 ssl http2;
  server_name example.com;
  ssl_certificate     /etc/ssl/example.crt;
  ssl_certificate_key /etc/ssl/example.key;
  ssl_protocols TLSv1.2 TLSv1.3;
}
\`\`\`

## 2. Upstream + proxy
\`\`\`nginx
upstream app { server 127.0.0.1:8000; keepalive 32; }
location / {
  proxy_pass http://app;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
\`\`\`

## 3. Caching
\`\`\`nginx
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=app:10m;
proxy_cache app;
\`\`\`

## 4. Rate limiting
\`\`\`nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req zone=api burst=20 nodelay;
\`\`\`

## 5. Security headers
\`\`\`nginx
add_header Strict-Transport-Security "max-age=63072000" always;
add_header X-Content-Type-Options nosniff always;
\`\`\``;

const STEERED_MARKDOWN = `Here are the only three you need:

1. \`nginx -t\` — test the config before anything
2. \`systemctl reload nginx\` — apply changes without dropping connections
3. \`nginx -s reload\` — same, if you're not on systemd

That's it.`;

const NGINX_PLANNER = plannerReply(
  NGINX_MARKDOWN,
  "Lay out a comprehensive, production-ready configuration.",
);
const STEERED_PLANNER = plannerReply(STEERED_MARKDOWN, "User only wants the three essential commands.");

const STUB_SCRIPT: StubModelScript[] = [
  { responses: [{ text: CONVERSATION_TITLE }] },
  {
    model: MODEL,
    responses: [
      { text: NGINX_PLANNER, streamMs: NGINX_STREAM_MS },
      { text: STEERED_PLANNER, streamMs: STEERED_STREAM_MS },
    ],
  },
];

test("steering", async ({ app, request }) => {
  await stubLlmReset(request);
  await stubLlmConfigure(request, STUB_SCRIPT);

  await installDemoOverlay(app.page);
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  const composer = app.chat.userInput.textarea;

  await demoClick(app.page, composer);
  await demoTypeOnly(composer, NGINX_PROMPT, QUICK_TYPE_MS);
  await demoKeyOnly(app.page, "Shift+Enter");

  const steerBtn = app.page.getByTestId("chat-steer-button");
  await expect(steerBtn).toBeVisible({ timeout: E2E_LLM_TIMEOUT_MS });
  await app.chat.transcript.waitForPrepareTitle("Decision planning");
  await beat(700);

  await demoTypeOnly(composer, STEER_TEXT, QUICK_TYPE_MS);
  await expect(steerBtn).toBeVisible();
  await demoKeyOnly(app.page, demoSteerShortcut());

  await app.chat.transcript.waitForUserMessageCount(2, E2E_LLM_TIMEOUT_MS);
  await app.chat.transcript.expectTranscriptContains("nginx -t");
  await app.chat.transcript.expectTranscriptContains("systemctl reload nginx");
  await beat(2000);
});
