/** Symmetric slope envelopes retain a hillside's trend while removing DEM steps.
 * Four linear sweeps, no iterative solver. The axis bound also bounds diagonals.
 */
export function continuousRoadGrade(values: Float32Array, width: number, height: number, cell: number, maxGrade = 0.2) {
  const low = Float32Array.from(values), high = Float32Array.from(values);
  const rise = maxGrade * cell / Math.SQRT2;
  for (const forward of [true, false]) {
    for (let jj = 0; jj < height; jj++) {
      const j = forward ? jj : height - 1 - jj;
      for (let ii = 0; ii < width; ii++) {
        const i = forward ? ii : width - 1 - ii, k = j * width + i;
        const a = forward ? i > 0 ? k - 1 : -1 : i + 1 < width ? k + 1 : -1;
        const b = forward ? j > 0 ? k - width : -1 : j + 1 < height ? k + width : -1;
        for (let side = 0; side < 2; side++) {
          const q = side ? b : a;
          if (q < 0) continue;
          low[k] = Math.min(low[k], low[q] + rise);
          high[k] = Math.max(high[k], high[q] - rise);
        }
      }
    }
  }
  return Float32Array.from(low, (v, i) => (v + high[i]) / 2);
}
