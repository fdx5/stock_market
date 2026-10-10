import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {STRIDE,type RailFacility,type RailPath} from './railCore';

/** Source polygons establish the plan. Roof clearance, columns and facade details
 * are schematic where no surveyed station model/height is supplied. */
export function stationKit(f:RailFacility,path:RailPath,origin:{lon:number;lat:number},heightAt:(x:number,y:number)=>number){
  const kx=111320*Math.cos(origin.lat*Math.PI/180),ring=f.points.map(p=>new THREE.Vector2((p[0]-origin.lon)*kx,(p[1]-origin.lat)*110540));
  const group=new THREE.Group();group.name=`station-${f.stationName}-${f.id}`;group.userData.railBuilding=true;
  const geos:THREE.BufferGeometry[]=[],materials:THREE.Material[]=[];
  const add=(g:THREE.BufferGeometry,m:THREE.Material)=>{geos.push(g);const mesh=new THREE.Mesh(g,m);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);};
  const inside=(x:number,y:number)=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
  const bounds=[Math.min(...ring.map(p=>p.x))-35,Math.min(...ring.map(p=>p.y))-35,Math.max(...ring.map(p=>p.x))+35,Math.max(...ring.map(p=>p.y))+35],local:number[][]=[];
  for(let i=0;i<path.points.length;i+=STRIDE){const v=path.points,x=v[i],y=v[i+1];if(x>=bounds[0]&&x<=bounds[2]&&y>=bounds[1]&&y<=bounds[3])local.push([x,y,v[i+2]]);}
  const hall=local.filter(p=>inside(p[0],p[1]));
  // A separate station head house is already drawn from the building register.
  // Raising it to the nearby elevated track would put an unrelated roof in midair.
  if(!local.length||f.kind==='station'&&!hall.length)return{group,dispose:()=>group.removeFromParent()};
  const height=(x:number,y:number)=>local.reduce((best,p)=>Math.hypot(p[0]-x,p[1]-y)<Math.hypot(best[0]-x,best[1]-y)?p:best)[2];
  const railH=Math.max(...(hall.length?hall:local).map(p=>p[2]));
  const concrete=new THREE.MeshStandardMaterial({color:'#c1c7c7',roughness:.85,side:THREE.DoubleSide}),roof=new THREE.MeshStandardMaterial({color:'#63737c',metalness:.25,roughness:.6,side:THREE.DoubleSide});materials.push(concrete,roof);
  const outline=new THREE.Shape(ring),tri=THREE.ShapeUtils.triangulateShape(ring,[]);
  const surface=(h:(x:number,y:number)=>number)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(ring.flatMap(p=>[p.x,h(p.x,p.y),-p.y]),3));g.setIndex(tri.flat().reverse());g.computeVertexNormals();return g;};
  const ground=Math.min(...ring.map(p=>heightAt(p.x,p.y)));
  if(f.kind==='platform'){
    add(surface((x,y)=>height(x,y)+.9),concrete);
    // Platform edges and tactile yellow strips follow the mapped platform polygon.
    const strips:THREE.BufferGeometry[]=[];
    for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],len=a.distanceTo(b);if(len<.2)continue;
      const ha=height(a.x,a.y)+.9,hb=height(b.x,b.y)+.9,direction=new THREE.Vector3(b.x-a.x,hb-ha,a.y-b.y),g=new THREE.BoxGeometry(.22,.035,direction.length());
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),direction.normalize()));g.translate((a.x+b.x)/2,(ha+hb)/2+.018,-(a.y+b.y)/2);strips.push(g);
    }
    if(strips.length){const m=new THREE.MeshStandardMaterial({color:'#d8b84c',roughness:.9});materials.push(m);add(mergeGeometries(strips)!,m);strips.forEach(g=>g.dispose());}
  }
  if(f.kind==='station'||f.shelter){
    const h=Math.max(railH+6.15,ground+(f.height??0)),parts:THREE.BufferGeometry[]=[];
    const g=new THREE.ExtrudeGeometry(outline,{depth:.25,bevelEnabled:false,steps:1});g.rotateX(-Math.PI/2);g.translate(0,h,0);add(g,roof);
    // Open train halls, not solid apartment prisms. The common clearance pass
    // also cuts any perimeter column that falls on a mapped track.
    for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],len=a.distanceTo(b),n=Math.max(1,Math.ceil(len/12));
      for(let j=0;j<n;j++){const t=j/n,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,bottom=f.kind==='station'?heightAt(x,y):height(x,y)+.9;
        const column=new THREE.BoxGeometry(.36,Math.max(.5,h-bottom),.36).translate(x,(h+bottom)/2,-y);parts.push(column);
      }
    }
    if(parts.length){add(mergeGeometries(parts)!,concrete);parts.forEach(g=>g.dispose());}
  }
  return{group,dispose:()=>{group.removeFromParent();geos.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}};
}
