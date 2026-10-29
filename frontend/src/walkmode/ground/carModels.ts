import * as THREE from "three";
import { loadCarModels } from "../../drivegame/vehicle/cars";
import { fetchStatic } from "../../staticCdn";
import { frameVanRearWindow } from "./carRearWindow";
import { repairCarNormals } from "./carSurfaceSafety";

interface Part { verts: number; index: number; pos: number; nor: number; uv: number; idx: number }
/** Dedicated close-range bodies and independent glazing. Every walk owns its decoded
 * geometries; the drive's shared models are never modified or disposed here. */
export async function loadWalkCarModels() {
  const bodies = new Map<string, THREE.BufferGeometry>(), windows = new Map<string, THREE.BufferGeometry>();
  let quality = "original-fallback";
  const original = await loadCarModels();
  const models = new Map([...original].map(([name, geometry]) => [name, geometry.clone()]));
  try {
    const [meta, data] = await Promise.all([
      fetchStatic("/3d/walk/cars/cars.json").then(r => { if (!r.ok) throw Error("walk car metadata " + r.status); return r.json() as Promise<{ kinds: Record<string, Part> }>; }),
      fetchStatic("/3d/walk/cars/cars.bin").then(r => { if (!r.ok) throw Error("walk car geometry " + r.status); return r.arrayBuffer(); }),
    ]);
    for (const [name, p] of Object.entries(meta.kinds)) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(data, p.pos, p.verts * 3).slice(), 3));
      const packedNormal = new Int8Array(data, p.nor, p.verts * 4), normal = new Float32Array(p.verts * 3);
      for (let i = 0; i < p.verts; i++) for (let c = 0; c < 3; c++) normal[i * 3 + c] = packedNormal[i * 4 + c] / 127;
      geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
      const packedUv = new Uint16Array(data, p.uv, p.verts * 2), uv = Float32Array.from(packedUv, n => n / 65535);
      geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(data, p.idx, p.index).slice(), 1));
      geometry.userData.walkCarQuality = "close-range-panel-wheel-cabin-v1";
      geometry.userData.carMeta=p;
      models.get(name)?.dispose(); models.set(name, geometry);
    }
    quality = "close-range-panel-wheel-cabin-v1";
  } catch (error) { console.warn("walk: detailed car assets unavailable", error); }
  for (const [name, geometry] of models) {
    repairCarNormals(geometry);
    frameVanRearWindow(geometry,name);
    const index = geometry.getIndex()!, uv = geometry.getAttribute("uv"), opaque: number[] = [], glass: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i), part = Math.floor(uv.getX(a) * 16);
      (part === 1 || part === 12 || part === 13 ? glass : opaque).push(a, index.getX(i + 1), index.getX(i + 2));
    }
    const glazing = new THREE.BufferGeometry();
    for (const [key, attribute] of Object.entries(geometry.attributes)) glazing.setAttribute(key, attribute);
    glazing.setIndex(glass); glazing.computeBoundingSphere(); glazing.userData.walkKind = name;
    geometry.setIndex(opaque); geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometry.userData.walkKind = name;
    bodies.set(name, geometry); windows.set(name, glazing);
  }
  const levels = [{ bodies, windows }];
  try {
    const [meta, data] = await Promise.all([
      fetchStatic("/3d/walk/cars/lods.json").then(r => { if (!r.ok) throw Error("distance metadata"); return r.json() as Promise<{ kinds: Record<string, Part[]> }>; }),
      fetchStatic("/3d/walk/cars/lods.bin").then(r => { if (!r.ok) throw Error("distance geometry"); return r.arrayBuffer(); }),
    ]);
    for (let level = 0; level < 2; level++) {
      const b = new Map(bodies), w = new Map(windows);
      for (const [name, parts] of Object.entries(meta.kinds)) {
        const p = parts[level], geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(data, p.pos, p.verts * 3).slice(), 3));
        const packed = new Int8Array(data, p.nor, p.verts * 4), normal = new Float32Array(p.verts * 3);
        for (let i = 0; i < p.verts; i++) for (let c = 0; c < 3; c++) normal[i * 3 + c] = packed[i * 4 + c] / 127;
        geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
        geometry.setAttribute("uv", new THREE.BufferAttribute(Float32Array.from(new Uint16Array(data, p.uv, p.verts * 2), n => n / 65535), 2));
        geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(data,p.idx,p.index).slice(),1));repairCarNormals(geometry);frameVanRearWindow(geometry,name);
        const index = geometry.getIndex()!.array, opaque: number[] = [], glass: number[] = [], uv = geometry.getAttribute("uv");
        for (let i = 0; i < index.length; i += 3) { const part = Math.floor(uv.getX(index[i]) * 16); (part === 1 || part === 12 || part === 13 ? glass : opaque).push(index[i], index[i + 1], index[i + 2]); }
        const glazing = new THREE.BufferGeometry(); for (const [key, attribute] of Object.entries(geometry.attributes)) glazing.setAttribute(key, attribute);
        glazing.setIndex(glass); glazing.computeBoundingSphere(); geometry.setIndex(opaque); geometry.computeBoundingSphere();
        geometry.userData.walkKind = glazing.userData.walkKind = name; b.set(name, geometry); w.set(name, glazing);
      }
      levels.push({ bodies: b, windows: w });
    }
  } catch (error) { console.warn("walk: car distance meshes unavailable", error); }
  while (levels.length < 3) levels.push(levels[0]);
  return { bodies, windows, levels, quality, dispose() { const owned = new Set<THREE.BufferGeometry>(); for (const l of levels) { l.bodies.forEach(g => owned.add(g)); l.windows.forEach(g => owned.add(g)); } owned.forEach(g => g.dispose()); } };
}

/** Glazing shares the body's GPU instance matrices, including traffic interpolation.
 * It draws after opaque surfaces with depth writes off, so the cabin remains visible. */
export function attachCarWindows(body: THREE.InstancedMesh, geometry: THREE.BufferGeometry, material: THREE.Material) {
  const mesh = new THREE.InstancedMesh(geometry, material, body.instanceMatrix.count);
  mesh.instanceMatrix = body.instanceMatrix; mesh.count = body.count; mesh.frustumCulled = false;
  mesh.receiveShadow = true; mesh.renderOrder = 2;
  mesh.onBeforeRender = () => { mesh.count = body.count; };
  body.add(mesh); return mesh;
}
