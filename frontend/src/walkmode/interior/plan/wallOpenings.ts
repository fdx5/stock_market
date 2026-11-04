import type {Opening,Room} from './types';

const EPS=.002;
const known=new Set<Opening['type']>(['door','sliding_door','front_door','glass_door','window','balcony_window','open']);
type Owner={room:Room;side:number;lo:number;hi:number};
/** a flat's shared spaces: an opening between two of them is a passage whoever it was read for */
const SHARED=new Set(['living','kitchen','dining','hall','corridor','entrance']);

/** Clip holes to real, opposing room boundaries. A shared semantic zone alone
 * never authorizes a hole in an exterior wall or across a missing floor strip. */
export function resolveWallOpenings(rooms:Room[],input:Opening[],expandZones=false):Opening[]{
 const byId=new Map(rooms.map(r=>[r.id,r]));
 const result:Opening[]=[];
 for(const source of input){
  if(!known.has(source.type)||!['x','z'].includes(source.axis)||![source.at,source.center,source.width,source.height,source.sill].every(Number.isFinite)||source.width<=0||source.height<=0||source.sill<0)continue;
  const a=byId.get(source.a),b=byId.get(source.b);if(!a||(!b&&source.b!=='out'))continue;
  if(source.b==='out'&&source.type==='open')continue;
  const j=source.axis==='x'?0:1,k=1-j;
  const edge=[a.rect[j],a.rect[j+2]].sort((x,y)=>Math.abs(x-source.at)-Math.abs(y-source.at))[0];
  if(Math.abs(edge-source.at)>EPS)continue;
  const lo=source.center-source.width/2,hi=source.center+source.width/2;
  const owners:Owner[]=rooms.flatMap(room=>{
   const side=Math.abs(room.rect[j]-edge)<=EPS?1:Math.abs(room.rect[j+2]-edge)<=EPS?-1:0;
   return side&&room.rect[k]<hi-EPS&&room.rect[k+2]>lo+EPS?[{room,side,lo:room.rect[k],hi:room.rect[k+2]}]:[];
  });
  const matches=(room:Room,anchor:Room)=>room.id===anchor.id||(expandZones&&room.zone===anchor.zone);
  const cuts=[...new Set([lo,hi,...owners.flatMap(o=>[Math.max(lo,o.lo),Math.min(hi,o.hi)])])].sort((x,y)=>x-y);
  const runs:{lo:number;hi:number;a:Room;b:Room|undefined}[]=[];
  for(let n=1;n<cuts.length;n++){
   const start=cuts[n-1],end=cuts[n];if(end-start<EPS)continue;
   const mid=(start+end)/2,at=owners.filter(o=>o.lo<=mid&&o.hi>=mid);
   let aa:Owner|undefined,bb:Owner|undefined;
   for(const owner of at.filter(o=>matches(o.room,a))){
    const opposite=at.filter(o=>o.side!==owner.side);
    const other=b?opposite.find(o=>matches(o.room,b)):undefined;
    if(b?!other:opposite.length>0)continue;
    aa=owner;bb=other;break;
   }
   // A drawn passage between shared spaces is no wall, whichever pieces the bookkeeping named:
   // the rooms that really face each other across this stretch own it (never an exterior edge,
   // never a private room's boundary — those still need their own matching pair).
   if(!aa&&expandZones&&source.type==='open'&&b){
    const before=at.filter(o=>o.side===-1),after=at.filter(o=>o.side===1);
    if(before.length===1&&after.length===1&&[before[0].room,after[0].room].every(r=>SHARED.has(r.surfaceType??r.type))&&[a,b].some(r=>matches(before[0].room,r)||matches(after[0].room,r))){aa=before[0];bb=after[0];}
   }
   if(!aa)continue;
   // A private-room boundary cannot become a full-height, frame-only opening.
   // Same-room decomposition seams and an open living/kitchen remain continuous.
   if(expandZones&&source.type==='open'&&b&&a.zone!==b.zone&&[a,b].some(r=>['bedroom','master','bathroom','ensuite','dressroom'].includes(r.surfaceType??r.type)))continue;
   const prior=runs[runs.length-1];
   // (one opening across pieces of the same two rooms; a stretch owned by other rooms its own —
   // the builder cuts each wall only where its own pair meets)
   if(prior&&Math.abs(prior.hi-start)<EPS&&prior.a.zone===aa.room.zone&&prior.b?.zone===bb?.room.zone)prior.hi=end;
   else runs.push({lo:start,hi:end,a:aa.room,b:bb?.room});
  }
  for(const run of runs){
   if(run.hi-run.lo<.01)continue;
   // A representative pair carries one continuous opening across decomposition
   // pieces. The builder still verifies the owners of every local wall segment.
   result.push({...source,a:run.a.id,b:run.b?.id??'out',at:edge,center:(run.lo+run.hi)/2,width:run.hi-run.lo});
  }
 }
 // Explicit doors/windows take precedence over a broad decomposition seam.
 const concrete=result.filter(o=>o.type!=='open');
 const clipped:Opening[]=[...concrete];
 for(const opening of result.filter(o=>o.type==='open')){
  let runs=[[opening.center-opening.width/2,opening.center+opening.width/2]];
  for(const o of concrete.filter(o=>o.axis===opening.axis&&Math.abs(o.at-opening.at)<EPS)){
   const lo=o.center-o.width/2,hi=o.center+o.width/2;
   runs=runs.flatMap(([a,b])=>hi<=a||lo>=b?[[a,b]]:[[a,Math.min(b,lo)],[Math.max(a,hi),b]].filter(([x,y])=>y-x>=.01));
  }
  clipped.push(...runs.map(([a,b])=>({...opening,center:(a+b)/2,width:b-a})));
 }
 const seen=new Set<string>();
 return clipped.filter(o=>{const key=[o.type,o.axis,o.at.toFixed(4),o.center.toFixed(4),o.width.toFixed(4),o.sill.toFixed(4),o.height.toFixed(4)].join(':');if(seen.has(key))return false;seen.add(key);return true;});
}

