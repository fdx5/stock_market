/// <reference lib="webworker" />
import {modelBlocksRoad} from './roadModelConflict';
import {ringIndex} from './footprintIndex';
export type RoadModelCheckJob={context:string;position:ArrayLike<number>;index:ArrayLike<number>|null;dx:number;dy:number;roads:[number,number][][];buildings:[number,number][][]};
export type RoadModelCheckResult={id:number;blocked:boolean;ms:number};
const scope=self as unknown as DedicatedWorkerGlobalScope;
let context='',onRoad:(x:number,y:number)=>boolean=()=>false,onBuilding:(x:number,y:number)=>boolean=()=>false;
scope.onmessage=(e:MessageEvent<RoadModelCheckJob&{id:number}>)=>{
  const j=e.data,t=performance.now();
  try{
    if(context!==j.context){onRoad=ringIndex(j.roads);onBuilding=ringIndex(j.buildings);context=j.context;}
    scope.postMessage({id:j.id,blocked:modelBlocksRoad(j.position,j.index,j.dx,j.dy,onRoad,onBuilding),ms:performance.now()-t} satisfies RoadModelCheckResult);
  }catch{scope.postMessage({id:j.id,blocked:true,ms:performance.now()-t});}
};
