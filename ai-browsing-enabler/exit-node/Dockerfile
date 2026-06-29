# Reference exit node: a minimal, forward-only SSH egress endpoint (~15 MB).
# Its only job is to accept the enabler's `ssh -D` and let traffic exit from
# THIS box's IP. Run it as a container on your laptop (reference/test) or as a
# plain image on a real VPS (production exit).
FROM alpine:3.20

RUN apk add --no-cache openssh-server \
 && ssh-keygen -A \
 && adduser -D -s /sbin/nologin tunnel \
 && echo "tunnel:$(head -c 18 /dev/urandom | base64)" | chpasswd
# `adduser -D` leaves the password field `!`, which OpenSSH treats as a LOCKED
# account and rejects for ALL auth methods (incl. pubkey) — "account is locked".
# OpenSSH also treats `*` as locked, so we set a real random hash: the account is
# unambiguously unlocked (pubkey works) and the random password is never usable
# because PasswordAuthentication is off.

# Forward-only hardening: keys only, TCP forwarding for the SOCKS tunnel, nothing else.
# PREPEND (not append): Alpine's stock sshd_config ships an active
# `AllowTcpForwarding no`, and OpenSSH uses the FIRST occurrence of a keyword —
# so appended directives lose. Putting ours first makes them win.
RUN { printf '%s\n' \
      'PermitRootLogin no' \
      'PasswordAuthentication no' \
      'PubkeyAuthentication yes' \
      'AllowTcpForwarding yes' \
      'AllowAgentForwarding no' \
      'X11Forwarding no' \
      'PermitTunnel no' \
      'GatewayPorts no' \
      'AllowUsers tunnel'; \
      cat /etc/ssh/sshd_config; \
    } > /etc/ssh/sshd_config.new && mv /etc/ssh/sshd_config.new /etc/ssh/sshd_config

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]
