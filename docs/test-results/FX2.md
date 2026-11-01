# FX2 test report

- pnpm verify: exit 0 (typecheck, lint, 75 unit files, content:validate, build).
- Unit: tests/unit/combat-text-format.test.ts (10 tests), tests/unit/settings-migrate.test.ts (4 tests): pass.
- Browser: `pnpm exec playwright test tests/browser/combat-text.spec.ts` passed. Real server and client; practice dummy hit showed red text "-10" (rgb(255, 77, 77)); Digit1 cast showed the "Fault Strike" pill and bottom-centre copy; Leave removed the overlay; no page errors.
- Full pnpm test:browser: NOT RUN (shared machine). tests/browser/settings.spec.ts not re-run after its version assertion changed 1 to 2.
- Edge arc and KO feed: implemented; KO text covered by unit tests only, no browser check.
- iPad: NOT RUN.
