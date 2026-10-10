/// <reference lib="webworker" />
import {modelBlocksRoad} from './roadModelConflict';
import {ringIndex} from './footprintIndex';
export type RoadModelCheckJob={context:string;position:ArrayLike<number>;index:ArrayLike<number>|null;dx:number;dy:number;roads?:[number,number][][];buildings?:[number,number][][]};
export type RoadModelCheckResult={id:number;blocked:boolean;ms:number;needContext?:boolean};
const scope=self as unknown as DedicatedWorkerGlobalScope;
const contexts=new Map<string,{onRoad:(x:number,y:number)=>boolean;onBuilding:(x:number,y:number)=>boolean}>();
scope.onmessage=(e:MessageEvent<RoadModelCheckJob&{id:number}>)=>{
  const j=e.data,t=performance.now();
  try{
    let cached=contexts.get(j.context);
    if(j.roads&&j.buildings){cached={onRoad:ringIndex(j.roads),onBuilding:ringIndex(j.buildings,.75)};contexts.delete(j.context);contexts.set(j.context,cached);if(contexts.size>2)contexts.delete(contexts.keys().next().value!);}
    if(!cached){scope.postMessage({id:j.id,blocked:true,ms:0,needContext:true} satisfies RoadModelCheckResult);return;}
    const {onRoad,onBuilding}=cached;
    scope.postMessage({id:j.id,blocked:modelBlocksRoad(j.position,j.index,j.dx,j.dy,onRoad,onBuilding),ms:performance.now()-t} satisfies RoadModelCheckResult);
  }catch{scope.postMessage({id:j.id,blocked:true,ms:performance.now()-t});}
};
