/// <reference lib="webworker" />
import {unpackTrees,type TreeWire}from'./treeGeometryWire';
import {assembleBudgetForest,type BudgetPlant}from'./budgetForestGeometry';
// (one worker for the page's lifetime: the tree kit comes once, then only each build's plants —
// a worker made, and the whole kit copied to it, for every build held the drone's trees back)
let variants:ReturnType<typeof unpackTrees>|null=null;
self.onmessage=async(e:MessageEvent<{wire?:TreeWire;plants?:BudgetPlant[];center?:number[];id?:number}>)=>{
 const {wire,plants,center,id}=e.data;
 if(wire){variants=unpackTrees(wire);if(!plants)return;}
 try{if(!variants)throw Error('no tree kit');const result=await assembleBudgetForest(variants,plants!,center!,()=>Promise.resolve());
  const buffers=Object.values(result).flatMap(p=>Object.values(p).map(a=>a.buffer));self.postMessage({id,result},buffers);
 }catch(error){self.postMessage({id,error:String(error)});}
};
