import * as THREE from 'three';
import type {Planting}from'./complexScene';
import {rng}from'./complexScene';
import type {Terrain}from'./sceneTerrain';
import {frameSlice}from'./frameSlice';
import {PARK_TREE_STYLES,WOODLAND_STANDS,woodlandTreeStyle}from'./landscapeDiversity';
import {treeFoliageTone}from'./foliageTone';
import {sceneDeviceBudget}from'./sceneDeviceBudget';
import {hybridSceneEnabled} from './hybridScene';
import {forestCells} from './spatialForest';
import {InstanceBatch,prepareInstanceKernel} from './instanceWasm';

const FOREST_CELL_M=10.5;
export function woodlandDensity(x:number,y:number){
 const t=Math.max(0,Math.min(1,(Math.hypot(x,y)-140)/500)),d=t*t*(3-2*t);
 const cluster=woodlandCluster(x,y);
 return {mergeCell:9+6*d,crownScale:1+.45*d,shade:1-.06*d,treeSpacing:FOREST_CELL_M,occupancy:(.74+.24*d)*(.72+.28*cluster),cluster};
}
/** Smooth world-space stands: dense cores and softer edges, stable across
 * patches, negative coordinates, reloads and camera movements. */
export function woodlandCluster(x:number,y:number){
 const cx=Math.floor(x/64),cy=Math.floor(y/64),sx=x/64-cx,sy=y/64-cy;
 const u=sx*sx*(3-2*sx),v=sy*sy*(3-2*sy),sample=(a:number,b:number)=>rng(9173+a*73856093+b*19349663)();
 return (sample(cx,cy)*(1-u)+sample(cx+1,cy)*u)*(1-v)+(sample(cx,cy+1)*(1-u)+sample(cx+1,cy+1)*u)*v;
}
type Buffers={position:number[];normal:number[];uv:number[];color:number[];index:number[]};
type Root={x:number;y:number;floor:number;pattern:number;priority:number};
/** Eight-triangle closed tube. Bark shares atlas cell 20 with the crowns. */
function tube(out:Buffers,start:THREE.Vector3,end:THREE.Vector3,r0:number,r1:number,angle:number){
 const base=out.position.length/3,axis=end.clone().sub(start).normalize();
 const u=new THREE.Vector3(0,0,1).cross(axis).normalize(),v=axis.clone().cross(u).normalize();
 for(let ring=0;ring<2;ring++)for(let j=0;j<3;j++){
  const a=angle+j*Math.PI*2/3,n=u.clone().multiplyScalar(Math.cos(a)).addScaledVector(v,Math.sin(a));
  const p=(ring?end:start).clone().addScaledVector(n,ring?r1:r0);
  out.position.push(...p.toArray());out.normal.push(...n.addScaledVector(axis,ring?.1:-.1).normalize().toArray());out.color.push(.90,.86,.79);
  out.uv.push(.5+(j%2?124:4)/1024,4/576+(ring?184:0)/576);
 }
 for(let j=0;j<3;j++){const a=base+j,b=base+(j+1)%3,c=a+3,d=b+3;out.index.push(a,b,d,a,d,c);}
 out.index.push(base,base+2,base+1,base+3,base+4,base+5);
}
export const TREE_LEAVES=192,TREE_LEAF_TRIANGLES=TREE_LEAVES*4,TREE_TRIANGLES=TREE_LEAF_TRIANGLES+32;
/** A leaf-shaped, thin closed tetrahedron, with individually shaded faces.
 * Its polygon follows the leaf outline. No rectangular plane, billboard,
 * round shell, alpha mask, camera-facing rotation or animation shader. */
