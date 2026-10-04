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

/** Slope envelopes along the connected road mask. Non-road hills are never
 * constraints. Eight neighbours keep narrow diagonal and winding roads joined;
 * paced shortest-path sweeps converge through bends without flattening the city. */
export async function corridorRoadGrade(values: Float32Array, width: number, height: number, cell: number, mask: Float32Array, pace: () => Promise<void>, maxGrade = .2) {
  const envelope = async (sign: number) => {
    const out = Float32Array.from(values, v => v * sign);
    const ids: number[] = [], costs: number[] = [];
    const push = (id: number, cost: number) => {
      let p = ids.length; ids.push(id); costs.push(cost);
      while (p > 0) { const q = (p - 1) >> 1; if (costs[q] <= cost) break; ids[p] = ids[q]; costs[p] = costs[q]; p = q; }
      ids[p] = id; costs[p] = cost;
    };
    for (let i = 0; i < values.length; i++) if (mask[i]) { push(i, out[i]); if (i % 2048 === 0) await pace(); }
    let visits = 0;
    while (ids.length) {
      const id = ids[0], cost = costs[0], lastId = ids.pop()!, lastCost = costs.pop()!;
      if (ids.length) {
        let p = 0;
        while (p * 2 + 1 < ids.length) {
          let q = p * 2 + 1; if (q + 1 < ids.length && costs[q + 1] < costs[q]) q++;
          if (costs[q] >= lastCost) break; ids[p] = ids[q]; costs[p] = costs[q]; p = q;
        }
        ids[p] = lastId; costs[p] = lastCost;
      }
      if (++visits % 1024 === 0) await pace();
      if (cost > out[id] + 1e-5) continue;
      const x = id % width, y = Math.floor(id / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const q = id + dy * width + dx; if (!mask[q]) continue;
        const next = cost + maxGrade * cell * Math.hypot(dx, dy) / Math.SQRT2;
        if (next < out[q] - 1e-5) { out[q] = next; push(q, out[q]); }
      }
    }
    return out;
  };
  const low = await envelope(1), high = await envelope(-1);
  return Float32Array.from(values, (v, i) => mask[i] ? (low[i] - high[i]) / 2 : v);
}
