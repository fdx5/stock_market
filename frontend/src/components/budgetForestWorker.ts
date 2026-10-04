/// <reference lib="webworker" />
import {unpackTrees,type TreeWire}from'./treeGeometryWire';
import {assembleBudgetForest,type BudgetPlant}from'./budgetForestGeometry';
self.onmessage=async(e:MessageEvent<{wire:TreeWire;plants:BudgetPlant[];center:number[]}>)=>{
 try{const {wire,plants,center}=e.data,result=await assembleBudgetForest(unpackTrees(wire),plants,center,()=>Promise.resolve());
  const buffers=Object.values(result).flatMap(p=>Object.values(p).map(a=>a.buffer));self.postMessage({result},buffers);
 }catch(error){self.postMessage({error:String(error)});}
};
