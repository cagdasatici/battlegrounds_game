/** WebGL2 capability probe. Kept free of Three.js so the welcome shell can run it without loading the renderer (QP01). */
export function hasWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch { return false; }
}
