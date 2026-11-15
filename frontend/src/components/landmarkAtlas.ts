import * as THREE from "three";

/* A landmark site's models drawn as one (sceneLandmarks). Each VWorld model came with its own
 * photograph, material and mesh: a site of 200-odd models was 200-odd draws, materials, bind
 * groups and pipelines in each pass (camera and shadows), and on a phone the frames went from
 * ~40 to ~25 fps as a site came within its 1.9 km. Here the models' far photographs are packed
 * into one picture (an atlas, with a gutter round each so its mipmaps do not bleed), their
 * vertices into one mesh in the site's frame, their uvs into the atlas — one draw, one material,
 * one texture. A model seen close (sceneLandmarks LEVELS) is drawn alone with its bigger
 * photograph, and its part of the merged mesh folded away (its vertices collapsed: no triangles
 * left to rasterise) till it is far again. */

export type AtlasPart = { start: number; count: number; ground: number; folded: boolean };
export type AtlasModel = { geometry: THREE.BufferGeometry; bitmap: ImageBitmap; matrix: THREE.Matrix4; ground: number };

const GUTTER = 4;

/** whether a model's uvs stay within its picture (a repeating one cannot go into an atlas) */
export function atlasable(g: THREE.BufferGeometry) {
  const uv = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
  if (!uv) return false;
  const a = uv.array as Float32Array;
  for (let i = 0; i < a.length; i++) if (a[i] < -0.01 || a[i] > 1.01) return false;
  return true;
}

/** Packs `models` (geometry in its own frame, placed by `matrix` in the site's group; its far
 * picture) into one mesh and atlas. `side`: the atlas's largest size. */
export async function buildAtlas(models: AtlasModel[], side: number, name: string) {
  // (cells shrunk evenly, if need be, to fit: a far picture is already its distance's size)
  const area = models.reduce((s, m) => s + (m.bitmap.width + 2 * GUTTER) * (m.bitmap.height + 2 * GUTTER), 0);
  let A = 256;
  while (A < side && A * A * 0.8 < area) A *= 2;
  let scale = Math.min(1, Math.sqrt((A * A * 0.78) / Math.max(1, area)));
  type Cell = { m: AtlasModel; i: number; w: number; h: number; x: number; y: number };
  let cells: Cell[] = [];
  for (let tries = 0; tries < 8; tries++) {
    cells = models.map((m, i) => ({ m, i, w: Math.max(4, Math.floor(m.bitmap.width * scale)), h: Math.max(4, Math.floor(m.bitmap.height * scale)), x: 0, y: 0 }));
    // shelves, tallest first
    const order = [...cells].sort((a, b) => b.h - a.h);
    let x = 0, y = 0, row = 0, ok = true;
    for (const c of order) {
      const cw = c.w + 2 * GUTTER, ch = c.h + 2 * GUTTER;
      if (x + cw > A) { x = 0; y += row; row = 0; }
      if (y + ch > A) { ok = false; break; }
      c.x = x + GUTTER; c.y = y + GUTTER; x += cw; row = Math.max(row, ch);
    }
    if (ok) break;
    scale *= 0.85;
  }
  const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(A, A) : Object.assign(document.createElement("canvas"), { width: A, height: A });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.fillStyle = "#c8c3b8"; ctx.fillRect(0, 0, A, A);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  for (const c of cells) {
    // (the gutter: the picture stretched under itself, its edges carried out)
    ctx.drawImage(c.m.bitmap, c.x - GUTTER, c.y - GUTTER, c.w + 2 * GUTTER, c.h + 2 * GUTTER);
    ctx.drawImage(c.m.bitmap, c.x, c.y, c.w, c.h);
  }
  const bitmap = await createImageBitmap(canvas as unknown as ImageBitmapSource);
  const texture = new THREE.Texture(bitmap as unknown as HTMLImageElement);
  texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.needsUpdate = true;
  texture.userData.releaseAfterUpload = true;

  // the merged mesh, in the site group's frame
  let verts = 0, idx = 0;
  for (const m of models) { verts += m.geometry.getAttribute("position").count; idx += m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute("position").count; }
  const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), uv = new Float32Array(verts * 2);
  const index = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  const parts: AtlasPart[] = [];
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  let vo = 0, io = 0;
  for (const c of [...cells].sort((a, b) => a.i - b.i)) {
    const g = c.m.geometry, P = g.getAttribute("position"), N = g.getAttribute("normal"), U = g.getAttribute("uv"), n = P.count;
    nm.getNormalMatrix(c.m.matrix);
    const u0 = (c.x + 0.5) / A, v0 = (c.y + 0.5) / A, us = (c.w - 1) / A, vs = (c.h - 1) / A;
    for (let k = 0; k < n; k++) {
      v.fromBufferAttribute(P, k).applyMatrix4(c.m.matrix); pos[(vo + k) * 3] = v.x; pos[(vo + k) * 3 + 1] = v.y; pos[(vo + k) * 3 + 2] = v.z;
      if (N) { v.fromBufferAttribute(N, k).applyMatrix3(nm).normalize(); nor[(vo + k) * 3] = v.x; nor[(vo + k) * 3 + 1] = v.y; nor[(vo + k) * 3 + 2] = v.z; }
      const uu = Math.min(1, Math.max(0, U.getX(k))), vv = Math.min(1, Math.max(0, U.getY(k)));
      uv[(vo + k) * 2] = u0 + uu * us; uv[(vo + k) * 2 + 1] = v0 + vv * vs;
    }
    const gi = g.index;
    if (gi) for (let k = 0; k < gi.count; k++) index[io + k] = gi.getX(k) + vo;
    else for (let k = 0; k < n; k++) index[io + k] = k + vo;
    io += gi ? gi.count : n;
    parts.push({ start: vo, count: n, ground: c.m.ground, folded: false });
    vo += n;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere(); geometry.computeBoundingBox();
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${name} (one atlas)`;
  // (the original positions, to fold a part away and back)
  const home = pos.slice();
  return {
    mesh, material, texture, parts, size: A,
    /** model i drawn alone (folded out of the merged mesh), or back in it */
    fold(i: number, folded: boolean) {
      const p = parts[i];
      if (!p || p.folded === folded) return;
      p.folded = folded;
      const a = geometry.getAttribute("position") as THREE.BufferAttribute, arr = a.array as Float32Array;
      if (folded) { const x = arr[p.start * 3], y = arr[p.start * 3 + 1], z = arr[p.start * 3 + 2]; for (let k = p.start; k < p.start + p.count; k++) { arr[k * 3] = x; arr[k * 3 + 1] = y; arr[k * 3 + 2] = z; } }
      else arr.set(home.subarray(p.start * 3, (p.start + p.count) * 3), p.start * 3);
      a.addUpdateRange(p.start * 3, p.count * 3); a.needsUpdate = true;
    },
    /** model i's ground moved (a later DEM): its part raised or lowered by the difference */
    lift(i: number, ground: number) {
      const p = parts[i];
      if (!p || Math.abs(ground - p.ground) < 0.05) return;
      const d = ground - p.ground; p.ground = ground;
      const a = geometry.getAttribute("position") as THREE.BufferAttribute, arr = a.array as Float32Array;
      for (let k = p.start; k < p.start + p.count; k++) { home[k * 3 + 1] += d; if (!p.folded) arr[k * 3 + 1] += d; }
      a.addUpdateRange(p.start * 3, p.count * 3); a.needsUpdate = true;
    },
    dispose() { geometry.dispose(); material.dispose(); texture.dispose(); bitmap.close?.(); },
  };
}
export type LandmarkAtlas = Awaited<ReturnType<typeof buildAtlas>>;
