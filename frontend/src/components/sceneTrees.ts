import { decodeTreeKit } from "./treeDecodeClient";
import type { Meta, TwigAtlas, Built } from "./treeGeometry";
import * as THREE from "three";
import { fetchStatic } from "../staticCdn";
import { bitmapTexture } from "./bitmapTexture";
import { onSceneMemoryRelease } from "./sceneMemory";

/* Trees as meshes (scripts/gen-mesh-trees.py): bark tubes and leaf-cluster cards per species
 * variant, instanced — every tree of one variant is one draw for its bark and one for its
 * leaves. They replace the crossed-card impostors, which showed each tree two or three
 * times over from an angle (a ghost trunk, a boxy crown, loose leaves round it). */

interface BarkInfo { file: string; metres: number }

/** A variant's meshes: full detail, and the distant copy (main limbs, a third of the twigs,
 * larger, so the crown keeps its fill). */
export interface TreeKit { species: string[]; variants: Map<string, Built[]>; texture: THREE.Texture; twigs: THREE.Texture; bark: Map<string, THREE.Texture> }

let kit: Promise<TreeKit> | null = null;
onSceneMemoryRelease(() => {
  const old = kit; kit = null;
  void old?.then(k => {
    for (const list of k.variants.values()) for (const v of list) {
      v.bark.dispose(); v.leaves.dispose(); v.farBark.dispose(); v.farLeaves.dispose(); v.farthestLeaves.dispose();
    }
    k.texture.dispose(); k.twigs.dispose(); k.bark.forEach(t => t.dispose());
    k.variants.clear(); k.bark.clear();
  }).catch(() => {});
});

export function loadTreeKit(): Promise<TreeKit> {
  kit ??= Promise.all([
    fetchStatic("/3d/trees.json").then(r => { if (!r.ok) throw new Error("trees.json " + r.status); return r.json() as Promise<Meta>; }),
    fetchStatic("/3d/trees.bin").then(r => { if (!r.ok) throw new Error("trees.bin " + r.status); return r.arrayBuffer(); }),
    bitmapTexture("/3d/leaves.webp", true),
    // Leafy twigs (photographed leaves on their stems): what the crowns are made of.
    bitmapTexture("/3d/twigs.webp", true),
    fetchStatic("/3d/twigs.json").then(r => { if (!r.ok) throw new Error("twigs.json " + r.status); return r.json() as Promise<TwigAtlas>; }),
    // Scanned bark per species (Poly Haven CC0: zelkova, plane, cherry, pine …), tiled at
    // its real size; a tree whose bark doesn't load keeps its vertex colour.
    fetchStatic("/3d/bark.json").then(r => (r.ok ? r.json() : {}) as Promise<Record<string, BarkInfo>>).then(async (info: Record<string, BarkInfo>) => {
      const out = new Map<string, THREE.Texture>();
      await Promise.all(Object.entries(info).map(async ([species, b]) => {
        const t = await bitmapTexture("/3d/" + b.file, true).catch(() => null);
        if (!t) return;
        t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
        t.repeat.set(1 / b.metres, 1 / b.metres);
        out.set(species, t);
      }));
      return out;
    }).catch(() => new Map<string, THREE.Texture>()),
  ]).then(async ([meta, bin, texture, twigs, twigAtlas, barkTex]) => {
    for (const t of [texture, twigs]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; }   // (upright: bitmapTexture)
    const variants = await decodeTreeKit(meta, bin, twigAtlas);
    return { species: meta.species, variants, texture, twigs, bark: barkTex };
  });
  const pending = kit;
  pending.catch(() => { if (kit === pending) kit = null; });
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
