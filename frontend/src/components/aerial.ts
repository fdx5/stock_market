/* The buildings' colours from VWorld's aerial photographs (국토지리정보원 정사영상, WMTS
 * "Satellite", nationwide, ~0.24 m a pixel at level 19): the fallback where VWorld has no
 * 3D buildings. Read, never drawn:
 * - roof: the median of the roof inside its outline (a metre and a half in);
 * - rim: the colourful part of the band just inside the roof edge (a stripe, tiles);
 * - facade: the photographs lean tall buildings a little (relief displacement), so one
 *   facade shows just outside the outline; its bright, unshaded paint is sampled there;
 * - pitched: a tiled roof (red, brown, terracotta) — Korean slab blocks of the 1990s wear
 *   a gable of them.
 * Rings in local metres about (lat0, lon0), x east, y north (the server's projection). */

const Z = 19, TILE = 256;

export interface AerialColours { roof: [number, number, number]; rim: [number, number, number] | null; facade: [number, number, number] | null; pitched: boolean }

const tileUrl = (key: string, z: number, row: number, col: number) => `https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(key)}/Satellite/${z}/${row}/${col}.jpeg`;

export async function aerialColours(key: string, lat0: number, lon0: number, rings: [number, number][][], signal?: AbortSignal, zoom = Z): Promise<(AerialColours | null)[]> {
  const Z = zoom;
  if (!rings.length) return [];
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111_320, ky = 110_540;
  const n = 2 ** Z;
  const px = (x: number, y: number): [number, number] => {
    const lon = lon0 + x / kx, lat = lat0 + y / ky;
    const s = Math.sin((lat * Math.PI) / 180);
    return [((lon + 180) / 360) * n * TILE, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * TILE];
  };
  // the pixels covering every ring with a margin
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    const [u, v] = px(x, y);
    x0 = Math.min(x0, u); y0 = Math.min(y0, v); x1 = Math.max(x1, u); y1 = Math.max(y1, v);
  }
  const m = 60;   // (pixels: ~14 m)
  const c0 = Math.floor((x0 - m) / TILE), c1 = Math.floor((x1 + m) / TILE), r0 = Math.floor((y0 - m) / TILE), r1 = Math.floor((y1 + m) / TILE);
  if ((c1 - c0 + 1) * (r1 - r0 + 1) > 64) return rings.map(() => null);   // (a very large complex: not worth the download)
  const W = (c1 - c0 + 1) * TILE, H = (r1 - r0 + 1) * TILE;
  const cv = new OffscreenCanvas(W, H), cx = cv.getContext("2d", { willReadFrequently: true })!;
  const jobs: Promise<void>[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) jobs.push((async () => {
    const res = await fetch(tileUrl(key, Z, r, c), { signal, mode: "cors" });
    if (!res.ok) return;
    const blob = await res.blob();
    if (!blob.type.startsWith("image")) return;
    const bmp = await createImageBitmap(blob);
    cx.drawImage(bmp, (c - c0) * TILE, (r - r0) * TILE); bmp.close();
  })().catch(() => {}));
  await Promise.all(jobs);
  const img = cx.getImageData(0, 0, W, H).data;
  const at = (x: number, y: number): [number, number, number] | null => {
    const [u, v] = px(x, y);
    const X = Math.floor(u - c0 * TILE), Y = Math.floor(v - r0 * TILE);
    if (X < 0 || Y < 0 || X >= W || Y >= H) return null;
    const o = (Y * W + X) * 4;
    if (img[o + 3] === 0) return null;
    return [img[o] / 255, img[o + 1] / 255, img[o + 2] / 255];
  };
  const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const sat = (c: number[]) => (Math.max(...c) - Math.min(...c)) / Math.max(Math.max(...c), 1e-3);
  const hue = (c: number[]) => {
    const [r, g, b] = c, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 1e-4) return 0;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const median = (list: number[][]): [number, number, number] => {
    const ch = (k: number) => { const v = list.map(c => c[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
    return [ch(0), ch(1), ch(2)];
  };
  const inside = (p: [number, number], ring: [number, number][]) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const edgeDist = (p: [number, number], ring: [number, number][]) => {
    let d = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length], dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
      d = Math.min(d, Math.hypot(p[0] - ax - dx * t, p[1] - ay - dy * t));
    }
    return d;
  };
  return rings.map(ring => {
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const [x, y] of ring) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
    const roof: number[][] = [], rim: number[][] = [], out: number[][] = [];
    for (let y = by0 - 8; y <= by1 + 8; y += 0.4) for (let x = bx0 - 8; x <= bx1 + 8; x += 0.4) {
      const p: [number, number] = [x, y], c = at(x, y);
      if (!c) continue;
      const inR = inside(p, ring), d = edgeDist(p, ring);
      if (inR && d > 1.5) roof.push(c);
      else if (inR && d > 0.2 && d <= 1.2) rim.push(c);
      else if (!inR && d > 0.5 && d < 7) out.push(c);
    }
    if (roof.length < 30) return null;
    const roofC = median(roof);
    const vivid = [...rim].sort((a, b) => sat(b) - sat(a)).slice(0, Math.max(1, rim.length >> 2));
    const rimC = vivid.length > 8 && sat(median(vivid)) > 0.2 ? median(vivid) : null;
    // the leaning facade: bright, unshaded, low-saturation paint just outside (not the
    // ground: asphalt and grass are darker or greener, shadows darker still)
    const paint = out.filter(c => lum(c) > 0.55 && sat(c) < 0.3);
    const facade = paint.length > 40 ? median(paint) : null;
    const h = hue(roofC), s = sat(roofC);
    const pitched = s > 0.28 && (h < 30 || h > 340) && lum(roofC) < 0.55;
    return { roof: roofC, rim: rimC, facade, pitched };
  });
}
