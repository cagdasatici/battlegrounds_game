import { makeAwakenedSequence } from "./awakened.js";

/**
 * td.a1 Cascade Chain (spec 15, awakened slot 1). Capture of any target state (standing, air, ragdoll), damage
 * [4,4,4,4,10] at captureTick + [0,8,16,24,32] (the capture hit is index 0, so five damage events in all, 26 HP),
 * release at +33 with R60 F5 U4. The caster has armor from the capture (definition armor onHit plus the shared
 * capture sequence armor); the victim stays open to third party damage (not cinematic). No area damage. The initial
 * hit is counterable; the scheduled hits are not (shared sequence).
 */
export const CASCADE_CHAIN = makeAwakenedSequence({ name: "cascadeChain" });
