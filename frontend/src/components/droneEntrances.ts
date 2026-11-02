import * as THREE from "three";

/* Every building's way in, for the walker in the drone's world: the edge of its outline that faces
 * the street (the nearest lane) carries an entrance sized by what the building is — a block of
 * flats' 공동현관, a shop's glass front, an office tower's tall lobby doors, a school's double doors
 * under a porch, a government building's columned portico and steps, a department store's wide
 * glazed front, a hospital's drop-off canopy, a museum's grand portico. They are drawn as instanced
 * boxes (a handful of draws for all of them) and are where E goes in. */

export type EntranceKind = "apartment" | "house" | "shop" | "office" | "school" | "civic" | "store" | "hospital" | "museum" | "station";
type Ring = [number, number][];

/** door width and height, canopy depth and width, columns, steps, sign colour, label (m) */
export const ENTRANCE_SPEC: Record<EntranceKind, { w: number; h: number; cd: number; cw: number; cols: number; steps: number; sign: string; label: string }> = {
  house: { w: 1.0, h: 2.1, cd: 0.9, cw: 1.8, cols: 0, steps: 1, sign: "#ffd27a", label: "현관" },
  apartment: { w: 2.2, h: 2.6, cd: 1.9, cw: 3.8, cols: 0, steps: 1, sign: "#9fe7ff", label: "공동현관" },
  shop: { w: 1.8, h: 2.5, cd: 1.1, cw: 4.2, cols: 0, steps: 0, sign: "#ffcf6e", label: "상가 출입문" },
  office: { w: 4.4, h: 3.6, cd: 3.0, cw: 7.5, cols: 2, steps: 1, sign: "#bfe8ff", label: "로비 출입구" },
  school: { w: 3.6, h: 2.9, cd: 2.6, cw: 6.4, cols: 2, steps: 2, sign: "#7ef0a8", label: "학교 현관" },
  civic: { w: 4.0, h: 3.8, cd: 3.4, cw: 9.0, cols: 4, steps: 3, sign: "#ffe9a8", label: "청사 정문" },
  store: { w: 8.0, h: 4.2, cd: 3.2, cw: 12.0, cols: 2, steps: 0, sign: "#ff8ad8", label: "백화점 정문" },
  hospital: { w: 8.0, h: 3.4, cd: 9.0, cw: 18.0, cols: 4, steps: 0, sign: "#7dffb0", label: "병원 정문" },
  museum: { w: 5.0, h: 5.0, cd: 3.6, cw: 11.0, cols: 6, steps: 4, sign: "#e8d3a0", label: "박물관 정문" },
  station: { w: 5.0, h: 3.0, cd: 3.0, cw: 8.0, cols: 2, steps: 0, sign: "#7fb2ff", label: "역 출입구" },
};

export interface Entrance {
  key: string; kind: EntranceKind; ring: Ring;
  /** the door's middle on the wall, outward normal, along-wall direction (view frame: x east, y north) */
  x: number; y: number; nx: number; ny: number; tx: number; ty: number;
  w: number; h: number; scale: number; z: number;
  /** the building's name for the sign over the way in (the map's label in or by it) */
  name?: string;
}

