import * as THREE from "three";
import type { Body } from "../vehicle/physics";
import { RoadGraph, type Edge } from "./RoadGraph";

/* The traffic round the player: vehicles kept within a few hundred metres of them on whatever
 * roads are loaded — made out of sight ahead, taken away well behind — so the streets are always
 * busy and never more than the frame can carry. Right-hand traffic on the surveyed lanes, car
 * following (IDM), each junction's approaches in turn on signals (방향별 신호), side roads giving
 * way; nobody drives into anybody: every vehicle checks its own way ahead (lane, the turn it will
 * take, the next road) against every body near, the player's included. Stepped at 30 Hz, drawn
 * interpolated at the display's rate. */

export interface Kind { name: string; geo: THREE.BufferGeometry; length: number; width: number; speed: number; weight: number; paint: string[] | null }
interface Conn { xs: Float32Array; ys: Float32Array; hs: Float32Array; cum: Float32Array; len: number; node: number; key: string; turn: "straight" | "left" | "right" | "uturn" }
interface Car extends Body {
  id: number; kind: number; slot: number; z: number; pitch: number;
  edge: number; fwd: boolean; lane: number; s: number;
  cruise: number; conn: Conn | null; u: number;
  next: { edge: number; fwd: boolean; lane: number; startS: number; conn: Conn } | null;
  go: boolean; why: string; stunned: number; inBox: number;
  px: number; py: number; pz: number; phx: number; phy: number;   // last step's pose (interpolation)
  alive: boolean; version: number;
}

const STEP = 1 / 30;
const NEAR = 24;
const gk = (x: number, y: number) => Math.floor(x / NEAR) * 100003 + Math.floor(y / NEAR);

export class Traffic {
  readonly graph = new RoadGraph();
  readonly group = new THREE.Group();
  private cars: Car[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private used: boolean[][] = [];
  private grid = new Map<number, Car[]>();
  private clock = 0; private acc = 0; private nextId = 1;
  private pt = { x: 0, y: 0, h: 0, ux: 0, uy: 0 }; private pt2 = { x: 0, y: 0, h: 0, ux: 0, uy: 0 };
  private rnd: () => number;
  private player: Body & { z?: number } | null = null;
  target = 70; radius = 380;
  stats = { cars: 0, spawned: 0, despawned: 0, stepMs: 0 };
  private connCache = new Map<string, Conn>();
  private graphVersion = -1;

  constructor(private kinds: Kind[], material: THREE.Material, private capacity = 160, seed = 7) {
    this.rnd = (s => () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; })(seed);
    for (const k of kinds) {
      const im = new THREE.InstancedMesh(k.geo, material, capacity);
      im.count = 0; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
      this.meshes.push(im); this.used.push([]);
      this.group.add(im);
    }
  }
  setPlayer(p: (Body & { z?: number }) | null) { this.player = p; }

  /** Vehicles near (x, y) within r (for the player's collisions). */
  near(x: number, y: number, r: number): Body[] {
    const out: Body[] = [];
    for (let i = Math.floor((x - r) / NEAR); i <= Math.floor((x + r) / NEAR); i++) for (let j = Math.floor((y - r) / NEAR); j <= Math.floor((y + r) / NEAR); j++)
      for (const c of this.grid.get(i * 100003 + j) ?? []) if (Math.abs(c.x - x) < r && Math.abs(c.y - y) < r) out.push(c);
    return out;
  }
  /** A vehicle struck by the player: it stops a while. */
  stun(b: Body, secs: number) { (b as Car).stunned = Math.max((b as Car).stunned ?? 0, secs); }

  // ---------- geometry of lanes ----------
  private lanePos(e: Edge, fwd: boolean, s: number, lane: number, out = this.pt) {
    const g = this.graph;
    g.at(e, fwd ? s : e.len - s, out);
    if (!fwd) { out.ux = -out.ux; out.uy = -out.uy; }
    const off = (Math.min(lane, g.lanesOf(e) - 1) + 0.5) * g.laneW(e);
    out.x += out.uy * off; out.y -= out.ux * off;
    return out;
  }
  private endTrim(e: Edge, fwd: boolean) { return fwd ? e.trimB : e.trimA; }
  private startTrim(e: Edge, fwd: boolean) { return fwd ? e.trimA : e.trimB; }

