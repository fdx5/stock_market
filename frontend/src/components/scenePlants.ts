import * as THREE from "three";
import type { Planting } from "./complexScene";
import { rng, seasonNow } from "./complexScene";
import { FLAT, type Terrain } from "./sceneTerrain";
import { KERB_H } from "./sceneSidewalk";
import { gpuCaps } from "./gpuCaps";

/* Landscaping plants as photoreal impostors. /3d/plants.webp is an atlas baked from
 * Poly Haven's CC0 photoscanned plants (trees, conifers, shrubs, flowers; one cell
 * per variant from the side, and from above for the larger ones). Each plant is
 * three crossed alpha-tested cards plus a canopy card, with normals bent outward
 * like a rounded crown so they light as volumes. Every plant of a complex is baked
 * into one static mesh: the whole landscape is a single draw (plus shadows). */

// tree: broadleaf; smalltree: a smaller, lighter deciduous; pine and fir: full-grown
// conifers (Poly Haven CC0, baked by scripts/bake-plants.py); conifer: saplings.
type Kind = "tree" | "smalltree" | "pine" | "fir" | "conifer" | "shrub" | "flower";
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
  }).then(async got => {
    // Where the WebGPU view reads BC textures: the atlas pre-compressed (scripts/plants-bc7.py).
    if (gpuCaps.bc) got.texture.userData.compressed = await compressedAtlas().catch(() => null);
    return got;
  });
  atlas.catch(() => { atlas = null; });
  return atlas;
}

/** plants.bc7.gz: 'BC7A', u32 header length, JSON header, then every mip level's blocks. */
async function compressedAtlas() {
  const res = await fetch("/3d/plants.bc7.gz");
  if (!res.ok) return null;
  let buf = new Uint8Array(await res.arrayBuffer());
  // Still gzipped, unless the server already undid it (Content-Encoding).
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") return null;
    buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  }
  if (String.fromCharCode(...buf.subarray(0, 4)) !== "BC7A") return null;
  const n = new DataView(buf.buffer).getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + n))) as { width: number; height: number; levels: [number, number, number, number][] };
  const base = 8 + n;
  return {
    format: "bc7-rgba-unorm-srgb", width: head.width, height: head.height,
    levels: head.levels.map(([w, h, off, len]) => ({ w, h, data: buf.subarray(base + off, base + off + len) })),
  };
}

/** Start loading the plant atlas early (it is cached for every complex after). */
export function preloadPlants() { void loadAtlas().catch(() => {}); }

/** Target heights in metres (min, max) for each kind; the bake keeps each model's own proportions. */
const HEIGHT: Record<Kind, [number, number]> = { tree: [6.5, 11], smalltree: [4, 6.5], pine: [5.5, 9], fir: [6, 10], conifer: [4.5, 8], shrub: [0.9, 2], flower: [0.25, 0.45] };
/** Landscaping mix (Korean apartment grounds: broadleaf, pine, small ornamentals, conical conifers). */
const MIX: [Kind, number][] = [["tree", 0.34], ["pine", 0.3], ["smalltree", 0.2], ["fir", 0.16]];
/** Crown card height (fraction of the tree): where the crown is widest seen from above. */
const TOP_AT: Partial<Record<Kind, number>> = { shrub: 0.8, pine: 0.78, fir: 0.42 };
const DECIDUOUS = new Set<Kind>(["tree", "smalltree"]);

