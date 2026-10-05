import * as THREE from "three";
import { complexAt, type ComplexLink } from "../world/complexAt";
import type { Game, Frame } from "./Game";
import { GameAudio } from "./audio";
import { feelSfx, fuelCans, navVoice, pickupPlan, screech, sparks } from "./feel";
import { damageSfx, vehicleFx } from "./fx";
import { beacon, cutFrom, drawMinimap, goldFor, lengthOf, nextTurn, progressOn, routeRibbon, sfx, type Pt, type TurnKind } from "./nav";
import { SPECS, type Controls } from "../vehicle/physics";

/* The rules of the game on top of the drive: deliveries to the apartment complexes the streamed
 * tiles find (공동주택 by name), the way there and back on course when left, fuel by the distance,
 * damage by the knocks, pickups on the way, gold with a bonus for time, no knocks and a run of
 * on-time deliveries; speed cameras and red lights cost gold; into the river and you start again. */

export interface Result { name: string; base: number; time: number; clean: number; combo: number; penalty: number; total: number; secs: number; dist: number; floors: number;
  /** the complex delivered to, as the site knows it: undefined while it is looked up, null if none */
  complex?: ComplexLink | null }
export interface UiState {
  hp: number; fuel: number; gold: number; earned: number; delivered: number; combo: number; violations: number;
  delivery: { name: string; n: number; floors: number } | null;
  result: Result | null;
  toast: { text: string; n: number; kind: "good" | "bad" | "info" } | null;
  warn: { fuel: number; hp: number };
  wrecked: null | "hp" | "fuel" | "water";
  voiceOn: boolean; limit: number | null; finding: boolean;
}
export interface HudEls { dist?: HTMLElement | null; time?: HTMLElement | null; turn?: HTMLElement | null; turnDist?: HTMLElement | null; map?: HTMLCanvasElement | null; fx?: HTMLElement | null; flash?: HTMLElement | null; fuelText?: HTMLElement | null }

const GOLD_KEY = "kospimap.drive.gold";
const REPAIR_HP = 35;
export const goldTotal = () => { try { return Number(localStorage.getItem(GOLD_KEY) ?? 0) || 0; } catch { return 0; } };
const addGold = (n: number) => { const t = Math.max(0, goldTotal() + n); try { localStorage.setItem(GOLD_KEY, String(t)); } catch { /* */ } return t; };
const DEAD: Controls = { throttle: 0, brake: 1, steer: 0, hand: true, boost: false };

interface Delivery {
  name: string; x: number; y: number; floors: number; way: Pt[]; wayLen0: number; started: number; knocks: number; knockAt: number;
  routedAt: number; mapAt: number; spoken: { kind: TurnKind; x: number; y: number }[]; rerouteSaidAt: number;
  /** the complex there (looked up while driving: the arrival card links to it) */
  complex: Promise<ComplexLink | null>;
}

export class Session {
  readonly audio = new GameAudio();
  ui: UiState;
  hud: HudEls = {};
  private squeal; private sparks = sparks(); private fx = vehicleFx(); private cans = fuelCans(); private voice = navVoice();
  private ribbon; private beacon = beacon();
  private d: Delivery | null = null;
  private lastDest = "";
  private fuelCap = 900; private fuelLeft = 900; private dryAt = 0;
  private hitAt = 0; private shake = 0; private findAt = 0; private toastN = 0;
  private lamps: THREE.Group;
  private cams: { x: number; y: number; limit: number; mesh: THREE.Object3D; at: number }[] = [];
  private camSeen = new Set<string>();
  private camGeo: THREE.BufferGeometry; private camMat: THREE.Material;
  private prevPos = { x: 0, y: 0 };
  private wreck: THREE.Mesh | null = null; private fireStop: ((s?: number) => void) | null = null;
  private home = { x: 0, y: 0, h: 0 };
  private onUi: (u: UiState) => void;
  private uiDirty = true; private uiAt = 0;
  private acc = 0; private prevV = 0;