  /** Where a car on (edge, fwd) may go on from its end: the roads leaving its end node (or the
   * road its T joins), weighted toward straight on; a U-turn where there is nothing else. */
  private choose(e: Edge, fwd: boolean, lane: number) {
    const g = this.graph, ni = fwd ? e.b : e.a, nd = g.nodes[ni];
    const [hx, hy] = g.headingInto(e, !fwd);
    const tee = fwd ? e.teeB : e.teeA;
    const opts: { edge: number; fwd: boolean; dot: number; startS: number }[] = [];
    if (tee) {
      const o = g.edges[tee.edge], p = g.at(o, tee.at, { x: 0, y: 0, h: 0, ux: 0, uy: 0 });
      const dot = p.ux * hx + p.uy * hy;
      if (o.major) { opts.push({ edge: o.idx, fwd: true, dot, startS: tee.at + o.w / 2 + 1 }); opts.push({ edge: o.idx, fwd: false, dot: -dot, startS: o.len - tee.at + o.w / 2 + 1 }); }
    } else for (const end of nd.ends) {
      if (end.edge === e.idx) continue;
      const o = g.edges[end.edge];
      if (!o.alive || !o.major || o.len < 8) continue;
      const [ix, iy] = g.headingInto(o, end.atA);
      opts.push({ edge: o.idx, fwd: end.atA, dot: -(ix * hx + iy * hy), startS: this.startTrim(o, end.atA) });
    }
    const ok = opts.filter(o => o.dot > -0.4 && o.startS < g.edges[o.edge].len - 6);
    if (!ok.length) return { edge: e.idx, fwd: !fwd, startS: this.startTrim(e, !fwd), turn: "uturn" as const };
    const pick = ok;
    const w = pick.map(o => Math.exp(3.2 * o.dot)), total = w.reduce((a, b) => a + b, 0);
    let r = this.rnd() * total, c = pick[0];
    for (let i = 0; i < pick.length; i++) { r -= w[i]; if (r <= 0) { c = pick[i]; break; } }
    void lane;
    return { edge: c.edge, fwd: c.fwd, startS: c.startS, turn: (c.dot > 0.7 ? "straight" : "turn") as "straight" | "turn" };
  }
  /** The car's next road and the curve onto it, from its lane's stop to the next lane's start. */
  private plan(c: Car) {
    const g = this.graph, e = g.edges[c.edge];
    const ch = this.choose(e, c.fwd, c.lane), o = g.edges[ch.edge];
    const a = this.lanePos(e, c.fwd, e.len - this.endTrim(e, c.fwd), c.lane, { x: 0, y: 0, h: 0, ux: 0, uy: 0 });
    // the lane on the next road: left turns into the inner lane, right turns into the outer
    const nl = g.lanesOf(o);
    const b0 = this.lanePos(o, ch.fwd, ch.startS, 0, { x: 0, y: 0, h: 0, ux: 0, uy: 0 });
    const turnSign = a.ux * b0.uy - a.uy * b0.ux, dot = a.ux * b0.ux + a.uy * b0.uy;
    const turn: Conn["turn"] = ch.turn === "uturn" ? "uturn" : dot > 0.7 ? "straight" : turnSign > 0 ? "left" : "right";
    const lane = turn === "left" || turn === "uturn" ? 0 : turn === "right" ? nl - 1 : Math.min(c.lane, nl - 1);
    const b = this.lanePos(o, ch.fwd, ch.startS, lane, { x: 0, y: 0, h: 0, ux: 0, uy: 0 });
    const key = `${c.edge}${c.fwd ? "+" : "-"}${c.lane}>${ch.edge}${ch.fwd ? "+" : "-"}${lane}@${ch.startS.toFixed(1)}`;
    let conn = this.connCache.get(key);
    if (!conn) {
      const dist = Math.hypot(b.x - a.x, b.y - a.y), k = turn === "uturn" ? Math.max(3.5, dist) : Math.max(0.5, dist * 0.42);
      const N = 16, xs = new Float32Array(N + 1), ys = new Float32Array(N + 1), hs = new Float32Array(N + 1), cum = new Float32Array(N + 1);
      for (let i = 0; i <= N; i++) {
        const t = i / N, u = 1 - t;
        xs[i] = u * u * u * a.x + 3 * u * u * t * (a.x + a.ux * k) + 3 * u * t * t * (b.x - b.ux * k) + t * t * t * b.x;
        ys[i] = u * u * u * a.y + 3 * u * u * t * (a.y + a.uy * k) + 3 * u * t * t * (b.y - b.uy * k) + t * t * t * b.y;
        hs[i] = a.h + (b.h - a.h) * t;
        if (i) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
      }
      const node = (c.fwd ? e.trimB : e.trimA) > 2 ? (c.fwd ? e.b : e.a) : -1;
      conn = { xs, ys, hs, cum, len: Math.max(0.3, cum[N]), node, key: `${c.edge}:${c.fwd ? "b" : "a"}`, turn };
      this.connCache.set(key, conn);
      if (this.connCache.size > 6000) this.connCache.delete(this.connCache.keys().next().value!);
    }
    c.next = { edge: ch.edge, fwd: ch.fwd, lane, startS: ch.startS, conn };
    c.go = false;
  }

