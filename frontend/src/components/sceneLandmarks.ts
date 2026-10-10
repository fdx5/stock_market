import * as THREE from "three";
import { photoBuildings, type PhotoBuilding } from "./vworld3d";
import { bridgeSections } from './bridgeDeck';

/* Landmarks the drone flies to: the palaces, the stadiums and arenas, as VWorld surveyed them —
 * every building of the site in its photo-textured 3D model (국토교통부 브이월드 3D 건물:
 * shape and facade photographs), in place of the boxes the register gives — and 광안대교, which
 * VWorld has no model of, built from its OpenStreetMap alignment and its published figures.
 * Loaded when the drone comes within LOAD_M of a site, let go past DROP_M. */

export type LandmarkSite = { id: string; name: string; lat: number; lon: number; radius: number };

/** The sites: centre and the radius whose buildings are all taken from VWorld's models. */
export const LANDMARK_SITES: LandmarkSite[] = [
  { id: "gyeongbokgung", name: "경복궁", lat: 37.5796, lon: 126.9770, radius: 430 },
  { id: "changdeokgung", name: "창덕궁", lat: 37.5794, lon: 126.9910, radius: 300 },
  { id: "changgyeonggung", name: "창경궁", lat: 37.5787, lon: 126.9948, radius: 260 },
  { id: "jongmyo", name: "종묘", lat: 37.5744, lon: 126.9941, radius: 240 },
  { id: "deoksugung", name: "덕수궁", lat: 37.5658, lon: 126.9751, radius: 170 },
  { id: "olympic-stadium", name: "서울올림픽주경기장", lat: 37.5157, lon: 127.0728, radius: 230 },
  { id: "jamsil-baseball", name: "잠실야구장", lat: 37.5122, lon: 127.0719, radius: 150 },
  { id: "jangchung-arena", name: "장충체육관", lat: 37.5583, lon: 127.0067, radius: 90 },
  { id: "gocheok-dome", name: "고척스카이돔", lat: 37.4982, lon: 126.8671, radius: 170 },
  { id: "worldcup-stadium", name: "서울월드컵경기장", lat: 37.5683, lon: 126.8972, radius: 220 },
  { id: "ddp", name: "동대문디자인플라자", lat: 37.5665, lon: 127.0092, radius: 170 },
  { id: "namsan-tower", name: "N서울타워", lat: 37.5512, lon: 126.9882, radius: 70 },
  { id: "sajik-baseball", name: "사직야구장", lat: 35.1940, lon: 129.0615, radius: 170 },
];

const LOAD_M = 1900, DROP_M = 3200;

/** 광안대교's upper deck (OpenStreetMap ways 511890774 … 382760546), north-east to south-west:
 * lon, lat. Its suspended part runs from point SUSP[0] to SUSP[1]. */
const GWANGAN: [number, number][] = [[129.135213, 35.1647074], [129.1344974, 35.1643387], [129.1342338, 35.1641399], [129.1340839, 35.163988], [129.1339528, 35.1638401], [129.1338287, 35.1636622], [129.1337205, 35.163448], [129.1336216, 35.1631974], [129.1335877, 35.1629908], [129.1335758, 35.1627717], [129.1335778, 35.1626449], [129.133596, 35.1624984], [129.1336456, 35.1622541], [129.1337043, 35.1620237], [129.133845, 35.1616273], [129.1339528, 35.1613506], [129.1340721, 35.1611377], [129.13422, 35.1609151], [129.134438, 35.1606289], [129.1350954, 35.1597649], [129.1357061, 35.158968], [129.1358012, 35.1588261], [129.1360011, 35.1585908], [129.1363599, 35.1580722], [129.136498, 35.1578789], [129.1367548, 35.1573253], [129.1369539, 35.1567442], [129.1370081, 35.1562436], [129.1369836, 35.1557258], [129.136886, 35.1551932], [129.1366969, 35.154712], [129.1363892, 35.1541649], [129.1314637, 35.148996], [129.12527, 35.1425428], [129.1211753, 35.1382762], [129.1210514, 35.1381655], [129.1208537, 35.1379936], [129.1205839, 35.137791], [129.1201831, 35.1375277], [129.1198756, 35.1373693], [129.1195487, 35.1372168], [129.1191988, 35.1370617], [129.1189831, 35.1369811], [129.1187303, 35.1369028], [129.1184677, 35.1368346], [129.1181599, 35.1367695], [129.1179239, 35.1367276], [129.1176587, 35.1366864], [129.1170043, 35.1366109], [129.1159849, 35.1364995], [129.1143292, 35.1362879], [129.112963, 35.1361007], [129.1125564, 35.1360465], [129.1122319, 35.1359912]];
const SUSP: [number, number] = [32, 33];
export const GWANGAN_CENTRE = { lat: 35.1457, lon: 129.1283 };

