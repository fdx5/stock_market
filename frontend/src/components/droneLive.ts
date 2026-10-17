import * as THREE from 'three';
import type { DroneSigns } from './droneSigns';
import type { DroneLabel } from './ringBuildings';
import type { DroneWorld } from './droneWorld';
import { bedsText, FACILITY, placeTrain, type Facility, type BikeDock, type EmergencyRoom, type LiveKind, type ParkingLot, type SubwayData, type SubwayStation, type Train } from './publicLive';

/** The drone's live public layers on its signs (droneSigns: one canvas, no new 3D materials) and
 * on its roads (the traffic bands droneWorld colours): what LiveLayerControls fetches is put here. */
export class DroneLive {
  readonly on: Record<LiveKind, boolean> = { subway: false, er: false, traffic: false, bike: false, parking: false, facility: true };
  /** the subway entrances: one instanced canopy each (a roof on posts, glass sides and back,
   * the yellow number board over the open end), the open end away from its station */
  private exitRoot = new THREE.Group();
  private exitMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .45, metalness: .15 });
  private exitGeo = entranceGeometry();
  private exitMesh = new THREE.InstancedMesh(this.exitGeo, this.exitMat, 400);
  constructor(private signs: DroneSigns, readonly origin: { lat: number; lon: number }, private groundAt: (x: number, y: number) => number, readonly world: DroneWorld, scene?: THREE.Scene) {
    this.exitRoot.name = 'drone subway entrances'; this.exitMesh.count = 0; this.exitMesh.castShadow = false; this.exitMesh.receiveShadow = true;
    this.exitMesh.frustumCulled = false; this.exitRoot.add(this.exitMesh); scene?.add(this.exitRoot);
  }
  private yaws = new Map<string, number>();
  materials() { return [this.exitMat]; }
  /** The direction of the nearest sidewalk middle line within 12 m of (x, y), if any. */
  private alongWalk(x: number, y: number): [number, number] | null {
    let best: [number, number] | null = null, bd = 12;
    for (const w of this.world.walkPathsNear(x, y, 40)) for (let k = 0; k < w.length;) {
      const n = w[k], at = k + 1;
      for (let i = 1; i < n; i++) {
        const ax = w[at + i * 2 - 2], ay = w[at + i * 2 - 1], bx = w[at + i * 2], by = w[at + i * 2 + 1];
        const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey; if (L2 < .01) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)), d = Math.hypot(ax + ex * t - x, ay + ey * t - y);
        if (d < bd) { bd = d; const L = Math.sqrt(L2); best = [ex / L, ey / L]; }
      }
      k = at + n * 2;
    }
    return best;
  }
  /** The subway entrances (OpenStreetMap), each with its station (the nearest within 600 m). */
  exits(list: Facility[] | null, stations: SubwayStation[] | null) {
    if (!list?.length || !stations) { this.exitMesh.count = 0; this.put('live-exits', null); return; }
    const out: DroneLabel[] = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (const f of list.slice(0, 400)) {
      const { x, y } = this.point(f.lat, f.lon);
      let best: SubwayStation | null = null, bd = 600;
      for (const s of stations) { const p = this.point(s.lat, s.lon), d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = s; } }
      const g = this.groundAt(x, y);
      // Along the sidewalk it stands on (the drone's surveyed sidewalks' middle lines, the nearest
      // within 12 m), its open end the way away from the station (the stairs go down toward it);
      // with no sidewalk known, straight away from the station.
      const sp = best ? this.point(best.lat, best.lon) : { x, y: y - 1 };
      let yaw = this.yaws.get(f.id);
      if (yaw === undefined) {
        let ax = x - sp.x, ay = y - sp.y;
        const walk = this.alongWalk(x, y);
        if (walk) { const s = walk[0] * ax + walk[1] * ay >= 0 ? 1 : -1; ax = walk[0] * s; ay = walk[1] * s; }
        yaw = Math.atan2(ax, -ay);
        // (kept once a sidewalk was found: the tiles round it are in)
        if (walk) this.yaws.set(f.id, yaw);
      }
      q.setFromAxisAngle(up, Math.PI - yaw);
      m.compose(new THREE.Vector3(x, g, -y), q, new THREE.Vector3(1, 1, 1));
      this.exitMesh.setMatrixAt(n++, m);
      if (best) out.push({ name: `${best.name}역 ${f.ref ? f.ref + '번 ' : ''}출구`, kind: 'exit', x, y, top: g + 3.6, n: 1,
        live: { type: 'station', station: best, exit: f }, key: 'exit:' + f.id });
    }
    this.exitMesh.count = n; this.exitMesh.instanceMatrix.needsUpdate = true;
    this.put('live-exits', out);
  }
  private point(lat: number, lon: number) {
    const o = this.origin;
    return { x: (lon - o.lon) * 111320 * Math.cos(o.lat * Math.PI / 180), y: (lat - o.lat) * 110540 };
  }
  private put(tile: string, labels: DroneLabel[] | null) { this.signs.set(tile, labels?.length ? labels : null); }

  stations(list: SubwayStation[] | null, colour: (s: SubwayStation) => string) {
    this.put('live-stations', list?.map(s => {
      const { x, y } = this.point(s.lat, s.lon);
      return { name: s.name + '역', kind: 'subway' as const, x, y, top: this.groundAt(x, y) + 4, n: 1, live: { type: 'station' as const, station: s }, tint: colour(s) };
    }) ?? null);
  }
  trains(d: SubwayData | null, list: Train[] | null) {
    if (!d || !list) { this.put('live-trains', null); return; }
    const out: DroneLabel[] = [];
    for (const t of list) {
      const p = placeTrain(d, t, this.origin); if (!p) continue;
      const { x, y } = this.point(p.lat, p.lon), colour = d.lines[t.line]?.colour ?? '#9cd';
      out.push({ name: `${t.line} ${t.terminal}행${t.express ? ' 급행' : ''} · ${t.status}`, kind: 'train', x, y, top: this.groundAt(x, y) + 12, n: 1,
        live: { type: 'train', train: t, colour }, tint: colour, key: 'train:' + t.line + ':' + t.train });
    }
    this.put('live-trains', out);
  }
  rooms(list: EmergencyRoom[] | null) {
    this.put('live-er', list?.map(r => {
      const { x, y } = this.point(r.lat, r.lon);
      return { name: `${r.name} · 응급실 ${bedsText(r.er)}`, kind: 'er' as const, x, y, top: this.groundAt(x, y) + 30, n: 1, live: { type: 'er' as const, room: r },
        tint: r.er === null ? '#9aa4ad' : r.er <= 0 ? '#ff5964' : r.er <= 2 ? '#ffb020' : '#3ddc84' };
    }) ?? null);
  }
  docks(list: BikeDock[] | null) {
    this.put('live-bike', list?.map(b => {
      const { x, y } = this.point(b.lat, b.lon);
      return { name: `${b.bikes}대 · ${b.name}`, kind: 'bike' as const, x, y, top: this.groundAt(x, y) + 3, n: 1, live: { type: 'bike' as const, dock: b },
        tint: b.bikes <= 0 ? '#ff5964' : b.bikes <= 2 ? '#ffb020' : '#3ddc84', key: 'bike:' + b.id };
    }) ?? null);
  }
  lots(list: ParkingLot[] | null) {
    this.put('live-parking', list?.map(l => {
      const { x, y } = this.point(l.lat, l.lon);
      const free = l.total !== null && l.parked !== null ? Math.max(0, l.total - l.parked) : null;
      return { name: `${free === null ? '정보 없음' : `잔여 ${free}면`} · ${l.name.replace(/공영주차장|\((시|구)\)/g, '').trim()}`, kind: 'parking' as const, x, y, top: this.groundAt(x, y) + 6, n: 1,
        live: { type: 'parking' as const, lot: l }, key: 'parking:' + l.id,
        tint: free === null || !l.total ? '#9aa4ad' : free / l.total < .05 ? '#ff5964' : free / l.total < .2 ? '#ffb020' : '#3ddc84' };
    }) ?? null);
  }
  places(list: Facility[] | null) {
    this.put('live-facility', list?.filter(f => f.kind !== 'exit').map(f => {
      const { x, y } = this.point(f.lat, f.lon), k = FACILITY[f.kind];
      return { name: `${k.icon} ${f.name}`, kind: 'service' as const, x, y, top: this.groundAt(x, y) + (f.kind === 'aed' ? 3 : 10), n: 1,
        live: { type: 'facility' as const, place: f }, tint: k.colour, key: 'facility:' + f.id };
    }) ?? null);
  }
  traffic(speeds: Record<string, number> | null) {
    this.world.setTraffic(speeds ? new Map(Object.entries(speeds)) : null, this.on.traffic);
  }
  /** The link IDs on the roads within r of the drone (x, y: metres east, north of the origin). */
  links(x: number, y: number, r = 1500) { return this.world.trafficLinks(x, y, r); }
  dispose() {
    for (const k of ['live-stations', 'live-trains', 'live-er', 'live-bike', 'live-parking', 'live-facility', 'live-exits']) this.signs.set(k, null);
    this.exitRoot.removeFromParent(); this.exitMesh.dispose(); this.exitGeo.dispose(); this.exitMat.dispose();
    this.world.setTraffic(null, false);
  }
}

