import type { AbilityHandler } from "../sim/AbilityRunner.js";
import { CAPTURE_BARRAGE } from "./td/captureBarrage.js";
import { CASCADE_CHAIN } from "./td/cascadeChain.js";
import { COUNTER } from "./td/counter.js";
import { DEEPFALL } from "./td/deepfall.js";
import { DRAG_SLAM } from "./td/dragSlam.js";
import { RIPTIDE_PURSUIT } from "./td/riptidePursuit.js";
import { SPLIT_TIDE } from "./td/splitTide.js";
import { THROW_CAPTURE } from "./td/throwCapture.js";

/** Tide Duelist handlers. T13 adds captureBarrage, dragSlam, throwCapture and counter; T16 the awakened four. */
export const TD_HANDLERS: AbilityHandler[] = [
  CAPTURE_BARRAGE, DRAG_SLAM, THROW_CAPTURE, COUNTER, CASCADE_CHAIN, DEEPFALL, SPLIT_TIDE, RIPTIDE_PURSUIT,
];
