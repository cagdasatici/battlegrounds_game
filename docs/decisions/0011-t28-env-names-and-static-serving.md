# 0010 T28 environment names and static serving

Date: 2026-11-01. Status: accepted for T28.

## Conflict
Spec section 24 names the production keys `HOST`, `PORT`, `PUBLIC_ORIGIN`, `ROOM_CAPACITY`, `DATA_DIR`, `LOG_LEVEL`. The T01 to T18 code used ad hoc `EB_DATA_DIR`, `EB_ORIGINS`, `EB_BUILD_ID`, `EB_INSECURE_COOKIES`. The spec's numeric and contract rules rank above defaults, so the spec names win.

## Rules chosen
1. Spec names replace the `EB_*` ones. `BUILD_ID` and `STATIC_DIR` are added. `EB_ALLOW_HTTP_ORIGIN` and `EB_ALLOW_NONLOOPBACK` are explicit local-test overrides; production otherwise requires an https `PUBLIC_ORIGIN` and a loopback `HOST`.
2. `ROOM_CAPACITY` is validated to equal 4 but not wired: `MAX_CLIENTS` is a shared protocol constant and the scope is fixed at four players.
3. `secureCookies` derives from the `PUBLIC_ORIGIN` scheme, so `EB_INSECURE_COOKIES` is removed.
4. The Node process serves `apps/client/dist` itself (spec section 17: one same origin entry). No new dependency; a small GET-only handler registered after the API routes.
5. `LOG_LEVEL` is validated only; the logger has no levels yet.
6. No Dockerfile: the spec's target is a Mac Studio under launchd, so a container would be an unrequested second deployment path.
