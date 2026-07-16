# runvane sandbox image

A plain, well-stocked dev box for agents: git, ripgrep/fd, jq, curl, python3
(+pipx/uv), node 22 (+pnpm), build-essential, sqlite, net tools — plus sshd
and a `dev` user (uid 1000). No runvane code is baked in: on first connect the
app's ssh machinery deploys and runs the in-repo tool-host automatically, so
the image stays generic and slow-aging (publishable to a registry later).

Runvane builds this automatically on first sandbox creation (tag
`runvane-sandbox:latest`). Manual build:

    docker build -t runvane-sandbox:latest sandbox/

How runvane uses a container made from it:

- created via `POST /api/tool-sandboxes/docker` ({ name, mounts, image? }) —
  requested host paths are bind-mounted in (paths are the DOCKER DAEMON
  host's: identical to the harness host under rv-dev's dind, not for
  sibling/remote daemons);
- a per-sandbox ed25519 key is generated under `~/.runvane/sandboxes/<id>/`
  (RUNVANE_SANDBOX_DATA_DIR overrides) and installed as `dev`'s
  authorized_keys;
- the sandbox is registered as a normal **ssh** sandbox whose transport is
  `-o ProxyCommand=docker exec -i -u root <container> /usr/sbin/sshd -i` —
  real ssh, no published ports, works wherever the `docker` CLI works;
- deleting the sandbox removes the container and the key material.
