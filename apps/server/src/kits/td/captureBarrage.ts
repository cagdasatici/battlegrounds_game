import { makeSequenceHandler } from "./sequence.js";

/**
 * td.b1 Current Bind (spec 15, captureBarrage). Capture on the initial hit (not cinematic), damage
 * [4,4,4,4,8] at captureTick + [0,10,20,30,42], release at +43 with R60 F7 U3. Supports airborne ragdoll
 * but not grounded ragdoll. Caster armor during the capture; the victim stays open to third party damage.
 */
export const CAPTURE_BARRAGE = makeSequenceHandler({
  name: "captureBarrage",
  eligible: (target, pose) => !(target.action === "Ragdolled" && pose.grounded),
});
