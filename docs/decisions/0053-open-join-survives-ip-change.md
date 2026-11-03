# 0053 Open-join session survives an IP change

Date: 2026-11-03. Status: accepted (owner approval in chat, 2026-11-03: "Approve: open-join session survives an IP change; supersede decision 0050's source-IP binding; rely on Cloudflare Access + HttpOnly cookie.").

## Decision
- Supersedes the source-address binding in decision 0050. `POST /api/open-session` keeps the existing session when the request carries a live `eb_session` cookie and the same `displayName`. The source address no longer has to match.
- The latest address hash is stored on the session (`SessionStore.setIpHash`) so the record stays current. The address is still stored only as a SHA-256 hash.
- A different `displayName` still revokes the old session and creates a new one (the Nora-shown-as-Arel fix from 0050 is unchanged).
- Everything else in 0050 stands: Cloudflare Access gates the hostname and the server verifies the signed Access token on every open-session call.

## Rationale
- Backlog OPEN01 and review E3: Cloudflare Access already authenticates the person and the HttpOnly, SameSite=Strict cookie identifies the browser. The address binding added no protection against a stolen cookie that Access does not already cover, and it broke play when a phone moved between wifi and mobile data (new session, lost seat).

## Limits
- A stolen cookie is usable from another address until the session expires or is revoked; mitigated by the Access gate in front of the hostname (the cookie alone does not reach the server without a valid Access token).
- A fresh join ticket during the reconnect window is still refused with SEAT_TAKEN for the same session; the seat is resumed through the reconnection token (unchanged room behaviour, not part of this decision).