function leaf(out:Buffers,center:THREE.Vector3,width:number,length:number,q:THREE.Quaternion,cell:number,tint:number){
 const points=[new THREE.Vector3(0,.06,length*.5),new THREE.Vector3(0,.06,-length*.5),new THREE.Vector3(-width*.5,0,0),new THREE.Vector3(width*.5,0,0)].map(p=>p.applyQuaternion(q).add(center));
 const uv=[[.5,1],[.5,0],[0,.5],[1,.5]],faces=[[0,1,2],[0,3,1],[0,2,3],[1,3,2]];
 const centroid=points.reduce((a,p)=>a.addScaledVector(p,.25),new THREE.Vector3());
 const u0=cell%8/8+4/1024,u1=(cell%8+1)/8-4/1024,v0=1-(Math.floor(cell/8)+1)/3+4/576,v1=1-Math.floor(cell/8)/3-4/576;
 for(const f of faces){let[a,b,c]=f;const normal=points[b].clone().sub(points[a]).cross(points[c].clone().sub(points[a])),mid=points[a].clone().add(points[b]).add(points[c]).multiplyScalar(1/3).sub(centroid);
  if(normal.dot(mid)<0){[b,c]=[c,b];normal.negate();}normal.normalize();const base=out.position.length/3;
  for(const k of [a,b,c]){out.position.push(...points[k].toArray());out.normal.push(...normal.toArray());out.color.push(tint,tint,tint);out.uv.push(u0+uv[k][0]*(u1-u0),v0+uv[k][1]*(v1-v0));}
  out.index.push(base,base+1,base+2);
 }
}
/** 48 branch sprays of four leaf shapes, plus trunk and three limbs. */
export function treeMeshModel(styleIndex:number,seed=1,leafCount=TREE_LEAVES){
 const style=PARK_TREE_STYLES[styleIndex],random=rng(seed+71),shape=styleIndex===2?[17,4,6.4]:styleIndex===4?[22,7.3,3.8]:styleIndex===1?[20,6.1,4.9]:styleIndex===3?[15,4.5,5.4]:[19,5.4,6.5];
 const[height,ry,radius]=shape,cy=height-ry,out:Buffers={position:[],normal:[],uv:[],color:[],index:[]};
 const leafScale=Math.min(1.5,Math.sqrt(TREE_LEAVES/leafCount));
 for(let n=0;n<leafCount/4;n++){
  const level=1-2*(n+.5)/(leafCount/4),a=n*2.3999632297,spread=Math.sqrt(1-level*level)*(styleIndex===4?(.75-level*.25):1),rad=radius*spread*(.80+random()*.2);
  const branch=new THREE.Vector3(Math.cos(a)*rad,cy+level*ry,Math.sin(a)*rad);
  for(let j=0;j<4;j++){
   const p=branch.clone().add(new THREE.Vector3(Math.cos(a+j*.9)*(.15+j*.24),(random()-.5)*.60,Math.sin(a+j*.9)*(.15+j*.24)));
   const yaw=a+(j%2?1:-1)*(.50+random()*.5),tilt=(random()-.5)*1.9;
   const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt,yaw,(random()-.5)*.6)),needle=styleIndex===2||styleIndex===4;
   leaf(out,p,leafScale*(needle?1.0:1.30)*(1+random()*.25),leafScale*(needle?2.20:1.90)*(1+random()*.25),q,style.cell,.91+random()*.18);
  }
 }
 const leafVertices=out.position.length/3;let low=Infinity;for(let i=1;i<out.position.length;i+=3)low=Math.min(low,out.position[i]);
 tube(out,new THREE.Vector3(0,-.06,0),new THREE.Vector3(.10,height*.78,.08),.28+height*.009,.14,.23);
 for(let k=0;k<3;k++){const a=k*Math.PI*2/3+.4;tube(out,new THREE.Vector3(0,height*(.36+k*.09),0),new THREE.Vector3(Math.cos(a)*radius*.65,cy+(k-1)*ry*.25,Math.sin(a)*radius*.65),.19,.045,a);}
 const geo=new THREE.BufferGeometry();for(const[name,values,size]of [['position',out.position,3],['normal',out.normal,3],['uv',out.uv,2],['color',out.color,3]]as const)geo.setAttribute(name,new THREE.Float32BufferAttribute(values,size));
 geo.setIndex(out.index);geo.computeBoundingBox();geo.computeBoundingSphere();geo.userData.treeModel={height,radius,leafVertices,leafTriangles:leafCount*4,treeTriangles:leafCount*4+32,exposedTrunk:low};return geo;
}

