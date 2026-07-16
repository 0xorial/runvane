# The runvane sandbox image: a plain, well-stocked dev box an agent can work
# in. Deliberately NO tool-host baked in — runvane's existing ssh machinery
# auto-deploys the in-repo tool-host on first connect (ssh-deploy.ts), so this
# image ages slowly and can later be published (e.g. Docker Hub) as-is.
#
# The container's requirements from runvane's side are only:
#   - a `dev` user (uid 1000) whose authorized_keys runvane installs at create
#   - sshd available for per-session `sshd -i` over `docker exec` (no daemon)
#   - node >= 22 + tar for the tool-host auto-deploy
#
# Everything else is agent quality-of-life tooling.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-server ca-certificates curl wget gnupg \
      git jq ripgrep fd-find tree less vim nano \
      unzip zip tar xz-utils bzip2 rsync file \
      build-essential pkg-config \
      python3 python3-pip python3-venv pipx \
      sqlite3 \
      procps iproute2 iputils-ping dnsutils netcat-openbsd \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s "$(command -v fdfind)" /usr/local/bin/fd

# node 22 (the tool-host runs via `node --experimental-strip-types`).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm

# uv: the modern python package runner agents reach for.
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh

# sshd is used in inetd mode (`sshd -i` per docker-exec'd session): host keys
# and the privsep dir must exist; auth is pubkey-only as the dev user.
RUN ssh-keygen -A \
    && mkdir -p /run/sshd \
    && printf '%s\n' \
      'PasswordAuthentication no' \
      'KbdInteractiveAuthentication no' \
      'PermitRootLogin no' \
      'UsePAM no' \
      'AcceptEnv LANG LC_*' \
      >> /etc/ssh/sshd_config

# ubuntu:24.04 ships an `ubuntu` user squatting uid 1000 — replace it with dev.
RUN userdel -r ubuntu 2>/dev/null || true \
    && useradd -m -u 1000 -s /bin/bash dev \
    && mkdir -p /workspace \
    && chown dev:dev /workspace

USER dev
WORKDIR /workspace

# A sandbox is a box, not a service: PID 1 just keeps it alive. Each ssh
# session is served by `docker exec … sshd -i` from the harness side.
CMD ["sleep", "infinity"]