/** 광안대교 (1994–2002, 7.42 km; its suspended part 900 m: 200 + 500 + 200 m, two towers 105 m
 * over the sea; a double deck — eight lanes over two storeys — on a stiffening truss). Built in
 * the view frame: `project(lon, lat)` → x east, y north (m); `sea` the sea's height there. */
/** The upper deck's line and height (view frame, z up): 44 m over the sea along the suspended
 * part, easing down the approaches to the ground at their ends (where they meet the roads). */
export function gwanganDeck(project: (lon: number, lat: number) => [number, number], sea: number, groundAt: (x: number, y: number) => number) {
  const P = GWANGAN.map(([lon, lat]) => project(lon, lat));
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = cum[cum.length - 1], s0 = cum[SUSP[0]], s1 = cum[SUSP[1]];
  // The approach ends meet the ordinary road surface (the common 8 cm lift).
  const g0 = groundAt(P[0][0], P[0][1]) + .08, g1 = groundAt(P[P.length - 1][0], P[P.length - 1][1]) + .08;
  const top = sea + 44;
  const profile = (s: number) => {
    if (s >= s0 && s <= s1) return top;
    const near = s < s0, d = near ? s0 - s : s - s1, far = near ? s0 : total - s1, end = near ? g0 : g1;
    const k = Math.min(1, d / Math.max(1, far)), e = k * k * (3 - 2 * k);
    return top + (end - top) * e;
  };
  const sections = bridgeSections(P, profile);
  const lower = sections.points.slice(0, -1).map((p, i) => sections.heights[i] - 7.5 > groundAt(p[0], p[1]) + 1 && sections.heights[i + 1] - 7.5 > groundAt(sections.points[i + 1][0], sections.points[i + 1][1]) + 1);
  const upper = (s: number) => sections.at(s).z;
  return { P, cum, total, s0, s1, upper, z: cum.map(upper), sections, lower, g0, g1 };
}

