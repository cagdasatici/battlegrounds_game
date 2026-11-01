# Deployment runbook (T28)

Nothing here has been run against a real host. Everything marked HOST STEP needs a machine, a hostname and accounts that the owner chooses. Nothing in the repository deploys, buys or sends anything.

## One-command start (T33a)

`pnpm play` is the owner shortcut on one machine: it checks Node 24 (warns with the PATH fix), runs `pnpm build` (skip with `--no-build`), creates an invitation (`--uses`, default 4; `--hours`, default 24) before the server starts, prints the link and a terminal QR code, then runs the production server and waits for `/healthz`. Modes (decision 0018):

- default / `--lan`: home-network HTTP. Detects the private IPv4 (prefers `en0`; `--host-ip <ip>` overrides), binds `0.0.0.0`, `PUBLIC_ORIGIN=http://<ip>:2567`, sets `EB_ALLOW_NONLOOPBACK=1`, `EB_ALLOW_HTTP_ORIGIN=1`, `EB_LAN_HTTP=1`. On the iPad: open the link in Safari, then Share > Add to Home Screen. If macOS asks to allow incoming connections for node, click Allow. Do not use on shared or public Wi-Fi.
- `--local`: loopback only (this computer).
- `--tailscale`: opt-in HTTPS through `tailscale serve --bg` (never Funnel); fails if Tailscale is not running with a DNS name.

`EB_LAN_HTTP=1` only drops the `Secure` cookie attribute and is refused unless HOST is non-loopback and `PUBLIC_ORIGIN` is `http://` with an RFC1918 IPv4. Defaults: `DATA_DIR=~/eb-data` (mode 700), `PORT=2567`, `BUILD_ID` = git short hash; override through the environment. Ctrl-C stops the server. The token appears only in the printed link. The Tailscale path is unit-tested with injected command output only; the LAN mode has not been run on a physical iPad.

## What ships

| File | Purpose |
|---|---|
| `apps/server/src/config/env.ts` | Environment schema. Invalid config exits with code 78 and a message that names variables, never values. |
| `apps/server/src/http/staticFiles.ts` | Serves `apps/client/dist` from the same origin (SPA fallback, no path escape, hashed assets cached). |
| `apps/server/src/main.ts` | Production entry: validated config, loopback bind, SIGTERM/SIGINT graceful drain. |
| `ops/deploy/env.example` | Template for the owner-only env file. |
| `ops/deploy/run-prod.sh` | Sources the env file and runs `pnpm start:prod`. |
| `ops/deploy/com.elementalbattlegrounds.server.plist` | launchd template (restart on failure, logs). |
| `ops/deploy/Caddyfile.public-profile` | Optional public HTTPS profile. |

Environment keys (spec section 24): `NODE_ENV`, `HOST`, `PORT`, `PUBLIC_ORIGIN`, `ROOM_CAPACITY` (must be 4), `DATA_DIR`, `LOG_LEVEL`, plus `BUILD_ID` and optional `STATIC_DIR`. Local-only escape hatches: `EB_ALLOW_HTTP_ORIGIN=1`, `EB_ALLOW_NONLOOPBACK=1`, `EB_LAN_HTTP=1` (home network, see below). The old `EB_DATA_DIR`, `EB_ORIGINS`, `EB_BUILD_ID`, `EB_INSECURE_COOKIES` names are gone. `LOG_LEVEL` is validated but the logger does not filter by level yet. Health: `GET /healthz` returns `{"ok":true}` with no player data; `GET /api/version` returns protocol version, content hash and build id.

## Install caveat: uWebSockets.js SSH URL

`pnpm-lock.yaml` records `uWebSockets.js` with the SSH URL `git@github.com:uNetworking/uWebSockets.js.git`. On a host without an SSH client or GitHub SSH key, `pnpm install --frozen-lockfile` can fail or hang on it. Either install from a machine that has access and copy `node_modules`, or give the host a GitHub deploy key. Do not change git config globally and do not edit the lockfile without a decision record. Verified in this worktree only with an already populated pnpm store.

