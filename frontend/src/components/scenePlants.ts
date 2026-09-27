import * as THREE from "three";
import type { Planting } from "./complexScene";
import { rng, seasonNow } from "./complexScene";

/* Landscaping plants as photoreal impostors. /3d/plants.webp is an atlas baked from
 * Poly Haven's CC0 photoscanned plants (trees, conifers, shrubs, flowers; one cell
 * per variant from the side, and from above for the larger ones). Each plant is
 * three crossed alpha-tested cards plus a canopy card, with normals bent outward
 * like a rounded crown so they light as volumes. Every plant of a complex is baked
 * into one static mesh: the whole landscape is a single draw (plus shadows). */

type Kind = "tree" | "conifer" | "shrub" | "flower";
interface Cell { kind: Kind; side: number; top: number; span: number; topSpan: number; groundV: number; height: number; width: number }
interface Atlas { cell: number; cols: number; rows: number; assets: Cell[] }

let atlas: Promise<{ meta: Atlas; texture: THREE.Texture }> | null = null;
function loadAtlas() {
  atlas ??= Promise.all([
    fetch("/3d/plants.json").then(r => { if (!r.ok) throw new Error("plants.json " + r.status); return r.json() as Promise<Atlas>; }),
    new THREE.TextureLoader().loadAsync("/3d/plants.webp"),
  ]).then(([meta, texture]) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.anisotropy = 8;
    texture.flipY = true;
    return { meta, texture };
  });
  atlas.catch(() => { atlas = null; });
  return atlas;
}

/** Target heights in metres (min, max) for each kind; the bake keeps each model's own proportions. */
const HEIGHT: Record<Kind, [number, number]> = { tree: [6.5, 11], conifer: [4.5, 8], shrub: [0.9, 2], flower: [0.25, 0.45] };

export async function buildPlants(planting: Planting, seed: number): Promise<{ mesh: THREE.Mesh; dispose: () => void } | null> {
  const { meta, texture } = await loadAtlas();
  const rnd = rng(seed + 11);
  const season = seasonNow();
  const byKind = (k: Kind) => meta.assets.filter(a => a.kind === k);
  const trees = [...byKind("tree"), ...byKind("tree"), ...byKind("conifer")]; // broadleaf twice as common
  const shrubs = byKind("shrub"), flowers = byKind("flower");
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [];
  const cellUV = (k: number) => {
    const u0 = (k % meta.cols) / meta.cols, v1 = 1 - Math.floor(k / meta.cols) / meta.rows;
    return [u0, v1 - 1 / meta.rows, u0 + 1 / meta.cols, v1];
  };
  const pad = 0.5 / meta.cell;
  const tint = new THREE.Color();
  const add = (x: number, z: number, c: Cell, h: number) => {
    const k = h / c.height, span = c.span * k, base = c.groundV * span;
    const yaw = rnd() * Math.PI;
    const cy = h * 0.55;
    // Crown tint: species variety plus the season (autumn warms, winter dulls broadleaf).
    const v = 0.86 + rnd() * 0.24;
    tint.setRGB(v, v * (0.97 + rnd() * 0.06), v * (0.92 + rnd() * 0.08));
    if (c.kind === "tree" && season === "autumn" && rnd() < 0.7) tint.multiply(new THREE.Color(1.25, 0.9, 0.55));
    if (c.kind === "tree" && season === "winter") tint.multiply(new THREE.Color(0.85, 0.8, 0.72));
    const [u0, v0, u1, v1] = cellUV(c.side);
    const quad = (p: number[][], uvs: number[][]) => {
      // Both windings, front faces only: the back face keeps the outward crown normal
      // instead of the flipped one a double-sided material would give it.
      for (const i of [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]) {
        const [px, py, pz] = p[i];
        pos.push(px, py, pz);
        // Rounded-crown normal: outward from the crown centre, biased up.
        const n = new THREE.Vector3(px - x, (py - cy) * 0.6 + h * 0.35, pz - z).normalize();
        nor.push(n.x, n.y, n.z);
        uv.push(uvs[i][0], uvs[i][1]);
        col.push(tint.r, tint.g, tint.b);
      }
    };
    for (let j = 0; j < 3; j++) {
      const a = yaw + (j * Math.PI) / 3, dx = Math.cos(a) * span / 2, dz = Math.sin(a) * span / 2;
      const y0 = -base, y1 = span - base;
      quad([[x - dx, y0, z - dz], [x + dx, y0, z + dz], [x + dx, y1, z + dz], [x - dx, y1, z - dz]],
        [[u0 + pad, v0 + pad], [u1 - pad, v0 + pad], [u1 - pad, v1 - pad], [u0 + pad, v1 - pad]]);
    }
    if (c.top >= 0) {
      const [t0, w0, t1, w1] = cellUV(c.top), r = c.topSpan * k / 2, y = h * (c.kind === "shrub" ? 0.8 : 0.66);
      const ca = Math.cos(yaw) * r, sa = Math.sin(yaw) * r;
      quad([[x - ca + sa, y, z - sa - ca], [x + ca + sa, y, z + sa - ca], [x + ca - sa, y, z + sa + ca], [x - ca - sa, y, z - sa + ca]],
        [[t0 + pad, w0 + pad], [t1 - pad, w0 + pad], [t1 - pad, w1 - pad], [t0 + pad, w1 - pad]]);
    }
  };
  const pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)];
  const size = (kind: Kind) => { const [a, b] = HEIGHT[kind]; return a + (b - a) * rnd(); };
  // Footprint frame (x east, y north) to world (x, -z).
  for (const [x, y] of planting.trees) { const c = pick(trees); add(x, -y, c, size(c.kind)); }
  for (const [x, y] of planting.shrubs) { const c = pick(shrubs); add(x, -y, c, size("shrub")); }
  for (const [x, y] of planting.flowers) { const c = pick(flowers); add(x, -y, c, size("flower")); }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ map: texture, alphaTest: 0.32, side: THREE.FrontSide, vertexColors: true, roughness: 0.85, metalness: 0 });
  mat.userData.foliage = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  // The atlas stays cached for the next complex; only this complex's geometry goes.
  return { mesh, dispose: () => { geo.dispose(); mat.dispose(); } };
}
