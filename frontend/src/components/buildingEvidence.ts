/** Explicit zero above-ground storeys with no positive height is not permission
 * to invent a two-storey building. Missing storeys remain unknown, not zero. */
export function hasAboveGroundEvidence(p:Record<string,unknown>):boolean {
  const floors=String(p.grnd_flr??'').trim();
  if(floors!==''&&Number(floors)===0&&!(Number(p.height)>0))return false;
  // Some register placeholders carry "1" storey (and a permit identifier in
  // dong_nm), but explicitly zero height and all three registered areas.
  // They must not become houses or obstacles that carve holes into roads.
  const zero=(v:unknown)=>v!=null&&String(v).trim()!==''&&Number(v)===0;
  return !(floors!==''&&Number(floors)<=1&&zero(p.height)
    &&['archarea','totalarea','platarea'].every(k=>zero(p[k]))
    &&!String(p.usability??'').trim()&&!String(p.bld_nm??'').trim());
}
