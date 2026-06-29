# AI web browsing enabler — single "mega" container.
#
# Base = Steel's production API image. It already ships chromium + xvfb + dbus +
# nginx + the bundled UI/session-viewer, started by /app/api/entrypoint.sh.
# On top we add three processes, all run under supervisord:
#   - autossh     : maintains `ssh -D` SOCKS5 to the exit node (egress)
#   - searxng     : the search half (Steel has no search)
#   - caddy       : one front door (search at /, Steel at /steel, CDP at /cdp)
#
# What we deliberately do NOT add (this is the crawl4ai stack, now cut):
#   - redis                 -> Steel needs no datastore
#   - Xvfb/fluxbox/x11vnc/noVNC -> Steel's CDP screencast is the takeover viewer
FROM ghcr.io/steel-dev/steel-browser-api:latest

USER root

# --- system deps: searxng runtime, caddy repo tooling, ssh egress, supervisor ---
# No compilers/-dev libs: every searxng requirement (lxml, msgspec, granian, …)
# ships manylinux aarch64/x86_64 wheels, so pip needs no build toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv \
      git openssh-client autossh \
      supervisor curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https \
 && rm -rf /var/lib/apt/lists/*

# --- Caddy (official apt repo) ---
RUN curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
 && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      | tee /etc/apt/sources.list.d/caddy-stable.list \
 && apt-get update && apt-get install -y --no-install-recommends caddy \
 && rm -rf /var/lib/apt/lists/*

# --- SearXNG (cloned; requirements installed into its own venv, run from source) ---
# Mirrors SearXNG's own container build: install requirements.txt +
# requirements-server.txt (granian) into a venv and run `granian searx.webapp:app`
# from the source tree. We do NOT `pip install -e .` — its editable build hook
# imports runtime deps (msgspec) before they exist and fails.
ARG SEARXNG_REF=master
RUN useradd --system --create-home --home-dir /usr/local/searxng searxng \
 && git clone --depth 1 --branch ${SEARXNG_REF} https://github.com/searxng/searxng /usr/local/searxng/searxng-src \
 && python3 -m venv /usr/local/searxng/venv \
 && /usr/local/searxng/venv/bin/pip install --no-cache-dir -U pip setuptools wheel \
 && /usr/local/searxng/venv/bin/pip install --no-cache-dir \
      -r /usr/local/searxng/searxng-src/requirements.txt \
      -r /usr/local/searxng/searxng-src/requirements-server.txt \
 && chown -R searxng:searxng /usr/local/searxng

# --- our config + glue ---
COPY searxng/settings.yml /etc/searxng/settings.yml
COPY Caddyfile           /etc/caddy/Caddyfile
COPY supervisord.conf    /etc/supervisor/conf.d/enabler.conf
COPY entrypoint.sh       /usr/local/bin/enabler-entrypoint.sh
RUN chmod +x /usr/local/bin/enabler-entrypoint.sh \
 && mkdir -p /var/log/supervisor /etc/searxng /data/logs /tmp/steel-browser-exports /app/.cache

# Headless (Steel's default): its entrypoint starts no Xvfb, and headful chromium
# would need an X server on :10. Human takeover still works — Steel's session
# viewer is CDP-screencast + Input.dispatch{Mouse,Key}Event, which work headless.
# (For headful/stealth later: add an `Xvfb :10` supervisord program + dbus.)
#
# NOTE: PROXY_URL is set but is a NO-OP in this Steel build (defined in its env
# schema yet never consumed). Egress is requested PER CALL via the `proxyUrl`
# field on /v1/scrape and /v1/sessions — see README. The internal-only network
# is the real guard: a call without proxyUrl simply can't reach the internet.
ENV PROXY_URL=socks5://127.0.0.1:1080 \
    CHROME_HEADLESS=true \
    DOMAIN=localhost:3000 \
    CDP_DOMAIN=localhost:9223 \
    SEARXNG_SETTINGS_PATH=/etc/searxng/settings.yml

EXPOSE 8080 3000 9223
ENTRYPOINT ["/usr/local/bin/enabler-entrypoint.sh"]
