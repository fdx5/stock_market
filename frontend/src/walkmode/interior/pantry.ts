import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/* What is in the fridge, and what can be put in it: groceries modelled at their real sizes (a 900 ml
 * carton of milk, 355 ml cans, a 500 ml bottle of beer, a 6-egg carton…), each one mesh of one
 * shared material (vertex colours and one atlas of printed labels), so a full fridge costs a draw an
 * item. They sit in slots — the fridge's shelves and door pockets, a shopping basket on the dining
 * table — and are taken out to the hand and put back where the walker chooses. Where everything is
 * is kept in this browser (localStorage) and is the same in every flat's fridge. */

export type ItemKind = "milk" | "cola" | "cider" | "beer" | "ketchup" | "apple" | "orange" | "banana" | "sausage" | "cake" | "eggs";
export const ITEM_NAME: Record<ItemKind, string> = {
  milk: "우유", cola: "콜라", cider: "사이다", beer: "맥주", ketchup: "케첩", apple: "사과", orange: "오렌지",
  banana: "바나나", sausage: "후랑크소시지", cake: "케이크", eggs: "계란",
};
/** what fits a door pocket (upright and narrow) */
const SLIM = new Set<ItemKind>(["milk", "cola", "cider", "beer", "ketchup"]);
/** everything there is, and where it starts (slot ids: f:<level>:<i> shelves, d:<door>:<bin>:<i> door pockets, b:<i> the basket) */
const START: [string, ItemKind][] = [
  ["f:0:0", "apple"], ["f:0:1", "orange"], ["f:0:2", "eggs"], ["f:1:0", "sausage"], ["f:1:2", "cake"], ["f:2:1", "banana"],
  ["d:0:0:0", "milk"], ["d:0:1:0", "beer"], ["d:1:0:1", "ketchup"], ["d:1:1:0", "cola"],
  ["b:0", "milk"], ["b:1", "apple"], ["b:2", "orange"], ["b:3", "beer"], ["b:4", "cider"], ["b:5", "cola"],
];
const STORE = "walk.fridge.v1";

// ------------------------------------------------------------------ the label atlas
const CELL = 256, CELLS = 4;
const LABEL: Partial<Record<ItemKind, number>> = { milk: 1, cola: 2, cider: 3, beer: 4, ketchup: 5, sausage: 6, eggs: 7 };
const FONT = "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

