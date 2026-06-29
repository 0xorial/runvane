#!/usr/bin/env bash
# Enabler PID 1: prep the SSH key + SearXNG secret, then hand off to supervisord.
set -euo pipefail

# 1) Private key for the egress tunnel (mounted read-only at /keys/tunnel).
install -d -m 700 /root/.ssh
if [ -f /keys/tunnel ]; then
  install -m 600 /keys/tunnel /root/.ssh/id_tunnel
else
  echo "WARN: /keys/tunnel not mounted — the egress tunnel cannot start." >&2
fi
touch /root/.ssh/known_hosts && chmod 600 /root/.ssh/known_hosts

# 2) First-boot SearXNG secret_key.
if grep -q 'CHANGE_ME' /etc/searxng/settings.yml; then
  key="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  sed -i "s/CHANGE_ME/${key}/" /etc/searxng/settings.yml
fi

# 3) Sanity: the tunnel target must be configured.
: "${EXIT_HOST:?set EXIT_HOST (the exit node host)}"
: "${EXIT_USER:=tunnel}"
: "${EXIT_PORT:=22}"
export EXIT_HOST EXIT_USER EXIT_PORT

exec supervisord -c /etc/supervisor/conf.d/enabler.conf -n
