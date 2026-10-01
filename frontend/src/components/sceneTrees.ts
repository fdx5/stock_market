import { frameSlice } from "./frameSlice";
import * as THREE from "three";
import { cdn, fetchStatic } from "../staticCdn";

/* Trees as meshes (scripts/gen-mesh-trees.py): bark tubes and leaf-cluster cards per species
 * variant, instanced — every tree of one variant is one draw for its bark and one for its
 * leaves. They replace the crossed-card impostors, which showed each tree two or three
 * times over from an angle (a ghost trunk, a boxy crown, loose leaves round it). */

interface Part { verts: number; index: number; pos: number; nor: number; col?: number; uv?: number; idx: number }
/** Leaves as records (gen-mesh-trees.py): 32 bytes a leaf, spread into a quad here. */
interface Leaves { count: number; rec: number }
interface Variant { species: string; variant: string; height: number; width: number; bark: Part; leaves: Leaves; barkLod?: Part }
interface Meta { species: string[]; variants: Variant[]; rects: [number, number, number, number][]; twigs: string[] }
interface TwigAtlas { cols: number; rows: number; order: string[] }
interface BarkInfo { file: string; metres: number }

/** A variant's meshes: full detail, and the distant copy (main limbs, a third of the twigs,
 * larger, so the crown keeps its fill). */
interface Built { v: Variant; bark: THREE.BufferGeometry; leaves: THREE.BufferGeometry; farBark: THREE.BufferGeometry; farLeaves: THREE.BufferGeometry; farthestLeaves: THREE.BufferGeometry; twig: boolean }
export interface TreeKit { species: string[]; variants: Map<string, Built[]>; texture: THREE.Texture; twigs: THREE.Texture; bark: Map<string, THREE.Texture> }

let kit: Promise<TreeKit> | null = null;

/** Blender's z-up to three's y-up: (x, y, z) -> (x, z, -y). */
function yUp(a: ArrayLike<number>, n: number, stride: number, scale = 1) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = a[i * stride] * scale; out[i * 3 + 1] = a[i * stride + 2] * scale; out[i * 3 + 2] = -a[i * stride + 1] * scale;
  }
  return out;
}

