import type { FloorPlan, Opening, Room } from "./types";
import { fixturesFor, type PlanInput } from "./generate";
import {resolveWallOpenings} from './wallOpenings';
import {openPublicStubs,tidyImageOpenings} from './imageTidy';

export interface Drawing {
  key:string;naverId:string;typeId:string;typeName:string;exclusiveArea:number;supplyArea:number;
  variant:string;imageId:string;imageUrl:string;sourceUrl:string;
}
export interface ImageAnalysis {
  status:"ready"|"needs_review";reason?:string;version:string;drawing:Drawing;
  rooms?:Room[];openings?:Opening[];areaM2?:number;areaError?:number;elapsedMs?:number;
  application?:{mode:string;areaAnnotationAdjusted:boolean;geometryBasis:string;templateUsed:boolean};
  scale?:{basis:string;xMetresPerPixel:number;zMetresPerPixel:number;estimated?:boolean;sourceAspectRatio?:number;wallThicknessMetres?:number};
  pixelRooms?:{id:string;rect:[number,number,number,number]}[];
  recognizedAreas?:{text:string;areaM2:number;scope:string}[];
  sourceMatch?:{wallRecall:number;wallPrecision:number;wallF1:number;floorCoverage?:number;target:number;targetMet:boolean;certifiedAccuracy:boolean};
  imageSize?:[number,number];pixelBounds?:[number,number,number,number];note?:string;
}

/** Source geometry is never passed through template generation, mirroring or envelope stretching. */
export function floorPlanFromImage(p:PlanInput,analysis:ImageAnalysis,o:{tidy?:boolean}={}):FloorPlan|null {
  if(analysis.status!=="ready"||!analysis.rooms?.length||!analysis.openings||!analysis.scale||Math.abs(analysis.drawing.exclusiveArea-p.area)>.005)return null;
  if(analysis.scale.wallThicknessMetres!==undefined&&(!Number.isFinite(analysis.scale.wallThicknessMetres)||analysis.scale.wallThicknessMetres<.02||analysis.scale.wallThicknessMetres>.4))return null;
  const rooms=analysis.rooms.map(r=>{const surfaceType=analysis.rooms!.find(q=>q.zone===r.zone&&q.type!=="hall")?.type??r.type;return {...r,surfaceType,rect:[...r.rect] as Room["rect"],floorDrop:surfaceType==="bathroom"?.03:0};});
  // Small unfurnished perimeter strips preserve stepped walls. They are not rooms
  // to stand in; the lead-room dimensions and body-sized navigation are checked separately.
  if(rooms.length>120||rooms.some(r=>r.rect.length!==4||r.rect.some(v=>!Number.isFinite(v))||r.rect[2]-r.rect[0]<.10||r.rect[3]-r.rect[1]<.10))return null;
  if(new Set(rooms.map(r=>r.id)).size!==rooms.length)return null;
  for(let i=0;i<rooms.length;i++)for(const q of rooms.slice(i+1)){
    const r=rooms[i];if(Math.max(0,Math.min(r.rect[2],q.rect[2])-Math.max(r.rect[0],q.rect[0]))*Math.max(0,Math.min(r.rect[3],q.rect[3])-Math.max(r.rect[1],q.rect[1]))>1e-5)return null;
  }
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
  // A drawing read without its 현관문 (the door symbol lost in the plan's line work) still has one:
  // in the 현관's outside wall — the side no other room lies against — at its widest clear part.
  if(!openings.some(o=>o.type==="front_door")){const fd=frontDoorFor(rooms,openings);if(fd)openings.push(fd);}
  // (stubs of wall left by passages read short, seams inside one room, doors read half-width)
  const tidy=o.tidy===false?{openings,report:{stubsOpened:0,seamsOpened:0,doorsWidened:0}}:tidyImageOpenings(rooms,openings);
  let resolved=resolveWallOpenings(rooms,tidy.openings,true);
  if(o.tidy!==false){const pub=openPublicStubs(rooms,resolved);resolved=pub.openings;tidy.report.publicStubs=pub.opened;}
  const xs=rooms.flatMap(r=>[r.rect[0],r.rect[2]]),zs=rooms.flatMap(r=>[r.rect[1],r.rect[3]]);
  const living=rooms.find(r=>r.type==="living");if(!living)return null;
  const [x0,z0,x1,z1]=living.rect;
  const plan:FloorPlan={complexId:p.complexId,complexName:p.complexName,dong:p.dong,unitType:analysis.drawing.typeName,
    areaExclusiveM2:p.area,ceilingHeightM:p.built&&p.built>=2015?2.4:2.32,
    source:"image_analysis",template:`${analysis.drawing.typeName} · ${analysis.drawing.variant}`,
    basis:{area:`단지 공개 도면 전용면적 ${p.area}㎡`,rooms:"원본 이미지 벽·공간 인식 · 가구·마감은 연출",built:p.built,households:p.households},
    rooms,openings:resolved,fixtures:[],bounds:[Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)],
    check:{areaM2:analysis.areaM2??p.area,error:analysis.areaError??0},style:p.style??"modern_white",floor:p.floor??3,furnishingCase:p.furnishingCase,
    imageAnalysis:{key:analysis.drawing.key,typeName:analysis.drawing.typeName,sourceUrl:analysis.drawing.sourceUrl,scaleBasis:analysis.scale.basis,wallThicknessMetres:analysis.scale.wallThicknessMetres,elapsedMs:analysis.elapsedMs??0,tidy:tidy.report,start:[(x0+x1)/2,(z0+z1)/2,Math.PI]}};
  plan.fixtures=fixturesFor(plan).filter(f=>{const r=ids.get(f.room);return r&&f.pos[0]>=r.rect[0]+.15&&f.pos[0]<=r.rect[2]-.15&&f.pos[1]>=r.rect[1]+.15&&f.pos[1]<=r.rect[3]-.15;});
  return plan;
}

