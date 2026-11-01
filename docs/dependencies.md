# Dependencies

Exact pins, no caret or tilde. Baseline from spec section 17 (observed 1 Nov 2026).

| Package | Version | Where |
|---|---|---|
| colyseus | 0.18.10 | server, root (tests) |
| @colyseus/sdk | 0.18.9 | client, root (tests) |
| @colyseus/schema | 5.0.43 | server |
| @colyseus/ws-transport | 0.18.4 | server (peer of colyseus; added explicitly) |
| @dimforge/rapier3d-compat | 0.21.0 | client (server use arrives in T05) |
| three / @types/three | 0.187.0 | client / root |
| typescript | 7.0.2 | root |
| vite | 8.3.5 | client |
| vitest | 5.0.5 | root |
| @playwright/test | 1.64.1 | root |
| zod | 4.6.7 | shared |
| tsx | 4.23.15 | server (dev runner) |
| @types/node | 24.0.0 | root |

Transitive resolutions (including @colyseus/core) are recorded in `pnpm-lock.yaml`.

## Deviations (T01)

- **Node**: `.node-version` pins 24.22.2 (current Node 24 LTS per nodejs.org index). The development sandbox runs Node 22.23.4, so `engines` is `>=22.12`. Verified on 22 only.
- **pnpm**: pinned 10.28.0 (installed in the sandbox). The spec asks to check official release metadata; the registry shows a newer major. Not upgraded.
- **@types/node 24.0.0**: chosen to match Node 24; not verified against peers.
- **@colyseus/ws-transport 0.18.4** and **tsx 4.23.15** are additions not listed in section 17.
- **Ignored build scripts** (esbuild, msgpackr-extract): not approved; the smoke test and build pass without them.
- **Lint**: `pnpm lint` is an import-boundary script, not ESLint, until a full linter is justified.
