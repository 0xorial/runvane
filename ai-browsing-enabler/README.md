# AI web browsing enabler (+ SSH exit node)

A self-hostable **search + browse** backend for AI agents, whose web traffic
egresses through an **SSH exit node** of your choosing.

Two pieces:

| Component | What it is | Image size |
| --- | --- | --- |
| **`enabler/`** | One "mega" container: **Steel** (browse/scrape/markdown/DevTools/human-takeover) + **SearXNG** (search) + **Caddy** (one front door) + **autossh** (egress) under supervisord | ~base Steel (node+chromium) +~400 MB |
| **`exit-node/`** | Minimal forward-only `sshd`. The enabler `ssh -D`'s through it, so all web traffic exits from **its** IP. Reference impl; run locally to test or on a real VPS for production | ~15 MB |

This replaces the old `crawl4ai`-based exit-node stack. Cut along the way:
`redis`, and the whole `Xvfb + fluxbox + x11vnc + noVNC` desktop — Steel's
CDP screencast is the takeover viewer, with no X server.

## How egress works

```
   AI / agent ── http://localhost:8080 (search)  ──┐
              ── http://localhost:3000 (Steel API) ─┤   ingress (published ports)
                                                    ▼
            ┌──────────────── enabler ───────────────┐        ┌──── exit-node ────┐
            │ Steel  ─ PROXY_URL=socks5://127.0.0.1:1080 ──┐   │                    │
            │ SearXNG ─ outgoing.proxies socks5h://…:1080 ─┤   │  sshd (tunnel user)│
            │ autossh ─ ssh -N -D 127.0.0.1:1080 ──────────┼──►│  -D dynamic SOCKS  │──► internet
            └──────────────────────────────────────────────┘   └────────────────────┘
                 (internal network, NO direct internet)            (the only egress)
```

Steel passes `PROXY_URL` straight to Chromium's `--proxy-server=socks5://…`
(verified in `cdp.service.ts`), and SearXNG honours `socks5h://` upstream — so a
plain `ssh -D` SOCKS5 proxy serves both. No HTTP-proxy shim needed.

## Quick test on your laptop

```bash
# 1) generate the tunnel keypair (private stays local, public goes to the exit node)
ssh-keygen -t ed25519 -f keys/tunnel -N "" -C "enabler-egress"

# 2) build + run both containers
docker compose up -d --build

# 3) search works (proves SearXNG -> SOCKS -> exit-node -> web)
curl "http://localhost:8080/search?q=hello&format=json" | head

# 4) browse works (proves Steel -> SOCKS -> exit-node -> web); returns markdown.
#    NOTE: pass proxyUrl on every call — that is what routes egress through the
#    tunnel. `127.0.0.1:1080` is resolved inside the enabler (where Steel runs).
curl -X POST http://localhost:3000/v1/scrape \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","format":["markdown","links"],
       "proxyUrl":"socks5://127.0.0.1:1080"}'

# verify egress IP == exit-node: scrape an IP echo, expect the exit node's IP
curl -X POST http://localhost:3000/v1/scrape -H 'content-type: application/json' \
  -d '{"url":"https://api.ipify.org?format=json","format":["markdown"],
       "proxyUrl":"socks5://127.0.0.1:1080"}'

# 5) human takeover viewer (CDP screencast, click/type into the live page)
open http://localhost:3000/ui     # create a session with showControls+interactive
```

**Egress is per-call.** Steel's `PROXY_URL` env is defined but unused in the
current build, so pass `proxyUrl` on each `/v1/scrape` (or `/v1/sessions`) call.
You can't leak by forgetting it: the enabler has no direct internet (internal
network), so a call without `proxyUrl` simply fails instead of going direct.

**Why this is a real egress test, not a fake one:** the `enabler` is on an
`internal: true` docker network with no route to the internet. The `exit-node`
is the only service with outbound access. So steps 3–4 can *only* succeed if the
traffic flowed through the SSH SOCKS tunnel. (Locally the public IP is still your
laptop's — to see a *different* IP, run `exit-node/` on a VPS; see below.)

## Pointing at a real VPS exit node

```bash
cp .env.example .env        # set EXIT_HOST=your.vps, EXIT_USER=tunnel
# put keys/tunnel.pub into the VPS tunnel user's ~/.ssh/authorized_keys
#   (run the exit-node/ image there, or hand-configure a forward-only sshd)
docker compose up -d --build enabler   # enabler only; skip the local exit-node
```

Then a page that echoes the client IP (e.g. scrape `https://api.ipify.org`)
should report the **VPS** IP.

## The token-economy depth ladder (Steel)

An agent can start cheap and escalate only when needed:

1. **Overview** — `format:["metadata"]` + `links` → triage for ~hundreds of tokens
2. **Read** — `format:["readability"]` (or `markdown`) → main content, ads/nav stripped
3. **Structure** — `format:["cleaned_html"]` / `["html"]` → full DOM when attributes matter
4. **DevTools** — the CDP WebSocket on `:9223` → network, console, `Runtime.evaluate`,
   `Accessibility.getFullAXTree` (a compact semantic map, cheaper than HTML)

Note: this is tiering by *representation*, not automatic relevance compression —
Steel hands back the whole page in the chosen format (the one thing crawl4ai did
that Steel doesn't).

## Status — built & verified end-to-end (linux/arm64)

`docker compose build` + `up` succeed; search and proxied browse both confirmed
working, with the browse egress IP equal to the exit node's. Issues found and
fixed along the way (recorded so they don't bite again):

- **SearXNG install** — `pip install -e .` hits a `msgspec` build-hook error.
  Upstream's actual method: install `requirements.txt` + `requirements-server.txt`
  and serve via `granian searx.webapp:app` (not uwsgi / not `python -m searx.webapp`).
- **exit-node SSH "account is locked"** — Alpine `adduser -D` leaves the password
  field `!`; OpenSSH treats `!` *and* `*` as locked and rejects pubkey auth too.
  Set a real random hash (password login is off anyway).
- **exit-node forwarding refused** — Alpine's stock sshd ships an active
  `AllowTcpForwarding no`; OpenSSH honours the FIRST occurrence, so our directives
  must be **prepended**, not appended.
- **Steel "Missing X server"** — its entrypoint starts no Xvfb, so `CHROME_HEADLESS=false`
  can't launch. Headless is the default and the CDP-screencast takeover still works.
- **Proxy egress** — `PROXY_URL` env is a no-op in Steel; pass `proxyUrl` per call
  (see above). Chromium does remote DNS over `socks5://`, so no DNS leak.

Steel's base image is multi-arch (arm64 + amd64), so this builds on Apple Silicon
and x86 hosts alike.

Run `docker compose build` and watch those two logs first.