/** A Seoul subway entrance's canopy (m, y up, the open end toward +z): a roof on two posts at
 * the back, glass sides and back wall, and the yellow number board over the open end. */
function entranceGeometry() {
  const parts: [number, number, number, number, number, number, string][] = [
    // [w, h, d, x, y, z, colour]
    [3.3, .18, 5.6, 0, 2.75, 0, '#3b4148'],            // roof
    [3.3, .08, 5.6, 0, 2.62, 0, '#8d969f'],            // its soffit
    [.06, 2.6, 5.2, -1.6, 1.3, -.1, '#5d8fa0'],        // glass sides
    [.06, 2.6, 5.2, 1.6, 1.3, -.1, '#5d8fa0'],
    [3.2, 2.6, .06, 0, 1.3, -2.7, '#5d8fa0'],          // glass back
    [.16, 2.75, .16, -1.6, 1.37, 2.7, '#2c3036'],      // front posts
    [.16, 2.75, .16, 1.6, 1.37, 2.7, '#2c3036'],
    [1.5, .55, .1, 0, 3.15, 2.62, '#f2c200'],          // the number board
    [3.4, .12, 5.8, 0, .06, 0, '#9a9890'],             // the kerb round the stairwell
    [5.2, .06, 8.6, 0, .03, .4, '#b8b2a4'],            // the paving round it (on the sidewalk, or where there is none)
  ];
  const pos: number[] = [], nor: number[] = [], col: number[] = [], c = new THREE.Color();
  for (const [w, h, d, x, y, z, colour] of parts) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed().translate(x, y, z);
    c.set(colour);
    const p = g.getAttribute('position').array as Float32Array, nn = g.getAttribute('normal').array as Float32Array;
    for (let i = 0; i < p.length; i += 3) { pos.push(p[i], p[i + 1], p[i + 2]); nor.push(nn[i], nn[i + 1], nn[i + 2]); col.push(c.r, c.g, c.b); }
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}
