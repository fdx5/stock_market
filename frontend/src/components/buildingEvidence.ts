/** Explicit zero above-ground storeys with no positive height is not permission
 * to invent a two-storey building. Missing storeys remain unknown, not zero. */
export function hasAboveGroundEvidence(p:Record<string,unknown>):boolean {
  const floors=String(p.grnd_flr??'').trim();
  return !(floors!==''&&Number(floors)===0&&!(Number(p.height)>0));
}