/** Verify the local side too: no opening can leak from one zone piece into an
 * unrelated exterior edge just because both share a room name. */
export function openingsOnWall(rooms:Room[],openings:Opening[],room:Room,axis:'x'|'z',at:number,lo:number,hi:number,expandZones=false):(Opening&{sourceOpening:Opening})[]{
 const j=axis==='x'?0:1,k=1-j,side=Math.abs(room.rect[j]-at)<EPS?1:-1;
 const byId=new Map(rooms.map(r=>[r.id,r]));
 const same=(id:string)=>{const r=byId.get(id);return r&&(r.id===room.id||(expandZones&&r.zone===room.zone));};
 const result:(Opening&{sourceOpening:Opening})[]=[];
 for(const o of openings){
  if(o.axis!==axis||Math.abs(o.at-at)>EPS||(!same(o.a)&&!same(o.b)))continue;
  const start=Math.max(lo,o.center-o.width/2),end=Math.min(hi,o.center+o.width/2);if(end-start<.001)continue;
  const a=byId.get(o.a),b=byId.get(o.b),other=same(o.a)?b:a;
  const cuts=[start,end,...rooms.flatMap(r=>[r.rect[k],r.rect[k+2]]).filter(v=>v>start&&v<end)].sort((a,b)=>a-b);
  for(let n=1;n<cuts.length;n++){
   const x=cuts[n-1],y=cuts[n];if(y-x<.001)continue;
   const mid=(x+y)/2;
   const opposite=rooms.filter(r=>r.id!==room.id&&r.rect[k]<=mid&&r.rect[k+2]>=mid&&Math.abs((side===1?r.rect[j+2]:r.rect[j])-at)<EPS);
   if(o.b==='out'?opposite.length>0:!other||!opposite.some(r=>r.id===other.id||(expandZones&&r.zone===other.zone)))continue;
   result.push({...o,center:(x+y)/2,width:y-x,sourceOpening:o});
  }
 }
 return result;
}