  /** The light shown to an approach (`edge:a|b`) at a node: green, yellow or red. */
  light(ni: number, key: string): "green" | "yellow" | "red" {
    const sg = this.graph.nodes[ni]?.signal;
    if (!sg) return "green";
    const P = 15, t = (this.clock + sg.offset) % (P * sg.phases), i = Math.floor(t / P), w = t - i * P;
    if (sg.phaseOf.get(key) !== i) return "red";
    return w < 10 ? "green" : w < 13 ? "yellow" : "red";
  }

  /** A pose `d` metres on along the car's way: its lane, the curve, the next lane. */
  private ahead(c: Car, d: number, out: { x: number; y: number; h: number; ux: number; uy: number }) {
    const g = this.graph;
    if (c.conn) {
      const u = c.u + d;
      if (u <= c.conn.len) return this.onConn(c.conn, u, out);
      const n = c.next!; return this.lanePos(g.edges[n.edge], n.fwd, n.startS + u - c.conn.len, n.lane, out);
    }
    const e = g.edges[c.edge], end = e.len - this.endTrim(e, c.fwd), sv = c.s + d;
    if (sv <= end || !c.next) return this.lanePos(e, c.fwd, Math.min(sv, e.len), c.lane, out);
    const u = sv - end;
    if (u <= c.next.conn.len) return this.onConn(c.next.conn, u, out);
    const n = c.next; return this.lanePos(g.edges[n.edge], n.fwd, n.startS + u - n.conn.len, n.lane, out);
  }
  private onConn(cn: Conn, u: number, out: { x: number; y: number; h: number; ux: number; uy: number }) {
    let i = 1; while (i < cn.cum.length - 1 && cn.cum[i] < u) i++;
    const seg = cn.cum[i] - cn.cum[i - 1] || 1, t = Math.max(0, Math.min(1, (u - cn.cum[i - 1]) / seg));
    const dx = cn.xs[i] - cn.xs[i - 1], dy = cn.ys[i] - cn.ys[i - 1], l = Math.hypot(dx, dy) || 1;
    out.x = cn.xs[i - 1] + dx * t; out.y = cn.ys[i - 1] + dy * t; out.h = cn.hs[i - 1] + (cn.hs[i] - cn.hs[i - 1]) * t; out.ux = dx / l; out.uy = dy / l;
    return out;
  }
  private overlaps(x: number, y: number, hx: number, hy: number, L: number, Wd: number, o: Body) {
    const dx = o.x - x, dy = o.y - y;
    for (let a = 0; a < 4; a++) {
      const ux = a === 0 ? hx : a === 1 ? -hy : a === 2 ? o.hx : -o.hy, uy = a === 0 ? hy : a === 1 ? hx : a === 2 ? o.hy : o.hx;
      const ra = Math.abs(ux * hx + uy * hy) * L / 2 + Math.abs(-ux * hy + uy * hx) * Wd / 2;
      const rb = Math.abs(ux * o.hx + uy * o.hy) * o.length / 2 + Math.abs(-ux * o.hy + uy * o.hx) * o.width / 2;
      if (Math.abs(dx * ux + dy * uy) > ra + rb) return false;
    }
    return true;
  }
  /** Room (m) along its own way before its body meets another's (the player's included). */
  private room(c: Car, reach: number) {
    let best = Infinity;
    const cand: Body[] = [];
    for (let i = Math.floor((c.x - reach - 6) / NEAR); i <= Math.floor((c.x + reach + 6) / NEAR); i++) for (let j = Math.floor((c.y - reach - 6) / NEAR); j <= Math.floor((c.y + reach + 6) / NEAR); j++)
      for (const o of this.grid.get(i * 100003 + j) ?? []) if (o !== c && Math.hypot(o.x - c.x, o.y - c.y) < reach + (o.length + c.length) / 2 + 1) cand.push(o);
    const p = this.player;
    if (p && Math.hypot(p.x - c.x, p.y - c.y) < reach + (p.length + c.length) / 2 + 1) cand.push(p);
    if (!cand.length) return Infinity;
    const q = { x: 0, y: 0, h: 0, ux: 0, uy: 0 };
    const far = this.player ? Math.hypot(this.player.x - c.x, this.player.y - c.y) > 200 : false, stepD = far ? 3 : 1.5;
    for (let d = 0; d <= reach; d += stepD) {
      this.ahead(c, d, q);
      for (const o of cand) {
        if (!this.overlaps(q.x, q.y, q.ux, q.uy, c.length, c.width + 0.4, o)) continue;
        // (touching already: only what is ahead holds it)
        if (d === 0 && (o.x - c.x) * c.hx + (o.y - c.y) * c.hy <= 0) continue;
        // two in each other's way: the lower id goes first
        if (d < 3 && o !== p && (o as Car).id < c.id && (c.x - o.x) * o.hx + (c.y - o.y) * o.hy > 0) continue;
        best = Math.min(best, Math.max(0, d - 0.5));
      }
      if (best < Infinity) return best;
    }
    return best;
  }