type TreeBank={key:string;refs:number;geometries:THREE.BufferGeometry[];leaves:THREE.BufferGeometry[][];bark:THREE.BufferGeometry;bytes:number;baseTriangles:number;exposed:number[];crownMat:THREE.MeshStandardMaterial;barkMat:THREE.MeshStandardMaterial};
const treeBanks=new Map<string,Promise<TreeBank>>();
async function acquireBank(texture:THREE.Texture|null,pause:()=>Promise<void>,bounded:boolean){
 const key=(texture?.uuid??'procedural-colour')+(bounded?'/bounded':'/full')+(hybridSceneEnabled()?'/spatial':'');let pending=treeBanks.get(key);
 if(!pending){pending=(async()=>{
 const geometries:THREE.BufferGeometry[]=[],leaves:THREE.BufferGeometry[][]=[];let bark:THREE.BufferGeometry|undefined,bytes=0,baseTriangles=0;const exposed:number[]=[];
 const extract=(g:THREE.BufferGeometry,start:number,end:number,t0:number,t1:number)=>{
  const part=new THREE.BufferGeometry();for(const[name,a]of Object.entries(g.attributes))part.setAttribute(name,new THREE.Float32BufferAttribute(a.array.slice(start*a.itemSize,end*a.itemSize),a.itemSize));
  part.setIndex(Array.from(g.index!.array.slice(t0*3,t1*3),v=>v-start));part.computeBoundingBox();part.computeBoundingSphere();geometries.push(part);
  for(const a of Object.values(part.attributes))bytes+=a.array.byteLength;bytes+=part.index!.array.byteLength;baseTriangles+=part.index!.count/3;return part;
 };
 for(let i=0;i<5;i++){
  leaves[i]=[];
  let full:THREE.BufferGeometry|undefined;
  for(const count of bounded||hybridSceneEnabled()?[192,96,48]:[192]){
   if(full){
    // All levels share the full-detail vertex attributes. Keep complete closed
    // leaf sprays spread across the crown; only the index buffer changes.
    const g=new THREE.BufferGeometry();for(const [name,a]of Object.entries(full.attributes))g.setAttribute(name,a);
    const step=192/count,ids:number[]=[];for(let spray=0;spray<48;spray+=step)for(let j=0;j<4*12;j++)ids.push(full.index!.array[spray*48+j]);
    g.setIndex(ids);g.boundingBox=full.boundingBox!.clone();g.boundingSphere=full.boundingSphere!.clone();
    geometries.push(g);bytes+=g.index!.array.byteLength;baseTriangles+=g.index!.count/3;leaves[i].push(g);continue;
   }
   await pause();const model=treeMeshModel(i,1,count),n=model.userData.treeModel.leafVertices,t=model.userData.treeModel.leafTriangles;
   full=extract(model,0,n,0,t);leaves[i].push(full);
   if(!bark){bark=extract(model,n,n+24,t,t+32);if(!texture){const c=bark.attributes.color as THREE.BufferAttribute;for(let j=0;j<c.count;j++)c.setXYZ(j,.30,.19,.10);}}
   if(count===192)exposed.push(model.userData.treeModel.exposedTrunk);model.dispose();
  }
 }
  const crownMat=new THREE.MeshStandardMaterial({map:texture,vertexColors:true,roughness:.9,side:THREE.FrontSide});crownMat.userData.volumeFoliage=true;crownMat.userData.meshLeaves=true;
  const barkMat=new THREE.MeshStandardMaterial({map:texture,vertexColors:true,roughness:.95,side:THREE.FrontSide});barkMat.userData.bark=true;
  return {key,refs:0,geometries,leaves,bark:bark!,bytes,baseTriangles,exposed,crownMat,barkMat} as TreeBank;
 })();treeBanks.set(key,pending);pending.catch(()=>treeBanks.delete(key));}
 const bank=await pending;bank.refs++;return bank;
}
function releaseBank(bank:TreeBank){if(--bank.refs===0){bank.geometries.forEach(g=>g.dispose());bank.crownMat.dispose();bank.barkMat.dispose();treeBanks.delete(bank.key);}}

/** Repeated leaf and branch models share one geometry bank across near/far
 * woodland and park trees. Fixed 250m shadow bands avoid distant leaf shadows.
 * Bounded devices use 250/500m detail bands, without camera-driven rebuilding. */
