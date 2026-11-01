# Elemental Battlegrounds implementation contract

Read docs/spec.md and docs/tasks.md before changing code.
Implement one task ID at a time. Check its prerequisites first.
Treat Sonnet 5.5 Low and Sol 6.1 Low as selected execution agents.
Do not infer capabilities or change model settings from these names.

Authority order:
1. Explicit user requirements.
2. Specification local rules and numeric registry.
3. Per ability overrides.
4. Default handler semantics.
5. Acceptance tests consistent with the above.

Never claim an original game fact without an evidence ID.
D values are local design choices. C and X are not verified facts.
Do not copy Roblox or anime assets, audio, animation or UI artwork.
Use original shipped names. Keep reference labels in research only.
Do not expand the three fighter scope without a new specification.

Server decides position limits, hits, HP, cooldowns, forms and scores.
Clients send validated intent only. Never accept a target damage claim.
Use fixed 60 Hz simulation. Render timing never schedules damage.
All action timers use integer ticks. Auth expiry uses wall time.
Do not add setTimeout damage handlers or a second physics scheduler.
Every capture, listener, effect and room subscription has cleanup.
Use strict TypeScript and strict runtime message schemas.
Keep pure shared modules free of DOM, Three.js and server secrets.
Use exact dependency versions and the committed lockfile.

Before implementing an ability, add its definition and tests.
Test miss, block, counter, duplicate hit, interruption, death and expiry.
Test network behavior with real clients, not only mocked callbacks.
Physical iPad checks must be recorded as NOT RUN until actually run.
Do not report success from unexecuted tests or invented measurements.

Use rg for file/text discovery. Read relevant code before editing.
Keep each task small. No unrelated refactoring or package upgrades.
Resolve routine details autonomously within the approved contract.
If requirements conflict, document the conflict before choosing a rule.
For a broad new request, list concrete items and files and get scope
confirmation before exploring or editing beyond the current task.

Run pnpm typecheck, pnpm lint, relevant tests and pnpm build.
Run content:validate after data changes and assets:audit for assets.
Update docs/tasks.md with status and evidence, then commit coherently.
Report changed behavior, executed checks and actual limitations.
Never expose secrets in logs, chat, screenshots or version control.
Do not send invitations, deploy publicly or buy services automatically.

Keep each session to one task. When finished or around 50 steps,
recommend a fresh session with a 2 to 3 line handoff summary.

The task ledger uses TODO, IN PROGRESS, BLOCKED or DONE plus commit hash and test report path.
BLOCKED must name a concrete missing dependency. A completed code task with pending physical
checks is IMPLEMENTED, DEVICE CHECK PENDING rather than DONE.