  private place(c: Car) {
    const q = this.ahead(c, 0, this.pt);
    c.x = q.x; c.y = q.y; c.hx = q.ux; c.hy = q.uy; c.z = q.h;
    // pitch from the heights a little ahead (near the player only: afar it can't be seen)
    if (this.player && Math.hypot(this.player.x - c.x, this.player.y - c.y) < 220) {
      const f = this.ahead(c, c.length * 0.35, this.pt2).h;
      c.pitch = Math.atan2(f - c.z, c.length * 0.35);
    } else c.pitch = 0;
  }

  // ---------- life: spawning round the player, leaving behind ----------
  private spawnOne(px: number, py: number, view: (x: number, y: number) => boolean) {
    const g = this.graph;
    const r = 120 + this.rnd() * (this.radius - 140), a = this.rnd() * Math.PI * 2;
    const tx = px + Math.cos(a) * r, ty = py + Math.sin(a) * r;
    const hit = g.nearest(tx, ty, 50, true);
    if (!hit) return false;
    const e = g.edges[hit.edge];
    if (!e.alive || e.len < 20) return false;
    const fwd = this.rnd() < 0.5, lane = Math.floor(this.rnd() * g.lanesOf(e));
    const s0 = this.startTrim(e, fwd) + 3, s1 = e.len - this.endTrim(e, fwd) - 6;
    if (s1 <= s0) return false;
    const s = Math.max(s0, Math.min(s1, fwd ? hit.d : e.len - hit.d));
    const kind = this.pickKind(), K = this.kinds[kind];
    const p = this.lanePos(e, fwd, s, lane, { x: 0, y: 0, h: 0, ux: 0, uy: 0 });
    if (Math.hypot(p.x - px, p.y - py) < 110 || view(p.x, p.y)) return false;
    for (const o of this.near(p.x, p.y, 14)) if (Math.hypot(o.x - p.x, o.y - p.y) < (o.length + K.length) / 2 + 4) return false;
    const slot = this.used[kind].indexOf(false) >= 0 ? this.used[kind].indexOf(false) : this.used[kind].length;
    if (slot >= this.capacity) return false;
    this.used[kind][slot] = true;
    const cruise = (8.5 + this.rnd() * 5.5) * K.speed * (e.w >= 20 ? 1.35 : e.w >= 12 ? 1.1 : 0.85);
    const c: Car = { id: this.nextId++, kind, slot, x: p.x, y: p.y, z: p.h, pitch: 0, hx: p.ux, hy: p.uy, speed: cruise * 0.7, length: K.length, width: K.width,
      edge: e.idx, fwd, lane, s, cruise, conn: null, u: 0, next: null, go: false, why: "", stunned: 0, inBox: -1,
      px: p.x, py: p.y, pz: p.h, phx: p.ux, phy: p.uy, alive: true, version: 0 };
    this.plan(c);
    if (K.paint) { const col = new THREE.Color(K.paint[Math.floor(this.rnd() * K.paint.length)]); this.meshes[kind].setColorAt(slot, col); this.meshes[kind].instanceColor!.needsUpdate = true; }
    this.cars.push(c);
    this.stats.spawned++;
    return true;
  }
  private pickKind() {
    const total = this.kinds.reduce((t, k) => t + k.weight, 0);
    let r = this.rnd() * total;
    for (let i = 0; i < this.kinds.length; i++) { r -= this.kinds[i].weight; if (r <= 0) return i; }
    return 0;
  }
  private remove(c: Car) {
    c.alive = false;
    this.used[c.kind][c.slot] = false;
    this.stats.despawned++;
  }

