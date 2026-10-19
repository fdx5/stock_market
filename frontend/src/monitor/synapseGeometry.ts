import * as THREE from "three";
import { hash, type SynapseGraph } from "./synapseModel";
// Curve tessellation runs off the UI thread, including the initial scene.
export function buildGeometry(graph: SynapseGraph) {
  const divisions = graph.links.length > 12000 ? 10 : 20;
    const { nodes, links } = graph, count = links.length * divisions * 2;
    const pos = new Float32Array(count * 3), colors = new Float32Array(count * 3), along = new Float32Array(count);
    const packets = links.length * 4;
    const pp = [0, 1, 2, 3].map(() => new Float32Array(packets * 3));
    const pc = new Float32Array(packets * 3), offsets = new Float32Array(packets);
    const v = new THREE.Vector3();
    links.forEach((e, i) => {
      const a = new THREE.Vector3(...nodes[e.source].position), b = new THREE.Vector3(...nodes[e.target].position);
      const mid = a.clone().add(b).multiplyScalar(.5), length = a.distanceTo(b);
      // Twisted axons lift above and below the cluster plane, with stable geometry.
      const bend = new THREE.Vector3(-mid.y, mid.x, (hash(e.id) - .5) * 260).normalize().multiplyScalar(Math.min(95, length * .27));
      const c = a.clone().lerp(b, .32).add(bend), d = a.clone().lerp(b, .68).add(bend);
      const curve = new THREE.CubicBezierCurve3(a, c, d, b);
      const color = new THREE.Color(nodes[e.target].color);
      if (e.kind === "structure") color.multiplyScalar(.64);
      for (let j = 0; j < divisions; j++) for (let k = 0; k < 2; k++) {
        const at = i * divisions * 2 + j * 2 + k, t = (j + k) / divisions;
        curve.getPoint(t, v); v.toArray(pos, at * 3); color.toArray(colors, at * 3); along[at] = t;
      }
      for (let k = 0; k < 4; k++) { const at = i * 4 + k; [a,c,d,b].forEach((p,n) => p.toArray(pp[n], at * 3)); color.toArray(pc, at * 3); offsets[at] = k * .025; }
    });
    const np = new Float32Array(nodes.length * 3), nc = new Float32Array(nodes.length * 3), ns = new Float32Array(nodes.length);
    nodes.forEach((n, i) => { np.set(n.position, i * 3); new THREE.Color(n.color).toArray(nc, i * 3); ns[i] = n.kind === "core" ? 47 : n.kind === "service" ? 27 : n.parent ? n.kind === "api" ? 7 : 4 : 15; });
  return { divisions, pos, colors, along, pp, pc, offsets, np, nc, ns };
}
export type SynapseGeometry = ReturnType<typeof buildGeometry>;
