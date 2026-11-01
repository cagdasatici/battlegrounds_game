# 0002 ESLint with typescript-eslint is not used (TypeScript 7.0.2)

Status: accepted (R01). Date: 2026-11-01.

`npm view typescript-eslint` (latest 8.72.1, canary 8.72.2-alpha.4) declares peer `typescript: >=4.8.4 <6.1.0`.
The repo pins TypeScript 7.0.2, outside that range. R01 step 3 says to record this, keep the boundary script, and add a
grep check for `setTimeout`/`setInterval` instead. No ESLint packages were added.

Consequences: `recommendedTypeChecked` and `no-floating-promises` are NOT enforced. `pnpm lint` runs
`ops/scripts/lint-boundaries.mjs` and `ops/scripts/lint-timers.mjs` (timers forbidden in `apps/server/src/{sim,kits,rooms}`).
Revisit when typescript-eslint declares TypeScript 7 support.
