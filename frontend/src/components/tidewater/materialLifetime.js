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
