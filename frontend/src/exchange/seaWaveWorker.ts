/// <reference lib="webworker" />
/* Builds the tileable wave field for the live window sea off the main thread.
 * Periodic sum of wind-driven ocean waves (integer wave numbers -> seamless tile), stored as
 * RG = surface slope (d/dx, d/dy), B = height, A = slope second moment (for LEAN filtering). The shader layers this tile at several
 * scales and directions, so the sea never repeats visibly. */

export type SeaWaveIn = { size: number; seed: number };
export type SeaWaveOut = { data: Uint8Array; size: number };

const scope = self as unknown as DedicatedWorkerGlobalScope;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildSeaWaves(size: number, seed: number): Uint8Array {
  const rand = rng(seed);
  type Wave = { m: number; n: number; a: number; p: number };
  const waves: Wave[] = [];
  const used = new Set<string>();
  // Wind toward +x. Wave numbers 2..56 cycles per tile, log-spread; directional spread ~cos^4 with a little
  // cross-sea so crests break up into short, irregular ridges like a real calm sea (no parallel stripes).
  for (let tries = 0; waves.length < 120 && tries < 4000; tries++) {
    const kappa = Math.exp(Math.log(2) + rand() * (Math.log(56) - Math.log(2)));
    let theta = (rand() * 2 - 1) * Math.PI * 0.5;
    theta *= Math.pow(rand(), 0.6);
    if (rand() < 0.12) theta += Math.PI * (rand() < 0.5 ? 0.5 : -0.5) * rand();
    const m = Math.round(kappa * Math.cos(theta));
    const n = Math.round(kappa * Math.sin(theta));
    if (m === 0 && n === 0) continue;
    const key = `${m},${n}`;
    if (used.has(key) || used.has(`${-m},${-n}`)) continue;
    used.add(key);
    const k = Math.hypot(m, n);
    // Height ~ k^-1.75 -> slope ~ k^-0.75: energy mostly in the longer waves, fine ripples still visible.
    const a = Math.pow(k, -1.75) * (0.55 + rand() * 0.9);
    waves.push({ m, n, a, p: rand() * Math.PI * 2 });
  }

  const count = size * size;
  const h = new Float32Array(count);
  const sx = new Float32Array(count);
  const sy = new Float32Array(count);
  const TAU = Math.PI * 2;
  // Separable trig: cos(ax + by + p) from per-row/per-column tables -> fast even for 120 waves at 256^2.
  const cx = new Float32Array(size), sxT = new Float32Array(size), cy = new Float32Array(size), syT = new Float32Array(size);
  for (const w of waves) {
    for (let i = 0; i < size; i++) {
      const ax = (TAU * w.m * i) / size + w.p;
      cx[i] = Math.cos(ax); sxT[i] = Math.sin(ax);
      const ay = (TAU * w.n * i) / size;
      cy[i] = Math.cos(ay); syT[i] = Math.sin(ay);
    }
    const kx = TAU * w.m * w.a, ky = TAU * w.n * w.a;
    for (let y = 0; y < size; y++) {
      const cY = cy[y], sY = syT[y];
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const c = cx[x] * cY - sxT[x] * sY; // cos(ax + ay)
        const s = sxT[x] * cY + cx[x] * sY; // sin(ax + ay)
        h[row + x] += w.a * c;
        sx[row + x] -= kx * s;
        sy[row + x] -= ky * s;
      }
    }
  }

  // Normalise slopes to unit RMS (shader sets the real-world slope per layer) and clamp at 3 sigma.
  let ss = 0, hh = 0;
  for (let i = 0; i < count; i++) { ss += sx[i] * sx[i] + sy[i] * sy[i]; hh += h[i] * h[i]; }
  const sRms = Math.sqrt(ss / (2 * count)) || 1;
  const hRms = Math.sqrt(hh / count) || 1;
  const out = new Uint8Array(count * 4);
  const enc = (v: number) => Math.max(0, Math.min(255, Math.round(127.5 + v * 127.5)));
  for (let i = 0; i < count; i++) {
    const ex = Math.max(-1, Math.min(1, sx[i] / sRms / 3));
    const ey = Math.max(-1, Math.min(1, sy[i] / sRms / 3));
    out[i * 4] = enc(ex);
    out[i * 4 + 1] = enc(ey);
    out[i * 4 + 2] = enc(h[i] / hRms / 3);
    // Second moment (LEAN mapping): mipmaps average it, so the shader recovers the slope variance of
    // ripples too small for a pixel and turns it into reflection blur instead of aliasing.
    out[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(((ex * ex + ey * ey) * 0.5) * 255)));
  }
  return out;
}

scope.onmessage = (e: MessageEvent<SeaWaveIn>) => {
  const { size, seed } = e.data;
  const data = buildSeaWaves(size, seed);
  scope.postMessage({ data, size } satisfies SeaWaveOut, [data.buffer]);
};
