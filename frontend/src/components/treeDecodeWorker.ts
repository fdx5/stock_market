/// <reference lib="webworker" />
import { decodeTreeVariants, type Meta, type TwigAtlas } from './treeGeometry';
import { packTrees } from './treeGeometryWire';
self.onmessage=async(e:MessageEvent<{meta:Meta;bin:ArrayBuffer;twigAtlas:TwigAtlas}>)=>{
  try{
    const {meta,bin,twigAtlas}=e.data;
    const variants=await decodeTreeVariants(meta,bin,twigAtlas,()=>Promise.resolve());
    const {wire,transfer}=packTrees(variants);
    self.postMessage({wire},transfer);
  }catch(error){self.postMessage({error:String(error)});}
};
