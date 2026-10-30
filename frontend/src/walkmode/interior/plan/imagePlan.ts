import type { FloorPlan, Opening, Room } from "./types";
import { fixturesFor, type PlanInput } from "./generate";

export interface Drawing {
  key:string;naverId:string;typeId:string;typeName:string;exclusiveArea:number;supplyArea:number;
  variant:string;imageId:string;imageUrl:string;sourceUrl:string;
}
export interface ImageAnalysis {
  status:"ready"|"needs_review";reason?:string;version:string;drawing:Drawing;
  rooms?:Room[];openings?:Opening[];areaM2?:number;areaError?:number;elapsedMs?:number;
  scale?:{basis:string;xMetresPerPixel:number;zMetresPerPixel:number};
  imageSize?:[number,number];pixelBounds?:[number,number,number,number];note?:string;
}

/** Source geometry is never passed through template generation, mirroring or envelope stretching. */
export function floorPlanFromImage(p:PlanInput,analysis:ImageAnalysis):FloorPlan|null {
  if(analysis.status!=="ready"||!analysis.rooms?.length||!analysis.openings||!analysis.scale||Math.abs(analysis.drawing.exclusiveArea-p.area)>.005)return null;
  const rooms=analysis.rooms.map(r=>{const surfaceType=analysis.rooms!.find(q=>q.zone===r.zone&&q.type!=="hall")?.type??r.type;return {...r,surfaceType,rect:[...r.rect] as Room["rect"],floorDrop:surfaceType==="bathroom"?.03:0};});
  if(rooms.length>120||rooms.some(r=>r.rect.some(v=>!Number.isFinite(v))||r.rect[2]-r.rect[0]<.15||r.rect[3]-r.rect[1]<.15))return null;
  const ids=new Map(rooms.map(r=>[r.id,r]));
  const openings:Opening[]=[];
  for(const source of analysis.openings){
    const a=ids.get(source.a),b=ids.get(source.b);if(!a||(!b&&source.b!=="out"))continue;
    if(![source.at,source.center,source.width,source.height,source.sill].every(Number.isFinite))return null;
    const j=source.axis==="x"?0:1,k=source.axis==="x"?1:0;
    if(Math.min(Math.abs(a.rect[j]-source.at),Math.abs(a.rect[j+2]-source.at))>.002)continue;
    if(b&&Math.min(Math.abs(b.rect[j]-source.at),Math.abs(b.rect[j+2]-source.at))>.002)continue;
    // Physical openings can cross several rectangles belonging to the same room zone.
    const span=(r:Room)=>rooms.filter(q=>q.zone===r.zone&&Math.min(Math.abs(q.rect[j]-source.at),Math.abs(q.rect[j+2]-source.at))<.002);
    const aa=span(a),bb=b?span(b):[];
    const lo=Math.max(Math.min(...aa.map(q=>q.rect[k])),b?Math.min(...bb.map(q=>q.rect[k])):-Infinity),hi=Math.min(Math.max(...aa.map(q=>q.rect[k+2])),b?Math.max(...bb.map(q=>q.rect[k+2])):Infinity);
    const start=Math.max(lo,source.center-source.width/2),end=Math.min(hi,source.center+source.width/2);
    if(end-start<.12)continue;
    const kitchenWindow=["window","balcony_window"].includes(source.type)&&(a.surfaceType==="kitchen"||b?.surfaceType==="kitchen");
    openings.push({...source,center:(start+end)/2,width:end-start,...(kitchenWindow&&source.sill<.95?{sill:.95,height:Math.max(.8,source.sill+source.height-.95)}:{})});
  }
  const xs=rooms.flatMap(r=>[r.rect[0],r.rect[2]]),zs=rooms.flatMap(r=>[r.rect[1],r.rect[3]]);
  const living=rooms.find(r=>r.type==="living");if(!living)return null;
  const [x0,z0,x1,z1]=living.rect;
  const plan:FloorPlan={complexId:p.complexId,complexName:p.complexName,dong:p.dong,unitType:analysis.drawing.typeName,
    areaExclusiveM2:p.area,ceilingHeightM:p.built&&p.built>=2015?2.4:2.32,
    source:"image_analysis",template:`${analysis.drawing.typeName} · ${analysis.drawing.variant}`,
    basis:{area:`네이버 공개 도면 전용면적 ${p.area}㎡`,rooms:"원본 이미지 벽·공간 인식 · 가구·마감은 연출",built:p.built,households:p.households},
    rooms,openings,fixtures:[],bounds:[Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)],
    check:{areaM2:analysis.areaM2??p.area,error:analysis.areaError??0},style:p.style??"modern_white",floor:p.floor??3,furnishingCase:p.furnishingCase,
    imageAnalysis:{key:analysis.drawing.key,typeName:analysis.drawing.typeName,sourceUrl:analysis.drawing.sourceUrl,scaleBasis:analysis.scale.basis,elapsedMs:analysis.elapsedMs??0,start:[(x0+x1)/2,(z0+z1)/2,Math.PI]}};
  plan.fixtures=fixturesFor(plan).filter(f=>{const r=ids.get(f.room);return r&&f.pos[0]>=r.rect[0]+.15&&f.pos[0]<=r.rect[2]-.15&&f.pos[1]>=r.rect[1]+.15&&f.pos[1]<=r.rect[3]-.15;});
  return plan;
}