  constructor(private g: Game, onUi: (u: UiState) => void) {
    this.onUi = onUi;
    this.ui = { hp: 100, fuel: 1, gold: goldTotal(), earned: 0, delivered: 0, combo: 0, violations: 0, delivery: null, result: null, toast: null, warn: { fuel: 0, hp: 0 }, wrecked: null, voiceOn: true, limit: null, finding: true };
    this.squeal = screech(this.audio.ctx, this.audio.master);
    this.ribbon = routeRibbon((x, y) => { const s = g.world.surfaceAt(x, y); return Number.isFinite(s) ? s : 0; });
    this.lamps = this.brakeLamps();
    g.scene.add(this.sparks.mesh, this.fx.group, this.cans.group, this.ribbon.mesh, this.beacon.group, this.lamps);
    this.beacon.group.visible = false;
    // speed camera: a pole with a box on an arm
    const pole = new THREE.CylinderGeometry(0.1, 0.13, 6, 8).translate(0, 3, 0), box = new THREE.BoxGeometry(0.5, 0.45, 0.7).translate(0, 5.8, 1.1), arm = new THREE.BoxGeometry(0.1, 0.1, 1.2).translate(0, 5.9, 0.6);
    this.camGeo = new THREE.BufferGeometry();
    const merged = [pole, box, arm].map(gg => gg.toNonIndexed());
    const pos: number[] = [], nor: number[] = [];
    for (const m of merged) { pos.push(...(m.getAttribute("position").array as Float32Array)); nor.push(...(m.getAttribute("normal").array as Float32Array)); m.dispose(); }
    [pole, box, arm].forEach(x => x.dispose());
    this.camGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this.camGeo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    this.camMat = new THREE.MeshStandardMaterial({ color: "#e8e6df", roughness: 0.5, metalness: 0.3 });
    void this.audio.setVehicle(g.vehicle.spec);
    this.fuelCap = this.fuelLeft = 900;
    const b = g.vehicle.body;
    this.home = { x: b.x, y: b.y, h: Math.atan2(b.hy, b.hx) };
    this.prevPos = { x: b.x, y: b.y };
    g.controlFilter = c => (this.ui.wrecked ? DEAD : this.fuelLeft <= 0 ? { ...c, throttle: 0, boost: false } : c);
    g.ticks.push(dt => this.tick(dt));
    // its objects' materials compiled with the rest before the drive: a pickup of each kind, a
    // speed camera, the way and its beacon, sparks, smoke and fire, the brake lamps
    const camMesh = new THREE.Mesh(this.camGeo, this.camMat); camMesh.castShadow = true;
    this.cans.place([{ x: 0, y: 0, z: 0, kind: "fuel" }, { x: 1, y: 0, z: 0, kind: "repair" }]);
    this.ribbon.set([[0, 0], [0, 6]]);
    this.sparks.burst(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 2);
    this.fx.explode(new THREE.Vector3(), 0); this.fx.update(0.05, g.camera, new THREE.Vector3(), 10);
    g.warmExtras.push(this.cans.group, this.ribbon.mesh, this.beacon.group, this.sparks.mesh, this.fx.group, this.lamps, camMesh);
    this.emit(true);
  }
  /** After the warm-up: the stand-ins cleared. */
  ready() { this.cans.clear(); this.ribbon.mesh.visible = false; this.fx.clear(); this.sparks.update(5, this.g.camera); }

