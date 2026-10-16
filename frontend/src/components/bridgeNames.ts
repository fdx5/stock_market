import type {RealEstateRoad} from '../api/client';
import type {DroneLabel} from './ringBuildings';
import {nearestRoadPoint} from './roadLevels';
import {surfaceGeometry} from './surfaceGeometry';

// Recorded public map name/position anchors. A name is shown only when an
// actual surveyed bridge deck reaches its anchor; this list creates no roads.
const NAMES:readonly (readonly [string,number,number])[] = [["팔당대교",37.5452901,127.2367582],["미사대교",37.5858932,127.1976133],["강동대교",37.5771164,127.162083],["고덕토평대교",37.5713542,127.1492467],["구리암사대교",37.5691449,127.1318922],["광진교",37.544914,127.1127811],["천호대교",37.5424759,127.1137058],["올림픽대교",37.5343153,127.1036105],["잠실대교",37.5238081,127.0920808],["청담대교",37.5256091,127.063966],["영동대교",37.5311063,127.0577466],["성수대교",37.5369491,127.0350147],["동호대교",37.532385,127.0239252],["한남대교",37.5267086,127.0133784],["반포대교",37.514556,126.9965074],["잠수교",37.514935,126.9963074],["동작대교",37.5140478,126.9828807],["한강대교",37.5153525,126.9573152],["원효대교",37.5278722,126.9472633],["마포대교",37.5335537,126.9363748],["서강대교",37.5401054,126.9270439],["양화대교",37.5424652,126.9030096],["성산대교",37.552057,126.8911556],["월드컵대교",37.5552065,126.8848512],["가양대교",37.5689263,126.8607058],["방화대교",37.5880387,126.8265484],["행주대교",37.5965572,126.8082063],["김포대교",37.6089109,126.7909758],["일산대교",37.6495466,126.7158077],["광안대교",35.1457,129.1283]];
export function bridgeNameLabels(center:{lat:number;lon:number}, roads:readonly RealEstateRoad[]):DroneLabel[]{
 const kx=Math.cos(center.lat*Math.PI/180)*111320,ky=110540,out:DroneLabel[]=[];
 const decks=roads.filter(r=>r.structure==='bridge'&&r.structure_source&&r.profile_line&&r.profile_s&&r.profile_z&&r.line.length>1);
 for(const [name,lat,lon] of NAMES){
  const x=(lon-center.lon)*kx,y=(lat-center.lat)*ky;
  let best:RealEstateRoad|undefined,distance=180;
  for(const r of decks){const p=nearestRoadPoint(r.line,x,y);if(p.total>=120&&p.distance<distance){distance=p.distance;best=r;}}
  if(!best)continue;
  const line=best.line,mid=nearestRoadPoint(line,...line[0]).total/2;
  let along=0,point=line[0];
  for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(along+length>=mid){const t=(mid-along)/(length||1);point=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];break;}along+=length;}
  const top=surfaceGeometry.profileAt(best.profile_line!,best.profile_s!,best.profile_z!,point[0],point[1]);
  out.push({name,kind:'bridge',x:point[0],y:point[1],top:top+5,n:1});
 }
 return out;
}
