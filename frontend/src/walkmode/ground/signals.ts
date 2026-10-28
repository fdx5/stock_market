import * as THREE from "three";
import type { Traffic } from "../../drivegame/traffic/Traffic";

/* The traffic lights at the signalled junctions round the walk, lit as the traffic obeys them
 * (Traffic.light: the same clock and phases the cars stop for). One for each approach: a steel pole
 * on the pavement at the right of the stop line, an arm out over the lanes, a horizontal Korean
 * head of three lenses (red, amber, green, left to right as the driver sees them) facing the
 * oncoming cars. Every part instanced — six draws for every light within 230 m. */

const CAP = 256, NEAR = 230;
interface Head { node: number; key: string; m: THREE.Matrix4 }

export class SignalHeads {
  readonly group = new THREE.Group();
  private pole: THREE.InstancedMesh; private arm: THREE.InstancedMesh; private box: THREE.InstancedMesh;
  private lamps: THREE.InstancedMesh[];
  private heads: Head[] = [];
  private at = { x: 1e9, y: 0 }; private version = -1; private t = 0;
  private geos: THREE.BufferGeometry[] = []; private mats: THREE.Material[] = [];
  private pt = { x: 0, y: 0, h: 0, ux: 0, uy: 0 };
  private static ON = [new THREE.Color(3.2, 0.25, 0.15), new THREE.Color(3.0, 1.7, 0.1), new THREE.Color(0.2, 2.6, 1.3)];
  private static OFF = [new THREE.Color(0.09, 0.03, 0.03), new THREE.Color(0.09, 0.07, 0.02), new THREE.Color(0.02, 0.08, 0.06)];

  constructor(private traffic: Traffic, private ground: (x: number, y: number) => number) {
    const steel = new THREE.MeshStandardMaterial({ color: "#8c939a", roughness: 0.42, metalness: 0.8 });
    const housing = new THREE.MeshStandardMaterial({ color: "#1d2124", roughness: 0.55, metalness: 0.3 });
    const lamp = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
    this.mats.push(steel, housing, lamp);
    // (in the head's frame: x along the arm, y up, the lenses on the face toward the oncoming cars)
    const poleG = new THREE.CylinderGeometry(0.1, 0.13, 6.2, 10).translate(0, 3.1, 0);
    const armG = new THREE.CylinderGeometry(0.06, 0.08, 1, 8).rotateZ(Math.PI / 2).translate(-0.5, 0, 0);
    const boxG = new THREE.BoxGeometry(1.36, 0.42, 0.28);
    // a lens with its visor: the lit disc set in the housing's face
    const lensG = new THREE.CircleGeometry(0.13, 18).rotateY(Math.PI).translate(0, 0, -0.145);
    this.geos.push(poleG, armG, boxG, lensG);
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, shadow: boolean) => {
      const im = new THREE.InstancedMesh(g, m, CAP); im.count = 0; im.frustumCulled = false; im.castShadow = shadow; im.receiveShadow = shadow;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(im); return im;
    };
    this.pole = mk(poleG, steel, true); this.arm = mk(armG, steel, true); this.box = mk(boxG, housing, true);
    this.lamps = [0, 1, 2].map(() => { const im = mk(lensG, lamp, false); im.setColorAt(0, new THREE.Color()); return im; });
  }

  /** every quarter second: the heads near (x, y) placed when the walker has moved or the roads
   * changed; their lamps lit to the signals' state */
  update(dt: number, x: number, y: number) {
    this.t -= dt; if (this.t > 0) return; this.t = 0.25;
    const g = this.traffic.graph;
    if (Math.hypot(x - this.at.x, y - this.at.y) > 40 || g.version !== this.version) { this.at = { x, y }; this.version = g.version; this.place(x, y); }
    const off = SignalHeads.OFF;
    for (let i = 0; i < this.heads.length; i++) {
      const s = this.traffic.light(this.heads[i].node, this.heads[i].key), k = s === "red" ? 0 : s === "yellow" ? 1 : 2;
      for (let l = 0; l < 3; l++) this.lamps[l].setColorAt(i, l === k ? SignalHeads.ON[l] : off[l]);
    }
    for (const l of this.lamps) if (l.instanceColor) l.instanceColor.needsUpdate = true;
  }

  private place(x: number, y: number) {
    const g = this.traffic.graph, heads: Head[] = [], q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const tmp = new THREE.Matrix4(), off = new THREE.Matrix4(), p = new THREE.Vector3();
    let n = 0;
    for (const nd of g.nodes) {
      if (!nd || !nd.alive || !nd.signal || Math.hypot(nd.x - x, nd.y - y) > NEAR) continue;
      for (const end of nd.ends) {
        if (n >= CAP) break;
        const e = g.edges[end.edge]; if (!e || !e.alive || e.len < 12) continue;
        // the stop line of the approach into this node, and the way the cars come
        const s = end.atA ? e.trimA : e.len - e.trimB;
        g.at(e, Math.max(0, Math.min(e.len, s)), this.pt);
        const ux = end.atA ? -this.pt.ux : this.pt.ux, uy = end.atA ? -this.pt.uy : this.pt.uy;
        const rx = uy, ry = -ux;                       // the right of the approaching car
        const half = e.w / 2, px = this.pt.x + rx * (half + 1.3), py = this.pt.y + ry * (half + 1.3);
        const z = this.ground(px, py);
        if (!Number.isFinite(z)) continue;
        const arm = Math.min(Math.max(half * 0.9, 3), 8);
        // the frame: x toward the road (−right), y up, z the way the cars go (the face at −z meets them)
        const xa = new THREE.Vector3(-rx, 0, ry), za = new THREE.Vector3(ux, 0, -uy), ya = up;
        const basis = new THREE.Matrix4().makeBasis(xa, ya, za);
        q.setFromRotationMatrix(basis);
        const base = new THREE.Matrix4().compose(p.set(px, z, -py), q, one);
        this.pole.setMatrixAt(n, base);
        this.arm.setMatrixAt(n, tmp.copy(base).multiply(off.makeTranslation(0, 5.75, 0)).multiply(new THREE.Matrix4().makeScale(-arm, 1, 1)));
        const head = tmp.copy(base).multiply(off.makeTranslation(arm - 0.9, 5.75, -0.05));
        this.box.setMatrixAt(n, head);
        for (let l = 0; l < 3; l++) this.lamps[l].setMatrixAt(n, head.clone().multiply(off.makeTranslation(-0.42 + l * 0.42, 0, 0)));
        heads.push({ node: nd.idx, key: `${end.edge}:${end.atA ? "a" : "b"}`, m: head.clone() });
        n++;
      }
    }
    this.heads = heads;
    for (const im of [this.pole, this.arm, this.box, ...this.lamps]) { im.count = n; im.instanceMatrix.needsUpdate = true; }
  }

  dispose() { this.geos.forEach(g => g.dispose()); this.mats.forEach(m => m.dispose()); this.group.clear(); }
}
