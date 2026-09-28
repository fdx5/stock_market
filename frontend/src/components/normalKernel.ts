/** Tangent-space normals from the red channel of a height image (brighter = further out),
 * wrapping at the edges. Rows [y0, y1) of `d`. Shared by the page and normalWorker.ts. */
export function normalRows(src: Uint8ClampedArray, d: Uint8ClampedArray, W: number, H: number, strength: number, y0: number, y1: number) {
  const k = strength / 255;
  for (let y = y0; y < y1; y++) {
    const up = (y === 0 ? H - 1 : y - 1) * W, dn = (y === H - 1 ? 0 : y + 1) * W, row = y * W;
    for (let x = 0; x < W; x++) {
      const l0 = x === 0 ? W - 1 : x - 1, r0 = x === W - 1 ? 0 : x + 1;
      const dx = (src[(row + l0) << 2] - src[(row + r0) << 2]) * k;
      const dy = (src[(dn + x) << 2] - src[(up + x) << 2]) * k;
      const inv = 127.5 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (row + x) << 2;
      d[i] = dx * inv + 127.5; d[i + 1] = dy * inv + 127.5; d[i + 2] = inv + 127.5; d[i + 3] = 255;
    }
  }
}
