import type { LlmRequest } from '../types.js';
import { stubUserText } from './stubLlm.helpers.js';

/** Models the demo stub advertises (so the multi-model picker has real-looking choices). */
export const DEMO_MODELS = ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4.6'];

function planner(assistantOutput: string, thinking = ''): string {
  return JSON.stringify({
    assistant_thinking: thinking,
    assistant_output: assistantOutput,
    tool_requests: [],
    followup: 'finalize',
  });
}

// Two genuinely different answers to the same question, so the multi-model
// compare shows a real difference in pick and voice.
const SKILL_GPT4O = `**Reading code you didn't write.** Most engineers optimize for *writing* code, but you spend far more time understanding unfamiliar systems — debugging, reviewing, onboarding. People who can quickly build an accurate mental model of someone else's code ship fixes faster and break less. It compounds: every system you can read is one you can safely change.`;

const SKILL_MINI = `**Writing clearly.** The bottleneck on most teams isn't typing speed — it's communication. A crisp PR description or a two-line message that prevents an hour-long meeting is pure leverage. Clear writing also forces clear thinking, so it makes the *code* better too.`;

const NGINX = `# Production Nginx reverse proxy

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

const STEERED = `Here are the only three you need:

1. \`nginx -t\` — test the config before anything
2. \`systemctl reload nginx\` — apply changes without dropping connections
3. \`nginx -s reload\` — same, if you're not on systemd

That's it.`;

const TLS = `**TLS 1.3 improves on 1.2 in four big ways:**

- **1-RTT handshake** (and 0-RTT resumption) — roughly halves connection latency.
- **Trimmed cipher suites** — legacy/insecure options (RSA key exchange, CBC, RC4) are gone, so misconfiguration is far harder.
- **Forward secrecy by default** via ephemeral key exchange.
- **Encrypted handshake** — certificate details are hidden from passive observers.`;

const GENERIC = `Here's a concise, useful take: focus on the smallest change that proves the idea, ship it, and let real usage tell you what to build next.`;

/** A relevant conversation title for the demo prompts. */
export function demoTitle(request: LlmRequest): string {
  const u = stubUserText(request).toLowerCase();
  if (u.includes('underrated skill')) return 'Underrated engineering skills';
  if (u.includes('reverse proxy') || u.includes('nginx')) return 'Nginx reverse proxy setup';
  if (u.includes('tls 1.3')) return 'TLS 1.3 vs 1.2';
  return 'New conversation';
}

/** The planner reply (rich markdown answer), varied by prompt intent and model. */
export function demoPlannerReply(request: LlmRequest, model: string): string {
  const u = stubUserText(request).toLowerCase();
  if (u.includes('3 essential commands') || u.includes('just give me the 3')) return planner(STEERED);
  if (u.includes('underrated skill')) {
    return planner(model.includes('mini') ? SKILL_MINI : SKILL_GPT4O, 'Pick the single most leveraged skill.');
  }
  if (u.includes('reverse proxy') || u.includes('nginx')) {
    return planner(NGINX, 'Lay out a comprehensive, production-ready configuration.');
  }
  if (u.includes('tls 1.3')) return planner(TLS, 'Summarize the concrete improvements.');
  return planner(GENERIC);
}