export function buildGwanganBridge(project: (lon: number, lat: number) => [number, number], sea: number, hq: boolean, groundAt: (x: number, y: number) => number = () => sea, sharedDeck?: ReturnType<typeof gwanganDeck>) {
  const deck = sharedDeck ?? gwanganDeck(project, sea, groundAt);
  const P = deck.P;
  // distance along the deck
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = cum[cum.length - 1], s0 = cum[SUSP[0]], s1 = cum[SUSP[1]], span = s1 - s0;
  const at = deck.sections.at;
  // the decks' heights: gwanganDeck (the roads on it follow the same)
  const DEPTH = 7.5, HALF = 12.5, upper = deck.upper;
  const pos: number[] = [], index: number[] = [];
  const steel: number[] = [], steelIdx: number[] = [];
  const markings: number[] = [], markingIdx: number[] = [];
  const box = (out: number[], idx: number[], ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, h: number) => {
    // a square member from a to b (x east, y north, z up), w wide and h deep
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz) || 1;
    const d = new THREE.Vector3(dx / L, dz / L, -dy / L);
    const up = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(d, up).normalize().multiplyScalar(w / 2), v = new THREE.Vector3().crossVectors(u, d).normalize().multiplyScalar(h / 2);
    const A = new THREE.Vector3(ax, az, -ay), B = new THREE.Vector3(bx, bz, -by), k = out.length / 3;
    for (const E of [A, B]) for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const p = E.clone().addScaledVector(u, su).addScaledVector(v, sv); out.push(p.x, p.y, p.z); }
    for (let f = 0; f < 4; f++) { const a = k + f, b = k + (f + 1) % 4, c = k + 4 + (f + 1) % 4, e = k + 4 + f; idx.push(a, b, c, a, c, e); }
    idx.push(k, k + 2, k + 1, k, k + 3, k + 2, k + 4, k + 5, k + 6, k + 4, k + 6, k + 7);
  };
  const stripe = (s: number, end: number, offset: number, dz: number) => {
    const cuts = [s, ...deck.sections.stations.filter(v => v > s && v < end), end];
    for (let i = 1; i < cuts.length; i++) {
      const a = at(cuts[i - 1]), b = at(cuts[i]), w = .09, k = markings.length / 3;
      if (dz && !deck.lower[at((cuts[i - 1] + cuts[i]) / 2).k]) continue;
      for (const p of [a, b]) for (const side of [-1, 1]) {
        markings.push(p.x + p.nx * (offset + side * w), p.z + dz + .055, -(p.y + p.ny * (offset + side * w)));
      }
      markingIdx.push(k, k + 1, k + 3, k, k + 3, k + 2);
    }
  };
  // Four lanes on each storey, with solid shoulders and dashed lane divisions. These are
  // part of the bridge itself, including all-sea tiles with no cadastral road response.
  for (let s = 0; s < total; s += 6) {
    for (const dz of [0, -DEPTH]) {
      for (const offset of [-7, 7]) stripe(s, Math.min(total, s + 6), offset, dz);
      for (const offset of [-3.5, 0, 3.5]) stripe(s, Math.min(total, s + 3), offset, dz);
    }
  }
  // the deck: two slabs (upper and lower) and the truss's chords and diagonals between them; on
  // the approaches' last metres, where the deck meets the ground, the upper slab alone
  const STEP = 10;
  for (let section = 0; section < deck.sections.stations.length - 1; section++) {
    const s = deck.sections.stations[section], s2 = deck.sections.stations[section + 1];
    const a = at(s), b = at(s2), za = upper(s), zb = upper(s2), nx = a.nx, ny = a.ny, mx = b.nx, my = b.ny;
    if (!deck.lower[section]) {
      const k = pos.length / 3;
      pos.push(a.x + nx * HALF, za, -(a.y + ny * HALF), a.x - nx * HALF, za, -(a.y - ny * HALF), b.x - mx * HALF, zb, -(b.y - my * HALF), b.x + mx * HALF, zb, -(b.y + my * HALF));
      index.push(k, k + 1, k + 2, k, k + 2, k + 3);
      continue;
    }
    // slabs: a quad each
    for (const dz of [0, -DEPTH]) {
      const k = pos.length / 3;
      pos.push(a.x + nx * HALF, za + dz, -(a.y + ny * HALF), a.x - nx * HALF, za + dz, -(a.y - ny * HALF), b.x - mx * HALF, zb + dz, -(b.y - my * HALF), b.x + mx * HALF, zb + dz, -(b.y + my * HALF));
      index.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    // the truss on each side: top and bottom chords, a diagonal (alternating), a post
    for (const side of [1, -1]) {
      const ax = a.x + nx * side * HALF, ay = a.y + ny * side * HALF, bx = b.x + mx * side * HALF, by = b.y + my * side * HALF;
      box(steel, steelIdx, ax, ay, za + 0.4, bx, by, zb + 0.4, 0.8, 1.0);
      box(steel, steelIdx, ax, ay, za - DEPTH, bx, by, zb - DEPTH, 0.8, 1.0);
      const up = Math.round(s / STEP) % 2 === 0;
      box(steel, steelIdx, ax, ay, up ? za - DEPTH : za, bx, by, up ? zb : zb - DEPTH, 0.5, 0.5);
      box(steel, steelIdx, ax, ay, za - DEPTH, ax, ay, za, 0.5, 0.5);
      // Continuous guardrails on both decks, with a post each ten metres.
      for (const dz of [0, -DEPTH]) {
        box(steel, steelIdx, ax, ay, za + dz + 1.0, bx, by, zb + dz + 1.0, 0.24, 0.3);
        box(steel, steelIdx, ax, ay, za + dz, ax, ay, za + dz + 1.0, 0.18, 0.18);
      }
    }
  }
  // piers along the approaches: twin columns every 60 m (not under the suspended part)
  const concrete: number[] = [], concIdx: number[] = [];
  for (let s = 30; s < total - 10; s += 60) {
    if (s > s0 - 20 && s < s1 + 20) continue;
    const a = at(s), z = upper(s) - DEPTH - 0.5, nx = -a.ty, ny = a.tx;
    if (z < groundAt(a.x, a.y) + 1.5) continue;
    const foot = Math.min(sea - 6, groundAt(a.x, a.y) - 2);
    for (const side of [1, -1]) box(concrete, concIdx, a.x + nx * side * 8, a.y + ny * side * 8, foot, a.x + nx * side * 8, a.y + ny * side * 8, z, 3.2, 3.2);
    box(concrete, concIdx, a.x + nx * 10, a.y + ny * 10, z - 1.2, a.x - nx * 10, a.y - ny * 10, z - 1.2, 2.4, 2.4);
  }
  // the towers: two legs each, three cross beams, at 200 m into the suspended part from each end
  const TOWER = 105, legs: [number, number, number][] = [];
  for (const st of [s0 + span * (200 / 900), s0 + span * (700 / 900)]) {
    const a = at(st), nx = -a.ty, ny = a.tx;
    for (const side of [1, -1]) {
      const x = a.x + nx * side * (HALF + 2.5), y = a.y + ny * side * (HALF + 2.5);
      box(concrete, concIdx, x, y, sea - 8, x, y, sea + TOWER, 4.5, 6.5);
      legs.push([x, y, sea + TOWER]);
    }
    for (const z of [sea + TOWER - 4, sea + 70, upper(st) - DEPTH - 2]) box(concrete, concIdx, a.x + nx * (HALF + 2.5), a.y + ny * (HALF + 2.5), z, a.x - nx * (HALF + 2.5), a.y - ny * (HALF + 2.5), z, 3.5, 4);
  }
  // the main cables: parabolas — side spans from the deck at the suspended part's ends up to the
  // tower tops, the main span sagging 50 m between them — and hangers every 12 m to the deck
  const sT1 = s0 + span * (200 / 900), sT2 = s0 + span * (700 / 900);
  const cable = (s: number) => {
    if (s <= sT1) { const f = (s - s0) / (sT1 - s0); return upper(s0) + 2 + (sea + TOWER - upper(s0) - 2) * f * f; }
    if (s >= sT2) { const f = (s1 - s) / (s1 - sT2); return upper(s1) + 2 + (sea + TOWER - upper(s1) - 2) * f * f; }
    const f = (s - (sT1 + sT2) / 2) / ((sT2 - sT1) / 2);
    return sea + TOWER - 50 * (1 - f * f);
  };
  const cab: number[] = [], cabIdx: number[] = [];
  for (const side of [1, -1]) {
    let prev: [number, number, number] | null = null;
    const samples = Math.ceil((s1 - s0) / 6);
    for (let k = 0; k <= samples; k++) {
      const s = s0 + (s1 - s0) * k / samples;
      const a = at(s), x = a.x - a.ty * side * (HALF + 2.5), y = a.y + a.tx * side * (HALF + 2.5), z = cable(s);
      if (prev) box(cab, cabIdx, prev[0], prev[1], prev[2], x, y, z, 0.9, 0.9);
      if (k % 2 === 0 && z - upper(s) > 3) box(cab, cabIdx, x, y, z, x, y, upper(s) + 0.5, 0.18, 0.18);
      prev = [x, y, z];
    }
  }
  const group = new THREE.Group();
  group.name = "광안대교";
  const mk = (p: number[], i: number[], mat: THREE.Material, name: string) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(p), 3));
    g.setIndex(i);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = name; m.castShadow = hq; m.receiveShadow = true;
    group.add(m);
    return g;
  };
  const deckMat = new THREE.MeshStandardMaterial({ color: "#44484e", roughness: 0.9, metalness: 0.05, side: THREE.DoubleSide });
  const steelMat = new THREE.MeshStandardMaterial({ color: "#d9dde2", roughness: 0.45, metalness: 0.35 });
  const concMat = new THREE.MeshStandardMaterial({ color: "#c9c6bf", roughness: 0.82, metalness: 0 });
  const cableMat = new THREE.MeshStandardMaterial({ color: "#e8ebee", roughness: 0.35, metalness: 0.5, emissive: "#9fd8ff", emissiveIntensity: 0.04 });
  const paintMat = new THREE.MeshStandardMaterial({ color: "#e7e5da", roughness: 0.8, side: THREE.DoubleSide });
  const geos = [mk(pos, index, deckMat, "deck"), mk(steel, steelIdx, steelMat, "truss and guardrails"), mk(concrete, concIdx, concMat, "towers and piers"), mk(cab, cabIdx, cableMat, "cables"), mk(markings, markingIdx, paintMat, "four-lane markings on both decks")];
  group.updateMatrixWorld(true);
  return { group, materials: [deckMat, steelMat, concMat, cableMat, paintMat], dispose: () => { geos.forEach(g => g.dispose()); deckMat.dispose(); steelMat.dispose(); concMat.dispose(); cableMat.dispose(); paintMat.dispose(); } };
}

