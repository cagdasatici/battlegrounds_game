# 0018 Home-network HTTP as the default way to play (T33a)

Date: 2026-11-01. Status: owner decision, recorded while implementing T33a.

## Conflict
Spec section 23 and the T28 runbook default to HTTPS (Tailscale Serve) with `Secure` cookies. The owner says the iPads are always on home Wi-Fi and wants the simplest start. Explicit user requirements outrank the spec default (AGENTS.md authority order), so the spec default is relaxed for the home network only.

## Options
- A: Tailscale Serve, HTTPS inside a tailnet. Kept as opt-in: `pnpm play --tailscale`. Never Funnel.
- B: Plain HTTP on the home LAN. Chosen as the default: `pnpm play` (alias `--lan`).
- C: Public HTTPS domain through Caddy. Planned later; no change now.

## Rules chosen
1. `pnpm play` finds the private IPv4 of the active interface (prefers `en0`, RFC1918 only; `--host-ip` overrides), binds `HOST=0.0.0.0` with `EB_ALLOW_NONLOOPBACK=1`, sets `PUBLIC_ORIGIN=http://<ip>:<port>` and `EB_ALLOW_HTTP_ORIGIN=1`.
2. New escape hatch `EB_LAN_HTTP=1` drops only the `Secure` cookie attribute. `HttpOnly`, `SameSite=Strict`, exact Origin checks, invitations and rate limits are unchanged.
3. The server refuses `EB_LAN_HTTP=1` (exit 78) unless HOST is non-loopback AND `PUBLIC_ORIGIN` is `http://` with a dotted-quad address in 10/8, 172.16/12 or 192.168/16. Public IPs, domain names, https and CGNAT (100.64/10) are refused. Tests: `tests/unit/t28-env.test.ts`.
4. `--local` stays loopback only. Tailscale is never chosen automatically any more.

## Risks accepted
Traffic and the session cookie are readable by anyone on the same Wi-Fi. Acceptable only for a trusted home network; do not use the LAN mode on shared or public Wi-Fi. The OS firewall may prompt once to allow incoming connections for node.

## Impact
`ops/scripts/play.ts`, `ops/scripts/lib/play.ts`, `apps/server/src/config/env.ts`, `apps/server/src/main.ts`, runbook, README.