  // ---------- the step ----------
  private stepOnce(dt: number) {
    const g = this.graph;
    this.clock += dt;
    // cars on roads that went (their tile dropped): gone
    for (const c of this.cars) {
      if (!c.alive) continue;
      const e = g.edges[c.edge];
      if (!e?.alive || (c.next && !g.edges[c.next.edge]?.alive)) { if (!e?.alive) { this.remove(c); continue; } this.plan(c); }
    }
    this.grid.clear();
    for (const c of this.cars) if (c.alive) { const k = gk(c.x, c.y), l = this.grid.get(k); if (l) l.push(c); else this.grid.set(k, [c]); }
    // who is in each junction's box (by approach), for the box rule
    const boxes = new Map<number, Set<string>>();
    for (const c of this.cars) if (c.alive && c.conn && c.conn.node >= 0) { const s = boxes.get(c.conn.node) ?? new Set(); s.add(c.conn.key); boxes.set(c.conn.node, s); }
    for (const c of this.cars) {
      if (!c.alive) continue;
      c.px = c.x; c.py = c.y; c.pz = c.z; c.phx = c.hx; c.phy = c.hy;
      if (c.stunned > 0) { c.stunned -= dt; c.speed = 0; c.why = "struck"; continue; }
      const e = g.edges[c.edge];
      let room = this.room(c, Math.max(10, c.speed * 1.8 + c.length));
      c.why = room < Infinity ? "body" : "";
      if (!c.conn && c.next) {
        const end = e.len - this.endTrim(e, c.fwd), toStop = end - (c.s + c.length / 2) - 0.3;
        if (!c.go && toStop < 70) {
          let ok = true;
          const cn = c.next.conn;
          if (cn.node >= 0) {
            const lt = this.light(cn.node, cn.key);
            if (lt === "red" || (lt === "yellow" && toStop > (c.speed * c.speed) / 8 + 1)) { ok = false; c.why = lt; }
            // one approach in the box at a time
            const inBox = boxes.get(cn.node);
            if (ok && inBox && [...inBox].some(k => k !== cn.key)) { ok = false; c.why = "box"; }
          } else {
            const tee = c.fwd ? e.teeB : e.teeA;
            if (tee) {
              // a side road: wait for a gap on the road it joins
              const o = g.edges[tee.edge], p = g.at(o, tee.at, { x: 0, y: 0, h: 0, ux: 0, uy: 0 });
              for (const other of this.near(p.x, p.y, 30)) if (other !== c && Math.abs(other.speed) > 0.5) { const dx = p.x - other.x, dy = p.y - other.y; if (dx * other.hx + dy * other.hy > -4) { ok = false; c.why = "giveway"; break; } }
            }
          }
          // (꼬리물기 금지) room past the junction on the next lane
          if (ok) {
            const n = c.next, q = this.lanePos(g.edges[n.edge], n.fwd, n.startS + c.length / 2 + 1, n.lane, { x: 0, y: 0, h: 0, ux: 0, uy: 0 });
            for (const o of this.near(q.x, q.y, 9)) if (o !== c && Math.hypot(o.x - q.x, o.y - q.y) < (o.length + c.length) / 2 + 1.5) { ok = false; c.why = "exit"; break; }
          }
          if (ok && toStop < 2) c.go = true;
          if (!ok) room = Math.min(room, Math.max(0, toStop));
        }
      }
      // IDM toward the cruise speed (slower through a turn)
      const v0 = c.cruise * (c.conn && c.conn.turn !== "straight" ? 0.55 : 1);
      const gap = Math.max(0.1, room), sStar = 2 + c.speed * 1.2;
      let acc = 1.8 * (1 - (c.speed / Math.max(0.1, v0)) ** 4 - (room === Infinity ? 0 : (sStar / gap) ** 2));
      acc = Math.max(-7, Math.min(2.2, acc));
      c.speed = Math.max(0, c.speed + acc * dt);
      const adv = Math.min(c.speed * dt, Math.max(0, room - 0.3));
      if (adv <= 0) c.speed = Math.min(c.speed, room < 0.5 ? 0 : c.speed);
      // move along
      if (c.conn) {
        c.u += adv;
        if (c.u >= c.conn.len) {
          const n = c.next!, over = c.u - c.conn.len;
          c.edge = n.edge; c.fwd = n.fwd; c.lane = n.lane; c.s = n.startS + over; c.conn = null; c.u = 0;
          this.plan(c);
        }
      } else {
        c.s += adv;
        const end = e.len - this.endTrim(e, c.fwd);
        if (c.next && c.s >= end) {
          if (c.go || this.endTrim(e, c.fwd) < 0.5) { c.conn = c.next.conn; c.u = c.s - end; c.go = false; }
          else c.s = end;
        }
      }
      this.place(c);
    }
    this.cars = this.cars.filter(c => c.alive);
  }