export function loadTreeKit(): Promise<TreeKit> {
  kit ??= Promise.all([
    fetchStatic("/3d/trees.json").then(r => { if (!r.ok) throw new Error("trees.json " + r.status); return r.json() as Promise<Meta>; }),
    fetchStatic("/3d/trees.bin").then(r => { if (!r.ok) throw new Error("trees.bin " + r.status); return r.arrayBuffer(); }),
    new THREE.TextureLoader().loadAsync(cdn("/3d/leaves.webp")),
    // Leafy twigs (photographed leaves on their stems): what the crowns are made of.
    new THREE.TextureLoader().loadAsync(cdn("/3d/twigs.webp")),
    fetchStatic("/3d/twigs.json").then(r => { if (!r.ok) throw new Error("twigs.json " + r.status); return r.json() as Promise<TwigAtlas>; }),
    // Scanned bark per species (Poly Haven CC0: zelkova, plane, cherry, pine …), tiled at
    // its real size; a tree whose bark doesn't load keeps its vertex colour.
    fetchStatic("/3d/bark.json").then(r => (r.ok ? r.json() : {}) as Promise<Record<string, BarkInfo>>).then(async (info: Record<string, BarkInfo>) => {
      const out = new Map<string, THREE.Texture>();
      await Promise.all(Object.entries(info).map(async ([species, b]) => {
        const t = await new THREE.TextureLoader().loadAsync(cdn("/3d/" + b.file)).catch(() => null);
        if (!t) return;
        t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
        t.repeat.set(1 / b.metres, 1 / b.metres);
        out.set(species, t);
      }));
      return out;
    }).catch(() => new Map<string, THREE.Texture>()),
  ]).then(async ([meta, bin, texture, twigs, twigAtlas, barkTex]) => {
    for (const t of [texture, twigs]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.flipY = true; }
    // a twig's cell (flipY: v up); a hair inside it, off the neighbours
    const twigRect = (k: number): [number, number, number, number] => {
      const c = k % twigAtlas.cols, r = Math.floor(k / twigAtlas.cols), eu = 0.5 / 2048, ev = 0.5 / 1536;
      return [c / twigAtlas.cols + eu, 1 - (r + 1) / twigAtlas.rows + ev, (c + 1) / twigAtlas.cols - eu, 1 - r / twigAtlas.rows - ev];
    };
    const variants = new Map<string, Built[]>();
    const barkGeo = (b: Part) => {
      const g = new THREE.BufferGeometry();
      if (!b.verts) return g;
      g.setAttribute("position", new THREE.BufferAttribute(yUp(new Float32Array(bin, b.pos, b.verts * 3), b.verts, 3), 3));
      g.setAttribute("normal", new THREE.BufferAttribute(yUp(new Int8Array(bin, b.nor, b.verts * 4), b.verts, 4, 1 / 127), 3));
      const c8 = new Uint8Array(bin, b.col!, b.verts * 4), col = new Float32Array(b.verts * 3);
      for (let i = 0; i < b.verts; i++) { col[i * 3] = c8[i * 4] / 255; col[i * 3 + 1] = c8[i * 4 + 1] / 255; col[i * 3 + 2] = c8[i * 4 + 2] / 255; }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      if (b.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(bin, b.uv, b.verts * 2).slice(), 2));
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(bin, b.idx, b.index).slice(), 1));
      g.computeBoundingSphere();
      return g;
    };
    const f16 = (h: number) => {
      const e = (h >> 10) & 31, m = h & 1023, sg = h & 0x8000 ? -1 : 1;
      return e === 0 ? sg * m * 2 ** -24 : e === 31 ? 0 : sg * (1 + m / 1024) * 2 ** (e - 15);
    };
    for (const v of meta.variants) {
      // (one variant a slice: decoding them all at once held the page ~0.1 s)
      await frameSlice();
      const b = v.bark, l = v.leaves;
      const bark = barkGeo(b);
      // Each leaf record to a quad: base + across * (-1..1) + along * (0..1).
      const dv = new DataView(bin, l.rec, l.count * 32);
      const leafGeo = (n: number, grow: number) => {
      const pos = new Float32Array(n * 12), nor = new Float32Array(n * 12), col = new Float32Array(n * 12), uv = new Float32Array(n * 8), idx = new Uint32Array(n * 6);
      const corners = [[-1, 0, 0, 0], [1, 0, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]];
      for (let i = 0; i < n; i++) {
        const o = i * 32, h = (k: number) => f16(dv.getUint16(o + k * 2, true));
        const P = [h(0), h(1), h(2)], Wv = [h(3) * grow, h(4) * grow, h(5) * grow], Hv = [h(6) * grow, h(7) * grow, h(8) * grow];
        const N = [dv.getInt8(o + 18) / 127, dv.getInt8(o + 19) / 127, dv.getInt8(o + 20) / 127];
        const C = [dv.getUint8(o + 22) / 255, dv.getUint8(o + 23) / 255, dv.getUint8(o + 24) / 255];
        const ri = dv.getUint8(o + 26);
        const [u0, v0, u1, v1] = ri >= 128 ? twigRect(ri - 128) : meta.rects[ri];
        corners.forEach(([sx, sy, cu, cv], k) => {
          const j = i * 4 + k;
          // (Blender z-up to three y-up)
          const x = P[0] + Wv[0] * sx + Hv[0] * sy, y = P[1] + Wv[1] * sx + Hv[1] * sy, z = P[2] + Wv[2] * sx + Hv[2] * sy;
          pos.set([x, z, -y], j * 3); nor.set([N[0], N[2], -N[1]], j * 3); col.set(C, j * 3);
          uv.set([cu ? u1 : u0, cv ? v1 : v0], j * 2);
        });
        idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
      }
      const leaves = new THREE.BufferGeometry();
      leaves.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      leaves.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      leaves.setAttribute("color", new THREE.BufferAttribute(col, 3));
      leaves.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      leaves.setIndex(new THREE.BufferAttribute(n * 4 < 65536 ? new Uint16Array(idx) : idx, 1));
        leaves.computeBoundingSphere();
        return leaves;
      };
      const n = l.count;
      const leaves = leafGeo(n, 1);
      // (the distant copy: the first third of the twigs — they were laid in random order — half as large again)
      // (each copy a slice of its own: the three in one made the slice a longer frame)
      await frameSlice();
      const farLeaves = n > 400 ? leafGeo(Math.ceil(n * 0.32), 1.5) : leaves;   // (trees only: a flower keeps its heads)
      await frameSlice();
      // (and the farthest: a seventh of the twigs, twice as large — a crown a few dozen pixels
      // tall keeps its fill and outline from far fewer cards)
      const farthestLeaves = n > 400 ? leafGeo(Math.ceil(n * 0.14), 2.0) : n > 120 ? leafGeo(Math.ceil(n * 0.4), 1.5) : farLeaves;
      const farBark = v.barkLod ? barkGeo(v.barkLod) : bark;

      const twig = n > 0 && dv.getUint8(26) >= 128;
      variants.set(v.species, [...(variants.get(v.species) ?? []), { v, bark, leaves, farBark, farLeaves, farthestLeaves, twig }]);
    }
    return { species: meta.species, variants, texture, twigs, bark: barkTex };
  });
  kit.catch(() => { kit = null; });
  return kit;
}
export function preloadTrees() { void loadTreeKit().catch(() => {}); }

