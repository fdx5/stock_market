import * as THREE from "three";

/* Street lamps along the drone tiles' sidewalks, at night only.
 *
 * The view's own roads have their lamps (sceneStreet.buildLamps); the tiles round it — the
 * kilometre or two the drone sees — had none, so the city went dark past the complex after
 * sunset. From the drone's height a lamp is its lit head: one instanced mesh a tile (the heads,
 * a translation each), made when night falls for the tiles within reach and freed by day or
 * with the tile, so the day's frame carries none of it. The glow round each head is the
 * renderer's bloom of its emissive. */

const head = new THREE.BoxGeometry(0.55, 0.9, 0.2);
head.translate(0, 0, 8.8);   // (the tile frame: z up; the head on its 9 m pole)
const headMat = new THREE.MeshStandardMaterial({ color: "#e9e4da", emissive: "#ffd29a", emissiveIntensity: 0, roughness: 0.35 });
headMat.userData.droneLamp = true;
// The pool of light each throws on the street: what reads from the drone's height at night (the
// head itself is under a pixel there). A disc with a soft radial edge, warm, added over the ground.
let poolTex: THREE.CanvasTexture | null = null;
function poolTexture() {
  if (poolTex) return poolTex;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d")!, r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.35, "rgba(255,255,255,0.55)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  poolTex = new THREE.CanvasTexture(c); poolTex.colorSpace = THREE.SRGBColorSpace;
  return poolTex;
}
const pool = new THREE.CircleGeometry(8, 20);
pool.translate(0, 0, 0.35);
let poolMat: THREE.MeshStandardMaterial | null = null;
function poolMaterial() {
  if (poolMat) return poolMat;
  const t = poolTexture();
  poolMat = new THREE.MeshStandardMaterial({ color: "#000000", map: t, emissive: "#ffb46b", emissiveMap: t, emissiveIntensity: 0, transparent: true, opacity: 0.85, depthWrite: false, roughness: 1, metalness: 0 });
  poolMat.polygonOffset = true; poolMat.polygonOffsetFactor = -2;
  poolMat.userData.droneLamp = true;
  poolMat.emissiveIntensity = level * 0.55;
  return poolMat;
}
let level = 0;

/** The look's lamp level (0 by day, ~1.6 at night: Look.lamps). */
export function setDroneLampLevel(l: number) {
  level = l;
  headMat.emissiveIntensity = l * 9;
  if (poolMat) poolMat.emissiveIntensity = l * 0.55;
}
/** Whether the tiles' lamps are wanted now. */
export const droneLampsOn = () => level > 0.25;

/** A tile's lamps along its sidewalks' middle lines ([n, x, y, …]…, view frame), every `spacing`
 * metres, standing on `at`. Null when it has none. */
export function tileLamps(paths: Float32Array, at: (x: number, y: number) => number, spacing = 34, max = 700): THREE.Group | null {
  const pts: number[] = [];
  for (let i = 0; i < paths.length && pts.length < max * 3;) {
    const n = paths[i++];
    let carry = spacing * 0.5;
    for (let k = 1; k < n; k++) {
      const ax = paths[i + (k - 1) * 2], ay = paths[i + (k - 1) * 2 + 1], bx = paths[i + k * 2], by = paths[i + k * 2 + 1];
      const len = Math.hypot(bx - ax, by - ay);
      let s = carry;
      for (; s <= len && pts.length < max * 3; s += spacing) {
        const x = ax + (bx - ax) * (s / len), y = ay + (by - ay) * (s / len), z = at(x, y);
        if (Number.isFinite(z)) pts.push(x, y, z);
      }
      carry = s - len;
    }
    i += n * 2;
  }
  if (!pts.length) return null;
  const group = new THREE.Group();
  group.name = "drone tile lamps";
  const m = new THREE.Matrix4();
  for (const [geo, mat] of [[head, headMat], [pool, poolMaterial()]] as const) {
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length / 3);
    for (let k = 0; k < pts.length / 3; k++) mesh.setMatrixAt(k, m.makeTranslation(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2]));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.name = mat === headMat ? "drone tile lamp heads" : "drone tile lamp pools";
    if (mat !== headMat) mesh.renderOrder = 2;
    mesh.raycast = () => {};
    group.add(mesh);
  }
  return group;
}
