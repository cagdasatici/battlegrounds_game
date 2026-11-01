# FX3 test report

- `pnpm verify`: exit 0 (typecheck, lint, unit tests, build, content:validate).
- `tests/unit/audio-bus.test.ts`: 9 passed (fake AudioContext: no sound before unlock, attenuation at 0/22.5/45 m, 16 voice cap, priority stealing, expiry, dispose, event mapping).
- Browser spec: none required by the slice; `pnpm test:browser` not run (parallel agents).
- Audibility of the sounds: NOT RUN (needs a person to listen).
- iPad Safari audio unlock: NOT RUN.
- Limitation: unlock happens on the first pointerdown/touchend/keydown inside Sfx, because main.ts is outside FX3 Owns.