function atlas(): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = c.height = CELL * CELLS;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
  const cell = (n: number, draw: (g: CanvasRenderingContext2D) => void) => {
    g.save(); g.translate((n % CELLS) * CELL, Math.floor(n / CELLS) * CELL); g.beginPath(); g.rect(0, 0, CELL, CELL); g.clip(); draw(g); g.restore();
  };
  const text = (g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, weight = 800) => {
    g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(s, x, y);
  };
  // milk: a white carton, a blue band, the grade
  cell(1, g => {
    g.fillStyle = "#fbfbf8"; g.fillRect(0, 0, CELL, CELL);
    g.fillStyle = "#1d5fc4"; g.fillRect(0, 150, CELL, 70);
    g.fillStyle = "#7fb2ea"; g.fillRect(0, 140, CELL, 10);
    text(g, "우유", 128, 80, 78, "#1d5fc4");
    text(g, "1A등급 900ml", 128, 185, 26, "#ffffff", 700);
    g.fillStyle = "#2c2c2c"; for (let i = 0; i < 18; i++) g.fillRect(60 + i * 7, 232, i % 3 ? 3 : 5, 18);
  });
  // a can of cola: red, a white wave
  cell(2, g => {
    g.fillStyle = "#c8141e"; g.fillRect(0, 0, CELL, CELL);
    g.strokeStyle = "#ffffff"; g.lineWidth = 9; g.beginPath(); g.moveTo(0, 170); g.bezierCurveTo(70, 120, 150, 220, 256, 160); g.stroke();
    text(g, "콜라", 128, 95, 74, "#ffffff"); text(g, "COLA", 128, 210, 30, "#ffffff", 700);
  });
  // a can of cider: green and white, bubbles
  cell(3, g => {
    const gr = g.createLinearGradient(0, 0, 0, CELL); gr.addColorStop(0, "#e9f7ee"); gr.addColorStop(1, "#1f9a4a"); g.fillStyle = gr; g.fillRect(0, 0, CELL, CELL);
    g.fillStyle = "rgba(255,255,255,0.7)"; for (let i = 0; i < 26; i++) { g.beginPath(); g.arc((i * 73) % 256, (i * 41) % 256, 3 + (i % 4) * 2, 0, 7); g.fill(); }
    text(g, "사이다", 128, 120, 62, "#0e6b2f");
  });
  // a bottle of beer: a cream label with a gold rule
  cell(4, g => {
    g.fillStyle = "#f2e6c9"; g.fillRect(0, 0, CELL, CELL);
    g.fillStyle = "#b8902f"; g.fillRect(0, 24, CELL, 8); g.fillRect(0, 224, CELL, 8);
    text(g, "LAGER", 128, 95, 50, "#7a1f12", 900); text(g, "맥주 500ml", 128, 170, 30, "#3c2a10", 700);
  });
  // ketchup: red bottle, a white oval with a tomato
  cell(5, g => {
    g.fillStyle = "#b3140f"; g.fillRect(0, 0, CELL, CELL);
    g.fillStyle = "#fff8ee"; g.beginPath(); g.ellipse(128, 128, 74, 100, 0, 0, 7); g.fill();
    g.fillStyle = "#d42a1c"; g.beginPath(); g.arc(128, 100, 30, 0, 7); g.fill();
    g.fillStyle = "#2f7a2a"; g.fillRect(122, 66, 12, 10);
    text(g, "케첩", 128, 172, 40, "#b3140f");
  });
  // the franks' paper band
  cell(6, g => {
    g.fillStyle = "#fff3d6"; g.fillRect(0, 0, CELL, CELL);
    g.fillStyle = "#c2391b"; g.fillRect(0, 0, CELL, 40); g.fillRect(0, 216, CELL, 40);
    text(g, "후랑크", 128, 110, 58, "#8a2410"); text(g, "소시지", 128, 170, 40, "#8a2410", 700);
  });
  // the eggs' sticker
  cell(7, g => {
    g.fillStyle = "#fff7e0"; g.fillRect(0, 0, CELL, CELL);
    g.fillStyle = "#e09a2c"; g.fillRect(0, 0, CELL, 60);
    text(g, "신선란", 128, 130, 58, "#7a4a10"); text(g, "6구 · 대란", 128, 200, 30, "#7a4a10", 700);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ the groceries' shapes
type Paint = THREE.ColorRepresentation | ((p: THREE.Vector3) => THREE.Color);
interface Piece { g: THREE.BufferGeometry; paint: Paint; label?: number }
const C = (c: THREE.ColorRepresentation) => new THREE.Color(c);
const lathe = (pts: [number, number][], seg = 28) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const band = (r: number, h: number, y: number, seg = 32) => new THREE.CylinderGeometry(r, r, h, seg, 1, true).translate(0, y + h / 2, 0);

/** pieces → one geometry: position, normal, the atlas uv (labels in their cell, the rest on white), colour */
function bake(pieces: Piece[]): THREE.BufferGeometry {
  const v = new THREE.Vector3(), parts: THREE.BufferGeometry[] = [];
  for (const p of pieces) {
    let g = p.g.index ? p.g.toNonIndexed() : p.g;
    if (g !== p.g) p.g.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") g.deleteAttribute(k);
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const pos = g.getAttribute("position"), uv = g.getAttribute("uv"), n = pos.count;
    const uvs = new Float32Array(n * 2), col = new Float32Array(n * 3);
    const cell = p.label ?? 0, cx = cell % CELLS, cy = Math.floor(cell / CELLS), pad = 0.02;
    for (let i = 0; i < n; i++) {
      if (p.label !== undefined && uv) {
        uvs[i * 2] = (cx + pad + uv.getX(i) * (1 - 2 * pad)) / CELLS;
        uvs[i * 2 + 1] = 1 - (cy + 1 - pad - uv.getY(i) * (1 - 2 * pad)) / CELLS;
      } else { uvs[i * 2] = 0.5 / CELLS; uvs[i * 2 + 1] = 1 - 0.5 / CELLS; }
      v.fromBufferAttribute(pos, i);
      const c = p.label !== undefined ? C("#ffffff") : typeof p.paint === "function" ? p.paint(v) : C(p.paint);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    parts.push(g);
  }
  const out = mergeGeometries(parts)!; parts.forEach(g => g.dispose());
  out.computeBoundingSphere();
  return out;
}

const noise = (p: THREE.Vector3, f: number) => Math.sin(p.x * f + 1.3) * Math.sin(p.y * f * 1.3 + 0.7) * Math.sin(p.z * f * 0.9 + 2.1);

function can(label: number): Piece[] {
  return [
    { g: lathe([[0, 0], [0.026, 0], [0.031, 0.005], [0.033, 0.013], [0.033, 0.106], [0.029, 0.117], [0.027, 0.122], [0.0255, 0.121], [0, 0.119]], 32), paint: "#cdd1d6" },
    { g: band(0.0333, 0.092, 0.0135), paint: "#fff", label },
  ];
}
const BUILD: Record<ItemKind, () => Piece[]> = {
  milk: () => {
    const roof = new THREE.Shape([new THREE.Vector2(-0.035, 0), new THREE.Vector2(0.035, 0), new THREE.Vector2(0, 0.028)]);
    return [
      { g: new THREE.BoxGeometry(0.07, 0.165, 0.07).translate(0, 0.0825, 0), paint: "#fff", label: LABEL.milk },
      { g: new THREE.ExtrudeGeometry(roof, { depth: 0.07, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-0.035, 0.165, 0), paint: "#f4f6fa" },
      { g: new THREE.BoxGeometry(0.004, 0.014, 0.072).translate(0, 0.198, 0), paint: "#eef1f6" },
      { g: new THREE.CylinderGeometry(0.0095, 0.0095, 0.012, 16).rotateX(-0.9).translate(0, 0.184, 0.016), paint: "#1d5fc4" },
    ];
  },
  cola: () => can(LABEL.cola!),
  cider: () => can(LABEL.cider!),
  beer: () => [
    { g: lathe([[0, 0], [0.03, 0], [0.034, 0.006], [0.034, 0.15], [0.03, 0.176], [0.017, 0.205], [0.0135, 0.236], [0.0148, 0.24], [0.0148, 0.246], [0, 0.246]], 32), paint: "#4a2810" },
    { g: band(0.0346, 0.07, 0.045), paint: "#fff", label: LABEL.beer },
    { g: new THREE.CylinderGeometry(0.0157, 0.0157, 0.009, 20).translate(0, 0.247, 0), paint: "#c9a23a" },
  ],
  ketchup: () => [
    { g: lathe([[0, 0], [0.022, 0], [0.03, 0.01], [0.031, 0.112], [0.026, 0.15], [0.019, 0.158], [0, 0.158]], 28), paint: "#b3140f" },
    { g: band(0.0315, 0.07, 0.03, 28), paint: "#fff", label: LABEL.ketchup },
    { g: lathe([[0, 0], [0.019, 0], [0.02, 0.022], [0.012, 0.034], [0.004, 0.04], [0, 0.04]], 20).translate(0, 0.157, 0), paint: "#f7f4ee" },
  ],
  apple: () => {
    const red = C("#a8101a"), blush = C("#d23a2a"), gold = C("#d8a640");
    return [
      { g: lathe([[0, 0.008], [0.012, 0.003], [0.028, 0.006], [0.038, 0.018], [0.042, 0.035], [0.04, 0.052], [0.032, 0.066], [0.018, 0.072], [0.008, 0.068], [0, 0.062]], 28),
        paint: p => red.clone().lerp(blush, 0.5 + 0.5 * noise(p, 90)).lerp(gold, Math.max(0, noise(p, 40)) * 0.35 + (p.y < 0.012 ? 0.3 : 0)) },
      { g: new THREE.CylinderGeometry(0.0018, 0.0025, 0.02, 6).rotateZ(0.25).translate(0.002, 0.072, 0), paint: "#5a3a1a" },
    ];
  },
  orange: () => {
    const g = new THREE.SphereGeometry(0.038, 28, 20); g.scale(1, 0.93, 1); g.translate(0, 0.035, 0);
    const a = C("#ef7b12"), b = C("#f6a02a");
    return [
      { g, paint: p => a.clone().lerp(b, 0.5 + 0.5 * noise(p, 160)) },
      { g: new THREE.SphereGeometry(0.004, 8, 6).scale(1, 0.4, 1).translate(0, 0.0705, 0), paint: "#6b6a2a" },
    ];
  },
  banana: () => {
    const out: Piece[] = [], yellow = C("#e9c838"), green = C("#9aa63a"), tip = C("#3e2f16");
    for (let i = 0; i < 3; i++) {
      const a = (i - 1) * 0.28;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const p0 = new THREE.Vector3(0, 0.03, 0), p2 = dir.clone().multiplyScalar(0.19).setY(0.03 + 0.03);
      const p1 = dir.clone().multiplyScalar(0.1).setY(0.004 + i * 0.004);
      const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
      const TS = 24, RS = 5, g = new THREE.TubeGeometry(curve, TS, 0.017, RS, false);
      const pos = g.getAttribute("position"), c = new THREE.Vector3();
      for (let k = 0; k < pos.count; k++) {
        const t = Math.floor(k / (RS + 1)) / TS; curve.getPointAt(t, c);
        const taper = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t * 0.92 + 0.04))), 0.45) * (t < 0.12 ? 0.55 + t * 3.7 : 1);
        pos.setXYZ(k, c.x + (pos.getX(k) - c.x) * taper, c.y + (pos.getY(k) - c.y) * taper, c.z + (pos.getZ(k) - c.z) * taper);
      }
      g.computeVertexNormals();
      out.push({ g, paint: q => { const t = Math.min(1, Math.hypot(q.x, q.z) / 0.19); return t > 0.95 ? tip : t < 0.12 ? green.clone().lerp(yellow, t / 0.12) : yellow; } });
    }
    out.push({ g: new THREE.CylinderGeometry(0.008, 0.011, 0.03, 8).rotateZ(Math.PI / 2).translate(-0.012, 0.03, 0), paint: "#6a6a2c" });
    return out;
  },
  sausage: () => {
    const out: Piece[] = [{ g: new THREE.BoxGeometry(0.16, 0.02, 0.11).translate(0, 0.01, 0), paint: "#f2f1ec" }];
    const skin = C("#9c3b1f"), dark = C("#6e2410");
    for (let i = 0; i < 4; i++) out.push({ g: new THREE.CapsuleGeometry(0.0115, 0.11, 6, 14).rotateZ(Math.PI / 2).translate(0, 0.0315, -0.039 + i * 0.026), paint: p => skin.clone().lerp(dark, Math.max(0, Math.sin(p.x * 160)) * 0.25 + (p.y > 0.04 ? 0.15 : 0)) });
    out.push({ g: new THREE.BoxGeometry(0.055, 0.003, 0.112).translate(0, 0.0445, 0), paint: "#fff", label: LABEL.sausage });
    return out;
  },
  cake: () => {
    const out: Piece[] = [
      { g: new THREE.CylinderGeometry(0.088, 0.088, 0.005, 40).translate(0, 0.0025, 0), paint: "#d4b062" },
      { g: new THREE.CylinderGeometry(0.078, 0.078, 0.065, 40).translate(0, 0.0375, 0), paint: p => C("#f7f0e4").lerp(C("#e9dcc6"), p.y < 0.02 ? 0.4 : 0) },
    ];
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; out.push({ g: new THREE.SphereGeometry(0.0085, 10, 8).scale(1, 0.8, 1).translate(Math.cos(a) * 0.068, 0.072, Math.sin(a) * 0.068), paint: "#fffaf2" }); }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.26;
      out.push({ g: lathe([[0, 0], [0.006, 0.002], [0.0105, 0.009], [0.011, 0.016], [0.007, 0.022], [0, 0.024]], 14).translate(Math.cos(a) * 0.042, 0.07, Math.sin(a) * 0.042), paint: "#c8102e" });
      out.push({ g: new THREE.ConeGeometry(0.008, 0.005, 6).translate(Math.cos(a) * 0.042, 0.096, Math.sin(a) * 0.042), paint: "#3f7a2a" });
    }
    out.push({ g: new THREE.CylinderGeometry(0.022, 0.022, 0.003, 24).translate(0, 0.0715, 0), paint: "#5a3220" });
    return out;
  },
  eggs: () => {
    const out: Piece[] = [{ g: new THREE.BoxGeometry(0.17, 0.03, 0.115).translate(0, 0.015, 0), paint: "#cdc3b2" }];
    const shell = C("#d9b08a"), spot = C("#c99a72");
    for (let i = 0; i < 3; i++) for (const z of [-0.027, 0.027]) out.push({ g: new THREE.SphereGeometry(0.021, 16, 12).scale(1, 1.28, 1).translate(-0.054 + i * 0.054, 0.042, z), paint: p => shell.clone().lerp(spot, Math.max(0, noise(p, 300)) * 0.5) });
    out.push({ g: new THREE.BoxGeometry(0.1, 0.022, 0.002).translate(0, 0.015, 0.0585), paint: "#fff", label: LABEL.eggs });
    return out;
  },
};
/** each item's height (for its slot's look box) */
const HEIGHT: Record<ItemKind, number> = { milk: 0.2, cola: 0.122, cider: 0.122, beer: 0.25, ketchup: 0.2, apple: 0.08, orange: 0.075, banana: 0.08, sausage: 0.05, cake: 0.1, eggs: 0.07 };