export const ringArea = (r: Ring) => Math.abs(r.reduce((t, p, i) => { const q = r[(i + 1) % r.length]; return t + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
export function inRing(x: number, y: number, r: Ring) {
  let h = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) h = !h; }
  return h;
}

/** What a building is, from the names on it (the map's labels in or by it), its size and height. */
export function entranceKind(names: { name: string; kind: string }[], area: number, height: number, ctx: { aptNear?: boolean; slender?: number } = {}): EntranceKind {
  const all = names.map(n => n.name).join(" "), kinds = new Set(names.map(n => n.kind));
  if (kinds.has("hospital") || kinds.has("er") || /병원|의료원|메디컬|의원/.test(all)) return area > 400 ? "hospital" : "shop";
  if (/박물관|미술관|기념관|과학관|전시관|아트센터|문화회관/.test(all)) return "museum";
  if (/백화점|아울렛|쇼핑몰|몰$|마트|스타필드|타임스퀘어/.test(all) || (kinds.has("market") && area > 2500)) return "store";
  if (kinds.has("school") || /학교|초등|중학|고등|대학|캠퍼스|유치원/.test(all)) return "school";
  if (kinds.has("gov") || /구청|시청|도청|군청|주민센터|행정복지|경찰|소방|우체국|법원|청사|세무서|도서관/.test(all)) return "civic";
  if (kinds.has("station") || kinds.has("subway") || kinds.has("train") || /역$|터미널/.test(all)) return "station";
  if (kinds.has("apt") || /아파트|APT|\d+동$/.test(all)) return "apartment";
  // (no name on it: in an apartment complex — its blocks' labels about — or a tall, narrow slab, a block of flats)
  if (!kinds.has("commercial") && !kinds.has("market") && height > 12 && area < 2500 && (ctx.aptNear || (ctx.slender ?? 1) > 2.3)) return "apartment";
  if (kinds.has("commercial") || kinds.has("market")) return height > 30 ? "office" : "shop";
  if (height > 35 && area > 600) return area > 2500 && height < 60 ? "store" : "office";
  if (height > 25 && area < 1200) return "apartment";
  if (area < 160) return "house";
  return height > 14 ? "office" : "shop";
}

/** The entrance on the wall facing `toward` (a lane point; else the outline's longest edge): the
 * edge whose outside looks most that way and is long enough, the door where the street is nearest. */
export function placeEntrance(ring: Ring, kind: EntranceKind, toward: [number, number] | null, ground: (x: number, y: number) => number, key = ""): Entrance | null {
  if (ring.length < 3) return null;
  const sp = ENTRANCE_SPEC[kind], area = ringArea(ring);
  const scale = THREE.MathUtils.clamp(Math.sqrt(area) / (kind === "house" ? 12 : kind === "apartment" ? 26 : 40), 0.85, 1.35);
  const cx = ring.reduce((t, p) => t + p[0], 0) / ring.length, cy = ring.reduce((t, p) => t + p[1], 0) / ring.length;
  let best: Entrance | null = null, bestScore = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1.6) continue;
    const tx = (b[0] - a[0]) / len, ty = (b[1] - a[1]) / len;
    let nx = ty, ny = -tx;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (inRing(mx + nx * 0.3, my + ny * 0.3, ring)) { nx = -nx; ny = -ny; }
    // (the door where the street is nearest along this edge, kept off its corners)
    const w = Math.min(sp.w * scale, len - 0.8), half = w / 2 + 0.4;
    let t = len / 2;
    if (toward) t = THREE.MathUtils.clamp((toward[0] - a[0]) * tx + (toward[1] - a[1]) * ty, half, len - half);
    if (len < 2 * half) t = len / 2;
    const x = a[0] + tx * t, y = a[1] + ty * t;
    const facing = toward ? ((toward[0] - x) * nx + (toward[1] - y) * ny) / (Math.hypot(toward[0] - x, toward[1] - y) || 1) : 0;
    const dist = toward ? Math.hypot(toward[0] - x, toward[1] - y) : 0;
    const score = facing * 40 - dist * 0.4 + Math.min(len, 30) * 0.6 + (toward ? 0 : ((x - cx) * nx + (y - cy) * ny) * 0.01);
    if (score > bestScore) { bestScore = score; best = { key, kind, ring, x, y, nx, ny, tx, ty, w: Math.max(0.9, w), h: sp.h * THREE.MathUtils.clamp(scale, 1, 1.2), scale, z: ground(x + nx * 0.6, y + ny * 0.6) }; }
  }
  return best;
}

type Part = "frame" | "glass" | "canopy" | "stone" | "sign" | "drum" | "plant" | "asphalt" | "lobby" | "column" | "beam";
/** the door leaves themselves: glass, drawn with the rest except at the entrance being used */
type BoxPart = Part | "door";
const PARTS: Part[] = ["frame", "glass", "canopy", "stone", "sign", "drum", "plant", "asphalt", "lobby", "column", "beam"];
const MAX = 2400;

