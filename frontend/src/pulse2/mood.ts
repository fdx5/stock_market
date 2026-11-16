import * as THREE from "three";

/** The deep-dive's light follows the market: rises run yellow → orange → red with the
 *  size of the gain, a flat day is violet, falls deepen from sky blue to a dark ocean
 *  blue. Returns a linear-space colour for the shaders. */
const STOPS: [number, string][] = [
  [-7, "#0c3cc8"],   // a heavy fall: deep, dark ocean blue
  [-4.5, "#1b80ff"],
  [-2.5, "#28acff"],
  [-1.0, "#3cc8ff"],
  [-0.35, "#5fdcff"], // a small fall: bright cyan-sky blue
  [-0.3, "#9a5cff"],  // flat: violet
  [0.3, "#9a5cff"],
  [0.35, "#ffe14a"],  // a small rise: yellow
  [1.8, "#ffb12a"],
  [3.2, "#ff7a1a"],   // orange
  [5.0, "#ff3b1f"],
  [8.0, "#e8102a"],   // a big rise: red
];
const parsed = STOPS.map(([v, hex]) => [v, new THREE.Color(hex)] as const);

export function moodColor(changePct: number | null | undefined, out = new THREE.Color()) {
  const c = changePct == null || !Number.isFinite(changePct) ? 0 : changePct;
  if (c <= parsed[0][0]) return out.copy(parsed[0][1]);
  for (let i = 1; i < parsed.length; i++) {
    const [v, col] = parsed[i];
    if (c <= v) { const [v0, c0] = parsed[i - 1]; return out.copy(c0).lerp(col, (c - v0) / Math.max(1e-6, v - v0)); }
  }
  return out.copy(parsed[parsed.length - 1][1]);
}

/** 0 for flat, up to 1 for a ±6 % day: how much the scene's energy is raised. */
export const moodStrength = (changePct: number | null | undefined) => Math.min(1, Math.abs(changePct ?? 0) / 6);
