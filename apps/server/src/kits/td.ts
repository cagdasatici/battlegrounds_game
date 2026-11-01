import type { AbilityHandler } from "../sim/AbilityRunner.js";
import { CAPTURE_BARRAGE } from "./td/captureBarrage.js";
import { DRAG_SLAM } from "./td/dragSlam.js";

/** Tide Duelist handlers. T13 adds captureBarrage, dragSlam, throwCapture and counter; T16 the awakened four. */
export const TD_HANDLERS: AbilityHandler[] = [CAPTURE_BARRAGE, DRAG_SLAM];
