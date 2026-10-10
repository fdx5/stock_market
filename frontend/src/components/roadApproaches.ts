import type {RealEstateRoad} from '../api/client';
import type {Terrain} from './sceneTerrain';
import {nearestRoadPoint, roadHeight, roadProfileKey} from './roadLevels';

/** Match a deck to ground only at a physical endpoint confirmed by both roads.
 * Match its bank height/crossfall and outward ground slope with a Hermite blend.
 * This changes neither source XY nor the bank-to-bank interior height profile. */
export function roadApproachTerrain(roads: RealEstateRoad[], terrain: Terrain): Terrain {
  type Anchor = {along: number; direction: number; span: number; point: [number,number];
    normal: [number,number]; cross: number; outside: [number,number]; probe: number; baseline: number; grade: number};
  const anchors = new Map<string, Anchor[]>();
  const ground = roads.filter(r => r.structure === 'ground' && r.line.length > 1);
  for (const road of roads) {
    if (!['bridge', 'elevated'].includes(road.structure ?? '') || !road.structure_source || road.line.length < 2) continue;
    const profile = road.profile_line ?? road.line;
    for (const start of [true, false]) {
      const endpoint = start ? road.line[0] : road.line[road.line.length-1];
      const inside = start ? road.line[1] : road.line[road.line.length-2];
      const dx = inside[0] - endpoint[0], dy = inside[1] - endpoint[1], len = Math.hypot(dx, dy);
      if (!len) continue;
      let outside: [number,number] | undefined, probe = 0;
      const connected = ground.some(r => [true, false].some(atStart => {
        const p = atStart ? r.line[0] : r.line[r.line.length-1];
        const q = atStart ? r.line[1] : r.line[r.line.length-2];
        const gx = q[0] - p[0], gy = q[1] - p[1], gl = Math.hypot(gx, gy);
        // The ground continues outward. An interior crossing or a same-direction
        // neighbouring carriageway is not an approach.
        if (!(gl > 0 && Math.hypot(p[0] - endpoint[0], p[1] - endpoint[1]) <= 1.5
          && (gx * dx + gy * dy) / (gl * len) < -.5)) return false;
        probe = Math.min(5, gl);
        outside = [p[0] + gx * probe / gl, p[1] + gy * probe / gl];
        return true;
      }));
      if (!connected || !outside || probe < .01) continue;
      const p = nearestRoadPoint(profile, endpoint[0], endpoint[1]);
      const direction = dx * p.dir[0] + dy * p.dir[1] >= 0 ? 1 : -1;
      const key = roadProfileKey(road), list = anchors.get(key) ?? [];
      if (!list.some(a => Math.abs(a.along - p.along) < .01 && a.direction === direction))
        list.push({along: p.along, direction, span: p.total, point: endpoint, normal: [-p.dir[1],p.dir[0]],
          cross: (endpoint[0]-p.point[0])*(-p.dir[1])+(endpoint[1]-p.point[1])*p.dir[0], outside, probe,
          baseline: roadHeight(road, terrain, p.point[0], p.point[1]),
          grade: (roadHeight(road,terrain,...profile[profile.length-1])-roadHeight(road,terrain,...profile[0]))/(p.total || 1)});
      anchors.set(key, list);
    }
  }
  if (!anchors.size) return terrain;
  return {...terrain, roadAt: (road, x, y) => {
    const baseline = roadHeight(road, terrain, x, y);
    const list = anchors.get(roadProfileKey(road));
    if (!list || !['bridge', 'elevated'].includes(road.structure ?? '')) return baseline;
    const p = nearestRoadPoint(road.profile_line ?? road.line, x, y);
    let correction = 0, closest = Infinity;
    for (const anchor of list) {
      const inward = (p.along - anchor.along) * anchor.direction;
      if (inward < -1.5) continue;
      const other = list.filter(a => a !== anchor && (a.along - anchor.along) * anchor.direction > .01);
      const available = Math.min(anchor.span, ...other.map(a => Math.abs(a.along - anchor.along)));
      const band = Math.min(90, available / 3);
      if (!(band > .01)) continue;
      const u = Math.max(0, Math.min(1, inward / band));
      if (u >= 1 || inward >= closest) continue;
      const cross = (x-p.point[0])*(-p.dir[1])+(y-p.point[1])*p.dir[0]-anchor.cross;
      const ox = anchor.normal[0]*cross, oy = anchor.normal[1]*cross;
      const bank = terrain.at(anchor.point[0] + ox, anchor.point[1] + oy);
      const outside = terrain.at(anchor.outside[0] + ox, anchor.outside[1] + oy);
      const slope = (bank - outside) / anchor.probe;
      correction = (bank - anchor.baseline) * (2*u*u*u - 3*u*u + 1)
        + (slope - anchor.grade * anchor.direction) * band * (u*u*u - 2*u*u + u);
      closest = inward;
    }
    // Interior river-bed DEM must never pull a deck downward. Only the bank and
    // the connected ground road supply the tangent; the original profile and
    // slope are restored at the inner edge. No clearance or Z is fabricated.
    return baseline + correction;
  }};
}
