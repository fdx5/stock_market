import type { DroneSigns } from './droneSigns';
import type { DroneLabel } from './ringBuildings';
import type { DroneWorld } from './droneWorld';
import { placeTrain, type BikeDock, type EmergencyRoom, type LiveKind, type ParkingLot, type SubwayData, type SubwayStation, type Train } from './publicLive';

/** The drone's live public layers on its signs (droneSigns: one canvas, no new 3D materials) and
 * on its roads (the traffic bands droneWorld colours): what LiveLayerControls fetches is put here. */
export class DroneLive {
  readonly on: Record<LiveKind, boolean> = { subway: false, er: false, traffic: false, bike: false, parking: false };
  constructor(private signs: DroneSigns, readonly origin: { lat: number; lon: number }, private groundAt: (x: number, y: number) => number, readonly world: DroneWorld) {}
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
      const beds = r.er === null ? '정보 없음' : r.er <= 0 ? '병상 없음' : `${r.er}병상`;
      return { name: `${r.name} · 응급실 ${beds}`, kind: 'er' as const, x, y, top: this.groundAt(x, y) + 30, n: 1, live: { type: 'er' as const, room: r },
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
  traffic(speeds: Record<string, number> | null) {
    this.world.setTraffic(speeds ? new Map(Object.entries(speeds)) : null, this.on.traffic);
  }
  /** The link IDs on the roads within r of the drone (x, y: metres east, north of the origin). */
  links(x: number, y: number, r = 1500) { return this.world.trafficLinks(x, y, r); }
  dispose() {
    for (const k of ['live-stations', 'live-trains', 'live-er', 'live-bike', 'live-parking']) this.signs.set(k, null);
    this.world.setTraffic(null, false);
  }
}
