import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Avatar } from "../player/avatar";
import { Crowd } from "./crowd";
import { planFloor, type BuildingPlan, type FloorPlan, type Mat } from "./plan";

/* Inside a building that is not a block of flats (an office, a hospital, a store…): its floors from
 * the register (plan.ts), one built and drawn at a time, rendered live — floors in their finish by
 * use (stone in a lobby, carpet in offices, vinyl in a hospital, epoxy in a car park), a ceiling of
 * LED panels, the glazed outer wall with the city outside seen from the floor's own height; the
 * lift bank (the register's lifts) whose doors open and take you to the floor you choose, stairs
 * up and down, escalators between a store's floors that carry you; and the floor's people (crowd.ts).
 * Walk with WASD, look with the mouse, E for the lifts, the stairs and the door out. */

export interface BuildingHud {
  building: string; floor: string; uses: string; people: number; prompt: string | null; riding: boolean; view: "first" | "third";
}
export interface BuildingOptions {
  plan: BuildingPlan; seed: number; hour: number;
  onHud?(h: BuildingHud): void;
  /** the lift's panel: open with the floors to choose from (null closes it) */
  onLiftPanel?(p: { levels: { level: number; label: string; uses: string }[]; current: number } | null): void;
  onProgress?(k: number, text: string): void;
  onExit?(): void;
}

const EYE = 1.6, RADIUS = 0.28;
const TEX = "/3d/walk/tex/";

export class BuildingInterior {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(68, 1, 0.05, 900);
  private avatar = new Avatar(7);
  private floorGroup = new THREE.Group();
  private crowd: Crowd | null = null;
  private plan!: FloorPlan;
  level = 1;
  private pos = new THREE.Vector2(); private vel = new THREE.Vector2(); yaw = Math.PI; pitch = -0.05;
  private keys = new Set<string>(); private stick = new THREE.Vector2(); private runStick = false;
  view: "first" | "third" = "third";
  private running = false; private disposed = false; private raf = 0; private last = 0;
  private solids: { x0: number; z0: number; x1: number; z1: number }[] = [];
  private mats = new Map<Mat, THREE.Material>();
  private textures: THREE.Texture[] = [];
  private owned: { dispose(): void }[] = [];
  private liftDoors: { leaves: THREE.Mesh[]; x: number; z: number; open: number; want: number }[] = [];
  private escal: { mesh: THREE.Mesh; steps: THREE.InstancedMesh; x: number; z0: number; z1: number; up: boolean; w: number; offset: number; H: number }[] = [];
  private riding: { esc: BuildingInterior["escal"][number]; t: number } | null = null;
  private fade = 0; private pending: (() => void) | null = null;
  private hud: BuildingHud | null = null;
  private skyline: THREE.Mesh | null = null; private ground: THREE.Mesh | null = null;
  private hemi = new THREE.HemisphereLight("#f4f6ff", "#8a8578", 0.7);
  private sun = new THREE.DirectionalLight("#fff2dc", 1.4);
  private bob = 0; private shownPos = new THREE.Vector3(); private shownInit = false;

  constructor(readonly renderer: THREE.WebGLRenderer, private o: BuildingOptions) {
    this.scene.add(this.floorGroup, this.avatar.root, this.hemi, this.sun);
    this.avatar.shoes(true);
  }