type Loaded = { state: "loading" | "placed"; group: THREE.Group | null; materials: THREE.Material[]; models: PhotoBuilding[]; dispose: () => void; stop: AbortController };

/** The sites near the drone, loaded and let go as it flies (droneWorld). */
export class Landmarks {
  readonly root = new THREE.Group();
  private loaded = new Map<string, Loaded>();
  private retryAt = new Map<string, number>();
  private alignedAt = 0;
  constructor(private readonly o: {
    key: string; lat0: number; lon0: number; hq: boolean;
    /** ground height (view frame) at x, y */
    groundAt: (x: number, y: number) => number;
    /** the sea's height (view frame), when known */
    seaLevel: () => number | null;
    addWarm: (parent: THREE.Object3D, obj: THREE.Object3D) => void;
    forget?: (materials: Set<THREE.Material>) => void;
    /** a site's models are on screen: hide the boxes standing in for them */
    onPlaced?: (site: LandmarkSite) => void;
    onBridgePlaced?: () => void;
  }) {
    this.root.name = "landmarks";
  }
  private kx() { return Math.cos((this.o.lat0 * Math.PI) / 180) * 111320; }
  /** where a site is (view frame) */
  at(lat: number, lon: number): [number, number] { return [(lon - this.o.lon0) * this.kx(), (lat - this.o.lat0) * 110540]; }
  /** 광안대교's deck (for the roads on it), when it is near and the sea's level is known. */
  gwanganDeck(): ReturnType<typeof gwanganDeck> | null {
    const sea = this.o.seaLevel();
    if (sea === null) return null;
    return (this.deckMemo ??= gwanganDeck((lon, lat) => this.at(lat, lon), sea, this.o.groundAt));
  }
  private deckMemo: ReturnType<typeof gwanganDeck> | null = null;
  /** Sites whose buildings are taken from the models (placed ones only). */
  placedSites(): LandmarkSite[] { return LANDMARK_SITES.filter(s => this.loaded.get(s.id)?.state === "placed"); }