// ------------------------------------------------------------------ slots, the hand, the store
export interface Slot {
  id: string;
  /** what holds it (a shelf, a door, the basket): items are its children */
  anchor: THREE.Object3D;
  slim: boolean;
  where: "fridge" | "door" | "basket";
}

type Saved = { v: 1; at: Record<string, ItemKind>; hand?: ItemKind | null };
function load(): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? "null") as Saved | null;
    if (s && s.v === 1 && s.at && typeof s.at === "object") return s;
  } catch { /* none, or not readable */ }
  return null;
}

export class Pantry {
  readonly material: THREE.MeshPhysicalMaterial;
  private geo = new Map<ItemKind, THREE.BufferGeometry>();
  private tex: THREE.CanvasTexture;
  readonly slots = new Map<string, Slot>();
  /** what is where (slot id → item mesh), and in the hand */
  private at = new Map<string, THREE.Mesh>();
  hand: THREE.Mesh | null = null;
  /** items whose slot is in no room of this flat (no dining table: no basket) are kept, unseen */
  private unplaced: Record<string, ItemKind> = {};

  constructor(private root: THREE.Object3D) {
    this.tex = atlas();
    this.material = new THREE.MeshPhysicalMaterial({ map: this.tex, vertexColors: true, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.25 });
  }
  private mesh(kind: ItemKind): THREE.Mesh {
    let g = this.geo.get(kind);
    if (!g) { g = bake(BUILD[kind]()); this.geo.set(kind, g); }
    const m = new THREE.Mesh(g, this.material);
    m.receiveShadow = true; m.userData.kind = kind;
    return m;
  }
  addSlot(s: Slot) { this.slots.set(s.id, s); }
  /** put the saved (or the starting) groceries in their slots; call once every slot is added */
  stock() {
    const saved = load();
    const where: Record<string, ItemKind> = saved ? { ...saved.at } : Object.fromEntries(START);
    if (saved?.hand) {
      // (left in the hand last time: back to the first free place it fits)
      const free = [...this.slots.values()].find(s => !where[s.id] && (!s.slim || SLIM.has(saved.hand!)));
      if (free) where[free.id] = saved.hand;
    }
    for (const [id, kind] of Object.entries(where)) {
      if (!(kind in BUILD)) continue;
      const s = this.slots.get(id);
      if (!s) { this.unplaced[id] = kind; continue; }
      const m = this.mesh(kind); s.anchor.add(m); this.at.set(id, m);
    }
  }
  private save() {
    const at: Record<string, ItemKind> = { ...this.unplaced };
    for (const [id, m] of this.at) at[id] = m.userData.kind;
    try { localStorage.setItem(STORE, JSON.stringify({ v: 1, at, hand: this.hand?.userData.kind ?? null } satisfies Saved)); } catch { /* private mode: this visit only */ }
  }
  kindAt(id: string): ItemKind | null { return (this.at.get(id)?.userData.kind as ItemKind) ?? null; }
  handKind(): ItemKind | null { return (this.hand?.userData.kind as ItemKind) ?? null; }
  /** can the hand's item go in this slot */
  fits(id: string): boolean { const s = this.slots.get(id), k = this.handKind(); return !!s && !!k && !this.at.has(id) && (!s.slim || SLIM.has(k)); }
  take(id: string): boolean {
    const m = this.at.get(id); if (!m || this.hand) return false;
    this.at.delete(id); m.removeFromParent(); this.root.add(m); m.matrixAutoUpdate = false; this.hand = m;
    this.save(); return true;
  }
  put(id: string): boolean {
    if (!this.fits(id)) return false;
    const m = this.hand!, s = this.slots.get(id)!;
    m.removeFromParent(); m.matrixAutoUpdate = true; m.position.set(0, 0, 0); m.rotation.set(0, (Math.random() - 0.5) * 0.4, 0); m.updateMatrix();
    s.anchor.add(m); this.at.set(id, m); this.hand = null;
    this.save(); return true;
  }
  /** the hand's item, held in front of the eye (first person) or of the body */
  holdAt(world: THREE.Matrix4) { if (this.hand) { this.hand.matrix.copy(world); this.hand.matrixWorldNeedsUpdate = true; } }
  static height(k: ItemKind) { return HEIGHT[k]; }
  dispose() {
    this.geo.forEach(g => g.dispose()); this.tex.dispose(); this.material.dispose();
  }
}