  // ------------------------------------------------------------------ materials
  private tex(name: string, rep: number, srgb = true) {
    const t = new THREE.TextureLoader().load(`${TEX}${name}.webp`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(t); return t;
  }
  private makeMaterials() {
    const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
    const tiled = (set: string, color: string, rough: number) => std({ map: this.tex(`${set}_diff`, 1), normalMap: this.tex(`${set}_nor`, 1, false), color, roughness: rough });
    const M: [Mat, THREE.Material][] = [
      ["floor", tiled("large_floor_tiles_02", "#ffffff", 0.35)],
      ["tile", tiled("square_tiles_02", "#f2f2f0", 0.4)],
      ["carpet", tiled("poly_wool_herringbone", "#8a8f97", 0.95)],
      ["concrete", tiled("plastered_wall_02", "#9a9a98", 0.9)],
      ["wall", tiled("plastered_wall_02", "#ecebe7", 0.85)],
      ["glass", new THREE.MeshPhysicalMaterial({ color: "#cfe1e8", transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide })],
      ["desk", tiled("white_oak_veneer", "#f4efe6", 0.55)],
      ["wood", tiled("walnut_veneer", "#c9a27c", 0.5)],
      ["chair", std({ color: "#2b2e33", roughness: 0.6 })],
      ["fabric", tiled("rough_linen", "#5c6f86", 0.9)],
      ["metal", std({ color: "#b8bcc0", roughness: 0.3, metalness: 0.85 })],
      ["shelf", std({ color: "#e9e9e6", roughness: 0.5, metalness: 0.2 })],
      ["bed", std({ color: "#dfe7ee", roughness: 0.7 })],
      ["sheet", tiled("rough_linen", "#eef2f4", 0.85)],
      // (a counter's solid surface: off-white, satin — the marble tile texture read as gravel)
      ["counter", std({ color: "#eeece6", roughness: 0.32, metalness: 0.02 })],
      ["car", std({ color: "#5d6670", roughness: 0.35, metalness: 0.6 })],
      ["line", std({ color: "#f2d24a", roughness: 0.6 })],
      ["plant", std({ color: "#3f6b3a", roughness: 0.8 })],
      ["lift", std({ color: "#c9ced2", roughness: 0.22, metalness: 0.9 })],
      ["dark", std({ color: "#25282c", roughness: 0.5 })],
      ["screen", std({ color: "#101418", roughness: 0.2, emissive: new THREE.Color("#3a5a7a"), emissiveIntensity: 0.35 })],
      ["white", std({ color: "#f3f3f1", roughness: 0.5 })],
    ];
    for (const [k, m] of M) { this.mats.set(k, m); this.owned.push(m); }
  }

  async load() {
    this.o.onProgress?.(0.1, "건물 정보를 읽는 중");
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.shadowMap.enabled = false;
    const pm = new THREE.PMREMGenerator(this.renderer), env = pm.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = env.texture; this.scene.environmentIntensity = 0.55; this.owned.push(env, pm);
    this.makeMaterials();
    this.sky();
    this.o.onProgress?.(0.5, "층을 짓는 중");
    this.goTo(1, null);
    // the street door: start just inside it, facing in
    const door = this.plan.door;
    this.pos.set(door ? door.x : this.o.plan.W / 2, 1.6); this.yaw = Math.PI;
    this.o.onProgress?.(0.85, "셰이더를 준비하는 중");
    await this.renderer.compileAsync(this.scene, this.camera);
    this.o.onProgress?.(1, "입장합니다");
  }

  // the city outside: a far ring painted with a skyline and a ground plane, at the floor's height below
  private sky() {
    const night = this.o.hour < 6 || this.o.hour >= 19;
    this.scene.background = new THREE.Color(night ? "#0d1420" : "#a9c6de");
    const c = document.createElement("canvas"); c.width = 2048; c.height = 512; const g = c.getContext("2d")!;
    const sky = g.createLinearGradient(0, 0, 0, 512); sky.addColorStop(0, night ? "#0d1420" : "#9cc0dc"); sky.addColorStop(1, night ? "#1c2533" : "#dfe9ef");
    g.fillStyle = sky; g.fillRect(0, 0, 2048, 512);
    let s = 7; const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let layer = 0; layer < 3; layer++) {
      let x = 0;
      while (x < 2048) {
        const w = 20 + R() * 60, h = 60 + R() * (220 - layer * 40), y = 512 - 40 - h + layer * 25;
        const v = night ? 18 + layer * 6 : 150 - layer * 25 + R() * 20;
        g.fillStyle = `rgb(${v * 0.9},${v * 0.95},${v})`; g.fillRect(x, y, w, 512 - y);
        for (let wy = y + 6; wy < 500; wy += 9) for (let wx = x + 4; wx < x + w - 4; wx += 7) if (R() < (night ? 0.35 : 0.5)) { g.fillStyle = night ? "rgba(255,214,140,0.85)" : "rgba(80,95,110,0.55)"; g.fillRect(wx, wy, 3, 4); }
        x += w + 2;
      }
    }
    g.fillStyle = night ? "#10151c" : "#5d6a63"; g.fillRect(0, 472, 2048, 40);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.x = 2; this.textures.push(t);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(420, 420, 260, 64, 1, true), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false }));
    this.skyline = cyl; this.scene.add(cyl); this.owned.push(cyl.geometry, cyl.material as THREE.Material);
    const gr = new THREE.Mesh(new THREE.CircleGeometry(430, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: night ? "#151a20" : "#6f7a72" }));
    this.ground = gr; this.scene.add(gr); this.owned.push(gr.geometry, gr.material as THREE.Material);
    this.sun.position.set(-30, 60, -20); this.sun.intensity = night ? 0.15 : 1.4; this.hemi.intensity = night ? 0.45 : 0.75;
  }

  // ------------------------------------------------------------------ a floor
  private goTo(level: number, place: { x: number; z: number; yaw: number } | null) {
    // (the floor laid out the first time it is visited)
    const b = this.o.plan;
    let fp = b.floors.get(level);
    if (!fp) { fp = planFloor(b, level, this.o.seed); b.floors.set(level, fp); }
    this.plan = fp; this.level = level;
    this.clearFloor();
    this.buildFloor(fp);
    this.crowd = new Crowd(fp, this.o.seed * 31 + level);
    this.floorGroup.add(this.crowd.group);
    // the city at this height: the floor ~ (level − 1) × 3.8 m above the street
    const above = Math.max(-4, (level - 1) * 3.8 + (level < 0 ? -3 : 0));
    this.skyline!.position.set(b.W / 2, 130 - above - 38, b.D / 2); this.ground!.position.set(b.W / 2, -above - 0.3, b.D / 2);
    const under = level < 0;
    this.skyline!.visible = this.ground!.visible = !under;
    this.scene.background = new THREE.Color(under ? "#202326" : this.o.hour < 6 || this.o.hour >= 19 ? "#0d1420" : "#a9c6de");
    if (place) { this.pos.set(place.x, place.z); this.yaw = place.yaw; }
    this.shownInit = false;
    this.emitHud(true);
  }
  private clearFloor() {
    this.crowd?.dispose(); this.crowd = null;
    for (const c of [...this.floorGroup.children]) { this.floorGroup.remove(c); const m = c as THREE.Mesh; if (m.geometry) m.geometry.dispose(); }
    this.liftDoors = []; this.escal = []; this.solids = [];
    this.floorTex.forEach(t => t.dispose()); this.floorMats.forEach(m => m.dispose()); this.floorTex = []; this.floorMats = [];
  }
  private buildFloor(fp: FloorPlan) {
    const { W, D } = this.o.plan, H = fp.height;
    // boxes merged by material (uv in metres)
    const byMat = new Map<Mat, THREE.BufferGeometry[]>();
    const push = (m: Mat, g: THREE.BufferGeometry) => { const l = byMat.get(m); if (l) l.push(g); else byMat.set(m, [g]); };
    for (const q of fp.boxes) {
      const w = Math.max(0.01, q.x1 - q.x0), h = Math.max(0.005, q.y1 - q.y0), d = Math.max(0.01, q.z1 - q.z0);
      const g = new THREE.BoxGeometry(w, h, d);
      // (uv in metres: the box's faces scaled to their own size)
      const uv = g.getAttribute("uv") as THREE.BufferAttribute, nrm = g.getAttribute("normal") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) { const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)); const su = ax > 0.5 ? d : w, sv = ay > 0.5 ? d : h; uv.setXY(i, uv.getX(i) * su / 1.6, uv.getY(i) * sv / 1.6); }
      g.translate((q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2, (q.z0 + q.z1) / 2);
      push(q.m, g);
      if (q.solid && q.y0 < 1.5 && q.y1 > 0.3) this.solids.push({ x0: q.x0, z0: q.z0, x1: q.x1, z1: q.z1 });
    }
    // the floor: each zone in its finish; the lift lobby and corridors in stone
    const floorOf: Record<string, Mat> = { office: "carpet", lobby: "floor", clinic: "floor", ward: "floor", retail: "floor", food: "wood", class: "tile", gym: "dark", hotel: "carpet", parking: "concrete", rooms: "wood", plant: "concrete" };
    const base = new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2).translate(W / 2, 0, D / 2);
    scaleUv(base, W / 2, D / 2); push(fp.kinds[0] === "parking" ? "concrete" : "floor", base);
    for (const z of fp.zones) {
      const [x0, z0, x1, z1] = z.rect, g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0.004, (z0 + z1) / 2);
      scaleUv(g, (x1 - x0) / 2, (z1 - z0) / 2); push(floorOf[z.kind] ?? "floor", g);
    }
    // the ceiling: a plane, its LED panels on a 2.4 m grid (one emissive material)
    const ceil = new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2).translate(W / 2, H, D / 2); scaleUv(ceil, W / 3, D / 3);
    push(fp.kinds[0] === "parking" ? "concrete" : "white", ceil);
    const panels: THREE.BufferGeometry[] = [];
    for (let x = 1.2; x < W - 1; x += 2.4) for (let z = 1.2; z < D - 1; z += 2.4) panels.push(new THREE.PlaneGeometry(fp.kinds[0] === "parking" ? 1.2 : 0.6, fp.kinds[0] === "parking" ? 0.15 : 0.6).rotateX(Math.PI / 2).translate(x, H - 0.01, z));
    for (const [m, list] of byMat) {
      const g = mergeGeometries(list, false); list.forEach(x => x.dispose());
      if (!g) continue;
      const mesh = new THREE.Mesh(g, this.mats.get(m)!); mesh.matrixAutoUpdate = false;
      if (m === "glass") mesh.renderOrder = 2;
      this.floorGroup.add(mesh);
    }
    if (panels.length) {
      const pg = mergeGeometries(panels, false); panels.forEach(x => x.dispose());
      const pm = new THREE.MeshBasicMaterial({ color: fp.kinds[0] === "parking" ? "#e6f0ff" : "#fffdf6" }); this.owned.push(pm);
      this.floorGroup.add(new THREE.Mesh(pg!, pm));
    }
    // the floor's light: a few broad lights under the ceiling (no shadows: the panels light it evenly)
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight("#fff6ea", fp.kinds[0] === "parking" ? 18 : 26, 30, 1.6); l.position.set(W * (0.2 + 0.2 * i), H - 0.4, D / 2); this.floorGroup.add(l); }
    // the lift doors: two leaves each, sliding apart
    const doorM = this.mats.get("lift")!;
    for (const l of fp.lifts) {
      const leaves: THREE.Mesh[] = [];
      for (const side of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(l.w / 2, 2.25, 0.05), doorM); m.position.set(l.x + side * l.w / 4, 1.125, l.z - 0.05); this.floorGroup.add(m); leaves.push(m); }
      // (the car beyond: a lit box)
      const car = new THREE.Mesh(new THREE.BoxGeometry(l.w, 2.4, 1.8), new THREE.MeshStandardMaterial({ color: "#d9dcdd", roughness: 0.3, metalness: 0.6, side: THREE.BackSide }));
      car.position.set(l.x, 1.2, l.z + 1.0); this.floorGroup.add(car); this.owned.push(car.material as THREE.Material);
      this.liftDoors.push({ leaves, x: l.x, z: l.z, open: 0, want: 0 });
      this.solids.push({ x0: l.x - l.w / 2, z0: l.z - 0.06, x1: l.x + l.w / 2, z1: l.z + 0.1 });
    }
    // escalators: a sloped body, moving steps, glass balustrades
    for (const e of fp.escalators) {
      const len = Math.abs(e.z1 - e.z0), dir = Math.sign(e.z1 - e.z0), rise = H;
      const body = new THREE.Mesh(new THREE.BoxGeometry(e.w + 0.3, 0.6, Math.hypot(len, rise)), this.mats.get("metal")!);
      const ang = Math.atan2(rise, len) * (e.up ? 1 : -1) * dir;
      body.position.set(e.x + e.w / 2, (e.up ? rise / 2 : rise / 2) - 0.35, (e.z0 + e.z1) / 2); body.rotation.x = -Math.atan2(rise, len) * dir * (e.up ? 1 : -1);
      void ang; this.floorGroup.add(body);
      const n = Math.ceil(Math.hypot(len, rise) / 0.4);
      const steps = new THREE.InstancedMesh(new THREE.BoxGeometry(e.w, 0.04, 0.38), this.mats.get("dark")!, n + 2); steps.frustumCulled = false;
      this.floorGroup.add(steps);
      for (const sx of [e.x - 0.05, e.x + e.w + 0.05]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, Math.hypot(len, rise)), this.mats.get("glass")!); rail.position.copy(body.position).setX(sx); rail.position.y += 0.75; rail.rotation.x = body.rotation.x; this.floorGroup.add(rail); }
      this.escal.push({ mesh: body, steps, x: e.x, z0: e.z0, z1: e.z1, up: e.up, w: e.w, offset: 0, H: rise });
    }
    // what the floor shows: painted on canvases (the directory from the register's floors)
    for (const d of fp.decor) this.decorate(d);
    this.renderer.setClearColor(this.scene.background as THREE.Color);
  }

  private decorate(d: FloorPlan["decor"][number]) {
    const px = 512, c = document.createElement("canvas"); c.width = Math.round(px * Math.max(1, d.w / d.h)); c.height = Math.round(px * Math.max(1, d.h / d.w));
    const g = c.getContext("2d")!, W = c.width, H = c.height, font = (wt: number, sz: number) => `${wt} ${sz}px Pretendard, 'Noto Sans KR', 'Malgun Gothic', sans-serif`;
    let emissive = 0.25;
    if (d.kind === "directory") {
      // the floors, top down: each its label and its uses (the register's)
      g.fillStyle = "#1d2733"; g.fillRect(0, 0, W, H); g.fillStyle = "#e9f1f8"; g.font = font(800, W * 0.09); g.fillText("층별 안내", W * 0.07, H * 0.07);
      const levels = [...this.o.plan.levels].reverse(), row = Math.min(H * 0.06, (H * 0.86) / levels.length);
      levels.forEach((l, i) => {
        const y = H * 0.12 + i * row; if (l === this.level) { g.fillStyle = "rgba(94,180,255,0.35)"; g.fillRect(0, y - row * 0.1, W, row); }
        g.fillStyle = "#ffd36b"; g.font = font(800, row * 0.62); g.fillText(this.labelOf(l), W * 0.05, y + row * 0.62);
        g.fillStyle = "#dfe7ee"; g.font = font(500, row * 0.5); g.fillText((this.usesOf(l) || "-").slice(0, 22), W * 0.32, y + row * 0.6);
      });
      emissive = 0.5;
    } else if (d.kind === "floor") {
      g.fillStyle = "#f4f4f2"; g.fillRect(0, 0, W, H); g.fillStyle = "#1d2733"; g.font = font(900, H * 0.5); g.textAlign = "center"; g.fillText(d.text ?? "", W / 2, H * 0.58);
      g.font = font(600, H * 0.15); g.fillText(this.usesOf(this.level).slice(0, 18), W / 2, H * 0.86);
    } else if (d.kind === "sign") {
      g.fillStyle = "#24476b"; g.fillRect(0, 0, W, H); g.fillStyle = "#ffffff"; g.font = font(800, H * 0.6); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(d.text ?? "", W / 2, H * 0.54);
      emissive = 0.6;
    } else if (d.kind === "tv") {
      const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, "#0e5a8a"); grd.addColorStop(1, "#0b2236"); g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.fillStyle = "#ffffff"; g.font = font(800, H * 0.13); g.fillText("진료 대기 현황", W * 0.06, H * 0.2);
      g.font = font(600, H * 0.1); for (let i = 0; i < 4; i++) g.fillText(`${["내과", "정형외과", "소아청소년과", "영상의학과"][i]}  대기 ${3 + ((i * 7 + this.level) % 9)}명`, W * 0.08, H * (0.42 + i * 0.15));
      emissive = 1.0;
    } else {
      g.fillStyle = "#ffffff"; g.beginPath(); g.arc(W / 2, H / 2, W * 0.46, 0, Math.PI * 2); g.fill(); g.strokeStyle = "#222"; g.lineWidth = W * 0.04; g.stroke();
      const t = new Date(), hr = (this.o.hour % 12) + t.getMinutes() / 60, mn = t.getMinutes();
      for (const [a, l] of [[hr / 12, 0.25], [mn / 60, 0.36]] as [number, number][]) { g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 + Math.sin(a * Math.PI * 2) * W * l, H / 2 - Math.cos(a * Math.PI * 2) * H * l); g.stroke(); }
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; this.floorTex.push(tex);
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color("#ffffff"), emissiveIntensity: emissive, roughness: 0.5 }); this.floorMats.push(m);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), m);
    mesh.position.set(d.x, d.y, d.z); mesh.rotation.y = d.yaw; this.floorGroup.add(mesh);
  }
  private floorTex: THREE.Texture[] = []; private floorMats: THREE.Material[] = [];

  // ------------------------------------------------------------------ moving about
  keyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.matches?.("input, textarea")) return;
    if (e.code === "KeyE" && !e.repeat) { this.interact(); return; }
    if (e.code === "KeyV" && !e.repeat) { this.toggleView(); return; }
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right))$/.test(e.code)) { e.preventDefault(); this.keys.add(e.code); }
  };
  keyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private blur = () => this.keys.clear();
  setStick(x: number, y: number, run: boolean) { this.stick.set(x, y); this.runStick = run; }
  look(dx: number, dy: number) { this.yaw -= dx; this.pitch = Math.max(-1.3, Math.min(1.2, this.pitch - dy)); }
  toggleView() { this.view = this.view === "first" ? "third" : "first"; if (this.view === "first") this.pitch = -0.04; this.emitHud(true); }

  private collide(x: number, z: number): THREE.Vector2 {
    const p = new THREE.Vector2(x, z), r = RADIUS;
    for (let it = 0; it < 3; it++) {
      let pushed = false;
      for (const b of this.solids) {
        if (p.x < b.x0 - r || p.x > b.x1 + r || p.y < b.z0 - r || p.y > b.z1 + r) continue;
        const cx = Math.max(b.x0, Math.min(b.x1, p.x)), cz = Math.max(b.z0, Math.min(b.z1, p.y)), dx = p.x - cx, dz = p.y - cz, d = Math.hypot(dx, dz);
        if (d < r) {
          if (d > 1e-5) { p.x = cx + dx / d * r; p.y = cz + dz / d * r; }
          else { const l = p.x - b.x0, rr = b.x1 - p.x, t = p.y - b.z0, bb = b.z1 - p.y, m = Math.min(l, rr, t, bb); if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r; else if (m === t) p.y = b.z0 - r; else p.y = b.z1 + r; }
          pushed = true;
        }
      }
      if (!pushed) break;
    }
    const { W, D } = this.o.plan; p.x = Math.max(0.3, Math.min(W - 0.3, p.x)); p.y = Math.max(0.3, Math.min(D - 0.3, p.y));
    return p;
  }
  private move(dt: number) {
    if (this.riding) { this.ride(dt); return; }
    const k = this.keys;
    let fx = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) + this.stick.x;
    let fz = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) + this.stick.y;
    const l = Math.hypot(fx, fz); if (l > 1) { fx /= l; fz /= l; }
    const run = k.has("ShiftLeft") || k.has("ShiftRight") || this.runStick, speed = run ? 3.4 : 1.45;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = (fx * cy - fz * sy) * speed, wz = (-fx * sy - fz * cy) * speed, a = 1 - Math.exp(-dt * 9);
    this.vel.x += (wx - this.vel.x) * a; this.vel.y += (wz - this.vel.y) * a;
    const p = this.collide(this.pos.x + this.vel.x * dt, this.pos.y + this.vel.y * dt);
    const moved = p.distanceTo(this.pos); this.pos.copy(p); this.bob += moved * 4.4;
    this.avatar.update(dt, moved / Math.max(1e-4, dt));
    // stepping onto an escalator's foot: carried
    for (const e of this.escal) {
      const foot = e.z0, inX = this.pos.x > e.x && this.pos.x < e.x + e.w, dir = Math.sign(e.z1 - e.z0);
      if (inX && Math.abs(this.pos.y - (foot - dir * 0.4)) < 0.45 && (this.vel.x * 0 + this.vel.y * dir) > 0.2) { this.riding = { esc: e, t: 0 }; this.emitHud(true); break; }
    }
  }
  private ride(dt: number) {
    const r = this.riding!, e = r.esc, len = Math.abs(e.z1 - e.z0), dir = Math.sign(e.z1 - e.z0);
    r.t = Math.min(1, r.t + dt * 0.55 / Math.hypot(len, e.H) * 1.8);
    this.pos.set(e.x + e.w / 2, e.z0 + dir * len * r.t);
    this.avatar.update(dt, 0);
    if (r.t >= 1) {
      const to = this.level + (e.up ? 1 : -1) === 0 ? (e.up ? 1 : -1) : this.level + (e.up ? 1 : -1);
      this.riding = null;
      // off at the top (or the bottom) of the floor reached: by the matching escalator's other end
      this.fadeTo(() => { const x = this.pos.x, z = e.z1 + dir * 1.2; this.goTo(to, { x, z, yaw: dir > 0 ? Math.PI : 0 }); });
    }
  }
  private fadeTo(fn: () => void) { this.pending = fn; this.fade = 0.0001; }

  /** E: the lift (its panel), the stairs (up a floor, or down when there is none above), the street door */
  interact() {
    const p = this.pos;
    const lift = this.plan.lifts.find(l => Math.abs(p.x - l.x) < l.w * 0.8 && p.y < l.z && l.z - p.y < 2.0);
    if (lift) {
      const d = this.liftDoors.find(d => d.x === lift.x); if (d) d.want = 1;
      this.o.onLiftPanel?.({ levels: this.o.plan.levels.map(l => ({ level: l, label: this.labelOf(l), uses: this.usesOf(l) })), current: this.level });
      return;
    }
    const st = this.stairAt();
    if (st) {
      const lv = this.o.plan.levels, i = lv.indexOf(this.level);
      const to = this.keys.has("ShiftLeft") || i === lv.length - 1 ? lv[i - 1] : lv[i + 1];
      if (to === undefined) return;
      this.fadeTo(() => this.goTo(to, { x: this.pos.x, z: this.pos.y, yaw: this.yaw }));
      return;
    }
    if (this.atDoor()) this.o.onExit?.();
  }
  /** the panel's choice: the doors close, the car goes, they open on the floor chosen */
  ride_to(level: number) {
    this.o.onLiftPanel?.(null);
    for (const d of this.liftDoors) d.want = 0;
    const near = this.plan.lifts.reduce((a, l) => (Math.abs(l.x - this.pos.x) < Math.abs(a.x - this.pos.x) ? l : a), this.plan.lifts[0]);
    setTimeout(() => this.fadeTo(() => {
      this.goTo(level, null);
      const l = this.plan.lifts.find(x => x.index === near?.index) ?? this.plan.lifts[0];
      // (out of the car, its back to the lifts, facing the floor)
      if (l) { this.pos.set(l.x, l.z - 1.3); this.yaw = 0; const d = this.liftDoors.find(d => d.x === l.x); if (d) { d.open = 1; d.want = 1; setTimeout(() => (d.want = 0), 3500); } }
    }), 700);
  }
  closeLiftPanel() { this.o.onLiftPanel?.(null); for (const d of this.liftDoors) d.want = 0; }
  private stairAt() { return this.plan.stairs.find(s => { const doorX = s.x < this.o.plan.W / 2 ? s.x + s.w : s.x; return Math.abs(this.pos.x - doorX) < 1.6 && this.pos.y > s.z + 1.0 && this.pos.y < s.z + 3.2; }); }
  private atDoor() { const d = this.plan.door; return !!d && Math.abs(this.pos.x - d.x) < d.w && this.pos.y < 2.2; }
  private labelOf(l: number) { return this.o.plan.regFloors.find(f => f.level === l)?.label ?? (l < 0 ? `B${-l}` : `${l}F`); }
  private usesOf(l: number) { const r = this.o.plan.regFloors.find(f => f.level === l); return r ? [...new Set(r.uses.map(u => u.detail || u.use))].slice(0, 3).join(" · ") : l < 0 ? "주차장" : ""; }

  private emitHud(force = false) {
    const prompt = this.riding ? null : this.plan.lifts.some(l => Math.abs(this.pos.x - l.x) < l.w * 0.8 && this.pos.y < l.z && l.z - this.pos.y < 2.0) ? "엘리베이터 타기"
      : this.stairAt() ? "계단으로 이동 (Shift+E 아래층)" : this.atDoor() ? "건물 밖으로 나가기" : null;
    const h: BuildingHud = { building: this.o.plan.info.name ?? "건물", floor: this.labelOf(this.level), uses: this.usesOf(this.level), people: this.crowd?.count ?? 0, prompt, riding: !!this.riding, view: this.view };
    if (force || !this.hud || h.prompt !== this.hud.prompt || h.floor !== this.hud.floor || h.people !== this.hud.people || h.riding !== this.hud.riding || h.view !== this.hud.view) { this.hud = h; this.o.onHud?.(h); }
  }

  // ------------------------------------------------------------------ the frame
  start() {
    if (this.running) return;
    this.running = true;
    window.addEventListener("keydown", this.keyDown, true); window.addEventListener("keyup", this.keyUp, true); window.addEventListener("blur", this.blur);
    this.last = performance.now(); this.raf = requestAnimationFrame(this.loop);
  }
  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    this.move(dt);
    // lift doors
    for (const d of this.liftDoors) { d.open += Math.sign(d.want - d.open) * Math.min(Math.abs(d.want - d.open), dt * 1.4); const k = d.open * d.open * (3 - 2 * d.open); d.leaves.forEach((m, i) => (m.position.x = d.x + (i ? 1 : -1) * (0.52 + k * 0.98))); }
    // escalator steps flow
    for (const e of this.escal) {
      e.offset = (e.offset + dt * 0.5) % 0.4;
      const len = Math.abs(e.z1 - e.z0), dir = Math.sign(e.z1 - e.z0), L = Math.hypot(len, e.H), n = e.steps.count, m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const t = ((i * 0.4 + e.offset) % (L + 0.8)) / L, tt = Math.min(1, Math.max(0, t));
        const y = (e.up ? tt : 1 - tt) * e.H, z = e.z0 + dir * len * tt;
        m.makeTranslation(e.x + e.w / 2, y + 0.02, z); e.steps.setMatrixAt(i, m);
      }
      e.steps.instanceMatrix.needsUpdate = true;
    }
    this.crowd?.update(dt, this.camera.position);
    // the fade between floors (the lift's ride, the stairs)
    if (this.fade > 0) {
      this.fade += dt * 2.2;
      if (this.fade >= 1 && this.pending) { const f = this.pending; this.pending = null; f(); }
      if (this.fade >= 2) this.fade = 0;
    }
    this.placeCamera(dt);
    this.emitHud();
    this.renderer.toneMappingExposure = this.fade > 0 ? Math.max(0.02, Math.abs(1 - this.fade)) : 1.0;
    this.renderer.render(this.scene, this.camera);
  };
  private placeCamera(dt: number) {
    const y = this.riding ? (this.riding.esc.up ? this.riding.t : 1 - this.riding.t) * this.riding.esc.H : 0;
    const ar = this.avatar.root;
    ar.position.set(this.pos.x, y, this.pos.y); ar.rotation.set(0, this.yaw + Math.PI, 0);
    ar.visible = this.view === "third";
    const look = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const head = new THREE.Vector3(this.pos.x, y + EYE + (this.view === "first" ? Math.sin(this.bob) * 0.012 : 0), this.pos.y);
    let want = head.clone();
    if (this.view === "third") {
      // behind the shoulder, pulled in before a wall
      let d = 2.6;
      for (let t = 0.3; t <= 2.6; t += 0.15) { const px = head.x - look.x * t, pz = head.z - look.z * t; if (this.solids.some(b => px > b.x0 - 0.15 && px < b.x1 + 0.15 && pz > b.z0 - 0.15 && pz < b.z1 + 0.15)) { d = Math.max(0.35, t - 0.2); break; } }
      want = head.clone().addScaledVector(look, -d).add(new THREE.Vector3(0, 0.35, 0));
    }
    if (!this.shownInit) { this.shownPos.copy(want); this.shownInit = true; } else this.shownPos.lerp(want, 1 - Math.exp(-dt * 14));
    this.camera.position.copy(this.shownPos);
    this.camera.lookAt(head.clone().add(look.multiplyScalar(3)));
  }

  resize(w: number, h: number) { this.renderer.setSize(w, h, false); this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix(); }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.keyDown, true); window.removeEventListener("keyup", this.keyUp, true); window.removeEventListener("blur", this.blur);
    this.clearFloor(); this.avatar.dispose(); this.owned.forEach(o => o.dispose()); this.textures.forEach(t => t.dispose());
    this.scene.environment = null;
  }
}

function scaleUv(g: THREE.BufferGeometry, su: number, sv: number) {
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}
