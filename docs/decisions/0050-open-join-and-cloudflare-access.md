# 0050 Open join behind Cloudflare Access

Date: 2026-11-02. Status: accepted (owner request, delegated detail). Superseded in part by 0053 (the source-address binding of sessions no longer applies).

## Decision
- `OPEN_JOIN=1` adds `POST /api/open-session` `{ displayName: "Arel" | "Nora" }`. The server mints a normal session cookie (same store, CSRF and ticket path as invitation sessions). No invitation is needed.
- Identity is the browser cookie plus the source address hash (`CF-Connecting-IP`, trusted only when the TCP peer is loopback, which is true behind the tunnel). The address is stored as a SHA-256 hash only. Two players on one home network get separate sessions (the cookie differs), different networks differ by address. Repeating the same pick on the same browser and address keeps the session; any other pick revokes it and creates a new one, which fixes Nora being shown as Arel (the old session name was kept after a different profile was chosen).
- One room: Play joins the existing `play` arena room; the room is created by the first player and the next player joins it (`RoomDirectory.ensure`). No new multi-room code.
- Security is Cloudflare Access (email one-time PIN, one onboarding per device, long session) on `battle.cagdasatici.com`. The server also verifies the signed `Cf-Access-Jwt-Assertion` (RS256, audience and issuer pinned) before minting an open session, and refuses to start in production with `OPEN_JOIN=1` unless `CF_ACCESS_TEAM` and `CF_ACCESS_AUD` are set. If the Access policy is removed the game fails closed.
- Rationale versus the Atlas paired-device gate: same one-time-per-device onboarding, but no Caddy or custom pairing service; Cloudflare already fronts this hostname.

## Limits
- Access application created 2026-11-02 (Zero Trust Free, self-hosted app on `battle.cagdasatici.com`, email allow policy, 1 month session); production runs with `OPEN_JOIN=1`. NOT RUN: a real Access login from a phone on mobile data.
- Display names are limited to Arel and Nora in open mode; two people may pick the same name.
