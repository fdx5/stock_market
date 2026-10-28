/* Reading the ground from aerial photographs (VWorld's satellite layer, ~0.24 m a pixel at zoom
 * 19): what lies between the buildings and off the roads — tree canopy, lawn, paving (grey blocks,
 * red brick), asphalt — and what stands on it: each tree's crown, each parked car (where, which way,
 * how long, what colour). The photograph itself is never drawn; the walk's world is built from what
 * is read here (Ground.ts). Pure functions: run in a worker (aerialWorker.ts) or, without
 * OffscreenCanvas, on the page. */

export const CELL = 0.5;            // the class grid (m)
export const FINE = 0.25;           // the colour grid the photo is resampled to (m)
export const ZOOM = 19;

export const enum K { NONE = 0, ASPHALT = 1, PAVE = 2, RED = 3, GRASS = 4, TREE = 5 }

export interface AerialAsk {
  key: string;
  /** the frame: its origin and metres per degree (drivegame geo) */
  lat0: number; lon0: number; kx: number; ky: number;
  /** the square read: centre (frame m) and half size */
  cx: number; cy: number; half: number;
}
export interface AerialResult {
  /** the class grid's south-west corner (frame m), its size; row 0 is the south edge */
  x0: number; y0: number; nx: number; ny: number;
  cls: Uint8Array;
  /** the mean colour of each class cell (for tinting): r g b bytes */
  rgb: Uint8Array;
  /** tree crowns: x y radius (m) */
  trees: Float32Array;
  /** parked cars: x y yaw length width r g b (0..1) */
  cars: Float32Array;
  ms: number; tiles: number; failed: number;
}

// ------------------------------------------------------------------ Web Mercator
const worldPx = (z: number) => 256 * 2 ** z;
const lonToPx = (lon: number, z: number) => ((lon + 180) / 360) * worldPx(z);
const latToPx = (lat: number, z: number) => { const s = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldPx(z); };

/** The tiles covering the square, and where each pixel of the mosaic lies. */
export function tilesFor(a: AerialAsk) {
  const lon = (x: number) => a.lon0 + x / a.kx, lat = (y: number) => a.lat0 + y / a.ky;
  const px0 = lonToPx(lon(a.cx - a.half), ZOOM), px1 = lonToPx(lon(a.cx + a.half), ZOOM);
  const py0 = latToPx(lat(a.cy + a.half), ZOOM), py1 = latToPx(lat(a.cy - a.half), ZOOM);
  const tx0 = Math.floor(px0 / 256), tx1 = Math.floor(px1 / 256), ty0 = Math.floor(py0 / 256), ty1 = Math.floor(py1 / 256);
  const urls: { x: number; y: number; url: string }[] = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) urls.push({ x: tx - tx0, y: ty - ty0, url: `https://api.vworld.kr/req/wmts/1.0.0/${a.key}/Satellite/${ZOOM}/${ty}/${tx}.jpeg` });
  return { urls, w: (tx1 - tx0 + 1) * 256, h: (ty1 - ty0 + 1) * 256, ox: tx0 * 256, oy: ty0 * 256 };
}

