# HELP1 verification · 1 November 2026

Code commit: `7cfc40d`, branch `codex/help1`, worktree `/private/tmp/eb-help1`.
Prerequisites T18c (84f5cf8) and T18d (28239f4) present in base 971225f.
Status: IMPLEMENTED (DEVICE CHECK PENDING).

Standalone mountHowToPlay offers Touch/Keyboard controls, shipped labels from Lobby helpers, invitation/Ready instructions, practice guidance, optional sparring copy, injected callbacks and listener cleanup. No shared entry-point edits. HELP2 owns Welcome/practice integration. Existing T30 checkout left untouched.

## Executed checks

- Targeted Playwright: 3/3 PASS, local Google Chrome, 1024×768 and 1180×820. Both modes, action mappings, shipped labels, sparring flag off/on, keyboard navigation/activation, callback counts, repeated mount/dispose and detached-button cleanup.
- Six HELP1 PNG screenshots in this directory. Touch and lower-action captures visually inspected; automated horizontal overflow check passes at both sizes.
- pnpm typecheck: PASS; pnpm lint: PASS (also executed on Node 24.22.2).
- pnpm test tests/unit --maxWorkers=2 on Node 24.22.2: 58 files, 1058 tests PASS.
- pnpm build (including assets:audit): PASS; existing large chunk warning.
- pnpm content:validate: PASS, 36 abilities.
- git diff --check: PASS.
- pnpm verify: INCOMPLETE. Typecheck/lint passed; full test stage stopped producing output after RUN and was interrupted. Retried on Node 24.22.2 and with two workers with the same stall. Full integration suite is not claimed as passed.

## Environment and limitations

Offline install lacked cached tarballs; existing dependency directories were copied with no version or lockfile changes. Initial symlinked dependencies on Node 26 caused a prediction object-identity failure. With independent dependency links on Node 24, that test passed 22/22 and the unit suite passed 1058/1058. Build/content/browser ran on Node 26.10.0; type/lint/unit checks also ran on required Node 24.22.2. Completed network/tsx checks needed loopback/IPC permission after initial sandbox EPERM.

Both physical iPads: NOT RUN (DEV1). No gameplay/auth changes, invitations or deployment. HELP2 can consume the component. Full repository verification remains unresolved.

Remote push was rejected by automatic approval review: exporting private implementation/test artifacts to the GitHub remote requires explicit authorization. Commits remain local.

## Reconciliation re-run · 2 November 2026 (HEAD bee74a8)

HELP1 code (`7cfc40d`, also integrated as `0c4807c`) is an ancestor of main; the ledger row was stale TODO. No code changed in this pass.

- pnpm typecheck, pnpm lint (incl. boundaries, timers): PASS.
- pnpm test tests/unit --maxWorkers=2: 74 files, 1225 tests PASS.
- tests/browser/how-to-play.spec.ts, one worker: 3/3 PASS.
- pnpm build: PASS.
- content:validate: not re-run (no data changed).
- No dedicated unit test file exists for HowToPlay; coverage is the browser spec only (controls, mappings, sparring flag, cleanup).
- Physical iPad checks: NOT RUN (DEV1).
