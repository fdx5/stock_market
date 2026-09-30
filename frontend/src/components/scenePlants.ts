import * as THREE from "three";
import type { Planting } from "./complexScene";
import { rng, seasonNow } from "./complexScene";
import { FLAT, type Terrain } from "./sceneTerrain";
import { KERB_H } from "./sceneSidewalk";
import { gpuCaps } from "./gpuCaps";
import { Forest, loadTreeKit, preloadTrees } from "./sceneTrees";

/* Landscaping plants as photoreal impostors. /3d/plants.webp is an atlas baked from
 * Poly Haven's CC0 photoscanned plants (trees, conifers, shrubs, flowers; one cell
 * per variant from the side, and from above for the larger ones). Each plant is
 * three crossed alpha-tested cards plus a canopy card, with normals bent outward
 * like a rounded crown so they light as volumes. Every plant of a complex is baked
 * into one static mesh: the whole landscape is a single draw (plus shadows). */

// tree: broadleaf; smalltree: a smaller, lighter deciduous; pine and fir: full-grown
// conifers (Poly Haven CC0, baked by scripts/bake-plants.py); conifer: saplings.
/** street: the Korean street-tree species grown for the atlas (gen-street-trees.py); the name's
 * prefix is the species (ginkgo, zelkova, cherry, plane, fringe). */
type Kind = "tree" | "smalltree" | "pine" | "fir" | "conifer" | "shrub" | "flower" | "street";
interface Cell { name?: string; kind: Kind; side: number; top: number; span: number; topSpan: number; groundV: number; height: number; width: number }
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
    // Where the WebGPU view reads BC (desktops) or ETC2 (phones, tablets): the atlas
    // pre-compressed (scripts/plants-bc7.py), a quarter of the memory.
    if (gpuCaps.bc || gpuCaps.etc2) got.texture.userData.compressed = await compressedAtlas(gpuCaps.bc ? "bc7" : "etc2").catch(() => null);
    return got;
  });
  atlas.catch(() => { atlas = null; });
  return atlas;
}

/** plants.bc7.gz / plants.etc2.gz: 'BC7A' / 'ETC2', u32 header length, JSON header, then
 * every mip level's blocks. */
async function compressedAtlas(kind: "bc7" | "etc2") {
  const res = await fetch(`/3d/plants.${kind}.gz`);
  if (!res.ok) return null;
  let buf = new Uint8Array(await res.arrayBuffer());
  // Still gzipped, unless the server already undid it (Content-Encoding).
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") return null;
    buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  }
  if (String.fromCharCode(...buf.subarray(0, 4)) !== (kind === "bc7" ? "BC7A" : "ETC2")) return null;
  const n = new DataView(buf.buffer).getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + n))) as { width: number; height: number; levels: [number, number, number, number][] };
  const base = 8 + n;
  return {
    format: kind === "bc7" ? "bc7-rgba-unorm-srgb" : "etc2-rgba8unorm-srgb", width: head.width, height: head.height,
    levels: head.levels.map(([w, h, off, len]) => ({ w, h, data: buf.subarray(base + off, base + off + len) })),
  };
}

/** Start loading the plant atlas early (it is cached for every complex after). */
/** The plant meshes load early; the card atlas only if they can't (it is 5 MB). */
export function preloadPlants() { preloadTrees(); }

/** Target heights in metres (min, max) for each kind; the bake keeps each model's own proportions. */
const HEIGHT: Record<Kind, [number, number]> = { street: [7, 11], tree: [6.5, 11], smalltree: [4, 6.5], pine: [5.5, 9], fir: [6, 10], conifer: [4.5, 8], shrub: [0.9, 2], flower: [0.25, 0.45] };
/** Landscaping mix (Korean apartment grounds: broadleaf, pine, small ornamentals, conical conifers). */
const MIX: [Kind, number][] = [["tree", 0.34], ["pine", 0.3], ["smalltree", 0.2], ["fir", 0.16]];
/** Crown card height (fraction of the tree): where the crown is widest seen from above. */
const TOP_AT: Partial<Record<Kind, number>> = { shrub: 0.8, pine: 0.78, fir: 0.42 };
const DECIDUOUS = new Set<Kind>(["tree", "smalltree", "street"]);

/** Species shares and each one's autumn colour. */
const STREET_SHARE: Record<string, number> = { ginkgo: 0.3, zelkova: 0.24, cherry: 0.2, plane: 0.14, fringe: 0.12 };
const AUTUMN_OF: Record<string, [number, number, number]> = { ginkgo: [2.1, 1.55, 0.35], zelkova: [1.5, 0.95, 0.45], cherry: [1.7, 0.75, 0.45], plane: [1.35, 1.05, 0.55], fringe: [1.3, 1.0, 0.55], azalea: [1.5, 0.8, 0.55], spindle: [1.0, 1.0, 1.0] };
const EVERGREEN = new Set(["pine", "conifer", "boxwood", "spindle"]);

