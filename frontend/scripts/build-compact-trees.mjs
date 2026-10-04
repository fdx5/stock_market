// Offline crown grouping and trunk build from the original species volumes.
import {readFileSync,writeFileSync,mkdirSync}from'node:fs';
import {build}from'esbuild';
import * as THREE from'three';
import {pathToFileURL,fileURLToPath}from'node:url';
import path from'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
mkdirSync(path.join(root,'tmp'),{recursive:true});
const modulePath=path.join(root,'tmp','tree-asset-builder.mjs');
await build({stdin:{contents:"export {decodeTreeVariants} from './src/components/treeGeometry';export {densityCrown,distantFlowers,shapeSpeciesCrown} from './src/components/densityTreeGeometry';",resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',external:['three'],outfile:modulePath});
const {decodeTreeVariants,densityCrown,distantFlowers,shapeSpeciesCrown}=await import(pathToFileURL(modulePath));
const pub=path.join(root,'public','3d'),json=name=>JSON.parse(readFileSync(path.join(pub,name),'utf8'));
const raw=readFileSync(path.join(pub,'trees.bin'));
const meta=json('trees.json'),twig=json('twigs.json');
const variants=await decodeTreeVariants(meta,raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),twig,async()=>{},false);
function simpleTrunk(v,branches=false){
 const g=v.bark;if(!g.index)return g;
 const p=g.attributes.position,c=g.attributes.color,root=new THREE.Box3(),tint=new THREE.Vector3();let samples=0;
 for(let i=0;i<p.count;i++)if(p.getY(i)<v.v.height*.06){root.expandByPoint(new THREE.Vector3().fromBufferAttribute(p,i));tint.add(new THREE.Vector3().fromBufferAttribute(c,i));samples++;}
 if(!samples)return g;
 v.leaves.computeBoundingBox();const h=Math.min(v.v.height*.7,Math.max(v.v.height*.35,v.leaves.boundingBox.min.y+.1));
 const radius=Math.max(.055,Math.max(root.max.x-root.min.x,root.max.z-root.min.z)*.5);
 const out=new THREE.CylinderGeometry(radius*.62,radius,h,8,1,false);out.translate((root.min.x+root.max.x)*.5,h*.5,(root.min.z+root.max.z)*.5);
 if(branches && v.v.height>1.6){
  const parts=[out],center=v.leaves.boundingBox.getCenter(new THREE.Vector3()),span=v.leaves.boundingBox.getSize(new THREE.Vector3());
  for(let i=0;i<4;i++){
   const a=i*Math.PI*.5+.35,start=new THREE.Vector3((root.min.x+root.max.x)*.5,h*(.58+i*.07),(root.min.z+root.max.z)*.5);
   const end=new THREE.Vector3(center.x+Math.cos(a)*span.x*.24,Math.max(start.y+.15,center.y-span.y*.18),center.z+Math.sin(a)*span.z*.24);
   const delta=end.clone().sub(start),branch=new THREE.CylinderGeometry(radius*.16,radius*.44,delta.length(),5,1,false);
   branch.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));branch.translate(...start.add(end).multiplyScalar(.5).toArray());parts.push(branch);
  }
  const attributes={};let vertices=0;const indices=[];
  for(const part of parts){for(const[name,a]of Object.entries(part.attributes))(attributes[name]??=[]).push(...a.array);for(const index of part.index.array)indices.push(index+vertices);vertices+=part.attributes.position.count;}
  for(const[name,a]of Object.entries(attributes))out.setAttribute(name,new THREE.Float32BufferAttribute(a,name==='uv'?2:3));out.setIndex(indices);
 }
 const values=new Float32Array(out.attributes.position.count*3);tint.multiplyScalar(1/samples);for(let i=0;i<values.length;i+=3)values.set([tint.x,tint.y,tint.z],i);
 out.setAttribute('color',new THREE.BufferAttribute(values,3));out.computeBoundingSphere();return out;
}
const parts=[],ids=new Map(),chunks=[];let offset=0;
const append=a=>{const data=Buffer.from(a.buffer,a.byteOffset,a.byteLength);const at=offset;chunks.push(data);offset+=data.length;return at;};
function encode(g){
 if(ids.has(g))return ids.get(g);const id=parts.length;ids.set(g,id);
 const attributes={};for(const[name,a]of Object.entries(g.attributes)){const data=new Float32Array(a.array);attributes[name]={offset:append(data),count:data.length,size:a.itemSize};}
 const index=new Uint32Array(g.index?.array??[]);parts.push({attributes,index:{offset:append(index),count:index.length}});return id;
}
const entries=[];let before=0,after=0;
const proceduralSpecies=new Set(['zelkova','plane','ginkgo','cherry','fringe','pine','conifer']);
const blank=new THREE.BufferGeometry();for(const[name,size]of [['position',3],['normal',3],['uv',2],['color',3]])blank.setAttribute(name,new THREE.Float32BufferAttribute([],size));blank.setIndex([]);
for(const[species,list]of variants)for(const v of list){
 if(proceduralSpecies.has(species)){
  // Species metadata remains available to planting rules. Their actual leaf
  // meshes are shared procedural templates; do not download obsolete shells.
  entries.push({v:v.v,twig:v.twig,parts:Array(5).fill(encode(blank))});continue;
 }
 const isTwig=v.twig,cell=Math.max(0,twig.order.findIndex(x=>x.startsWith(species+'_')));
 const tree=v.v.height>=1.6;
 const leaves=isTwig?shapeSpeciesCrown(densityCrown(v.leaves,tree?3:2,cell),species):distantFlowers(v.leaves,32);
 const far=isTwig?shapeSpeciesCrown(densityCrown(v.leaves,2,cell),species):distantFlowers(v.leaves,16);
 const farthest=isTwig?far:distantFlowers(v.leaves,12);
 const farBark=simpleTrunk(v);
 const nearBark=tree?simpleTrunk(v,true):farBark;
 entries.push({v:v.v,twig:isTwig,parts:[nearBark,leaves,farBark,far,farthest].map(encode)});
 before+=v.farthestLeaves.index.count/3+(v.farBark.index?.count??0)/3;
 after+=farthest.index.count/3+(farBark.index?.count??0)/3;
}
writeFileSync(path.join(pub,'trees-compact.bin'),Buffer.concat(chunks));
writeFileSync(path.join(pub,'trees-compact.json'),JSON.stringify({version:1,species:meta.species,parts,variants:entries}));
console.log(JSON.stringify({variants:entries.length,bytes:offset,originalBytes:raw.length,farthestTrianglesBefore:before,farthestTrianglesAfter:after}));
