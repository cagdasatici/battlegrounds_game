# gr-GR01: active-session revocation (D, local design choice)

- Revocation closes the seat with code 4401 and reuses the normal leave cleanup. A dropped seat's reconnect reservation is cancelled by rejecting the Deferred returned by `allowReconnection` (installed @colyseus/core 0.18.24 exposes `reject`).
- Wall-clock sweep: at most once per 1,000 ms, rooms are checked for expired sessions; connected valid seats get one batched idle refresh per 60,000 ms (`SessionStore.touchMany`, never revives expired records).
- Hosted-sparring seats (`spar:` principals) are skipped by the session sweep; the SparringDirectory keeps owning them.
