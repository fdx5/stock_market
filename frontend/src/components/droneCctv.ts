import * as THREE from 'three';
import {cameraPoint,type TrafficCamera} from './trafficCctv';
import type {DroneSigns} from './droneSigns';

/** A shared, bounded batch for actual mapped cameras; no per-camera textures. */
export class DroneCctv {
  private root=new THREE.Group();
  private poleGeometry=new THREE.CylinderGeometry(.07,.1,6,6);
  private cameraGeometry=new THREE.BoxGeometry(.8,.35,.36);
  private material=new THREE.MeshStandardMaterial({color:'#d6e2e8',roughness:.6});
  private poles=new THREE.InstancedMesh(this.poleGeometry,this.material,160);
  private bodies=new THREE.InstancedMesh(this.cameraGeometry,this.material,160);
  private items:TrafficCamera[]=[];
  private heights:number[]=[];
  private matrix=new THREE.Matrix4();private last=0;
  constructor(scene:THREE.Scene,private signs:DroneSigns,private origin:{lat:number;lon:number},private groundAt:(x:number,y:number)=>number){
    this.root.name='public traffic CCTV';this.poles.count=this.bodies.count=0;
    this.root.add(this.poles,this.bodies);scene.add(this.root);
  }
  set(items:TrafficCamera[]){this.items=items;this.heights=[];this.last=0;this.update(Infinity);}
  update(now:number){
    if(now-this.last<1000)return;this.last=Number.isFinite(now)?now:0;
    const visible=this.items.slice(0,160),labels=[];
    let changed=this.poles.count!==visible.length;
    for(let i=0;i<visible.length;i++){
      const c=visible[i],{x,y}=cameraPoint(c,this.origin),ground=this.groundAt(x,y);
      if(this.heights[i]===undefined||Math.abs(this.heights[i]-ground)>.01)changed=true;
      this.heights[i]=ground;
      this.matrix.makeTranslation(x,ground+3,-y);this.poles.setMatrixAt(i,this.matrix);
      this.matrix.makeTranslation(x+.32,ground+6,-y);this.bodies.setMatrixAt(i,this.matrix);
      labels.push({name:c.name,kind:'cctv' as const,x,y,top:ground+6,n:1,camera:c});
    }
    this.poles.count=this.bodies.count=visible.length;
    if(!changed)return;
    this.poles.instanceMatrix.needsUpdate=this.bodies.instanceMatrix.needsUpdate=true;
    this.poles.computeBoundingSphere();this.bodies.computeBoundingSphere();
    this.signs.set('public-cctv',labels);
  }
  materials(){return [this.material];}
  dispose(){this.root.removeFromParent();this.poles.dispose();this.bodies.dispose();this.poleGeometry.dispose();this.cameraGeometry.dispose();this.material.dispose();this.signs.set('public-cctv',null);}
}
