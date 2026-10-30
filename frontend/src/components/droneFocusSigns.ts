import type { RealEstateBuildingsResponse } from "../api/client";
import type { DroneLabel } from "./ringBuildings";
type ViewSign={id:string;name:string;x:number;y:number;z:number;here:boolean};
const collected=(id:string)=>/^\d{5}:/.test(id);
const normal=(name:string)=>name.replace(/[\s()·_-]|아파트/g,"");
/** The initial coordinate destination is excluded from streamed tiles too. Keep its
 * own apartment sign without inventing a market/complex ID from the coordinate key. */
export function apartmentDroneLabels(signs:readonly ViewSign[],data:RealEstateBuildingsResponse,homeId:string|null,placeKind?:string):DroneLabel[]{
 return signs.flatMap(s=>{
  const point=s.here&&data.id===s.id&&s.id.startsWith("drone-point:");
  const nearest=[...data.buildings].sort((a,b)=>{const distance=(building:typeof a)=>{const ring=building.rings[0]??[];return ring.length?Math.hypot(ring.reduce((s,p)=>s+p[0],0)/ring.length,ring.reduce((s,p)=>s+p[1],0)/ring.length):Infinity;};return distance(a)-distance(b);})[0];
  const apartment=point&&(placeKind==="아파트"||placeKind!=="학교"&&/^02|공동주택|아파트/.test(nearest?.use??""));
  if(!(collected(s.id)&&(!s.here||data.id===s.id))&&!apartment)return [];
  const homeName=homeId?.split(":").slice(3).join(":")??"";
  const complexId=collected(s.id)?s.id:homeId&&collected(homeId)&&normal(homeName)===normal(s.name)?homeId:undefined;
  return [{name:s.name,kind:"apt" as const,x:point?0:s.x,y:point?0:s.y,top:s.z,n:1,focused:s.here,info:{complexId,bx:point?0:s.x,by:point?0:s.y}}];
 });
}
