import * as THREE from "three";
import { Vehicle, type Surroundings } from "../../drivegame/vehicle/physics";
import type { loadWalkCarModels } from "../ground/carModels";
import type { ParkedCar } from "./ParkedCars";
import { carProfile, type CarProfile } from "./carProfiles";
import { CarCabin } from "./CarCabin";
import { CarAudio,playCarEffect } from "./CarAudio";
import type { Sound } from "./sound";
import { fitCarCabin } from "./carCabinFit";
import { CarCabinSurfaces } from "./carCabinSurfaces";
import { carAxles,carWheelAttribute } from "../ground/carWheelMotion";

type Models=Awaited<ReturnType<typeof loadWalkCarModels>>;
interface Visual { root:THREE.Group; wheels:THREE.Group[]; cabin:CarCabin; originalInterior:THREE.Object3D;exterior:THREE.Object3D[];lining:THREE.Mesh;frontGlass:THREE.Mesh;windDetails:THREE.Object3D;phase:number }
interface Active { record:ParkedCar; vehicle:Vehicle; profile:CarProfile; visual:Visual; audio:CarAudio|null }
/** One parked car becomes the player's car. Geometry/materials are shared, wheel
 * pivots animate separately, and parked copies are suppressed by their registry ID. */
export class DrivingCars {
  readonly group=new THREE.Group(); active:Active|null=null;
  private visuals=new Map<string,Visual>();private owned:THREE.BufferGeometry[]=[];
  private parts=new Map<string,{body:THREE.BufferGeometry;interior:THREE.BufferGeometry;windDetails:THREE.BufferGeometry;wheels:{geometry:THREE.BufferGeometry;center:THREE.Vector3;radius:number;front:boolean}[]}>();
  private cameraEye=new THREE.Vector3();private cameraInit=false;private lastImpact=0;private wasFirst=false;
  private liningMaterial=new THREE.MeshStandardMaterial({color:0x8c8982,roughness:.93,side:THREE.BackSide,emissive:0x25272b,emissiveIntensity:.20});
  private cabinSurfaces=new CarCabinSurfaces();
  constructor(private models:Models,private paint:THREE.Material,private glass:THREE.Material,private sound:Sound){}
  async prepare(){await this.cabinSurfaces.ready;for(const kind of this.models.bodies.keys()){this.split(kind);await new Promise<void>(resolve=>setTimeout(resolve,0));}}
  private split(kind:string){
    const prior=this.parts.get(kind);if(prior)return prior;
    const original=this.models.bodies.get(kind)!,p=original.getAttribute("position"),uv=original.getAttribute("uv"),index=original.getIndex()!;
    const axles=carAxles(original),wheelTag=carWheelAttribute(original,axles),wheelParts=axles.flatMap(a=>[-1,1].map(side=>({center:new THREE.Vector3(side*a.x,a.y,a.z),radius:a.radius,front:a.front})));
    const windBox=new THREE.Box3(),glazing=this.models.windows.get(kind)!,gp=glazing.getAttribute("position"),guv=glazing.getAttribute("uv"),gn=glazing.getAttribute("normal"),gi=glazing.getIndex()!;
    for(let i=0;i<gi.count;i++){const a=gi.getX(i),part=Math.floor(guv.getX(a)*16);if(part===12||(part===1&&gn.getZ(a)>.45))windBox.expandByPoint(new THREE.Vector3().fromBufferAttribute(gp,a));}windBox.expandByScalar(.08);
    const wheelIndices:number[][]=wheelParts.map(()=>[]),body:number[]=[],interior:number[]=[],windDetails:number[]=[];
    for(let i=0;i<index.count;i+=3){const a=index.getX(i),v=new THREE.Vector3(p.getX(a),p.getY(a),p.getZ(a)),part=Math.floor(uv.getX(a)*16);let wheel=-1;
      if(Math.abs(wheelTag.getW(a))>.01){let best=Infinity;for(let j=0;j<wheelParts.length;j++){const c=wheelParts[j].center,d=(c.x-wheelTag.getX(a))**2+(c.z-wheelTag.getZ(a))**2;if(d<best){best=d;wheel=j;}}}
      (wheel>=0?wheelIndices[wheel]:part===15?interior:part===2&&windBox.containsPoint(v)?windDetails:body).push(a,index.getX(i+1),index.getX(i+2));}
    const geometry=(indices:number[])=>{const g=new THREE.BufferGeometry();for(const [key,attribute]of Object.entries(original.attributes))g.setAttribute(key,attribute);g.setIndex(indices);g.computeBoundingSphere();this.owned.push(g);return g;};
    const result={body:geometry(body),interior:geometry(interior),windDetails:geometry(windDetails),wheels:wheelIndices.map((indices,i)=>({geometry:geometry(indices),...wheelParts[i]}))};this.parts.set(kind,result);return result;
  }
  private visual(record:ParkedCar,profile:CarProfile){
    const fit=fitCarCabin(profile,this.models.bodies.get(record.kind)!,this.models.windows.get(record.kind)!);
    const prior=this.visuals.get(record.id);if(prior)return prior;
    const root=new THREE.Group(),parts=this.split(record.kind);
    const colored=(geometry:THREE.BufferGeometry)=>{const mesh=new THREE.InstancedMesh(geometry,this.paint,1);mesh.setColorAt(0,record.paint);mesh.castShadow=mesh.receiveShadow=true;return mesh;};
    const glazing=this.models.windows.get(record.kind)!,frontIndices:number[]=[],sideIndices:number[]=[],idx=glazing.getIndex()!,uv=glazing.getAttribute("uv"),normal=glazing.getAttribute("normal");
    for(let i=0;i<idx.count;i+=3){const a=idx.getX(i),part=Math.floor(uv.getX(a)*16);(part===12||(part===1&&normal.getZ(a)>.45)?frontIndices:sideIndices).push(a,idx.getX(i+1),idx.getX(i+2));}
    const glassPart=(indices:number[])=>{const geo=new THREE.BufferGeometry();for(const [key,attribute]of Object.entries(glazing.attributes))geo.setAttribute(key,attribute);geo.setIndex(indices);this.owned.push(geo);return new THREE.Mesh(geo,this.glass);};
    const frontGlass=glassPart(frontIndices),originalInterior=colored(parts.interior),exterior=[colored(parts.body),glassPart(sideIndices)];root.add(...exterior,frontGlass,originalInterior);
    const lining=new THREE.Mesh(parts.body,this.liningMaterial);lining.visible=false;root.add(lining);
    const windDetails=colored(parts.windDetails);root.add(windDetails);
    const wheels=parts.wheels.map(part=>{const pivot=new THREE.Group(),spin=new THREE.Group(),mesh=colored(part.geometry);pivot.position.copy(part.center);pivot.userData.radius=part.radius;pivot.userData.front=part.front;mesh.position.copy(part.center).negate();spin.add(mesh);pivot.add(spin);root.add(pivot);return pivot;});
    const cabin=new CarCabin(profile,record.label,fit,this.cabinSurfaces);cabin.group.visible=false;root.add(cabin.group);this.group.add(root);
    const visual={root,wheels,cabin,originalInterior,exterior,lining,frontGlass,windDetails,phase:0};this.visuals.set(record.id,visual);return visual;
  }
  mount(record:ParkedCar,environment:Surroundings){
    if(this.active)return;
    this.sound.resume();const profile=carProfile(record),visual=this.visual(record,profile),vehicle=new Vehicle(profile.spec,record.x,record.y,record.heading,environment);
    vehicle.body.length=record.body.length;vehicle.body.width=record.body.width;
    const graph=this.sound.audioGraph,audio=graph?new CarAudio(graph.ctx,graph.output,graph.noise,profile):null;
    record.parked=false;record.separate=true;this.active={record,profile,visual,vehicle,audio};this.cameraInit=false;this.pose(0,record.z);playCarEffect("door",this.sound);if(profile.engine!=="ev")playCarEffect("ignition",this.sound,.65);
  }
  update(dt:number,steer:number,pedal:number,hand:boolean,height:(x:number,y:number)=>number){
    const a=this.active;if(!a)return;const elapsed=Number.isFinite(dt)?Math.min(.1,Math.max(0,dt)):0;
    // Faster cars also sweep at most 14 cm per physics step.
    const count=Math.max(1,Math.ceil(elapsed*Math.max(120,Math.abs(a.vehicle.body.speed)/.14))),h=elapsed/count;
    let travelled=0;
    for(let i=0;i<count;i++){const before=a.vehicle.body.speed;a.vehicle.step(h,{throttle:Math.max(0,pedal),brake:Math.max(0,-pedal),steer:-steer,hand,boost:false});
      a.vehicle.body.speed=Math.max(-a.profile.spec.reverseMax,Math.min(a.profile.topKmh/3.6,a.vehicle.body.speed));travelled+=(before+a.vehicle.body.speed)*h*.5;
      if(a.vehicle.bump>1.2&&performance.now()-this.lastImpact>220){this.lastImpact=performance.now();playCarEffect("impact",this.sound,Math.min(1.4,.5+a.vehicle.bump/18));}}
    const b=a.vehicle.body,z=height(b.x,b.y);if(Number.isFinite(z))a.record.z+=(z-a.record.z)*Math.min(1,dt*15);
    a.visual.phase+=travelled;this.pose(dt,a.record.z);
    a.visual.wheels.forEach(w=>{w.rotation.set(0,w.userData.front?a.vehicle.steer:0,0);const mesh=w.children[0];mesh.rotation.x=a.visual.phase/Math.max(.12,w.userData.radius);});
    a.visual.cabin.update(b.speed,a.vehicle.gearLabel,a.vehicle.steer);
    a.audio?.update(a.vehicle.revsShare,a.vehicle.throttle,b.speed,a.vehicle.braking,a.vehicle.slip,a.visual.cabin.group.visible);
  }
  private pose(_dt:number,z:number){const a=this.active;if(!a)return;const b=a.vehicle.body;a.visual.root.position.set(b.x,z,-b.y);a.visual.root.rotation.set(0,Math.atan2(b.hx,-b.hy),-a.vehicle.steer*Math.min(Math.abs(b.speed)/40,1)*.06);a.visual.root.updateMatrixWorld(true);}
  stop(){const a=this.active;if(!a)return;a.vehicle.body.speed=0;a.vehicle.throttle=0;a.vehicle.steer=0;a.audio?.stop();}
  dismount(){const a=this.active;if(!a)return;this.stop();playCarEffect("door",this.sound);a.audio?.dispose();a.visual.cabin.group.visible=false;a.visual.lining.visible=false;a.visual.frontGlass.visible=true;a.visual.originalInterior.visible=true;for(const object of [...a.visual.exterior,...a.visual.wheels])object.visible=true;a.record.parked=true;this.active=null;this.cameraInit=false;}
  camera(camera:THREE.PerspectiveCamera,first:boolean,yaw:number,pitch:number,_dt:number,_building:(x:number,y:number)=>number){
    const a=this.active;if(!a)return;const b=a.vehicle.body;if(first){yaw=Math.atan2(-b.hx,b.hy);pitch=-.035;}const look=new THREE.Vector3(-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
    a.visual.cabin.group.visible=first;
    a.visual.originalInterior.visible=!first;
    a.visual.lining.visible=first;a.visual.frontGlass.visible=!first;a.visual.windDetails.visible=!first;
    for(const object of [...a.visual.exterior,...a.visual.wheels])object.visible=true;
    if(first!==this.wasFirst){this.cameraInit=false;this.wasFirst=first;}camera.up.set(0,1,0);
    const fov=first?66:62;if(camera.fov!==fov){camera.fov=fov;camera.updateProjectionMatrix();}
    if(first){const eye=new THREE.Vector3(...a.profile.eye).applyMatrix4(a.visual.root.matrixWorld);camera.position.copy(eye);camera.lookAt(eye.clone().add(look));return;}
    // Rear chase only. Mouse/touch angles and sideways collision fallbacks must
    // never turn this into an orbit, a side view, or a view inside the rear glass.
    const target=new THREE.Vector3(b.x,a.record.z+a.record.height*.50,-b.y),distance=Math.max(6.5,a.record.length*1.4),height=Math.min(1.2,.75+a.record.height*.12);
    camera.position.set(b.x-b.hx*distance,target.y+height,-b.y+b.hy*distance);camera.lookAt(target);
  }
  visibleFrom(x:number,y:number){for(const [id,visual]of this.visuals){if(this.active?.record.id===id){visual.root.visible=true;continue;}visual.root.visible=Math.hypot(visual.root.position.x-x,visual.root.position.z+y)<220;}}
  dispose(){this.active?.audio?.dispose();for(const v of this.visuals.values()){v.cabin.dispose();v.root.traverse(o=>{if((o as THREE.InstancedMesh).isInstancedMesh)(o as THREE.InstancedMesh).dispose();});}this.owned.forEach(g=>g.dispose());this.liningMaterial.dispose();this.cabinSurfaces.dispose();this.visuals.clear();this.parts.clear();this.group.removeFromParent();}
}
