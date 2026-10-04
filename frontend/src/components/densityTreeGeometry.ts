import * as THREE from 'three';
import {PARK_TREE_STYLES}from'./landscapeDiversity';
import {compactCrownLobes,appendCrownVolume,type CrownLobe}from'./crownVolume';

/** Preserve the photographic group count while making the five silhouettes distinct. */
export function shapeSpeciesCrown(geometry:THREE.BufferGeometry,species:string){
 const style=PARK_TREE_STYLES.find(s=>s.species===species);if(!style)return geometry;
 geometry.computeBoundingBox();const box=geometry.boundingBox!,center=box.getCenter(new THREE.Vector3()),span=box.getSize(new THREE.Vector3());
 const p=geometry.getAttribute('position') as THREE.BufferAttribute,n=geometry.getAttribute('normal') as THREE.BufferAttribute;
 const width=Math.min(1,style.width),depth=Math.min(1,style.depth/.32);
 for(let i=0;i<p.count;i++){
  const level=(p.getY(i)-box.min.y)/Math.max(span.y,1e-6),t=THREE.MathUtils.smoothstep(level,.35,1),spread=width*(1-t*(1-style.taper));
  const x=(p.getX(i)-center.x)*spread,y=(p.getY(i)-center.y)*depth,z=(p.getZ(i)-center.z)*spread;
  p.setXYZ(i,center.x+x,center.y+y,center.z+z);const normal=new THREE.Vector3(x,y,z).normalize();if(!normal.lengthSq())normal.set(0,1,0);n.setXYZ(i,normal.x,normal.y,normal.z);
 }
 geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}

/** Build offline: neighbouring spatial leaf groups become closed crown lobes
 * within their original bounds and triangle allowance. Photographs carry detail;
 * trunks remain separate geometry. */
export function densityCrown(source: THREE.BufferGeometry, divisions: number, cell: number) {
  const p = source.getAttribute('position'), color = source.getAttribute('color');
  source.computeBoundingBox();
  const bounds = source.boundingBox!, span = bounds.getSize(new THREE.Vector3());
  type Group = { lo: THREE.Vector3; hi: THREE.Vector3; color: THREE.Vector3; count: number };
  const groups = new Map<string, Group>();
  for (let i = 0; i < p.count; i += 4) {
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const tint = new THREE.Vector3();
    for (let k = 0; k < 4; k++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i + k); lo.min(v); hi.max(v);
      tint.add(new THREE.Vector3().fromBufferAttribute(color, i + k));
    }
    const center = lo.clone().add(hi).multiplyScalar(.5);
    const xyz = ['x', 'y', 'z'] as const;
    const key = xyz.map(a => Math.min(divisions - 1, Math.max(0, Math.floor((center[a] - bounds.min[a]) / Math.max(span[a], 1e-6) * divisions)))).join(':');
    let g = groups.get(key);
    if (!g) { g = { lo, hi, color: tint.multiplyScalar(.25), count: 1 }; groups.set(key, g); }
    else { g.lo.min(lo); g.hi.max(hi); g.color.add(tint.multiplyScalar(.25)); g.count++; }
  }
  const out={position:[]as number[],normal:[]as number[],color:[]as number[],uv:[]as number[],index:[]as number[]};
  const lobes:CrownLobe[]=[],tints:number[][]=[];
  for (const g of groups.values()) {
    const c = g.lo.clone().add(g.hi).multiplyScalar(.5), r = g.hi.clone().sub(g.lo).multiplyScalar(.5);
    const tint = g.color.multiplyScalar(1 / g.count);
    lobes.push({x:c.x,y:c.y,z:c.z,rx:r.x,ry:r.y,rz:r.z,weight:1,tag:tints.length});tints.push(tint.toArray());
  }
  // Keep many small branch-sized groups, rather than collapsing the entire
  // crown to one huge shell. Small rounded lobes cost 16 triangles; pairing the
  // original groups pays for their closed 3D shape without extra triangles.
  const budget=lobes.length*6,count=Math.max(1,Math.floor(budget/8)),sides=budget>=8?4:3;
  for(const lobe of compactCrownLobes(lobes,count))appendCrownVolume(out,lobe,sides,lobe.tag*2.39996,cell,tints[lobe.tag],budget>=8?2:1);
  const geometry = new THREE.BufferGeometry();
  for (const [name,a,size] of [['position',out.position,3],['normal',out.normal,3],['color',out.color,3],['uv',out.uv,2]] as const)
    geometry.setAttribute(name,new THREE.Float32BufferAttribute(a,size));
  geometry.setIndex(out.index); geometry.computeBoundingSphere(); geometry.computeBoundingBox();
  return geometry;
}

/** Tiny distant flower heads: stratified records keep the whole bed's extent and
 * head/leaf mix. Full geometry remains in the close band. No enlarged petals. */
export function distantFlowers(source: THREE.BufferGeometry, cards: number) {
  const available = source.getAttribute('position').count / 4;
  if (cards >= available) return source;
  const selected = Array.from({length:cards}, (_,i)=>Math.floor((i+.5)*available/cards));
  const out = new THREE.BufferGeometry();
  for (const [name,a] of Object.entries(source.attributes)) {
    const values: number[] = [];
    for (const card of selected) for (let k=0;k<4;k++) for(let j=0;j<a.itemSize;j++) values.push(a.array[(card*4+k)*a.itemSize+j]);
    out.setAttribute(name,new THREE.Float32BufferAttribute(values,a.itemSize));
  }
  out.setIndex(selected.flatMap((_,i)=>[i*4,i*4+1,i*4+2,i*4,i*4+2,i*4+3]));out.computeBoundingSphere();
  return out;
}
