import { expect, test } from "vitest";
import { Decoder, Encoder } from "../../apps/server/node_modules/@colyseus/schema/build/index.mjs";
import { ArenaState } from "../../apps/server/src/state/ArenaSchema.js";
import { PlayerSchema } from "../../apps/server/src/state/PlayerSchema.js";

// td and ea bank two bars of 35000 hundredths; a 16-bit wire field wrapped at 65536 and the Awaken button never fired.
test("meter100 = 70000 survives schema encode and decode", () => {
  const state = new ArenaState();
  const p = new PlayerSchema();
  p.meter100 = 70000;
  state.players.set("1", p);
  const bytes = new Encoder(state).encodeAll();
  const out = new ArenaState();
  new Decoder(out).decode(bytes);
  expect(out.players.get("1")!.meter100).toBe(70000);
});