## Local verification (no host needed)

```
pnpm install --frozen-lockfile
pnpm build
export NODE_ENV=production PORT=2567 PUBLIC_ORIGIN=http://127.0.0.1:2567 EB_ALLOW_HTTP_ORIGIN=1 DATA_DIR=$(mktemp -d) BUILD_ID=local
pnpm start:prod
curl -s http://127.0.0.1:2567/healthz
pnpm vitest run tests/integration/t28-production.test.ts   # spawns the production entry and joins two real clients
```

## HOST STEPS (first deployment)

1. Choose host and access path (decision needed, see below). Record hardware, OS, Node 24.22.2 and pnpm 10.28.0 versions.
2. Check out a tagged commit into a release directory, run `pnpm install --frozen-lockfile` and `pnpm build`, then `pnpm content:validate`.
3. Create a service account, a `chmod 700` data directory and a `chmod 600` env file outside the repository from `ops/deploy/env.example`. Set `PUBLIC_ORIGIN` to the exact HTTPS origin and `BUILD_ID` to the tag.
4. Start with `sh ops/deploy/run-prod.sh` (with `EB_ENV_FILE` set) and check `/healthz` and `/api/version` on loopback.
5. Put TLS in front (below). The Node process always stays on `127.0.0.1`.
6. Create invitations: `DATA_DIR=... pnpm --filter @eb/server exec tsx ../../ops/scripts/invite.ts https://your-origin 24 1`. The adult distributes the links; nothing sends them automatically.
7. Install the launchd job: edit the plist paths, copy to `/Library/LaunchDaemons/`, `launchctl bootstrap system <plist>`.
8. On both iPads: open the HTTPS URL, check certificate trust, WSS upgrade, audio activation, touch. Test once from another network. Record as device checks (NOT RUN until done).

## TLS and proxy

Default (spec section 23): private tailnet, `tailscale serve --bg http://127.0.0.1:2567`, check with `tailscale serve status`. Do not use Funnel. Both iPads need the Tailscale app connected. Verify the command against the installed Tailscale version.

Optional public profile: `ops/deploy/Caddyfile.public-profile` (Caddy obtains certificates automatically). Needs a domain, DNS, port forwarding.

Proxy rules for any front end: proxy the whole origin, not only one WebSocket path (Colyseus uses generated room paths); allow `Upgrade`/`Connection` headers; do not rewrite `Origin`; terminate TLS so browsers see `https` matching `PUBLIC_ORIGIN` (cookies are `Secure`).

Known gap for T29: per-IP rate limiting uses the socket address, which is `127.0.0.1` for every request behind a proxy, so all clients share one bucket. Colyseus also adds `Access-Control-Allow-Origin: *` and `X-Powered-By`, and no CSP is set. Mutating endpoints still check `Origin` exactly and cookies are `SameSite=Strict`. T29 should address these.

## Operations

- Logs go to stdout/stderr as JSON lines with secrets redacted; launchd writes them to the plist paths. Rotation (daily, 7 days, 100 MB cap) is not implemented in the repository; use `newsyslog` on macOS. HOST STEP.
- Update: announce, stop new joins, drain, back up `DATA_DIR`, switch release dir, `launchctl kickstart -k`. SIGTERM triggers a graceful Colyseus shutdown. There is no in-game shutdown announcement or join-stop yet (not implemented).
- Rollback: check out the previous tag, rebuild, restart. Old clients are refused by the content hash / protocol check until reload.
- Sleep: keep the Mac awake during sessions (`caffeinate` or Energy settings).

## Owner decisions needed

1. Access path: Tailscale Serve (default) or public Caddy profile, and for the latter a domain.
2. Which machine hosts (spec assumes the Mac Studio) and which service account.
3. Hostname for `PUBLIC_ORIGIN`.
4. Whether to fix the uWebSockets.js SSH lockfile URL (separate decision).
