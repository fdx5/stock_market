import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const directory=new URL('../src/neo/',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1');
const result=await build({stdin:{contents:`export {buildNanotubeGeometry} from './nanotubeGeometry';export {mergeNanotubeBatches} from './nanotubeBatches';`,resolveDir:directory,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const {buildNanotubeGeometry,mergeNanotubeBatches}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
test('merged draws preserve every original wire, halo and hull vertex in original order',()=>{
 const original=buildNanotubeGeometry(),merged=mergeNanotubeBatches(original);
 let vertex=0,index=0,halo=0,hull=0,hullIndex=0;
 for(const part of [...original.tubes,original.links]){
  assert.deepEqual(merged.vertices.slice(vertex,vertex+part.vertices.length),part.vertices);
  for(const old of part.indices)assert.equal(merged.indices[index++],old+vertex/12);
  if(part.haloIndices)for(const old of part.haloIndices)assert.equal(merged.haloIndices[halo++],old+vertex/12);
  vertex+=part.vertices.length;
 }
 original.tubes.forEach((part,id)=>{
  const base=hull/4;
  for(let i=0;i<part.hullVertices.length;i+=3){assert.equal(merged.hullVertices[hull++],part.hullVertices[i]);assert.equal(merged.hullVertices[hull++],part.hullVertices[i+1]);assert.equal(merged.hullVertices[hull++],part.hullVertices[i+2]);assert.equal(merged.hullVertices[hull++],id);}
  for(const old of part.hullIndices)assert.equal(merged.hullIndices[hullIndex++],old+base);
 });
 assert.equal(index,merged.indices.length);assert.equal(halo,merged.haloIndices.length);
 assert.equal(merged.tubeCount+original.links.indices.length,merged.indices.length);
 assert.ok(merged.indices.some(value=>value>65535));assert.ok(merged.indices.every(value=>value<merged.vertices.length/12));
});