/** The landscape as meshes: park trees in species groups, one street-tree species per road,
 * shrubs (azalea, boxwood, spindle) and flower beds. */
function plantForest(planting: Planting, seed: number, terrain: Terrain, forest: Forest) {
  const rnd = rng(seed + 11);
  const season = seasonNow();
  const at = (x: number, y: number) => terrain.at(x, y);
  const tint = (species: string, base = 1) => {
    const v = (0.9 + rnd() * 0.2) * base, t = new THREE.Color(v, v * (0.97 + rnd() * 0.06), v * (0.92 + rnd() * 0.08));
    if (!EVERGREEN.has(species) && season === "autumn") t.multiply(new THREE.Color(...(AUTUMN_OF[species] ?? [1.25, 0.95, 0.5])));
    if (!EVERGREEN.has(species) && season === "winter") t.multiply(new THREE.Color(0.85, 0.8, 0.72));
    return t;
  };
  // The complex's own grounds are the centre of the view: the distance bands count from them.
  if (planting.trees.length) {
    const cx = planting.trees.reduce((t, [x]) => t + x, 0) / planting.trees.length, cy = planting.trees.reduce((t, [, y]) => t + y, 0) / planting.trees.length;
    forest.centre.set(cx, -cy);
  }
  // Park trees: groups of one species per ~14 m patch, as landscapers plant them.
  const PARK: [string, number, [number, number]][] = [["zelkova", 0.2, [7, 11]], ["pine", 0.28, [5.5, 9]], ["cherry", 0.14, [5, 8]], ["plane", 0.08, [8, 12]],
    ["ginkgo", 0.08, [7, 10]], ["fringe", 0.1, [4.5, 7]], ["conifer", 0.12, [4, 7]]];
  const total = PARK.reduce((t, [, w]) => t + w, 0);
  for (const [x, y] of planting.trees) {
    let r = rng(seed * 7 + Math.floor(x / 14) * 7919 + Math.floor(y / 14) * 104729)() * total;
    const [species, , [h0, h1]] = PARK.find(([, w]) => (r -= w) <= 0) ?? PARK[0];
    forest.add(species, x, at(x, y), -y, h0 + rnd() * (h1 - h0), rnd() * Math.PI * 2, tint(species), rnd());
  }
  // Street trees: one species, size and tone per road; the variants alternate.
  const street = Object.keys(STREET_SHARE).filter(k => forest.has(k));
  const perRoad = new Map<number, { species: string; h: number; t: THREE.Color; n: number }>();
  for (const [x, y, road] of planting.street) {
    let spec = perRoad.get(road);
    if (!spec) {
      const r2 = rng(seed * 31 + road * 977);
      let r = r2() * street.reduce((t, k) => t + STREET_SHARE[k], 0);
      const species = street.find(k => (r -= STREET_SHARE[k]) <= 0) ?? street[0];
      spec = { species, h: 7 + r2() * 4, t: tint(species), n: 0 };
      perRoad.set(road, spec);
    }
    forest.add(spec.species, x, at(x, y) + KERB_H, -y, spec.h * (0.94 + rnd() * 0.12), rnd() * Math.PI * 2, spec.t.clone().multiplyScalar(0.97 + rnd() * 0.06), (spec.n++ % 3) / 3 + 0.01);
  }
  // Shrubs: patches of one kind (azalea mounds, boxwood balls, spindle hedging).
  const SHRUB: [string, [number, number]][] = [["azalea", [0.7, 1.1]], ["boxwood", [0.5, 0.9]], ["spindle", [0.9, 1.5]]];
  for (const [x, y] of planting.shrubs) {
    const g = rng(seed * 17 + Math.floor(x / 6) * 131 + Math.floor(y / 6) * 977)();
    const [species, [h0, h1]] = SHRUB[Math.floor(g * SHRUB.length)];
    forest.add(species, x, at(x, y), -y, h0 + rnd() * (h1 - h0), rnd() * Math.PI * 2, tint(species), rnd());
  }
  // Flower beds: one species per bed patch, twelve in all (spring tulips; petunias, begonias,
  // marigolds, pansies, daisies through summer; cosmos, coreopsis, salvia, lavender,
  // hydrangea), heights as they grow. None in winter.
  const FLOWER_H: Record<string, [number, number]> = {
    petunia: [0.2, 0.3], begonia: [0.18, 0.26], pansy: [0.14, 0.2], marigold: [0.22, 0.34], daisy: [0.25, 0.4], cosmos: [0.6, 1.0],
    coreopsis: [0.45, 0.65], tulip_red: [0.32, 0.45], tulip_yellow: [0.32, 0.45], lavender: [0.4, 0.6], salvia: [0.35, 0.55], hydrangea: [0.7, 1.1] };
  const FLOWERS = Object.keys(FLOWER_H).filter(k => forest.has(k));
  const flower = (species: string, x: number, g: number, y: number) => {
    const [h0, h1] = FLOWER_H[species];
    forest.add(species, x, g, -y, h0 + rnd() * (h1 - h0), rnd() * Math.PI * 2, tint(species), rnd());
  };
  if (season !== "winter" && FLOWERS.length) {
    for (const [x, y] of planting.flowers) {
      const g = rng(seed * 23 + Math.floor(x / 4) * 71 + Math.floor(y / 4) * 353)();
      flower(FLOWERS[Math.floor(g * FLOWERS.length)], x, at(x, y), y);
    }
    // By the road: about a third of the streets have their tree pits planted, a low
    // species round each tree (as the district's street planters are).
    const PIT = FLOWERS.filter(k => FLOWER_H[k][1] <= 0.6);
    for (const [x, y, road] of planting.street) {
      const r2 = rng(seed * 41 + road * 613);
      if (r2() > 0.35 || !PIT.length) continue;
      const species = PIT[Math.floor(r2() * PIT.length)];
      for (let k = 0; k < 3; k++) {
        const a = rnd() * Math.PI * 2, d = 0.45 + rnd() * 0.35;
        flower(species, x + Math.cos(a) * d, at(x, y) + KERB_H, y + Math.sin(a) * d);
      }
    }
  }
  const built = forest.build();
  return { mesh: built.group as THREE.Object3D, dispose: built.dispose };
}

