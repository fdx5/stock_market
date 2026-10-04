import type {Planting} from './complexScene';

/** Coordinates are immutable, but later water/road passes replace outer arrays.
 * Keep those arrays so an unchanged pass can retain the visible GPU resources. */
export function plantingSnapshot(p:Planting):Planting{
 return {...p,trees:p.trees.slice(),shrubs:p.shrubs.slice(),flowers:p.flowers.slice(),street:p.street.slice(),grass:p.grass?.slice(),border:p.border?.slice(),
  groves:p.groves?.map(g=>({...g,points:g.points.slice()})),woodlandFlowers:p.woodlandFlowers?.map(b=>({...b,points:b.points.slice()}))};
}
function samePoints(a:readonly (readonly number[])[]|undefined,b:readonly (readonly number[])[]|undefined){
 if(a===b)return true;if((a?.length??0)!==(b?.length??0))return false;
 for(let i=0;i<(a?.length??0);i++){const p=a![i],q=b![i];if(p.length!==q.length)return false;for(let k=0;k<p.length;k++)if(p[k]!==q[k])return false;}return true;
}
/** Exact equality, not a hash: even one moved tree or changed flower must rebuild. */
export function samePlanting(a:Planting,b:Planting){
 for(const key of ['trees','shrubs','flowers','street','grass','border']as const)if(!samePoints(a[key],b[key]))return false;
 const ga=a.groves??[],gb=b.groves??[],fa=a.woodlandFlowers??[],fb=b.woodlandFlowers??[];
 if(ga.length!==gb.length||fa.length!==fb.length)return false;
 for(let i=0;i<ga.length;i++)if(ga[i].pattern!==gb[i].pattern||!samePoints(ga[i].points,gb[i].points))return false;
 for(let i=0;i<fa.length;i++)if(fa[i].species!==fb[i].species||!samePoints(fa[i].points,fb[i].points))return false;
 return true;
}