/** The boxes of one entrance: [part, along, up, out (centre), size along, size up, size out]. */
export function entranceBoxes(e: Entrance): [BoxPart, number, number, number, number, number, number][] {
  const sp = ENTRANCE_SPEC[e.kind], s = e.scale, w = e.w, h = e.h, cd = sp.cd * s, cw = Math.max(sp.cw * s, w + 1), out: [BoxPart, number, number, number, number, number, number][] = [];
  const stepH = 0.15, base = sp.steps * stepH;
  // steps up to the door, the landing under the canopy
  // (each step a slab from the wall out, the higher ones shorter: a flight up to the landing)
  for (let i = 0; i < sp.steps; i++) { const depth = Math.max(cd, 1) + (sp.steps - 1 - i) * 0.34; out.push(["stone", 0, (i + 1) * stepH / 2, depth / 2, cw + 0.4 + (sp.steps - 1 - i) * 0.6, (i + 1) * stepH, depth]); }
  if (!sp.steps) out.push(["stone", 0, 0.03, cd / 2, cw, 0.06, cd]);
  // the doors: glass leaves, the frame round them and the mullion between
  out.push(["door", 0, base + h / 2, 0.08, w, h, 0.06]);
  out.push(["frame", -(w / 2 + 0.1), base + h / 2 + 0.08, 0.1, 0.2, h + 0.16, 0.26], ["frame", w / 2 + 0.1, base + h / 2 + 0.08, 0.1, 0.2, h + 0.16, 0.26]);
  out.push(["frame", 0, base + h + 0.12, 0.1, w + 0.4, 0.24, 0.26]);
  if (w > 1.4) for (let k = 1, n = Math.max(2, Math.round(w / 1.1)); k < n; k++) out.push(["frame", -w / 2 + w * k / n, base + h / 2, 0.11, 0.05, h, 0.08]);
  // a public building's lobby: a lit glass wall two storeys high either side of and over the doors,
  // its mullions and the floor band between the storeys
  if (e.kind === "hospital" || e.kind === "office" || e.kind === "civic" || e.kind === "museum" || e.kind === "store" || e.kind === "school" || e.kind === "station") {
    const lw = Math.min(cw * 0.86, w + (e.kind === "school" ? 4 : 10) * s), lh = h + (e.kind === "school" ? 1.2 : 3.6) * Math.min(1.2, s);
    out.push(["lobby", 0, base + lh / 2, 0.05, lw, lh, 0.04]);
    for (let k = 0, n = Math.max(2, Math.round(lw / 1.8)); k <= n; k++) out.push(["frame", -lw / 2 + lw * k / n, base + lh / 2, 0.07, 0.08, lh, 0.1]);
    out.push(["frame", 0, base + lh, 0.07, lw + 0.1, 0.14, 0.12], ["frame", 0, base + h + 0.6, 0.07, lw, 0.22, 0.12]);
  }
  // a shop's or a store's glazed front on either side of the door
  if (e.kind === "shop" || e.kind === "store" || e.kind === "office" || e.kind === "station") { const side = (cw - w) / 2 - 0.3; if (side > 0.4) for (const sg of [-1, 1]) out.push(["glass", sg * (w / 2 + 0.2 + side / 2), base + (h + 0.6) / 2, 0.07, side, h + 0.6, 0.05]); }
  // the canopy over the way in, on columns where the building has them
  if (cd > 0.6) {
    // (a hospital's canopy high enough for an ambulance under it)
    const top = base + h + 0.45 + (e.kind === "hospital" ? 1.6 : 0);
    // (a public building's canopy is a deep slab with a fascia band and lights under it; a house's a thin hood)
    const big = cd > 2, slab = big ? 0.55 : 0.2;
    out.push(["canopy", 0, top + slab / 2 - 0.11, cd / 2, cw, slab, cd]);
    if (big) {
      out.push(["frame", 0, top + slab - 0.08, cd + 0.02, cw + 0.04, 0.08, 0.06], ["frame", 0, top - 0.1, cd + 0.02, cw + 0.04, 0.05, 0.06]);
      // (downlights along the underside, two rows)
      for (let k = 0, n = Math.max(2, Math.floor(cw / 2.2)); k < n; k++) for (const v of [cd * 0.3, cd * 0.72]) out.push(["sign", -cw / 2 + cw * (k + 0.5) / n, top - 0.13, v, 0.5, 0.03, 0.5]);
    } else out.push(["sign", 0, top - 0.14, cd - 0.02, cw * 0.96, 0.06, 0.04]);
    const thick = e.kind === "civic" || e.kind === "museum" ? 0.62 : big ? 0.5 : 0.32;
    if (sp.cols) for (let k = 0; k < sp.cols; k++) { const u = sp.cols === 1 ? 0 : -cw / 2 + thick / 2 + 0.15 + (cw - thick - 0.3) * k / (sp.cols - 1); out.push(["column", u, top / 2, cd - thick / 2 - 0.15, thick, top, thick], ["stone", u, 0.08, cd - thick / 2 - 0.15, thick + 0.2, 0.16, thick + 0.2]); }
  }
  // a revolving door in the middle of a big building's doors (its glass drum, the frame rings)
  if (e.kind === "hospital" || e.kind === "office" || e.kind === "store" || e.kind === "civic") {
    const D = Math.min(3.2, w * 0.38);
    // (standing out from the facade as a vestibule, so the whole drum is seen)
    const v = D / 2 + 0.16;
    out.push(["drum", 0, base + h / 2, v, D, h, D], ["frame", 0, base + h + 0.05, v, D + 0.2, 0.12, D + 0.2], ["frame", 0, base + 0.05, v, D + 0.1, 0.1, D + 0.1]);
  }
  // a hospital's main entrance: a driveway under its canopy for cars to drop patients, a walk along
  // the doors, planters, the green cross on the fascia
  if (e.kind === "hospital") {
    out.push(["asphalt", 0, 0.025, cd * 0.5 + 2.6, cw + 8, 0.05, cd + 1.2]);
    out.push(["stone", 0, 0.08, 1.5, cw, 0.16, 3]);
    for (const sg of [-1, 1]) { out.push(["stone", sg * (w / 2 + 1.7), 0.35, 1.5, 1.4, 0.7, 1.4], ["plant", sg * (w / 2 + 1.7), 0.9, 1.5, 1.2, 0.5, 1.2]); }
    const top = base + h + 1.35, fx = -cw / 2 + 1.3;
    out.push(["sign", fx, top, cd + 0.08, 1.1, 0.36, 0.06], ["sign", fx, top, cd + 0.08, 0.36, 1.1, 0.06]);
  }
  // a government building's or a museum's portico: planters either side of the steps
  if (e.kind === "civic" || e.kind === "museum" || e.kind === "store") for (const sg of [-1, 1]) out.push(["stone", sg * (cw / 2 + 0.9), 0.4, cd * 0.6, 1.2, 0.8, 1.2], ["plant", sg * (cw / 2 + 0.9), 1.0, cd * 0.6, 1.0, 0.5, 1.0]);
  // the lit sign over the door
  out.push(["sign", 0, base + h + 0.75 + (cd > 0.6 ? 0.25 : 0), 0.14, Math.min(cw * 0.7, 1.4 + w * 0.5), 0.34 * Math.min(1.4, s), 0.06]);
  // the beam of light marking it, rising from just before the doors
  out.push(["beam", 0, 9, Math.min(cd, 2.5) + 0.8, 1.6, 18, 1.6]);
  return out;
}