  private brakeLamps() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: "#ff2010", toneMapped: false });
    const spec = this.g.vehicle.spec;
    const parts = spec.label === "사이버트럭" ? [{ x: 0, y: 1.26, z: -2.925, w: 1.97, h: 0.062 }, ...[-1, 1].map(s => ({ x: s * 0.95, y: 1.19, z: -2.925, w: 0.07, h: 0.14 }))]
      : [-1, 1].map(s => ({ x: s * 0.72, y: 0.72, z: -2.665, w: 0.29, h: 0.17 }));
    for (const p of parts) { const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, 0.02), mat); m.position.set(p.x, p.y, p.z); g.add(m); }
    g.matrixAutoUpdate = false; g.visible = false;
    return g;
  }

  private toast(text: string, kind: "good" | "bad" | "info" = "info") {
    this.ui.toast = { text, n: ++this.toastN, kind };
    this.emit(true);
  }
  private emit(now = false) { this.uiDirty = true; if (now) this.flush(); }
  private flush() { this.uiDirty = false; this.uiAt = performance.now(); this.onUi({ ...this.ui }); }

  get voiceOn() { return this.voice.on; }
  toggleVoice() { this.voice.on = !this.voice.on; this.ui.voiceOn = this.voice.on; this.toast(this.voice.on ? "🔊 음성 안내 켬" : "🔇 음성 안내 끔"); }
  horn() { sfx.horn(this.audio.ctx, this.g.vehicle.spec.label !== "사이버트럭", this.audio.master); }

  // ---------- deliveries ----------
  private mapLines = new WeakMap<object, Pt[]>();
  private cands: { id: string; name: string; x: number; y: number; floors: number }[] = [];
  /** One candidate tried a call (each a route search): the search spread over frames. */
  private findDelivery() {
    const g = this.g, b = g.vehicle.body;
    if (!this.cands.length) {
      this.cands = g.world.dests.filter(d => d.id !== this.lastDest && d.floors >= 5 && Math.hypot(d.x - b.x, d.y - b.y) > 350 && Math.hypot(d.x - b.x, d.y - b.y) < 1700);
      for (let i = this.cands.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this.cands[i], this.cands[j]] = [this.cands[j], this.cands[i]]; }
      this.cands = this.cands.slice(0, 10);
      if (!this.cands.length) return false;
    }
    const pick = this.cands.shift()!;
    const r = g.traffic.graph.route(b.x, b.y, pick.x, pick.y);
    if (!r || r.length < 2) return false;
    const way: Pt[] = [[b.x, b.y], ...r], len = lengthOf(way);
    if (len < 300) return false;
    this.cands = [];
    this.lastDest = pick.id;
    this.setWay(way);
    const end = way[way.length - 1];
    this.beacon.place(pick.x, pick.y, g.world.surfaceAt(pick.x, pick.y) || g.world.surfaceAt(end[0], end[1]) || 0);
    this.beacon.group.visible = true;
    this.cans.place(pickupPlan(len, this.ui.hp).map(({ at, kind }) => { const [x, y] = cutFrom(way, at)[0]; return { x, y, z: g.world.surfaceAt(x, y) || 0, kind }; }));
    this.fuelCap = Math.max(this.fuelCap * 0.5, len * 1.6 + 400) * SPECS.coupang.fuelUse;
    this.fuelLeft = Math.max(this.fuelLeft, this.fuelCap); this.fuelCap = Math.max(this.fuelCap, this.fuelLeft); this.dryAt = 0;
    const now = performance.now();
    const [lon, lat] = g.lonLat(pick.x, pick.y);
    const complex = complexAt(lon, lat, pick.name, pick.floors, g.sources);
    this.d = { name: pick.name, x: pick.x, y: pick.y, floors: pick.floors, way, wayLen0: len, started: now, knocks: 0, knockAt: 0, routedAt: now, mapAt: 0, spoken: [], rerouteSaidAt: 0, complex };
    this.ui.delivery = { name: pick.name, n: (this.ui.delivery?.n ?? 0) + 1, floors: pick.floors };
    this.ui.result = null; this.ui.finding = false;
    this.voice.say(`${pick.name}(으)로 배송을 시작합니다`);
    this.emit(true);
    return true;
  }
  private setWay(way: Pt[]) {
    this.ribbon.set(way);
    this.g.route = new Float32Array(way.flat());
    if (this.d) this.d.way = way;
  }
  nextDelivery() { this.ui.result = null; this.d = null; this.ui.finding = true; this.findAt = 0; this.emit(true); }

  private deliveryTick() {
    const d = this.d!, g = this.g, b = g.vehicle.body, now = performance.now();
    const p = progressOn(d.way, b.x, b.y), off = p.off > 22;
    // back on course: the way again from here (and again now and then: new roads come in)
    // (on course with a way that reaches the destination: no search at all; one that stops short —
    // the roads there not in yet — tried again every 4 s)
    const end0 = d.way[d.way.length - 1], short = Math.hypot(end0[0] - d.x, end0[1] - d.y) > 160;
    if ((off || short) && now - d.routedAt > (off ? 900 : 4000)) {
      d.routedAt = now;
      const r = g.traffic.graph.route(b.x, b.y, d.x, d.y);
      if (r && r.length > 1) {
        if (off && now - d.rerouteSaidAt > 15000) { d.rerouteSaidAt = now; this.voice.say("경로를 재탐색합니다"); }
        this.setWay([[b.x, b.y], ...r]);
      }
    }
    const pp = progressOn(d.way, b.x, b.y), rest = cutFrom(d.way, pp.along), left = Math.max(0, pp.total - pp.along);
    const toDest = Math.hypot(d.x - b.x, d.y - b.y), end = d.way[d.way.length - 1];
    if (toDest < 45 || (left < 18 && Math.hypot(end[0] - d.x, end[1] - d.y) < 160 && Math.abs(b.speed) < 8)) { this.arrive(); return; }
    // turn by turn
    const turn = nextTurn(rest), word = turn.kind === "left" ? "좌회전" : turn.kind === "right" ? "우회전" : turn.kind === "uturn" ? "유턴" : turn.kind === "arrive" ? "도착" : "직진";
    if (this.hud.turn) { const ic = turn.kind === "left" ? "↰" : turn.kind === "right" ? "↱" : turn.kind === "uturn" ? "⮌" : turn.kind === "arrive" ? "◎" : "↑"; if (this.hud.turn.textContent !== ic) this.hud.turn.textContent = ic; }
    if (this.hud.turnDist) { const t = turn.kind === "straight" ? `${Math.round(left)}m` : `${Math.round(turn.dist)}m ${word}`; if (this.hud.turnDist.textContent !== t) this.hud.turnDist.textContent = t; }
    if (turn.kind !== "straight" && turn.dist < 130) {
      const [tx, ty] = cutFrom(d.way, pp.along + Math.max(0, turn.dist))[0];
      if (!d.spoken.some(s => s.kind === turn.kind && Math.hypot(s.x - tx, s.y - ty) < 30)) {
        d.spoken.push({ kind: turn.kind, x: tx, y: ty });
        this.voice.say(turn.kind === "arrive" ? "목적지 부근입니다" : turn.dist < 40 ? word : `${Math.round(turn.dist / 10) * 10}미터 앞, ${word}`);
      }
    }
    if (this.hud.dist) { const t = left >= 1000 ? `${(left / 1000).toFixed(1)}km` : `${Math.round(left)}m`; if (this.hud.dist.textContent !== t) this.hud.dist.textContent = t; }
    if (this.hud.time) { const s = (now - d.started) / 1000, t = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`; if (this.hud.time.textContent !== t) this.hud.time.textContent = t; }
    if (this.hud.map && now - d.mapAt > 160) {
      d.mapAt = now;
      const roads: { line: Pt[]; width: number }[] = [];
      for (const ei of g.traffic.graph.edgesNear(b.x, b.y, 240)) {
        const e = g.traffic.graph.edges[ei];
        if (!e?.alive) continue;
        let line = this.mapLines.get(e);
        if (!line) { line = []; for (let k = 0; k < e.xs.length; k += 4) line.push([e.xs[k], e.ys[k]]); line.push([e.xs[e.xs.length - 1], e.ys[e.ys.length - 1]]); this.mapLines.set(e, line); }
        roads.push({ line, width: e.w });
      }
      drawMinimap(this.hud.map, roads, rest, b, [d.x, d.y], 0.5);
    }
  }
  private arrive() {
    const d = this.d!, secs = (performance.now() - d.started) / 1000;
    const r0 = goldFor(d.wayLen0, secs, d.knocks), onTime = secs < d.wayLen0 / 8;
    this.ui.combo = onTime ? Math.min(5, this.ui.combo + 1) : 0;
    const combo = Math.round(r0.total * 0.2 * this.ui.combo);
    const total = r0.total + combo;
    this.ui.gold = addGold(total); this.ui.earned += total; this.ui.delivered++;
    const result: Result = { name: d.name, base: r0.base, time: r0.time, clean: r0.clean, combo, penalty: r0.penalty, total, secs, dist: d.wayLen0, floors: d.floors, complex: undefined };
    this.ui.result = result;
    void d.complex.then(c => { result.complex = c; if (this.ui.result === result) this.emit(true); });
    this.d = null;
    this.ribbon.mesh.visible = false; this.beacon.group.visible = false; this.cans.clear(); this.g.route = null;
    sfx.chime(this.audio.ctx, this.audio.master); sfx.coins(this.audio.ctx, Math.min(14, Math.round(total / 10)), this.audio.master);
    this.voice.say(`배송 완료! ${total} 골드${this.ui.combo > 1 ? `, ${this.ui.combo}연속 정시 배송` : ""}`, true);
    this.emit(true);
  }

  // ---------- rules: cameras and lights ----------
  private camerasTick() {
    const g = this.g, b = g.vehicle.body, gr = g.traffic.graph;
    // cameras on the long major roads round the vehicle: about one road in four, at its middle
    for (const ei of gr.edgesNear(b.x, b.y, 300)) {
      const e = gr.edges[ei];
      if (!e?.alive || !e.major || e.len < 160 || this.camSeen.has(e.id)) continue;
      this.camSeen.add(e.id);
      let h = 0; for (let i = 0; i < e.id.length; i++) h = (h * 31 + e.id.charCodeAt(i)) >>> 0;
      if (h % 4 !== 0) continue;
      const p = gr.at(e, e.len / 2, { x: 0, y: 0, h: 0, ux: 0, uy: 0 }), side = e.w / 2 + 0.8;
      const x = p.x + p.uy * side, y = p.y - p.ux * side, mesh = new THREE.Mesh(this.camGeo, this.camMat);
      mesh.position.set(x, p.h, -y); mesh.rotation.y = Math.atan2(-p.uy, p.ux) - Math.PI / 2;
      mesh.castShadow = true;
      g.scene.add(mesh);
      this.cams.push({ x, y, limit: e.w >= 20 ? 80 : 60, mesh, at: 0 });
    }
    let limit: number | null = null;
    const kmh = Math.abs(b.speed) * 3.6, now = performance.now();
    for (const c of this.cams) {
      const dx = c.x - b.x, dy = c.y - b.y, d = Math.hypot(dx, dy);
      if (d < 160 && dx * b.hx + dy * b.hy > -10) limit = Math.min(limit ?? 999, c.limit);
      if (d < 14 && now - c.at > 8000 && kmh > c.limit + 10) {
        c.at = now; this.ui.violations++;
        this.ui.gold = addGold(-10); this.ui.earned -= 10;
        this.flash();
        this.toast(`📸 과속 단속! ${Math.round(kmh)}km/h (제한 ${c.limit}) −10G`, "bad");
      }
    }
    // (far behind: gone)
    this.cams = this.cams.filter(c => { if (Math.hypot(c.x - b.x, c.y - b.y) < 700) return true; c.mesh.removeFromParent(); return false; });
    if (limit !== this.ui.limit) { this.ui.limit = limit; this.emit(); }
  }
  private flash() { const el = this.hud.flash; if (!el) return; el.classList.remove("on"); void el.offsetWidth; el.classList.add("on"); }
  private lightsTick() {
    const g = this.g, b = g.vehicle.body, gr = g.traffic.graph, px = this.prevPos.x, py = this.prevPos.y;
    if (Math.abs(b.speed) < 2) return;
    for (const ei of gr.edgesNear(b.x, b.y, 30)) {
      const e = gr.edges[ei];
      if (!e?.alive) continue;
      for (const atA of [true, false]) {
        const ni = atA ? e.a : e.b, nd = gr.nodes[ni];
        if (!nd?.signal) continue;
        const trim = atA ? e.trimA : e.trimB;
        if (trim < 3) continue;
        // the stop line across the lanes coming in: travel toward the node, right of the centreline
        const p = gr.at(e, atA ? trim - 5.4 : e.len - trim + 5.4, { x: 0, y: 0, h: 0, ux: 0, uy: 0 });
        const ux = atA ? -p.ux : p.ux, uy = atA ? -p.uy : p.uy;
        const before = (px - p.x) * ux + (py - p.y) * uy, after = (b.x - p.x) * ux + (b.y - p.y) * uy;
        const lateral = (b.x - p.x) * uy - (b.y - p.y) * ux;
        if (before < 0 && after >= 0 && lateral > -0.5 && lateral < e.w / 2 + 1 && b.hx * ux + b.hy * uy > 0.6) {
          if (g.traffic.light(ni, `${ei}:${atA ? "a" : "b"}`) === "red") {
            this.ui.violations++; this.ui.gold = addGold(-15); this.ui.earned -= 15;
            this.toast("🚦 신호 위반! −15G", "bad");
          }
        }
      }
    }
  }

  // ---------- damage, fuel, water ----------
  private hurt(n: number) {
    if (this.ui.wrecked || n <= 0) return;
    this.ui.hp = Math.max(0, this.ui.hp - n);
    const hw = this.ui.hp < 25 ? 2 : this.ui.hp < 50 ? 1 : 0;
    if (hw > this.ui.warn.hp && this.ui.hp > 0) { feelSfx.alarm(this.audio.ctx, "hp", this.audio.master); this.voice.say(hw === 2 ? "경고! 차량 내구도가 매우 낮습니다" : "차량이 손상되었습니다", true); }
    this.ui.warn.hp = hw;
    if (this.ui.hp <= 0) this.destroy("hp");
    this.emit();
  }
  private destroy(why: "hp" | "fuel" | "water") {
    const g = this.g, b = g.vehicle.body;
    this.ui.wrecked = why;
    if (why !== "water") {
      const z = g.world.surfaceAt(b.x, b.y) || 0;
      this.fx.explode(new THREE.Vector3(b.x, z + 1.2, -b.y), z);
      damageSfx.explosion(this.audio.ctx, this.audio.master);
      this.fireStop = damageSfx.fire(this.audio.ctx, this.audio.master);
      this.shake = 9;
    }
    this.audio.engineMute(true);
    this.voice.say(why === "water" ? "차량이 물에 빠졌습니다" : why === "fuel" ? "연료가 떨어졌습니다" : "차량이 파손되었습니다", true);
    this.emit(true);
  }
  /** Back on the road, repaired (gold: 50, nothing after the river), a full tank. */
  repair(free = false) {
    const g = this.g;
    if (!free) { this.ui.gold = addGold(-Math.min(50, goldTotal())); this.ui.earned -= 50; }
    this.fireStop?.(1); this.fireStop = null; this.fx.clear();
    this.ui.wrecked = null; this.ui.hp = 100; this.ui.warn = { fuel: 0, hp: 0 };
    this.fuelLeft = this.fuelCap; this.dryAt = 0;
    this.toRoad();
    this.audio.engineMute(false);
    void g;
    this.emit(true);
  }
  /** The nearest lane, heading along it (R: stuck, off the road). */
  toRoad() {
    const g = this.g, b = g.vehicle.body, gr = g.traffic.graph;
    const hit = gr.nearest(b.x, b.y, 200, true) ?? gr.nearest(b.x, b.y, 400, false);
    if (!hit) { g.vehicle.place(this.home.x, this.home.y, this.home.h); return; }
    const e = gr.edges[hit.edge], p = gr.at(e, hit.d, { x: 0, y: 0, h: 0, ux: 0, uy: 0 });
    let ux = p.ux, uy = p.uy; if (ux * b.hx + uy * b.hy < 0) { ux = -ux; uy = -uy; }
    const off = 0.5 * gr.laneW(e);
    g.vehicle.place(p.x + uy * off, p.y - ux * off, Math.atan2(uy, ux));
  }

  // ---------- each frame ----------
  private tick(dt: number) {
    const g = this.g, v = g.vehicle, b = v.body, now = performance.now();
    this.audio.engineSet(v.revsShare, v.throttle, Math.abs(b.speed));
    // knocks (the physics notes the hardest of the frame's steps)
    const hit = g.lastHit;
    if (hit.bump > 0.6 && !this.ui.wrecked) {
      this.audio.knock(hit.bump);
      if (hit.bump > 2 && now - this.hitAt > 250) {
        this.hitAt = now;
        feelSfx.crash(this.audio.ctx, hit.bump, this.audio.master);
        const end = b.speed <= 0 ? 1 : -1, z = g.world.surfaceAt(b.x, b.y) || 0;
        this.sparks.burst(new THREE.Vector3(b.x + b.hx * end * b.length / 2, z + 0.7, -(b.y + b.hy * end * b.length / 2)), new THREE.Vector3(-b.hx * end, 0, b.hy * end), Math.min(70, 12 + hit.bump * 6));
        this.toast(hit.what === "building" ? "💥 건물과 충돌!" : hit.what === "pole" ? "💥 가로수·가로등과 충돌!" : "💥 차량과 충돌!", "bad");
        if (hit.car) { g.traffic.stun(hit.car, 3 + hit.bump * 0.5); const ctx = this.audio.ctx, out = this.audio.master; setTimeout(() => sfx.horn(ctx, false, out), 500 + Math.random() * 400); }
        this.hurt(Math.max(0, hit.bump - 1.2) * 3.4);
        if (this.d && now - this.d.knockAt > 500) { this.d.knocks++; this.d.knockAt = now; }
      }
      this.shake = Math.max(this.shake, Math.min(6, hit.bump));
    }
    this.squeal.set(this.ui.wrecked ? 0 : v.slip * Math.min(1, Math.abs(b.speed) / 4));
    this.sparks.update(dt, g.camera);
    // fuel by the distance (more with the throttle down, a lot more on the boost)
    if (!this.ui.wrecked) {
      const used = (Math.abs(b.speed) * dt * (0.8 + 0.5 * v.throttle) + dt * 0.4) * v.spec.fuelUse * (v.boosting ? 3 : 1);
      this.fuelLeft = Math.max(0, this.fuelLeft - used);
      const f = this.fuelCap > 0 ? this.fuelLeft / this.fuelCap : 0, fw = f < 0.1 ? 2 : f < 0.25 ? 1 : 0;
      if (fw > this.ui.warn.fuel) { feelSfx.alarm(this.audio.ctx, "fuel", this.audio.master); this.voice.say(fw === 2 ? "연료가 거의 바닥났습니다" : "연료가 부족합니다", true); }
      if (fw !== this.ui.warn.fuel) { this.ui.warn.fuel = fw; this.emit(); }
      if (Math.abs(f - this.ui.fuel) > 0.01) { this.ui.fuel = f; this.emit(); }
      if (this.fuelLeft <= 0) { if (!this.dryAt) this.dryAt = now; if (Math.abs(b.speed) < 0.6 || now - this.dryAt > 8000) this.destroy("fuel"); }
      if (g.world.wetAt(b.x, b.y)) { this.destroy("water"); setTimeout(() => this.repair(true), 2400); }
    }
    if (this.hud.fuelText) { const left = this.fuelLeft / v.spec.fuelUse, t = left >= 1000 ? `${(left / 1000).toFixed(1)}km` : `${Math.round(left)}m`; if (this.hud.fuelText.textContent !== t) this.hud.fuelText.textContent = t; }
    // pickups
    const got = this.cans.update(dt, b.x, b.y, 2.8);
    if (got.fuel) { this.fuelLeft = Math.min(this.fuelCap, this.fuelLeft + this.fuelCap * 0.25 * got.fuel); feelSfx.pickup(this.audio.ctx, this.audio.master); this.toast(v.spec.gears ? "⛽ 연료 +25%" : "⚡ 배터리 +25%", "good"); }
    if (got.repair) { this.ui.hp = Math.min(100, this.ui.hp + REPAIR_HP * got.repair); this.ui.warn.hp = this.ui.hp < 25 ? 2 : this.ui.hp < 50 ? 1 : 0; feelSfx.repair(this.audio.ctx, this.audio.master); this.toast(`🔧 내구도 +${REPAIR_HP}`, "good"); }
    // smoke and fire as it weakens
    const z = g.world.surfaceAt(b.x, b.y) || 0, fwd = this.ui.wrecked ? 0 : b.length * 0.32;
    this.fx.update(dt, g.camera, this.ui.hp < 45 || this.ui.wrecked === "hp" ? new THREE.Vector3(b.x + b.hx * fwd, z + 1.1, -(b.y + b.hy * fwd)) : null, this.ui.wrecked ? 0 : this.ui.hp);
    // brake lamps
    this.lamps.visible = g.view === "chase" && !this.ui.wrecked && v.braking;
    if (this.lamps.visible) { const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(b.hx, -b.hy)); this.lamps.matrix.compose(new THREE.Vector3(b.x, z + 0.02, -b.y), q, new THREE.Vector3(1, 1, 1)); this.lamps.matrixWorldNeedsUpdate = true; }
    // speed lines past ~60 km/h
    if (this.hud.fx) { const o = this.ui.wrecked ? 0 : Math.min(1, Math.max(0, (Math.abs(b.speed) - 16) / 22) + (v.boosting ? 0.55 : 0)); const ov = o.toFixed(2); if (this.hud.fx.style.opacity !== ov) this.hud.fx.style.opacity = ov; }
    // camera shake
    this.shake *= Math.exp(-dt * 7);
    if (this.shake > 0.02) { const s = this.shake * 0.05; g.camera.position.x += (Math.random() - 0.5) * s; g.camera.position.y += (Math.random() - 0.5) * s; }
    // deliveries
    this.ribbon.update(dt); this.beacon.update(dt, this.d ? Math.hypot(this.d.x - b.x, this.d.y - b.y) : Infinity);
    if (this.d) this.deliveryTick();
    else if (!this.ui.result && now - this.findAt > (this.cands.length ? 250 : 1500)) { this.findAt = now; this.findDelivery(); }
    this.acc += dt;
    if (this.acc > 0.25) { this.acc = 0; this.camerasTick(); }
    this.lightsTick();
    this.prevPos = { x: b.x, y: b.y };
    this.prevV = b.speed;
    if (this.uiDirty && now - this.uiAt > 120) this.flush();
  }

  onFrame(f: Frame) { void f; }

  dispose() {
    this.squeal.dispose(); this.sparks.dispose(); this.fx.dispose(); this.cans.dispose(); this.voice.dispose(); this.ribbon.dispose(); this.beacon.dispose();
    this.fireStop?.(0.2); this.wreck?.removeFromParent();
    this.cams.forEach(c => c.mesh.removeFromParent()); this.camGeo.dispose(); this.camMat.dispose();
    this.lamps.removeFromParent();
    this.audio.dispose();
  }
}
