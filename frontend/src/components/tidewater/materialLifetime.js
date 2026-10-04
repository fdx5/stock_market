/** A replacement can span frames; an old material lives until its final mesh moves. */
export function retireUnusedMaterials(retired, meshes, release) {
  const live = new Set();
  for (const mesh of meshes) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) live.add(material);
  let kept = 0;
  for (const material of retired) {
    if (live.has(material)) retired[kept++] = material;
    else release(material);
  }
  retired.length = kept;
}

/** Versions are local to a material. Replacing an object with another version 0
 * material (or one slot in a material array) must also rebuild its native binding. */
export function sourceMaterialsMatch(native, source) {
  const array = Array.isArray(source);
  if (array !== Array.isArray(native)) return false;
  // Static single-material meshes are the hot path; no temporary arrays per frame.
  if (!array) return native.source === source && native.srcVersion === source.version;
  return native.length === source.length && native.every((m, i) => m.source === source[i] && m.srcVersion === source[i].version);
}

export function boundTextures(materials) {
  const out = new Set();
  for (const m of materials) for (const binding of Object.values(m.bindings)) {
    if (binding?.texture?.isTexture) out.add(binding.texture);
  }
  return out;
}
