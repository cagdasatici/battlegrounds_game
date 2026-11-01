# FX5 test report

- `pnpm vitest run tests/unit/capture-cam.test.ts`: 12 passed. Track length, 30 degrees, 4.5 m peak and return to 6.5 m;
  one start per capture; cancel on death, release, respawn, disconnect, menu, Reduced Motion and dispose; dispose is
  inert; Reduced Motion produces no track.
- `pnpm typecheck`: pass. Full `pnpm test`: 83 files, 1183 passed, 2 todo. Client build passes.

NOT RUN: a real capture in a browser (no scripted capture drive), feel on an iPad, motion comfort with the track.