/** the 현관's front door where the drawing lost it: on the entrance room's (or, lacking one, the
 * hall's) side that no other room lies against, centred on its longest clear run (≥ 0.9 m) */
export function frontDoorFor(rooms:Room[],openings:Opening[]):Opening|null{
  const E=1e-3,ent=rooms.filter(r=>(r.surfaceType??r.type)==="entrance");
  const cands=ent.length?ent:rooms.filter(r=>r.type==="hall"||r.type==="corridor");
  let best:{o:Opening;len:number}|null=null;
  for(const r of cands){
    const [x0,z0,x1,z1]=r.rect;
    const sides:{axis:"x"|"z";at:number;lo:number;hi:number;out:number}[]=[{axis:"z",at:z0,lo:x0,hi:x1,out:-1},{axis:"z",at:z1,lo:x0,hi:x1,out:1},{axis:"x",at:x0,lo:z0,hi:z1,out:-1},{axis:"x",at:x1,lo:z0,hi:z1,out:1}];
    for(const s of sides){
      // (the parts of this side with a room beyond it, or a window in it, are not the way out)
      const taken:[number,number][]=[];
      for(const q of rooms){if(q===r)continue;const [a0,b0,a1,b1]=q.rect;
        const beyond=s.axis==="z"?(s.out<0?Math.abs(b1-s.at)<E:Math.abs(b0-s.at)<E):(s.out<0?Math.abs(a1-s.at)<E:Math.abs(a0-s.at)<E);
        if(beyond)taken.push(s.axis==="z"?[a0,a1]:[b0,b1]);}
      for(const o of openings)if(o.axis===s.axis&&Math.abs(o.at-s.at)<E&&o.b==="out")taken.push([o.center-o.width/2-.1,o.center+o.width/2+.1]);
      taken.sort((p,q)=>p[0]-q[0]);
      let a=s.lo+.15;const free:[number,number][]=[];
      for(const [t0,t1] of taken){if(t0>a)free.push([a,Math.min(t0,s.hi-.15)]);a=Math.max(a,t1);}
      if(s.hi-.15>a)free.push([a,s.hi-.15]);
      for(const [f0,f1] of free){const len=f1-f0;if(len<.9||(best&&len<=best.len))continue;
        const width=Math.min(.95,len-.1);
        best={len,o:{type:"front_door",a:r.id,b:"out",axis:s.axis,at:s.at,center:(f0+f1)/2,width,height:2.1,sill:0,hinge:"start",swingInto:"out"}};}
    }
  }
  return best?.o??null;
}
