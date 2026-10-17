# Runvane on terra

Runvane as a seat-based agent on terra, next to the Claude Code remote-control
seats. One harness process runs on terra as the `runvane` service user and
serves API and UI on one port. Every seat is an ssh sandbox the harness drives
as that unix user: the project seats on terra itself, and the Mac over ssh.

Decisions (2026-10-17): harness on terra; UI open on the LAN with no login;
frontend served by the backend; the root admin seat is not registered yet;
first seats are the Mac and the runvane seat.

## What terra-config provides (admin seat)

Adapt to the site conventions; the shapes below are what the harness needs.

```nix
# site/runvane.nix (sketch)
systemd.services.runvane = {
  description = "runvane harness, as runvane on :52230";
  wantedBy = [ "multi-user.target" ];
  after = [ "network-online.target" ];
  wants = [ "network-online.target" ];
  unitConfig.RequiresMountsFor = "/data/projects/runvane";
  path = with pkgs; [ nodejs_22 git openssh gnutar gzip coreutils bash ];
  environment.HOME = "/data/projects/runvane/service";
  serviceConfig = {
    User = "runvane";
    Group = "runvane";
    WorkingDirectory = "/data/projects/runvane/service";
    EnvironmentFile = "/data/projects/runvane/service/runvane.env";
    ExecStart = "/data/projects/runvane/service/app/scripts/terra/start.sh";
    Restart = "on-failure";
    RestartSec = 5;
  };
};

# deploy.sh runs in the service user's shell: node for the builds,
# prisma-engines for `prisma migrate deploy` (the CLI cannot download an
# engine on NixOS; the running app is engine-free).
users.users.runvane.packages = with pkgs; [ nodejs_22 prisma-engines ];

# Each seat the harness drives: node on the seat user's login PATH, and the
# harness key (printed by deploy.sh) authorized for that user.
users.users.claude-runvane.packages = [ pkgs.nodejs_22 ];
users.users.claude-runvane.openssh.authorizedKeys.keys = [ "ssh-ed25519 AAAA... runvane-harness@terra" ];

networking.firewall.allowedTCPPorts = [ 52230 ];
```

The service user needs the Gitea deploy key or read access to
`timur.seitosmanov/runvane` for `deploy.sh` to clone.

## Deploy (as the `runvane` user)

```bash
cp app/scripts/terra/runvane.env.example ~/runvane.env   # first time: edit PORT and paths
~/app/scripts/terra/deploy.sh                           # or: deploy.sh <branch|tag>
```

`deploy.sh` is idempotent: clone or fetch, detached checkout, `npm ci` and
builds for backend and frontend, `prisma migrate deploy`, and the harness ssh
key. It ends by printing the public key. The admin then restarts the unit:
`systemctl restart runvane`. Upgrades are the same two commands.

State lives under `~/data` (the SQLite file, sandbox key material). Two kinds
of state still live under the checkout's `backend/` because the app resolves
them from its working directory: uploads (`backend/data/`) and knowledge
indexes (`backend/.knowledge/`). The checkout is on the tank dataset, and
`deploy.sh` never cleans untracked files, so they survive upgrades.

## The Mac as a seat

On the Mac: System Settings, General, Sharing, Remote Login on, limited to
your user. Append the harness public key to `~/.ssh/authorized_keys`. Node 22
or newer must be reachable from a login shell (`zsh -lc 'node -v'`), because
the harness starts the tool-host through the user's login shell; the login
profile must not print anything, or it corrupts the wire protocol.

Check from terra as the `runvane` user before registering:

```bash
ssh -i ~/.ssh/id_ed25519 timurseitosmanov@<mac-host> 'exec "$SHELL" -lc "node -v"'
```

The sandbox is unreachable while the Mac sleeps; a chat bound to it fails at
the first tool call until the Mac is back.

## Terra seats

A seat is the project's `claude-<project>` user over ssh to 127.0.0.1. It has
the same reach the Claude Code seat has, because it is the same user. Check:

```bash
ssh -i ~/.ssh/id_ed25519 claude-runvane@127.0.0.1 'exec "$SHELL" -lc "node -v"'
```

## Register seats and the model

```bash
cp app/scripts/terra/seats.example.json ~/seats.json   # edit the Mac host name
ANTHROPIC_API_KEY=sk-ant-... node app/scripts/terra/seed-seats.mjs --api http://127.0.0.1:52230 --seats ~/seats.json
```

Per seat this creates or updates one sandbox and one agent of the same name.
The agent's gates: exec runs allowlisted prefixes without asking and asks for
anything else; reads are allowed inside the seat's roots; writes inside the
roots ask. The key is read from the environment only. In a chat, pick the
seat's sandbox and its agent.

## Verify

```bash
curl -s http://10.0.0.100:52230/health
```

Open `http://10.0.0.100:52230` from the Mac, start a chat on the runvane seat,
and ask for `whoami` and `pwd`: the answer must be `claude-runvane` in
`/data/projects/runvane/repo`.

## Known gaps

- Context-file preinjection (the CLAUDE.md equivalent) is not wired for remote
  sandboxes (`backend/src/contracts/preinject.ts`); seat memory does not
  auto-load. The agent's system prompt carries standing instructions instead.
- The UI has no login. Anyone on the LAN can use every registered seat as that
  user. The root admin seat stays unregistered for that reason.
- Uploads and knowledge indexes live under the checkout (see Deploy).