/** The detail a tree is drawn in, fixed by where it stands (never by the camera: a tree that
 * changed its detail as the view moved popped — the crowns flickered while the view turned):
 * full detail within FULL_M of the complex (phones: none), the distant copy to SHADOW_M, the
 * farthest copy (a seventh of the twigs, twice as large) beyond — those without a shadow of
 * their own, as before. Most trees of the 1 km view stand out there: ~5 M leaf triangles a
 * frame had been drawn at the middle copy's detail. */
const FULL_M = 110, SHADOW_M = 250;

type Planted = { m: THREE.Matrix4; tint: THREE.Color; x: number; y: number; z: number; h: number };

/** Trees placed one by one, then built into instanced meshes. */
export class Forest {
  private placed = new Map<string, Planted[]>();
  /** (kept for callers: the bands no longer depend on it) */
  centre = new THREE.Vector2();
  constructor(private kit: TreeKit, private hq = true) {}
  has(species: string) { return this.kit.variants.has(species); }
  /** A tree of `species` at (x, ground, z), `height` metres tall; `pick` chooses the variant. */
  add(species: string, x: number, ground: number, z: number, height: number, yaw: number, tint: THREE.Color, pick: number) {
    const list = this.kit.variants.get(species);
    if (!list) return false;
    const k = Math.floor(pick * list.length) % list.length, v = list[k].v;
    const s = height / v.height;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, ground - 0.05, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s));
    const key = `${species}:${k}`;
    const at = this.placed.get(key) ?? [];
    at.push({ m, tint: tint.clone(), x, y: ground + height * 0.5, z, h: height });
    this.placed.set(key, at);
    return true;
  }
  build(): { group: THREE.Group; dispose: () => void; update: () => void } {
    const group = new THREE.Group();
    const barkMats = new Map<string, THREE.MeshStandardMaterial>();
    const barkMat = (species: string) => {
      let m = barkMats.get(species);
      if (!m) {
        const map = this.kit.bark.get(species) ?? null;
        m = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.95, metalness: 0, color: map ? "#ffffff" : "#6b5a4c" });
        m.userData.bark = true;
        barkMats.set(species, m);
      }
      return m;
    };
    const foliage = (map: THREE.Texture) => {
      const m = new THREE.MeshStandardMaterial({ map, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, metalness: 0 });
      m.userData.leafCluster = true;
      return m;
    };
    const twigMat = foliage(this.kit.twigs), leafMat = foliage(this.kit.texture);
    const meshes: THREE.InstancedMesh[] = [];
    // Per variant, one leaf (and bark) mesh per level, each sized for every tree of the variant;
    // update() deals the trees out among them.
    const sets: { list: Planted[]; levels: THREE.InstancedMesh[][]; band: Uint8Array }[] = [];
    for (const [key, list] of this.placed) {
      const [species, k] = key.split(":");
      const built = this.kit.variants.get(species)![Number(k)];
      // (shrubs and flowers are low: no shadow of their own worth drawing into the sun's maps)
      const low = this.kit.variants.get(species)![0].v.height < 1.6;
      // (levels: full, distant, farthest casting a shadow, farthest without)
      const levels = ([[built.bark, built.leaves], [built.farBark, built.farLeaves], [built.farBark, built.farthestLeaves], [built.farBark, built.farthestLeaves]] as const).map(([bark, leaves], lv) => {
        // (no full detail on phones and small tablets: that level is never dealt any)
        if (lv === 0 && !this.hq) return [] as THREE.InstancedMesh[];
        // (room for a few to start with: a level grows when the trees dealt to it outnumber its
        // room — sized for every tree, the four levels held four times the instance data)
        const l = new THREE.InstancedMesh(leaves, built.twig ? twigMat : leafMat, Math.min(16, list.length));
        const parts = [l];
        if (bark.getAttribute("position")) parts.push(new THREE.InstancedMesh(bark, barkMat(species), Math.min(16, list.length)));
        for (const im of parts) {
          im.name = `${key}:${lv}`; im.castShadow = !low && lv < 3; im.receiveShadow = true; im.count = 0;
          group.add(im); meshes.push(im);
        }
        return parts;
      });
      sets.push({ list, levels, band: new Uint8Array(list.length).fill(255) });
    }
    const update = () => {
      for (const set of sets) {
        let changed = false;
        const bands = set.list.map((t, i) => {
          const fromCentre = Math.hypot(t.x - this.centre.x, t.z - this.centre.y);
          const b = fromCentre < FULL_M && this.hq ? 0 : fromCentre < SHADOW_M ? 1 : 3;
          if (b !== set.band[i]) { set.band[i] = b; changed = true; }
          return b;
        });
        if (!changed) continue;
        const n = [0, 0, 0, 0];
        for (const b of bands) n[b]++;
        set.levels.forEach((parts, b) => {
          if (!parts.length) return;
          const room = parts[0].instanceMatrix.count;
          if (n[b] <= room) return;
          const size = Math.min(set.list.length, Math.ceil(n[b] * 1.25) + 8);
          for (const im of parts) {
            im.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(size * 16), 16);
            if (im.instanceColor) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(size * 3), 3);
          }
        });
        n.fill(0);
        set.list.forEach((t, i) => {
          const b = bands[i], j = n[b]++;
          for (const im of set.levels[b]) im.setMatrixAt(j, t.m);
          set.levels[b][0]?.setColorAt(j, t.tint);
        });
        set.levels.forEach((parts, b) => parts.forEach(im => {
          im.count = n[b];
          // (bounds of the trees it holds: a level out of view isn't drawn)
          if (n[b]) im.computeBoundingSphere();
          im.instanceMatrix.needsUpdate = true;
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
        }));
      }
    };
    // (the geometries and the texture belong to the kit, kept for the next complex)
    return { group, update, dispose: () => { barkMats.forEach(m => m.dispose()); leafMat.dispose(); twigMat.dispose(); meshes.forEach(m => m.dispose()); } };
  }
}
