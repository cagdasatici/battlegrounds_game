/**
 * GFX01: sky dome material. A procedural gradient (nadir, horizon haze, mid sky, zenith) with a soft sun glow and a disc that sit in the
 * same direction as the directional light, so light, shadows and sky agree. Drawn on the existing camera-centred dome; unaffected by fog.
 */
import { BackSide, Color, ShaderMaterial, Vector3 } from "three";
import { normalizedSunDir, type EnvTheme } from "./theme.js";

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uZenith; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uNadir; uniform vec3 uGlow; uniform vec3 uSun;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float t = d.y;
  vec3 c;
  if (t < 0.0) c = mix(uHorizon, uNadir, min(1.0, -t * 2.0));
  else if (t < 0.28) c = mix(uHorizon, uMid, pow(t / 0.28, 0.8));
  else c = mix(uMid, uZenith, pow((t - 0.28) / 0.72, 0.7));
  float s = max(dot(d, uSun), 0.0);
  c += uGlow * (pow(s, 6.0) * 0.22 + pow(s, 48.0) * 0.45);
  c = mix(c, uGlow, exp(-abs(t) * 10.0) * 0.28 * (0.35 + 0.65 * s));
  float disc = smoothstep(0.9988, 0.9994, s);
  c = mix(c, vec3(1.0, 0.97, 0.88) * 1.6, disc);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function makeSkyMaterial(theme: EnvTheme): ShaderMaterial {
  const [x, y, z] = normalizedSunDir(theme);
  return new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: BackSide, depthWrite: false, fog: false,
    uniforms: {
      uZenith: { value: new Color(theme.sky.zenith) }, uMid: { value: new Color(theme.sky.mid) }, uHorizon: { value: new Color(theme.sky.horizon) },
      uNadir: { value: new Color(theme.sky.nadir) }, uGlow: { value: new Color(theme.sky.sunGlow) }, uSun: { value: new Vector3(x, y, z) },
    },
  });
}
