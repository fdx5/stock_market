/// <reference lib="webworker" />
import {fillTerrainGrid,type TerrainGridJob} from './terrainGrid';

export type TerrainGridResult={id:number;h:Float32Array};
self.onmessage=(event:MessageEvent<TerrainGridJob&{id:number}>)=>{
  const h=fillTerrainGrid(event.data);
  self.postMessage({id:event.data.id,h} satisfies TerrainGridResult,[h.buffer]);
};
