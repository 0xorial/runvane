#!/bin/sh
# Install the tunnel user's authorized key, then run sshd in the foreground.
set -e

install -d -m 700 -o tunnel -g tunnel /home/tunnel/.ssh

# Public key comes from a mounted file (compose) or an env var.
if [ -f /run/secrets/tunnel_authorized_key ]; then
  cat /run/secrets/tunnel_authorized_key > /home/tunnel/.ssh/authorized_keys
elif [ -n "${TUNNEL_AUTHORIZED_KEY:-}" ]; then
  echo "$TUNNEL_AUTHORIZED_KEY" > /home/tunnel/.ssh/authorized_keys
else
  echo "FATAL: no tunnel public key (mount ./keys/tunnel.pub or set TUNNEL_AUTHORIZED_KEY)" >&2
  exit 1
fi

chmod 600 /home/tunnel/.ssh/authorized_keys
chown -R tunnel:tunnel /home/tunnel/.ssh

exec /usr/sbin/sshd -D -e