export async function buildPlants(planting: Planting, seed: number, terrain: Terrain = FLAT): Promise<{ mesh: THREE.Mesh; dispose: () => void } | null> {
  const { meta, texture } = await loadAtlas();
  const rnd = rng(seed + 11);
  const season = seasonNow();
  const byKind = (k: Kind) => meta.assets.filter(a => a.kind === k);
  // Species planted in groups, as landscapers do: one species per ~14 m patch.
  const species = MIX.filter(([k]) => byKind(k).length);
  const speciesAt = (x: number, y: number) => {
    const h = rng(seed * 7 + Math.floor(x / 14) * 7919 + Math.floor(y / 14) * 104729)();
    let r = h * species.reduce((a, [, w]) => a + w, 0);
    for (const [k, w] of species) { r -= w; if (r <= 0) return k; }
    return species[0]?.[0] ?? "tree";
  };
  const trees = byKind("tree");
  const shrubs = byKind("shrub"), flowers = byKind("flower");
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [];
  const cellUV = (k: number) => {
    const u0 = (k % meta.cols) / meta.cols, v1 = 1 - Math.floor(k / meta.cols) / meta.rows;
    return [u0, v1 - 1 / meta.rows, u0 + 1 / meta.cols, v1];
  };
  const pad = 0.5 / meta.cell;
  const tint = new THREE.Color();
  const add = (x: number, z: number, c: Cell, h: number, ground: number, fixedTint?: THREE.Color) => {
    const k = h / c.height, span = c.span * k, base = c.groundV * span - ground;
    const yaw = rnd() * Math.PI;
    const cy = ground + h * 0.55;
    // Crown tint: species variety plus the season (autumn warms, winter dulls broadleaf).
    const v = 0.86 + rnd() * 0.24;
    if (fixedTint) tint.copy(fixedTint).multiplyScalar(0.97 + rnd() * 0.06);
    else tint.setRGB(v, v * (0.97 + rnd() * 0.06), v * (0.92 + rnd() * 0.08));
    // The photoscanned pine and fir needles are darker than the broadleaf cells.
    if (c.kind === "pine") tint.multiply(new THREE.Color(1.2, 1.42, 1.12));
    if (c.kind === "fir") tint.multiplyScalar(1.15);
    if (DECIDUOUS.has(c.kind) && season === "autumn" && rnd() < 0.7) tint.multiply(c.kind === "smalltree" ? new THREE.Color(1.35, 0.7, 0.45) : new THREE.Color(1.25, 0.9, 0.55));
    if (DECIDUOUS.has(c.kind) && season === "winter") tint.multiply(new THREE.Color(0.85, 0.8, 0.72));
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
      const [t0, w0, t1, w1] = cellUV(c.top), r = c.topSpan * k / 2, y = ground + h * (TOP_AT[c.kind] ?? 0.66);
      const ca = Math.cos(yaw) * r, sa = Math.sin(yaw) * r;
      quad([[x - ca + sa, y, z - sa - ca], [x + ca + sa, y, z + sa - ca], [x + ca - sa, y, z + sa + ca], [x - ca - sa, y, z - sa + ca]],
        [[t0 + pad, w0 + pad], [t1 - pad, w0 + pad], [t1 - pad, w1 - pad], [t0 + pad, w1 - pad]]);
    }
  };
  const pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)];
  const size = (kind: Kind) => { const [a, b] = HEIGHT[kind]; return a + (b - a) * rnd(); };
  // Footprint frame (x east, y north) to world (x, -z).
  const at = (x: number, y: number) => terrain.at(x, y);
  for (const [x, y] of planting.trees) { const c = pick(byKind(speciesAt(x, y))); add(x, -y, c, size(c.kind), at(x, y)); }
  for (const [x, y] of planting.shrubs) { const c = pick(shrubs); add(x, -y, c, size("shrub"), at(x, y)); }
  for (const [x, y] of planting.flowers) { const c = pick(flowers); add(x, -y, c, size("flower"), at(x, y)); }
  // Street trees: one broadleaf species, size and tone per road (planted together),
  // standing in their pits on the sidewalk.
  const broadleaf = byKind("tree");
  const perRoad = new Map<number, { c: Cell; h: number; tint: THREE.Color }>();
  for (const [x, y, road] of planting.street) {
    let spec = perRoad.get(road);
    if (!spec) {
      const r2 = rng(seed * 31 + road * 977);
      const c = broadleaf[Math.floor(r2() * broadleaf.length)] ?? pick(trees);
      const t = new THREE.Color(0.95 + r2() * 0.1, 0.97 + r2() * 0.06, 0.92 + r2() * 0.06);
      if (season === "autumn") t.multiply(new THREE.Color(1.25, 0.95, 0.5));
      if (season === "winter") t.multiply(new THREE.Color(0.85, 0.8, 0.72));
      spec = { c, h: 7.2 + r2() * 2.2, tint: t };
      perRoad.set(road, spec);
    }
    add(x, -y, spec.c, spec.h * (0.96 + rnd() * 0.08), at(x, y) + KERB_H, spec.tint);
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ map: texture, alphaTest: 0.32, side: THREE.FrontSide, vertexColors: true, roughness: 0.85, metalness: 0 });
  mat.userData.foliage = true;
  mat.userData.atlasCells = meta.cols;
  // Cards thin out as they turn edge-on to the eye, and the upright ones as the eye looks
  // steeply down (twin of the WebGPU view's fade): no flat slabs from the side, no
  // snowflake of squashed cards round the trunk from above.
  mat.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <alphatest_fragment>", `
      { vec3 ng = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition))); vec3 v = normalize(vViewPosition);
        vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        float upright = 1.0 - abs(dot(ng, up));
        diffuseColor.a *= smoothstep(0.14, 0.46, abs(dot(ng, v))) * mix(1.0, 1.0 - smoothstep(0.5, 0.78, abs(dot(v, up))), upright);
        vec2 cell = fract(vMapUv * ${meta.cols.toFixed(1)});
        float side = smoothstep(0.0, 0.12, min(min(cell.x, 1.0 - cell.x), 1.0 - cell.y));
        float crownEdge = 1.0 - smoothstep(0.78, 1.0, length(cell - 0.5) * 2.0);
        diffuseColor.a *= upright > 0.5 ? side : crownEdge; }
      #include <alphatest_fragment>`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  // The atlas stays cached for the next complex; only this complex's geometry goes.
  return { mesh, dispose: () => { geo.dispose(); mat.dispose(); } };
}