  /** Keep a registered building when the survey did not actually supply a model for it. */
  hasModelAt(site: LandmarkSite, x: number, y: number): boolean {
    return this.loaded.get(site.id)?.models.some(m => {
      const ring = m.hull;
      let inside = false, edge = Infinity;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[j], [bx, by] = ring[i];
        if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
        const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        edge = Math.min(edge, Math.hypot(x - ax - dx * t, y - ay - dy * t));
      }
      return inside || edge < 8;
    }) ?? false;
  }

  update(x: number, y: number) {
    const now = performance.now();
    // Models usually arrive before their terrain tile. Follow the later DEM instead of
    // leaving palace halls floating at the fallback height used during the download.
    if (now - this.alignedAt > 500) {
      this.alignedAt = now;
      for (const entry of this.loaded.values()) for (const child of entry.group?.children ?? []) {
        if (child.userData.landmarkX === undefined) continue;
        child.position.y = this.o.groundAt(child.userData.landmarkX, child.userData.landmarkY) - 0.15;
        child.updateMatrixWorld();
      }
      const deck = this.deckMemo;
      if (deck && this.loaded.has('gwangan')) {
        const a = deck.P[0], b = deck.P[deck.P.length - 1];
        // Later streamed DEM posts must update the rendered bridge and its traffic together.
        if (Math.abs(this.o.groundAt(a[0], a[1]) + .08 - deck.g0) > .15 || Math.abs(this.o.groundAt(b[0], b[1]) + .08 - deck.g1) > .15) {
          this.drop('gwangan'); this.deckMemo = null;
        }
      }
    }
    for (const site of LANDMARK_SITES) {
      const [sx, sy] = this.at(site.lat, site.lon), d = Math.hypot(sx - x, sy - y) - site.radius;
      const have = this.loaded.get(site.id);
      if (!have && d < LOAD_M && now >= (this.retryAt.get(site.id) ?? 0)) void this.load(site);
      else if (have && d > DROP_M) this.drop(site.id);
    }
    const [bx, by] = this.at(GWANGAN_CENTRE.lat, GWANGAN_CENTRE.lon), bd = Math.hypot(bx - x, by - y) - 3700;
    const bh = this.loaded.get("gwangan");
    if (!bh && bd < LOAD_M) this.bridge();
    else if (bh && bd > DROP_M) this.drop("gwangan");
  }

  private bridge() {
    const sea = this.o.seaLevel();
    if (sea === null) return;   // (asked again next frame: the sea's level first)
    const deck = this.gwanganDeck()!;
    const made = buildGwanganBridge((lon, lat) => this.at(lat, lon), sea, this.o.hq, this.o.groundAt, deck);
    this.loaded.set("gwangan", { state: "placed", group: made.group, materials: made.materials, models: [], dispose: made.dispose, stop: new AbortController() });
    this.o.addWarm(this.root, made.group);
    this.o.onBridgePlaced?.();
  }

  private async load(site: LandmarkSite) {
    const stop = new AbortController();
    const group = new THREE.Group();
    group.name = `landmark ${site.name}`;
    const mats: THREE.Material[] = [], models: PhotoBuilding[] = [];
    const release = (m: PhotoBuilding) => { m.geometry.dispose(); m.texture?.dispose(); (m.texture?.image as ImageBitmap | undefined)?.close?.(); };
    const entry: Loaded = { state: "loading", group, materials: mats, models, stop,
      dispose: () => { models.forEach(release); mats.forEach(m => m.dispose()); } };
    this.loaded.set(site.id, entry);
    this.o.addWarm(this.root, group);
    // (each model shown as it comes — nearest the site's centre first — on the ground under its own
    // footprint; z up in its local frame)
    const place = (m: PhotoBuilding) => {
      if (stop.signal.aborted) { release(m); return; }
      models.push(m);
      const mat = new THREE.MeshStandardMaterial({ map: m.texture, color: m.texture ? "#ffffff" : "#c8c3b8", roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(m.geometry, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = this.o.groundAt(m.cx, m.cy) - 0.15;
      mesh.castShadow = this.o.hq; mesh.receiveShadow = true;
      mesh.name = `landmark model ${m.key}`;
      mesh.userData.landmark = site.name;
      mesh.userData.landmarkX = m.cx; mesh.userData.landmarkY = m.cy;
      mesh.updateMatrixWorld(true);
      group.add(mesh);
      mats.push(mat);
    };
    try {
      await photoBuildings(this.o.key, this.o.lat0, this.o.lon0, site.radius, { photo: true, at: site, maxTex: this.o.hq ? 2048 : 1024, signal: stop.signal, workers: 8, onBuilding: place });
    } catch { /* (what came, stays) */ }
    if (stop.signal.aborted || this.loaded.get(site.id) !== entry) return;
    if (!models.length) { this.drop(site.id); this.retryAt.set(site.id, performance.now() + 10000); return; }
    this.retryAt.delete(site.id);
    entry.state = "placed";
    this.o.onPlaced?.(site);
  }

  private drop(id: string) {
    const e = this.loaded.get(id);
    if (!e) return;
    this.loaded.delete(id);
    e.stop.abort();
    if (e.group) { e.group.removeFromParent(); this.o.forget?.(new Set(e.materials)); }
    e.dispose();
  }

  dispose() { for (const id of [...this.loaded.keys()]) this.drop(id); this.root.removeFromParent(); }
}
