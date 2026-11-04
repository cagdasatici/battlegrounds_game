# GR05 decision: one InputGate for overlays

- `apps/client/src/input/InputGate.ts` holds a set of reasons (menu, settings, moves, fighter, sparring, orientation, connection, graphics, round). Subscribers fire only on open to closed. `graphics` and `round` are defined but unwired until GR09 and GR08.
- On close: router.releaseAll (pointer owners, keyboard down-set via router release listener, deferred skills), takeEdges, sampler.reset, one immediate neutral packet when transport is active. The GR03 loop gate also composes `!gate.closed`.
- Gated: keyHold (except menu), setKeyboardMove, pointer down (only menu/fighter/scoreboard hit regions and Escape remain). Keydown with `repeat` is ignored and the down-set is cleared on release, so leaving a gate needs a fresh press. Text inputs/textarea/select/contenteditable targets never drive the fighter.
- Single top overlay: opening Settings, Moves, sparring setup or the fighter menu closes the others; Escape closes the top overlay before toggling the pause menu. Moves and Settings close on room leave.
- A cancelled touch skillDown that has not been sampled is removed (no late cast). Existing touch-shell assertion updated accordingly.
- Scoreboard stays nonmodal; opening it calls releaseAll once.
- Capture camera is stopped via its existing menuOpen input (`menuOpen || gate.closed`).
