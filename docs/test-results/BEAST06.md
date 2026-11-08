# BEAST06

Commit d8a3ed5.

Executed on the final code: pnpm typecheck pass, pnpm lint pass, pnpm content:validate pass, pnpm build pass, tests/browser/beast.spec.ts pass.
pnpm test: 2078 passed, 1 failed, 3 skipped, 2 todo.

Failure: tests/integration/fb02-easy-bot.test.ts FB03, medium/hard bot damage ratio above the 0.9 limit (0.946, 0.962, 0.981).
Non-deterministic: this change passed 1 of 3 isolated runs; the previous commit e672e86 passed 4 of 4. Likely caused by this change; cause not isolated. Threshold not changed.

Limits: the beast sv.a1 effect ring (3.2 m) is smaller than its 9 m damage radius. Exit Beast and the countdown were not exercised in a browser.
Physical iPad and phone checks: NOT RUN.
