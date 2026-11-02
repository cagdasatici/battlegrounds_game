/**
 * QP01: everything that pulls in Three.js or Rapier, behind one dynamic import.
 * main.ts loads this only when the arena is first needed (Play/Practice), so the welcome screen is interactive without the renderer.
 */
export { WebGLRenderer } from "three";
export { GameScene, isSoftwareRenderer } from "./scene/GameScene.js";
export { createRapierCollide, initRapier } from "./net/RapierCollide.js";
export { CameraRig, fighterMarkers, framingOk, projectPoint } from "./scene/CameraRig.js";
export { registerPresentation } from "./fx/index.js";
export { rayCoverLength } from "./fx/AttackTelegraphs.js";
export { CaptureCam } from "./fx/CaptureCam.js";
export { GameLoop } from "./app/GameLoop.js";
