import type { NanotubeGeometry } from "./nanotubeGeometry";

/** Preserve every vertex/index and its draw order while sharing one GPU batch. */
export function mergeNanotubeBatches(geometry: NanotubeGeometry) {
  const wireParts = [...geometry.tubes, geometry.links];
  const vertices = new Float32Array(wireParts.reduce((size, part) => size + part.vertices.length, 0));
  const indices = new Uint32Array(wireParts.reduce((size, part) => size + part.indices.length, 0));
  const haloIndices = new Uint32Array(geometry.tubes.reduce((size, part) => size + part.haloIndices.length, 0));
  let vertexOffset = 0, indexOffset = 0, haloOffset = 0;
  for (const [partId, part] of wireParts.entries()) {
    vertices.set(part.vertices, vertexOffset);
    for (const index of part.indices) indices[indexOffset++] = index + vertexOffset / 12;
    if (partId < geometry.tubes.length) for (const index of geometry.tubes[partId].haloIndices) haloIndices[haloOffset++] = index + vertexOffset / 12;
    vertexOffset += part.vertices.length;
  }
  const hullVertices = new Float32Array(geometry.tubes.reduce((size, part) => size + part.hullVertices.length / 3 * 4, 0));
  const hullIndices = new Uint32Array(geometry.tubes.reduce((size, part) => size + part.hullIndices.length, 0));
  vertexOffset = 0; indexOffset = 0;
  geometry.tubes.forEach((part, tube) => {
    const base = vertexOffset / 4;
    for (let i = 0; i < part.hullVertices.length; i += 3) {
      hullVertices[vertexOffset++] = part.hullVertices[i];
      hullVertices[vertexOffset++] = part.hullVertices[i + 1];
      hullVertices[vertexOffset++] = part.hullVertices[i + 2];
      hullVertices[vertexOffset++] = tube;
    }
    for (const index of part.hullIndices) hullIndices[indexOffset++] = index + base;
  });
  return { vertices, indices, haloIndices, hullVertices, hullIndices,
    tubeCount: indices.length - geometry.links.indices.length };
}
