import * as THREE from "three";
export interface Part { verts: number; index: number; pos: number; nor: number; col?: number; uv?: number; idx: number }
/** Leaves as records (gen-mesh-trees.py): 32 bytes a leaf, spread into a quad here. */
export interface Leaves { count: number; rec: number }
export interface Variant { species: string; variant: string; height: number; width: number; bark: Part; leaves: Leaves; barkLod?: Part }
export interface Meta { species: string[]; variants: Variant[]; rects: [number, number, number, number][]; twigs: string[] }
export interface TwigAtlas { cols: number; rows: number; order: string[] }
export interface Built { v: Variant; bark: THREE.BufferGeometry; leaves: THREE.BufferGeometry; farBark: THREE.BufferGeometry; farLeaves: THREE.BufferGeometry; farthestLeaves: THREE.BufferGeometry; twig: boolean }

/** Blender's z-up to three's y-up: (x, y, z) -> (x, z, -y). */
function yUp(a: ArrayLike<number>, n: number, stride: number, scale = 1) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = a[i * stride] * scale; out[i * 3 + 1] = a[i * stride + 2] * scale; out[i * 3 + 2] = -a[i * stride + 1] * scale;
  }
  return out;
}

export async function decodeTreeVariants(meta:Meta, bin:ArrayBuffer, twigAtlas:TwigAtlas, pause:()=>Promise<void>, groupLeaves=true) {
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
      await pause();
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
      // The atlas already depicts photographed leafy twigs. Use fewer, larger
      // twig groups for full crowns, retaining equivalent projected coverage.
      // Flowers and small plants keep their original heads and geometry.
      const grouped=groupLeaves && n>400 && ['ginkgo','zelkova','cherry','plane','fringe','pine','conifer'].includes(v.species);
      const leaves = grouped ? leafGeo(Math.ceil(n*0.45),1.5) : leafGeo(n, 1);
      // (the distant copy: the first third of the twigs — they were laid in random order — half as large again)
      // (each copy a slice of its own: the three in one made the slice a longer frame)
      await pause();
      const farLeaves = grouped ? leafGeo(Math.ceil(n*0.22),1.8) : n > 400 ? leafGeo(Math.ceil(n * 0.32), 1.5) : leaves;
      await pause();
      // (and the farthest: a seventh of the twigs, twice as large — a crown a few dozen pixels
      // tall keeps its fill and outline from far fewer cards)
      const farthestLeaves = grouped ? leafGeo(Math.ceil(n*0.10),2.4) : n > 400 ? leafGeo(Math.ceil(n * 0.14), 2.0) : n > 120 ? leafGeo(Math.ceil(n * 0.4), 1.5) : farLeaves;
      const farBark = v.barkLod ? barkGeo(v.barkLod) : bark;

      const twig = n > 0 && dv.getUint8(26) >= 128;
      variants.set(v.species, [...(variants.get(v.species) ?? []), { v, bark, leaves, farBark, farLeaves, farthestLeaves, twig }]);
    }
    return variants;
}