  /** Per frame: the fixed steps due, the population kept round the player, the instances drawn
   * interpolated. `view(x, y)`: is a point in sight (no vehicle appears there). */
  update(dt: number, px: number, py: number, view: (x: number, y: number) => boolean) {
    const t0 = performance.now();
    if (this.graph.version !== this.graphVersion) { this.graphVersion = this.graph.version; this.connCache.clear(); for (const c of this.cars) if (!c.conn) this.plan(c); }
    this.acc = Math.min(this.acc + dt, STEP * 4);
    while (this.acc >= STEP) { this.stepOnce(STEP); this.acc -= STEP; }
    // population: away well behind, made out of sight ahead (a few a frame)
    for (const c of this.cars) if (Math.hypot(c.x - px, c.y - py) > this.radius + 60) this.remove(c);
    this.cars = this.cars.filter(c => c.alive);
    if (this.cars.length < this.target) this.spawnOne(px, py, view);
    // draw: interpolated between the last two steps
    const a = this.acc / STEP, m = new THREE.Matrix4(), q = new THREE.Quaternion(), qp = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), across = new THREE.Vector3(1, 0, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const counts = this.meshes.map(() => 0);
    // (slots are fixed per car; the count covers the highest used, empty ones scaled to nothing)
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let k = 0; k < this.meshes.length; k++) { const u = this.used[k]; let top = 0; for (let i = 0; i < u.length; i++) if (u[i]) top = i + 1; counts[k] = top; for (let i = 0; i < top; i++) if (!u[i]) this.meshes[k].setMatrixAt(i, zero); }
    for (const c of this.cars) {
      const x = c.px + (c.x - c.px) * a, y = c.py + (c.y - c.py) * a, z = c.pz + (c.z - c.pz) * a;
      let hx = c.phx + (c.hx - c.phx) * a, hy = c.phy + (c.hy - c.phy) * a; const l = Math.hypot(hx, hy) || 1; hx /= l; hy /= l;
      q.setFromAxisAngle(up, Math.atan2(hx, -hy)).multiply(qp.setFromAxisAngle(across, -c.pitch));
      m.compose(p.set(x, z + 0.02, -y), q, one);
      this.meshes[c.kind].setMatrixAt(c.slot, m);
    }
    this.meshes.forEach((im, k) => { im.count = counts[k]; im.instanceMatrix.needsUpdate = true; });
    this.stats.cars = this.cars.length;
    this.stats.stepMs = performance.now() - t0;
  }

  /** Inspection (development). */
  get all() { return this.cars; }
  dispose() { this.meshes.forEach(m => m.dispose()); }
}