export async function buildPlants(planting: Planting, seed: number, terrain: Terrain = FLAT, hq = true): Promise<{ mesh: THREE.Object3D; dispose: () => void } | null> {
  // Every plant as a mesh where the kit loads (sceneTrees): no cards at all.
  const treeKit = await loadTreeKit().catch(err => { console.info("[3D] plant meshes unavailable, using cards:", err); return null; });
  // (phones and small tablets: every tree as the distant copy)
  if (treeKit) return plantForest(planting, seed, terrain, new Forest(treeKit, hq));
  const forest = null as Forest | null;   // (the card fallback: no meshes)
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
  // Each species turns its own colour in autumn.
  const AUTUMN: Record<string, [number, number, number]> = { ginkgo: [2.1, 1.55, 0.35], zelkova: [1.5, 0.95, 0.45], cherry: [1.7, 0.75, 0.45], plane: [1.35, 1.05, 0.55], fringe: [1.3, 1.0, 0.55] };
  const size = (kind: Kind) => { const [a, b] = HEIGHT[kind]; return a + (b - a) * rnd(); };
  // Footprint frame (x east, y north) to world (x, -z).
  const at = (x: number, y: number) => terrain.at(x, y);
  // Park trees by kind: broadleaf as zelkova, plane, cherry or ginkgo; small ones as cherry
  // or fringe tree; pines as the red pine; firs as the dark cone. (In groups, as planted.)
  const MESH_OF: Partial<Record<Kind, string[]>> = { tree: ["zelkova", "plane", "cherry", "ginkgo"], smalltree: ["cherry", "fringe"], pine: ["pine"], fir: ["conifer"] };
  const treeTint = (species: string) => {
    const v = 0.9 + rnd() * 0.2, t = new THREE.Color(v, v * (0.97 + rnd() * 0.06), v * (0.92 + rnd() * 0.08));
    if (season === "autumn" && species !== "pine" && species !== "conifer") t.multiply(new THREE.Color(...(AUTUMN[species] ?? [1.25, 0.95, 0.5])));
    if (season === "winter" && species !== "pine" && species !== "conifer") t.multiply(new THREE.Color(0.85, 0.8, 0.72));
    return t;
  };
  for (const [x, y] of planting.trees) {
    const kind = speciesAt(x, y), options = MESH_OF[kind];
    if (forest && options) {
      const g = rng(seed * 13 + Math.floor(x / 14) * 31 + Math.floor(y / 14) * 57)();
      const species = options[Math.floor(g * options.length)];
      if (forest.add(species, x, at(x, y), -y, size(kind) * (species === "conifer" ? 0.85 : 1), rnd() * Math.PI * 2, treeTint(species), rnd())) continue;
    }
    const c = pick(byKind(kind)); add(x, -y, c, size(c.kind), at(x, y));
  }
  for (const [x, y] of planting.shrubs) { const c = pick(shrubs); add(x, -y, c, size("shrub"), at(x, y)); }
  for (const [x, y] of planting.flowers) { const c = pick(flowers); add(x, -y, c, size("flower"), at(x, y)); }
  // Street trees: one species per road, as the city plants them — ginkgo, zelkova, cherry,
  // London plane, fringe tree (the commonest on Korean streets) — in their pits on the
  // sidewalk, the two grown variants alternating, each species turning its own colour in
  // autumn. Without the grown cells, the broadleaf ones as before.
  const street = byKind("street");
  const bySpecies = new Map<string, Cell[]>();
  for (const c of street) { const k = c.name?.split("_")[0] ?? "tree"; bySpecies.set(k, [...(bySpecies.get(k) ?? []), c]); }
  const SHARE: Record<string, number> = { ginkgo: 0.3, zelkova: 0.24, cherry: 0.2, plane: 0.14, fringe: 0.12 };
  const MESH_STREET = ["ginkgo", "zelkova", "cherry", "plane", "fringe"].filter(k => forest?.has(k));
  const speciesList = MESH_STREET.length ? MESH_STREET : [...bySpecies.keys()];
  const broadleaf = byKind("tree");
  const perRoad = new Map<number, { cells: Cell[]; h: number; tint: THREE.Color; n: number; species: string }>();
  for (const [x, y, road] of planting.street) {
    let spec = perRoad.get(road);
    if (!spec) {
      const r2 = rng(seed * 31 + road * 977);
      let cells = broadleaf.length ? [broadleaf[Math.floor(r2() * broadleaf.length)]] : [pick(trees)];
      let name = "";
      if (speciesList.length) {
        let r = r2() * speciesList.reduce((t, k) => t + (SHARE[k] ?? 0.1), 0);
        name = speciesList.find(k => (r -= SHARE[k] ?? 0.1) <= 0) ?? speciesList[0];
        cells = bySpecies.get(name) ?? cells;
      }
      const t = new THREE.Color(0.95 + r2() * 0.1, 0.97 + r2() * 0.06, 0.92 + r2() * 0.06);
      if (season === "autumn") t.multiply(new THREE.Color(...(AUTUMN[name] ?? [1.25, 0.95, 0.5])));
      if (season === "winter") t.multiply(new THREE.Color(0.85, 0.8, 0.72));
      const [h0, h1] = HEIGHT.street;
      spec = { cells, h: h0 + r2() * (h1 - h0), tint: t, n: 0, species: name };
      perRoad.set(road, spec);
    }
    if (forest && spec.species && forest.add(spec.species, x, at(x, y) + KERB_H, -y, spec.h * (0.94 + rnd() * 0.12), rnd() * Math.PI * 2, spec.tint.clone().multiplyScalar(0.97 + rnd() * 0.06), spec.n++ / 3 + rnd() * 0.01)) continue;
    const c = spec.cells[spec.n++ % spec.cells.length];
    add(x, -y, c, spec.h * (0.94 + rnd() * 0.12) * (c.height / (spec.cells[0].height || c.height)) ** 0.3, at(x, y) + KERB_H, spec.tint);
  }
  const trees3d = forest?.build() ?? null;
  if (!pos.length) return trees3d ? { mesh: trees3d.group, dispose: trees3d.dispose } : null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ map: texture, alphaTest: 0.32, side: THREE.FrontSide, vertexColors: true, roughness: 0.85, metalness: 0 });
  mat.userData.foliage = true;
  mat.userData.atlasCells = meta.cols;
  mat.userData.atlasRows = meta.rows;
  // Cards thin out as they turn edge-on to the eye, and the upright ones as the eye looks
  // steeply down (twin of the WebGPU view's fade): no flat slabs from the side, no
  // snowflake of squashed cards round the trunk from above.
  mat.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <alphatest_fragment>", `
      { vec3 ng = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition))); vec3 v = normalize(vViewPosition);
        vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        float upright = 1.0 - abs(dot(ng, up));
        diffuseColor.a *= smoothstep(0.14, 0.46, abs(dot(ng, v))) * mix(1.0, 1.0 - smoothstep(0.5, 0.78, abs(dot(v, up))), upright);
        vec2 cell = fract(vMapUv * vec2(${meta.cols.toFixed(1)}, ${meta.rows.toFixed(1)}));
        float side = smoothstep(0.0, 0.12, min(min(cell.x, 1.0 - cell.x), 1.0 - cell.y));
        float crownEdge = 1.0 - smoothstep(0.78, 1.0, length(cell - 0.5) * 2.0);
        diffuseColor.a *= upright > 0.5 ? side : crownEdge; }
      #include <alphatest_fragment>`);
  };
  const cards = new THREE.Mesh(geo, mat);
  cards.castShadow = cards.receiveShadow = true;
  // The atlas stays cached for the next complex; only this complex's geometry goes.
  if (!trees3d) return { mesh: cards, dispose: () => { geo.dispose(); mat.dispose(); } };
  const group = new THREE.Group();
  group.add(cards, trees3d.group);
  return { mesh: group, dispose: () => { geo.dispose(); mat.dispose(); trees3d.dispose(); } };
}