export async function groveForest(patches:NonNullable<Planting['groves']>,terrain:Terrain,seed:number,texture:THREE.Texture|null,preserveRoots=false,heightScale=1,pause:()=>Promise<void>=()=>frameSlice(12)){
 const bounded=sceneDeviceBudget().constrained;
 let sliceAt=performance.now();const checkpoint=async()=>{if(performance.now()-sliceAt>=3){await pause();sliceAt=performance.now();}};
 const candidates:Root[]=[],legacy=new Set<string>();let sourceCanopies=0;
 for(let pi=0;pi<patches.length;pi++){
  if(pi%16===0)await checkpoint();const patch=patches[pi],cx=patch.points.reduce((s,p)=>s+p[0],0)/Math.max(1,patch.points.length),cy=patch.points.reduce((s,p)=>s+p[1],0)/Math.max(1,patch.points.length),cell=woodlandDensity(cx,cy).mergeCell;
  for(const[x,y]of patch.points){const floor=terrain.at(x,y);sourceCanopies++;legacy.add(`${pi}:${Math.floor(x/cell)}:${Math.floor(y/cell)}:${Math.floor(floor/3.5)}`);candidates.push({x,y,floor,pattern:patch.pattern,priority:rng(seed+Math.round(x*100)*73+Math.round(y*100)*193)()});}
 }
 const bins=new Map<string,Root>();
 for(let n=0;n<candidates.length;n++){if(n%256===0)await checkpoint();const r=candidates[n],cell=FOREST_CELL_M,key=`${Math.floor(r.x/cell)}:${Math.floor(r.y/cell)}`,prev=bins.get(key);if(!prev||r.priority<prev.priority)bins.set(key,r);}
 const roots=(preserveRoots?candidates:[...bins.values()].filter(r=>{
  const bx=Math.floor(r.x/FOREST_CELL_M),by=Math.floor(r.y/FOREST_CELL_M);
  return rng(seed+bx*8191+by*131071)()<woodlandDensity(r.x,r.y).occupancy*WOODLAND_STANDS[((r.pattern%5)+5)%5].density;
 })).sort((a,b)=>a.x-b.x||a.y-b.y);
 const lists=Array.from({length:5},()=>Array.from({length:bounded?3:2},()=>[] as Root[])),toneCounts:Record<string,number>={},speciesCounts:Record<string,number>={},standCounts:Record<string,number>={};let shadowTrees=0,triangles=0;
 for(const r of roots){const pick=rng(seed+Math.round(r.x*100)*313+Math.round(r.y*100)*977)(),i=preserveRoots?Math.floor(pick*5):woodlandTreeStyle(r.pattern,pick),distance=Math.hypot(r.x,r.y),band=distance<250?0:bounded&&distance>=500?2:1;lists[i][band].push(r);triangles+=(bounded?[800,416,224][band]:TREE_TRIANGLES);if(!band)shadowTrees++;const name=PARK_TREE_STYLES[i].species;speciesCounts[name]=(speciesCounts[name]??0)+1;const stand=preserveRoots?'park':WOODLAND_STANDS[((r.pattern%5)+5)%5].name;standCounts[stand]=(standCounts[stand]??0)+1;const tone=treeFoliageTone(r.x,r.y);toneCounts[tone.name]=(toneCounts[tone.name]??0)+1;}
 const group=new THREE.Group();group.name='woodland leaf meshes';
 if(!roots.length)return{group,dispose:()=>{}};
 await pause();const bank=await acquireBank(texture,pause,bounded);
 const temporaryBatches:InstanceBatch[]=[],ownedMeshes=new Set<THREE.InstancedMesh>();
 try{
 const{crownMat,barkMat}=bank;
 const stems=new THREE.InstancedMesh(bank.bark,barkMat,roots.length);stems.name='woodland trunks';let stemCursor=0,instanceBytes=0,minExposedTrunk=Infinity,minTreeHeight=Infinity,maxTreeHeight=0;
 ownedMeshes.add(stems);
 const instanceKernel=await prepareInstanceKernel(),stemBatch=instanceKernel?new InstanceBatch(roots.length,instanceKernel):null;
 if(stemBatch)temporaryBatches.push(stemBatch);
 group.userData.instanceCompute={mode:instanceKernel?'rust-wasm':'javascript',capacity:roots.length*2,retainedBytes:0,memory:()=>instanceKernel?.memory.buffer.byteLength??0};
 const heights=[19,20,17,15,22],radii=[6.5,4.9,6.4,5.4,3.8],exposed=bank.exposed;
 for(let i=0;i<5;i++)for(let band=0;band<(bounded?3:2);band++){
  const list=lists[i][band];if(!list.length)continue;await checkpoint();
  const crowns=new THREE.InstancedMesh(bank.leaves[i][bounded?band:0],crownMat,list.length);crowns.name='woodland '+PARK_TREE_STYLES[i].species+' '+(band?'far'+band:'near')+' leaves';
  ownedMeshes.add(crowns);
  const crownBatch=instanceKernel?new InstanceBatch(list.length,instanceKernel):null;
  if(crownBatch)temporaryBatches.push(crownBatch);
  for(let j=0;j<list.length;j++){
   if(j%128===0)await checkpoint();const r=list[j],random=rng(seed+Math.round(r.x*100)*421+Math.round(r.y*100)*1193),density=woodlandDensity(r.x,r.y);
   const stand=WOODLAND_STANDS[((r.pattern%5)+5)%5],base=(preserveRoots?.90+random()*.20:.72+random()*.38+density.cluster*.16)*heightScale;
   const scale=preserveRoots?base:base*(stand.height[0]+random()*(stand.height[1]-stand.height[0]));
   minTreeHeight=Math.min(minTreeHeight,heights[i]*scale);maxTreeHeight=Math.max(maxTreeHeight,heights[i]*scale);
   const yaw=random()*Math.PI*2,width=preserveRoots?1:stand.width[0]+random()*(stand.width[1]-stand.width[0]),sx=base*density.crownScale*width,sz=preserveRoots?sx:sx*(.84+random()*.32),lean=preserveRoots?0:(random()-.5)*.11;
   if(crownBatch&&stemBatch){crownBatch.set(j,r.x,r.floor,-r.y,yaw,lean,sx,scale,sz);stemBatch.set(stemCursor++,r.x,r.floor,-r.y,yaw,lean,sx*radii[i]/radii[0],scale*heights[i]/heights[0],sz*radii[i]/radii[0]);}
   else{const matrix=new THREE.Matrix4().compose(new THREE.Vector3(r.x,r.floor,-r.y),new THREE.Quaternion().setFromEuler(new THREE.Euler(lean,yaw,0,'YXZ')),new THREE.Vector3(sx,scale,sz));
    crowns.setMatrixAt(j,matrix);const barkMatrix=matrix.clone();barkMatrix.scale(new THREE.Vector3(radii[i]/radii[0],heights[i]/heights[0],radii[i]/radii[0]));stems.setMatrixAt(stemCursor++,barkMatrix);}
   const tone=treeFoliageTone(r.x,r.y),t=tone.name==='green'?PARK_TREE_STYLES[i].tint:tone.tint,shade=(.90+random()*.14)*density.shade;crowns.setColorAt(j,new THREE.Color(t[0]*shade,t[1]*shade,t[2]*shade));minExposedTrunk=Math.min(minExposedTrunk,exposed[i]*scale);
  }
  if(crownBatch){crownBatch.compose(crowns.instanceMatrix.array as Float32Array);crownBatch.dispose();}
  crowns.instanceMatrix.needsUpdate=true;crowns.castShadow=band===0;crowns.receiveShadow=true;crowns.computeBoundingBox();crowns.computeBoundingSphere();
  if(hybridSceneEnabled()&&band){group.add(...forestCells(crowns,480,1024,bank.leaves[i]));crowns.dispose();ownedMeshes.delete(crowns);}else group.add(crowns);
  instanceBytes+=crowns.instanceMatrix.array.byteLength+crowns.instanceColor!.array.byteLength;
 }
 if(stemBatch){stemBatch.compose(stems.instanceMatrix.array as Float32Array);stemBatch.dispose();}
 stems.instanceMatrix.needsUpdate=true;stems.receiveShadow=true;stems.computeBoundingBox();stems.computeBoundingSphere();
 if(hybridSceneEnabled()){group.add(...forestCells(stems,1024,4096));stems.dispose();ownedMeshes.delete(stems);}else group.add(stems);instanceBytes+=stems.instanceMatrix.array.byteLength;
 group.userData.forestBudget={sourceCanopies,clusterCanopies:roots.length,preserveRoots,heightScale,cardClusters:legacy.size,cardTriangleBudget:legacy.size*6,triangles,treeTriangles:TREE_TRIANGLES,leafGroups:TREE_LEAVES/4,meshLeaves:TREE_LEAVES,leafLevels:bounded?[192,96,48]:[192],baseTriangles:bank.baseTriangles,sharedGeometryKey:bank.key,geometryBytes:bank.bytes,instanceBytes,totalBufferBytes:bank.bytes+instanceBytes,cardBufferBytes:legacy.size*600,shadowTrees,mode:'shared leaf-shaped 3D models',toneCounts,speciesCounts,standCounts,minExposedTrunk,minTreeHeight,maxTreeHeight,treeCellM:preserveRoots?null:FOREST_CELL_M,clusterCellM:preserveRoots?null:64,roots:roots.map(r=>[r.x,r.y,r.floor])};
 let disposed=false;return {group,dispose:()=>{if(disposed)return;disposed=true;group.children.forEach(o=>{if(o instanceof THREE.InstancedMesh)o.dispose();});releaseBank(bank);}};
 }catch(error){for(const o of group.children)if(o instanceof THREE.InstancedMesh)ownedMeshes.add(o);ownedMeshes.forEach(o=>o.dispose());releaseBank(bank);throw error;}
 finally{temporaryBatches.forEach(batch=>batch.dispose());}
}
