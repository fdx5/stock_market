import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface ParkedBicycle {
  id: string; name: string; dong: string; x: number; y: number; z: number; heading: number;
}
const VISIBLE_BICYCLES = 64;
const WHEEL_RADIUS = 0.34;

/** One shared model: parked bicycles are one instanced draw, the ridden one has moving parts. */
export class Bicycles {
  readonly group = new THREE.Group();
  readonly records = new Map<string, ParkedBicycle>();
  active: ParkedBicycle | null = null;
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.32 });
  private assets: THREE.BufferGeometry[] = [];
  private parked: THREE.InstancedMesh;
  private ridden = new THREE.Group();
  private rear: THREE.Mesh;
  private front: THREE.Mesh;
  private steering = new THREE.Group();
  private crank: THREE.Mesh;
  private wheelTurn = 0;
  private matrix = new THREE.Matrix4();
  private position = new THREE.Vector3();
  private quaternion = new THREE.Quaternion();
  private euler = new THREE.Euler();
  private scale = new THREE.Vector3(1, 1, 1);

  constructor() {
    const color = (g: THREE.BufferGeometry, hex: string) => {
      const geo = g.index ? g.toNonIndexed() : g;
      if (geo !== g) g.dispose();
      geo.deleteAttribute("uv");
      const c = new THREE.Color(hex), n = geo.getAttribute("position").count, values = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) values.set([c.r, c.g, c.b], i * 3);
      geo.setAttribute("color", new THREE.BufferAttribute(values, 3));
      return geo;
    };
    const tube = (a: number[], b: number[], r: number, paint: string) => {
      const start = new THREE.Vector3().fromArray(a), end = new THREE.Vector3().fromArray(b), d = end.clone().sub(start);
      const g = new THREE.CylinderGeometry(r, r, d.length(), 9);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
      const middle = start.add(end).multiplyScalar(0.5);
      g.translate(middle.x, middle.y, middle.z);
      return color(g, paint);
    };
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, paint: string) => color(new THREE.BoxGeometry(w, h, d).translate(x, y, z), paint);
    const merge = (parts: THREE.BufferGeometry[]) => {
      const result = mergeGeometries(parts)!; parts.forEach(g => g.dispose());
      result.computeBoundingSphere(); this.assets.push(result); return result;
    };
    const rear = [0, 0.34, -0.56], bottom = [0, 0.36, -0.06], seat = [0, 0.94, -0.26], lower = [0, 0.76, 0.43], upper = [0, 1.02, 0.36];
    const paint = "#30b7ac", black = "#172027", steel = "#aab6bb";
    const bodyParts = [tube(bottom, seat, 0.032, paint), tube(seat, upper, 0.028, paint), tube(upper, bottom, 0.042, paint), tube(lower, upper, 0.028, paint)];
    for (const side of [-0.075, 0.075]) {
      bodyParts.push(tube([side, ...rear.slice(1)], [side, ...bottom.slice(1)], 0.017, paint));
      bodyParts.push(tube([side, ...rear.slice(1)], [side, ...seat.slice(1)], 0.017, paint));
    }
    bodyParts.push(tube(seat, [0, 1.075, -0.29], 0.022, steel), box(0.23, 0.065, 0.31, 0, 1.09, -0.31, black));
    // Chain guard, chain, rear luggage rack and reflector.
    bodyParts.push(box(0.045, 0.16, 0.6, -0.085, 0.34, -0.3, black));
    bodyParts.push(box(0.28, 0.025, 0.38, 0, 0.8, -0.62, steel), box(0.12, 0.045, 0.03, 0, 0.78, -0.84, "#f54242"));
    for (const side of [-0.1, 0.1]) bodyParts.push(tube([side, 0.35, -0.56], [side, 0.79, -0.75], 0.009, steel));
    const frame = merge(bodyParts);
    const wheelParts = [color(new THREE.TorusGeometry(0.315, 0.025, 8, 40).rotateY(Math.PI / 2), "#10171c"),
      color(new THREE.TorusGeometry(0.285, 0.012, 5, 40).rotateY(Math.PI / 2), steel), tube([-0.095, 0, 0], [0.095, 0, 0], 0.025, steel)];
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8;
      wheelParts.push(tube([0, 0, 0], [0, Math.sin(a) * 0.283, Math.cos(a) * 0.283], 0.0025, steel));
    }
    const wheel = merge(wheelParts);
    const forkParts: THREE.BufferGeometry[] = [];
    for (const side of [-0.075, 0.075]) forkParts.push(tube([side, 0.34, 0.57], [side, 0.91, 0.39], 0.017, paint));
    forkParts.push(tube([0, 0.91, 0.39], [0, 1.13, 0.34], 0.021, steel), tube([-0.31, 1.13, 0.34], [0.31, 1.13, 0.34], 0.018, steel));
    for (const side of [-1, 1]) forkParts.push(tube([side * 0.2, 1.13, 0.34], [side * 0.32, 1.13, 0.34], 0.024, black));
    forkParts.push(box(0.075, 0.06, 0.07, 0, 1.0, 0.47, "#fff5d1"));
    const fork = merge(forkParts);
    const pedalParts: THREE.BufferGeometry[] = [tube([-0.19, 0, 0], [0.19, 0, 0], 0.02, steel)];
    for (const s of [-1, 1]) pedalParts.push(tube([s * 0.13, 0, 0], [s * 0.13, 0, s * 0.17], 0.015, steel), box(0.14, 0.025, 0.085, s * 0.2, 0, s * 0.17, black));
    const pedals = merge(pedalParts);
    const complete = merge([frame.clone(), wheel.clone().translate(0, 0.34, -0.56), wheel.clone().translate(0, 0.34, 0.57), fork.clone(), pedals.clone().translate(0, 0.36, -0.06), tube([0, 0.36, -0.2], [-0.2, 0.025, -0.27], 0.012, steel)]);
    this.parked = new THREE.InstancedMesh(complete, this.material, VISIBLE_BICYCLES);
    this.parked.count = 0; this.parked.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.parked.castShadow = this.parked.receiveShadow = true;
    this.parked.frustumCulled = false;
    const frameMesh = new THREE.Mesh(frame, this.material);
    this.rear = new THREE.Mesh(wheel, this.material); this.rear.position.set(0, 0.34, -0.56);
    this.front = new THREE.Mesh(wheel, this.material); this.front.position.set(0, 0.34 - 0.88, 0.57 - 0.4);
    const steerFork = fork.clone().translate(0, -0.88, -0.4); this.assets.push(steerFork);
    this.steering.position.set(0, 0.88, 0.4);
    this.steering.add(new THREE.Mesh(steerFork, this.material), this.front);
    this.crank = new THREE.Mesh(pedals, this.material); this.crank.position.set(0, 0.36, -0.06);
    this.ridden.add(frameMesh, this.rear, this.steering, this.crank);
    this.ridden.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.ridden.visible = false;
    this.group.add(this.parked, this.ridden);
  }

  /** Reusing a building's record prevents repeated indoor visits from duplicating its bicycle. */
  provide(record: ParkedBicycle) {
    const current = this.records.get(record.id);
    if (current) Object.assign(current, record); else this.records.set(record.id, record);
    return current ?? record;
  }
  nearest(x: number, y: number, radius = 2.8): ParkedBicycle | null {
    let near: ParkedBicycle | null = null;
    for (const bike of this.records.values()) {
      if (bike === this.active) continue;
      const distance = Math.hypot(bike.x - x, bike.y - y);
      if (distance < radius) { near = bike; radius = distance; }
    }
    return near;
  }
  sync(x: number, y: number) {
    const visible = [...this.records.values()].filter(b => b !== this.active && Math.hypot(b.x - x, b.y - y) < 180)
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)).slice(0, VISIBLE_BICYCLES);
    this.parked.count = visible.length;
    visible.forEach((b, i) => {
      this.position.set(b.x, b.z, -b.y);
      this.quaternion.setFromEuler(this.euler.set(0, Math.atan2(Math.cos(b.heading), -Math.sin(b.heading)), -0.075));
      this.parked.setMatrixAt(i, this.matrix.compose(this.position, this.quaternion, this.scale));
    });
    this.parked.instanceMatrix.needsUpdate = true;
  }
  ride(bike: ParkedBicycle | null) { this.active = bike; this.ridden.visible = !!bike; }
  update(distance: number, steer: number, speed: number) {
    const b = this.active; if (!b) return;
    this.wheelTurn += distance / WHEEL_RADIUS;
    this.ridden.position.set(b.x, b.z, -b.y);
    this.ridden.rotation.set(0, Math.atan2(Math.cos(b.heading), -Math.sin(b.heading)), -steer * Math.min(speed / 10, 1) * 0.45);
    this.rear.rotation.x = this.front.rotation.x = this.wheelTurn;
    this.steering.rotation.y = -steer;
    this.crank.rotation.x = this.wheelTurn / 2.8;
  }
  dispose() { this.group.removeFromParent(); this.records.clear(); this.active = null; this.parked.dispose(); this.assets.forEach(g => g.dispose()); this.material.dispose(); }
}
