export interface GateEntrance { x: number; y: number; cx?: number; cy?: number }
export interface GateRoad { id: string; pts: Float32Array; w: number }
export interface BicycleGate { id: string; x: number; y: number; hx: number; hy: number; width: number }

/** Surveyed road crossings of the apartment cluster envelope, kept off the carriageway. */
export function bicycleGates(entrances: GateEntrance[], roads: Iterable<GateRoad>): BicycleGate[] {
  if (!entrances.length) return [];
  const xs = entrances.flatMap(e => [e.x, e.cx ?? e.x]), ys = entrances.flatMap(e => [e.y, e.cy ?? e.y]);
  const [x0, y0, x1, y1] = [Math.min(...xs) - 18, Math.min(...ys) - 18, Math.max(...xs) + 18, Math.max(...ys) + 18];
  const candidates: BicycleGate[] = [];
  for (const road of roads) for (let i = 3; i < road.pts.length; i += 3) {
    const ax = road.pts[i - 3], ay = road.pts[i - 2], dx = road.pts[i] - ax, dy = road.pts[i + 1] - ay;
    const length = Math.hypot(dx, dy); if (length < 1) continue;
    for (const [t, side] of [[dx ? (x0 - ax) / dx : -1, 0], [dx ? (x1 - ax) / dx : -1, 0], [dy ? (y0 - ay) / dy : -1, 1], [dy ? (y1 - ay) / dy : -1, 1]]) {
      if (t < 0 || t > 1) continue;
      const x = ax + dx * t, y = ay + dy * t;
      if (side === 0 ? y < y0 || y > y1 : x < x0 || x > x1) continue;
      if (candidates.some(p => Math.hypot(p.x - x, p.y - y) < 35)) continue;
      candidates.push({ id: `${road.id}:${Math.round(x)}:${Math.round(y)}`, x, y, hx: dx / length, hy: dy / length, width: road.w });
    }
  }
  candidates.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
  const first = candidates[0]; if (!first) return [];
  const second = candidates.slice(1).sort((a, b) => Math.hypot(b.x - first.x, b.y - first.y) - Math.hypot(a.x - first.x, a.y - first.y))[0];
  return second ? [first, second] : [first];
}