// ------------------------------------------------------------------ reading the photograph
/** From the mosaic's pixels to the classes, crowns and cars. */
export function analyse(a: AerialAsk, mosaic: Uint8ClampedArray, mw: number, mh: number, ox: number, oy: number): Omit<AerialResult, "ms" | "tiles" | "failed"> {
  // 1. resample to a north-up metric grid (FINE m), nearest pixel
  const fn = Math.round((2 * a.half) / FINE), N = fn * fn;
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N), L = new Float32Array(N);
  const fx0 = a.cx - a.half, fy0 = a.cy - a.half;
  for (let j = 0; j < fn; j++) {
    const y = fy0 + (j + 0.5) * FINE, py = Math.floor(latToPx(a.lat0 + y / a.ky, ZOOM) - oy);
    for (let i = 0; i < fn; i++) {
      const x = fx0 + (i + 0.5) * FINE, px = Math.floor(lonToPx(a.lon0 + x / a.kx, ZOOM) - ox);
      const k = j * fn + i;
      if (px < 0 || py < 0 || px >= mw || py >= mh) continue;
      const m = (py * mw + px) * 4, r = mosaic[m] / 255, g = mosaic[m + 1] / 255, b = mosaic[m + 2] / 255;
      R[k] = r; G[k] = g; B[k] = b; L[k] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }
  // local texture (3×3 standard deviation of brightness): a crown is rough, a lawn smooth
  const rough = new Float32Array(N);
  for (let j = 1; j < fn - 1; j++) for (let i = 1; i < fn - 1; i++) {
    let s = 0, s2 = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const v = L[(j + dj) * fn + i + di]; s += v; s2 += v * v; }
    rough[j * fn + i] = Math.sqrt(Math.max(0, s2 / 9 - (s / 9) ** 2));
  }
  // 2. classes at FINE: by chromaticity (works in shadow as in sun) and brightness
  const fine = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const r = R[k], g = G[k], b = B[k], sum = r + g + b + 1e-4, l = L[k];
    if (sum < 0.02) continue;
    const exg = (2 * g - r - b) / sum, mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = (mx - mn) / (mx + 1e-4);
    // (this imagery has a green cast: sunlit asphalt reads exg ~0.14, asphalt in a building's shadow
    // is teal — green over blue ~0 — where foliage is yellow-green, green over blue ~0.07, exg ~0.35)
    if (exg > 0.2 && g - b > 0.03 && sat > 0.28) fine[k] = rough[k] < 0.025 && l > 0.33 ? K.GRASS : K.TREE;   // (a lawn is smooth and bright; the rest is canopy)
    else if (r > g * 1.12 && r > b * 1.22 && sat > 0.2 && l > 0.2) fine[k] = K.RED;
    else if (l < 0.56) fine[k] = K.ASPHALT;
    else fine[k] = sat < 0.3 ? K.PAVE : K.ASPHALT;
  }
  // 3. the class grid (CELL): the commonest of its four fine cells, then a 3×3 majority smoothing
  const nx = Math.floor(fn / 2), ny = nx, cls0 = new Uint8Array(nx * ny), rgb = new Uint8Array(nx * ny * 3);
  const cnt = new Uint8Array(6);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    cnt.fill(0); let r = 0, g = 0, b = 0;
    for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) { const k = (j * 2 + dj) * fn + i * 2 + di; cnt[fine[k]]++; r += R[k]; g += G[k]; b += B[k]; }
    let best = 0; for (let c = 1; c < 6; c++) if (cnt[c] > cnt[best]) best = c;
    const o = j * nx + i; cls0[o] = best; rgb[o * 3] = (r / 4) * 255; rgb[o * 3 + 1] = (g / 4) * 255; rgb[o * 3 + 2] = (b / 4) * 255;
  }
  const cls = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    cnt.fill(0);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const jj = j + dj, ii = i + di; if (jj >= 0 && ii >= 0 && jj < ny && ii < nx) cnt[cls0[jj * nx + ii]]++; }
    const own = cls0[j * nx + i]; let best = own; for (let c = 0; c < 6; c++) if (cnt[c] > cnt[best] + 1) best = c;
    cls[j * nx + i] = best;
  }
  // 4. tree crowns: the canopy's distance to its edge; crowns at its ridges, largest first
  const dist = new Float32Array(nx * ny);
  const INF = 1e9;
  for (let k = 0; k < nx * ny; k++) dist[k] = cls[k] === K.TREE ? INF : 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (!dist[k]) continue; const a1 = i ? dist[k - 1] + 1 : 1, b1 = j ? dist[k - nx] + 1 : 1, c1 = i && j ? dist[k - nx - 1] + 1.414 : 1.414, d1 = j && i < nx - 1 ? dist[k - nx + 1] + 1.414 : 1.414; dist[k] = Math.min(dist[k], a1, b1, c1, d1); }
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { const k = j * nx + i; if (!dist[k]) continue; const a1 = i < nx - 1 ? dist[k + 1] + 1 : 1, b1 = j < ny - 1 ? dist[k + nx] + 1 : 1, c1 = i < nx - 1 && j < ny - 1 ? dist[k + nx + 1] + 1.414 : 1.414, d1 = j < ny - 1 && i ? dist[k + nx - 1] + 1.414 : 1.414; dist[k] = Math.min(dist[k], a1, b1, c1, d1); }
  const cand: number[] = [];
  for (let k = 0; k < nx * ny; k++) if (dist[k] >= 2.5) cand.push(k);   // ≥ 1.25 m into the canopy
  cand.sort((p, q) => dist[q] - dist[p]);
  const trees: number[] = [], bucket = new Map<number, number[]>(), BK = 16;
  const bkey = (x: number, y: number) => Math.floor(x / BK) * 100000 + Math.floor(y / BK);
  for (const k of cand) {
    const i = k % nx, j = (k - i) / nx, x = a.cx - a.half + (i + 0.5) * CELL, y = a.cy - a.half + (j + 0.5) * CELL;
    const r = Math.min(5.5, Math.max(1.6, dist[k] * CELL * 1.15));
    let ok = true;
    for (let di = -1; di <= 1 && ok; di++) for (let dj = -1; dj <= 1 && ok; dj++) {
      for (const t of bucket.get(bkey(x + di * BK, y + dj * BK)) ?? []) if (Math.hypot(trees[t] - x, trees[t + 1] - y) < 0.75 * (trees[t + 2] + r)) { ok = false; break; }
    }
    if (!ok) continue;
    const t = trees.length; trees.push(x, y, r);
    const bk = bkey(x, y); const l = bucket.get(bk); if (l) l.push(t); else bucket.set(bk, [t]);
  }
  // 5. parked cars: blobs on asphalt that stand out from it (white, black, coloured), car-sized
  const asph = new Uint8Array(N);
  for (let k = 0; k < N; k++) asph[k] = fine[k] === K.ASPHALT ? 1 : 0;
  const integ = (src: ArrayLike<number>) => { const I = new Float64Array((fn + 1) * (fn + 1)); for (let j = 0; j < fn; j++) { let row = 0; for (let i = 0; i < fn; i++) { row += src[j * fn + i]; I[(j + 1) * (fn + 1) + i + 1] = I[j * (fn + 1) + i + 1] + row; } } return I; };
  const IL = integ(L), IA = integ(asph);
  const box = (I: Float64Array, i: number, j: number, h: number) => { const i0 = Math.max(0, i - h), j0 = Math.max(0, j - h), i1 = Math.min(fn, i + h + 1), j1 = Math.min(fn, j + h + 1); return (I[j1 * (fn + 1) + i1] - I[j0 * (fn + 1) + i1] - I[j1 * (fn + 1) + i0] + I[j0 * (fn + 1) + i0]) / ((i1 - i0) * (j1 - j0)); };
  const odd = new Uint8Array(N);
  for (let j = 0; j < fn; j++) for (let i = 0; i < fn; i++) {
    const k = j * fn + i;
    if (fine[k] === K.TREE || fine[k] === K.GRASS) continue;
    if (box(IA, i, j, 12) < 0.2) continue;                          // among asphalt (a car park, a drive)
    const r = R[k], g = G[k], b = B[k], mx = Math.max(r, g, b), sat = (mx - Math.min(r, g, b)) / (mx + 1e-4);
    const d = L[k] - box(IL, i, j, 10);
    if (Math.abs(d) > 0.13 || (sat > 0.35 && mx > 0.25)) odd[k] = 1;
  }
  // (cars parked side by side touch: one pixel eroded off every blob parts them; the size test
  // below allows for the pixel taken)
  const er = new Uint8Array(N);
  for (let j = 1; j < fn - 1; j++) for (let i = 1; i < fn - 1; i++) { const k = j * fn + i; er[k] = odd[k] & odd[k - 1] & odd[k + 1] & odd[k - fn] & odd[k + fn]; }
  odd.set(er);
  const cars: number[] = [], seen = new Uint8Array(N), stack: number[] = [], pts: number[] = [];
  for (let s = 0; s < N; s++) {
    if (!odd[s] || seen[s]) continue;
    stack.length = 0; pts.length = 0; stack.push(s); seen[s] = 1;
    while (stack.length) {
      const k = stack.pop()!; pts.push(k);
      if (pts.length > 600) break;
      const i = k % fn, j = (k - i) / fn;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= fn || jj >= fn) continue; const q = jj * fn + ii; if (odd[q] && !seen[q]) { seen[q] = 1; stack.push(q); } }
    }
    const area = pts.length * FINE * FINE;
    if (area < 2.2 || area > 12) continue;
    let mx = 0, my = 0; for (const k of pts) { mx += k % fn; my += Math.floor(k / fn); } mx /= pts.length; my /= pts.length;
    let sxx = 0, syy = 0, sxy = 0; for (const k of pts) { const dx = (k % fn) - mx, dy = Math.floor(k / fn) - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity, cr = 0, cg = 0, cb = 0;
    for (const k of pts) { const dx = (k % fn) - mx, dy = Math.floor(k / fn) - my, p = dx * ux + dy * uy, q = -dx * uy + dy * ux; a0 = Math.min(a0, p); a1 = Math.max(a1, p); b0 = Math.min(b0, q); b1 = Math.max(b1, q); cr += R[k]; cg += G[k]; cb += B[k]; }
    const len = (a1 - a0 + 3) * FINE, wid = (b1 - b0 + 3) * FINE;
    if (len < 3.2 || len > 5.8 || wid < 1.3 || wid > 2.5 || len / wid < 1.45) continue;
    const x = a.cx - a.half + (mx + 0.5) * FINE, y = a.cy - a.half + (my + 0.5) * FINE;
    cars.push(x, y, Math.atan2(uy, ux), Math.min(5, len), Math.min(2, wid), cr / pts.length, cg / pts.length, cb / pts.length);
  }
  // 6. the ground under the canopy: a crown overhangs the drive or the car park beside its bed, so
  // only the canopy's core (1.5 m in from its edge, grown back 1 m) is a planted bed; the rest takes
  // the ground round it (spread in from the edges); then a 5×5 majority tidies the plan
  {
    const n = nx * ny, can = new Uint8Array(n);
    for (let k = 0; k < n; k++) can[k] = cls[k] === K.TREE ? 1 : 0;
    const morph = (src: Uint8Array, r: number, grow: boolean) => {
      const out = new Uint8Array(n);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        let v = grow ? 0 : 1;
        for (let dj = -r; dj <= r && (grow ? !v : v); dj++) for (let di = -r; di <= r; di++) {
          const ii = i + di, jj = j + dj, s1 = ii >= 0 && jj >= 0 && ii < nx && jj < ny ? src[jj * nx + ii] : 0;
          if (grow && s1) { v = 1; break; } if (!grow && !s1) { v = 0; break; }
        }
        out[j * nx + i] = v;
      }
      return out;
    };
    const bed = morph(morph(can, 3, false), 2, true);
    for (let k = 0; k < n; k++) if (can[k] && !bed[k]) cls[k] = K.NONE;
    for (let pass = 0; pass < 14; pass++) {
      let left = 0;
      const next = cls.slice();
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i; if (cls[k] !== K.NONE || !can[k]) continue;
        cnt.fill(0);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < nx && jj < ny) cnt[cls[jj * nx + ii]]++; }
        let best = 0; for (let c = 1; c < 6; c++) if (cnt[c] > cnt[best] || (best === 0 && cnt[c])) best = c;
        if (best) next[k] = best; else left++;
      }
      cls.set(next);
      if (!left) break;
    }
    for (let k = 0; k < n; k++) if (cls[k] === K.NONE && can[k]) cls[k] = K.TREE;
    const sm = cls.slice();
    for (let j = 2; j < ny - 2; j++) for (let i = 2; i < nx - 2; i++) {
      cnt.fill(0);
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) cnt[cls[(j + dj) * nx + i + di]]++;
      let best = cls[j * nx + i]; for (let c = 0; c < 6; c++) if (cnt[c] > 13) best = c;
      sm[j * nx + i] = best;
    }
    cls.set(sm);
  }
  // 7. clean-up: where a car stands is asphalt (a white car read as paving, a black one as tarmac);
  // islands of another class under 3 m² inside asphalt are the asphalt's too (cars missed, lines)
  for (let c = 0; c < cars.length; c += 8) {
    const x = cars[c], y = cars[c + 1], ux = Math.cos(cars[c + 2]), uy = Math.sin(cars[c + 2]), hl = cars[c + 3] / 2 + 0.3, hw = cars[c + 4] / 2 + 0.3;
    const i0 = Math.floor((x - hl - (a.cx - a.half)) / CELL), i1 = Math.ceil((x + hl - (a.cx - a.half)) / CELL), j0 = Math.floor((y - hl - (a.cy - a.half)) / CELL), j1 = Math.ceil((y + hl - (a.cy - a.half)) / CELL);
    for (let j = Math.max(0, j0); j <= Math.min(ny - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) {
      const dx = a.cx - a.half + (i + 0.5) * CELL - x, dy = a.cy - a.half + (j + 0.5) * CELL - y;
      if (Math.abs(dx * ux + dy * uy) <= hl && Math.abs(-dx * uy + dy * ux) <= hw && cls[j * nx + i] !== K.TREE) cls[j * nx + i] = K.ASPHALT;
    }
  }
  {
    const seen2 = new Uint8Array(nx * ny), st: number[] = [], comp: number[] = [];
    for (let s0 = 0; s0 < nx * ny; s0++) {
      const c0 = cls[s0];
      if (seen2[s0] || c0 === K.ASPHALT || c0 === K.NONE) continue;
      st.length = 0; comp.length = 0; st.push(s0); seen2[s0] = 1; let touchesOther = false;
      while (st.length) {
        const k = st.pop()!; comp.push(k);
        const i = k % nx, j = (k - i) / nx;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          const q = jj * nx + ii, cq = cls[q];
          if (cq === c0) { if (!seen2[q]) { seen2[q] = 1; st.push(q); } } else if (cq !== K.ASPHALT) touchesOther = true;
        }
        if (comp.length > 12) break;
      }
      if (comp.length <= 12 && !touchesOther) for (const k of comp) cls[k] = K.ASPHALT;
    }
  }
  // and the other way: specks of asphalt under 10 m² in a lawn, a bed or paving (a shadow, a
  // bare patch read as tarmac) are that surface's (else each is ringed with a kerb)
  {
    const seen3 = new Uint8Array(nx * ny), st: number[] = [], comp: number[] = [], around = new Uint16Array(6);
    for (let s0 = 0; s0 < nx * ny; s0++) {
      if (seen3[s0] || cls[s0] !== K.ASPHALT) continue;
      st.length = 0; comp.length = 0; around.fill(0); st.push(s0); seen3[s0] = 1; let edge = false;
      while (st.length) {
        const k = st.pop()!; comp.push(k);
        const i = k % nx, j = (k - i) / nx;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) { edge = true; continue; }
          const q = jj * nx + ii, cq = cls[q];
          if (cq === K.ASPHALT) { if (!seen3[q]) { seen3[q] = 1; st.push(q); } } else around[cq]++;
        }
        if (comp.length > 40) break;
      }
      if (comp.length > 40 || edge || around[K.NONE] > 0) continue;
      let best = K.GRASS; for (let c = 1; c < 6; c++) if (c !== K.ASPHALT && around[c] > around[best]) best = c;
      for (const k of comp) cls[k] = best;
    }
  }
  return { x0: a.cx - a.half, y0: a.cy - a.half, nx, ny, cls, rgb, trees: new Float32Array(trees), cars: new Float32Array(cars) };
}