export class EntranceLayer {
  readonly group = new THREE.Group();
  private meshes = new Map<Part, THREE.InstancedMesh>();
  private materials: THREE.Material[] = [];
  private geo = new THREE.BoxGeometry(1, 1, 1);
  private cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1, false);
  /** a light column narrowing upward, open at both ends */
  private beamGeo = new THREE.CylinderGeometry(0.15, 0.5, 1, 20, 1, true);
  entrances: Entrance[] = [];
  private keys = "";
  constructor() {
    const mat: Record<Part, THREE.Material> = {
      frame: new THREE.MeshStandardMaterial({ color: "#2b3138", metalness: 0.7, roughness: 0.35 }),
      // (the doors' glass and the lobby behind it lit warm from inside: a way in reads as lit)
      glass: new THREE.MeshStandardMaterial({ color: "#d6ecff", emissive: "#ffd9a0", emissiveIntensity: 0.38, metalness: 0.2, roughness: 0.06, transparent: true, opacity: 0.78 }),
      lobby: new THREE.MeshStandardMaterial({ color: "#7fa9c8", emissive: "#ffe2b8", emissiveIntensity: 0.17, metalness: 0.55, roughness: 0.05 }),
      column: new THREE.MeshStandardMaterial({ color: "#f1f2f0", roughness: 0.45 }),
      // (every way in marked from afar: a soft column of light in its sign's colour, over the doorstep)
      beam: new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }),
      canopy: new THREE.MeshStandardMaterial({ color: "#eef0f2", metalness: 0.2, roughness: 0.45 }),
      stone: new THREE.MeshStandardMaterial({ color: "#cfc6b6", roughness: 0.85 }),
      sign: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
      drum: new THREE.MeshStandardMaterial({ color: "#b8e4ff", emissive: "#2f6f8f", emissiveIntensity: 0.4, metalness: 0.3, roughness: 0.06, transparent: true, opacity: 0.6 }),
      plant: new THREE.MeshStandardMaterial({ color: "#3f7a3a", roughness: 0.9 }),
      asphalt: new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.95 }),
    };
    for (const p of PARTS) {
      const m = new THREE.InstancedMesh(p === "drum" || p === "column" ? this.cyl : p === "beam" ? this.beamGeo : this.geo, mat[p], p === "drum" || p === "beam" ? 256 : MAX); m.count = 0; m.frustumCulled = false; m.castShadow = p !== "glass" && p !== "sign"; m.receiveShadow = true;
      if (p === "sign" || p === "beam") m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
      this.meshes.set(p, m); this.group.add(m); this.materials.push(mat[p]);
    }
  }
  /** set the entrances drawn (rebuilt only when the set changes) */
  /** the entrance whose doors move (the nearest the walker), its leaves and how open they are */
  private active: Entrance | null = null;
  private leaves = new THREE.Group();
  private open = 0;
  /** set the entrances drawn (rebuilt only when the set or the one with moving doors changes) */
  set(list: Entrance[], active: Entrance | null = this.active) {
    const keys = list.map(e => e.key).join("|") + "#" + (active?.key ?? "");
    if (keys === this.keys) return;
    if (active !== this.active) this.makeLeaves(active);
    this.keys = keys; this.entrances = list;
    const n = new Map<Part, number>(PARTS.map(p => [p, 0]));
    const m4 = new THREE.Matrix4(), basis = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(), c = new THREE.Color();
    for (const e of list) {
      // (three's frame: x east, y up, z south; along the wall X, up Y, Z = X × Y — its sign immaterial for a box)
      X.set(e.tx, 0, -e.ty); Z.crossVectors(X, Y); basis.makeBasis(X, Y, Z);
      for (const [bp, u, up, out, su, sy, so] of entranceBoxes(e)) {
        // (the doors of the entrance in use are the moving leaves instead)
        if (bp === "door" && e === active) continue;
        const part: Part = bp === "door" ? "glass" : bp;
        const k = n.get(part)!; if (k >= MAX) continue;
        const px = e.x + e.tx * u + e.nx * out, py = e.y + e.ty * u + e.ny * out;
        m4.copy(basis).scale(new THREE.Vector3(su, sy, so)).setPosition(px, e.z + up, -py);
        const mesh = this.meshes.get(part)!; mesh.setMatrixAt(k, m4);
        if (part === "sign" || part === "beam") mesh.setColorAt(k, c.set(ENTRANCE_SPEC[e.kind].sign));
        n.set(part, k + 1);
      }
    }
    for (const [p, mesh] of this.meshes) { mesh.count = n.get(p)!; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
  }
  /** Two sliding glass leaves (framed) at the active entrance, in its wall's frame. */
  private makeLeaves(e: Entrance | null) {
    this.active = e; this.open = 0;
    for (const c of [...this.leaves.children]) { this.leaves.remove(c); c.traverse(m => (m as THREE.Mesh).geometry?.dispose()); }
    if (!e) return;
    if (!this.leaves.parent) this.group.add(this.leaves);
    const box = entranceBoxes(e).find(b => b[0] === "door")!, [, , up, out, w, h] = box;
    const glass = this.meshes.get("glass")!.material as THREE.Material, frame = this.meshes.get("frame")!.material as THREE.Material;
    for (const side of [-1, 1]) {
      const leaf = new THREE.Group();
      const pane = new THREE.Mesh(new THREE.BoxGeometry(w / 2 - 0.02, h - 0.04, 0.04), glass); leaf.add(pane);
      // (its frame: a rail top and bottom, a stile at the meeting edge, a pull bar)
      for (const [x, y, sx, sy] of [[0, h / 2 - 0.03, w / 2, 0.06], [0, -h / 2 + 0.05, w / 2, 0.1], [-side * (w / 4 - 0.025), 0, 0.05, h], [-side * (w / 4 - 0.12), 0, 0.03, 0.9]] as const) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.06), frame); m.position.set(x, y, 0); leaf.add(m);
      }
      leaf.userData.side = side; leaf.userData.w = w;
      this.leaves.add(leaf);
    }
    // (placed in the wall's frame: x along it, y up, z out — as the instanced boxes)
    const X = new THREE.Vector3(e.tx, 0, -e.ty), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3().crossVectors(X, Y);
    this.leaves.matrixAutoUpdate = false;
    this.leaves.matrix.makeBasis(X, Y, Z).setPosition(e.x + e.nx * out, e.z + up, -(e.y + e.ny * out));
    this.leaves.matrixWorldNeedsUpdate = true;
    this.place();
  }
  private place() {
    for (const leaf of this.leaves.children) { const side = leaf.userData.side as number, w = leaf.userData.w as number; leaf.position.set(side * (w / 4 + this.open * (w / 2 - 0.06)), 0, side * 0.03); }
  }
  /** the active entrance's doors slide open while `want` (someone at them), shut again after;
   * returns true the frame they begin to open (for the whoosh) */
  doors(dt: number, want: boolean): boolean {
    if (!this.active) return false;
    const was = this.open;
    this.open = THREE.MathUtils.clamp(this.open + (want ? dt / 0.7 : -dt / 1.1), 0, 1);
    if (this.open !== was) this.place();
    return want && was === 0 && this.open > 0;
  }
  get activeEntrance() { return this.active; }
  /** the building names lit on the fascias of the entrances nearest (x, y) — eight at most */
  private names = new Map<string, { mesh: THREE.Mesh; e: Entrance }>();
  nameSigns(x: number, y: number) {
    const want = this.entrances.filter(e => e.name && ENTRANCE_SPEC[e.kind].cd > 0.6).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)).slice(0, 8);
    const keep = new Set(want.map(e => e.key));
    for (const [k, n] of this.names) if (!keep.has(k)) { n.mesh.removeFromParent(); n.mesh.geometry.dispose(); (n.mesh.material as THREE.MeshBasicMaterial).map?.dispose(); (n.mesh.material as THREE.Material).dispose(); this.names.delete(k); }
    for (const e of want) if (!this.names.has(e.key)) this.names.set(e.key, { mesh: this.nameSign(e), e });
  }
  private nameSign(e: Entrance): THREE.Mesh {
    const sp = ENTRANCE_SPEC[e.kind], cw = Math.max(sp.cw * e.scale, e.w + 1), cd = sp.cd * e.scale, base = sp.steps * 0.15;
    const top = base + e.h + 0.45 + (e.kind === "hospital" ? 1.6 : 0);
    const text = e.name!.slice(0, 18), c = document.createElement("canvas"), H = 128, g0 = c.getContext("2d")!;
    g0.font = `800 84px Pretendard, "Noto Sans KR", "Malgun Gothic", sans-serif`;
    const W = Math.min(2048, Math.ceil(g0.measureText(text).width + 96)); c.width = W; c.height = H;
    const g = c.getContext("2d")!;
    g.fillStyle = "rgba(8,14,20,0.92)"; g.fillRect(0, 0, W, H);
    g.font = `800 84px Pretendard, "Noto Sans KR", "Malgun Gothic", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.shadowColor = sp.sign; g.shadowBlur = 18; g.fillStyle = "#ffffff"; g.fillText(text, W / 2, H / 2 + 4);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    // (letters as tall as the fascia band allows, on its front face)
    const height = cd > 2 ? 0.46 : 0.3, width = Math.min(cw * 0.8, height * W / H);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height * (width / (height * W / H))), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true }));
    // (on the canopy's front edge facing out; with no canopy, over the door)
    const X = new THREE.Vector3(e.tx, 0, -e.ty), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3().crossVectors(X, Y);
    const outward = new THREE.Vector3(e.nx, 0, -e.ny);
    if (Z.dot(outward) < 0) X.negate(), Z.negate();
    m.matrixAutoUpdate = false;
    const v = cd + 0.06, u = e.kind === "hospital" ? cw * 0.08 : 0;
    m.matrix.makeBasis(X, Y, Z).setPosition(e.x + e.tx * u + e.nx * v, e.z + top + (cd > 2 ? 0.17 : 0), -(e.y + e.ty * u + e.ny * v));
    m.matrixWorldNeedsUpdate = true; this.group.add(m);
    return m;
  }
  /** the entrance whose door is nearest (x, y) within r */
  nearest(x: number, y: number, r: number): { e: Entrance; d: number } | null {
    let best: { e: Entrance; d: number } | null = null;
    for (const e of this.entrances) { const d = Math.hypot(e.x + e.nx * 0.8 - x, e.y + e.ny * 0.8 - y); if (d < r && (!best || d < best.d)) best = { e, d }; }
    return best;
  }
  /** the entrance of the building with this outline */
  of(ring: Ring) { return this.entrances.find(e => e.ring === ring) ?? null; }
  dispose() { this.makeLeaves(null); this.names.forEach(n => { n.mesh.geometry.dispose(); (n.mesh.material as THREE.MeshBasicMaterial).map?.dispose(); (n.mesh.material as THREE.Material).dispose(); }); this.names.clear(); this.cyl.dispose(); this.beamGeo.dispose(); this.geo.dispose(); this.materials.forEach(m => m.dispose()); this.meshes.forEach(m => m.dispose()); this.group.removeFromParent(); }
}
