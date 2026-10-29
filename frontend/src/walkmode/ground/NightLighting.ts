import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { World } from "../../drivegame/world/World";
import type { Traffic } from "../../drivegame/traffic/Traffic";
import type { DrivingCars } from "../game/DrivingCars";
import type { Entrance } from "../game/WalkGame";
import type { ParkedCars } from "../game/ParkedCars";

export const STREET_LIGHT_TYPES = ["도로 LED 외팔등", "대로 양팔등", "곡선형 LED등", "단지 보행등", "단지 볼라드등"] as const;
interface Site { x:number; y:number; z:number; yaw:number; type:number }
const HEIGHT=[8.5,10,7.2,3.4,.95], REACH=[1.7,2.1,1.6,0,0], CAP=768, NEAR_LIGHTS=8;

/** Five globally instanced fixture designs. A fixed eight-light diffuse shader
 * lights nearby surfaces; distant pools and vehicle halos are instanced quads.
 * Only the driven vehicle adds two real (non-shadow) spotlights. No per-lamp
 * shadow maps, bloom pass, or output-resolution changes are needed. */
export class NightLighting {
  readonly group=new THREE.Group();
  readonly stats={fixtures:0,types:[0,0,0,0,0],surfaceLights:0,vehicleBeams:0,vehicleHalos:0,spotlights:2};
  private fixtures:THREE.InstancedMesh[]=[];private lenses:THREE.InstancedMesh[]=[];
  private sites:Site[]=[];private next=0;private materialScan=0;
  private positions=Array.from({length:NEAR_LIGHTS},()=>new THREE.Vector4());
  private colors=Array.from({length:NEAR_LIGHTS},()=>new THREE.Color());
  private metal=new THREE.MeshStandardMaterial({color:0x303b43,roughness:.42,metalness:.72});
  private led=new THREE.MeshBasicMaterial({color:0xffedca,toneMapped:false});
  private owned:THREE.BufferGeometry[]=[];private materials:THREE.Material[]=[];
  private pool:THREE.InstancedMesh;private beams:THREE.InstancedMesh;private halos:THREE.InstancedMesh;
  private texture:THREE.CanvasTexture;private spots:THREE.SpotLight[]=[];
  private matrix=new THREE.Matrix4();private q=new THREE.Quaternion();private p=new THREE.Vector3();private scale=new THREE.Vector3();
  private carMatrix=new THREE.Matrix4();private carQ=new THREE.Quaternion();private carScale=new THREE.Vector3();private carPos=new THREE.Vector3();
  private forward=new THREE.Vector3();private right=new THREE.Vector3();private front=new THREE.Vector3();private rear=new THREE.Vector3();private target=new THREE.Vector3();
  private headColor=new THREE.Color(0xffedc8).multiplyScalar(.7);private tailColor=new THREE.Color(0xff3020).multiplyScalar(.7);private brakeColor=new THREE.Color(0xff2014).multiplyScalar(1.4);private beamColor=new THREE.Color(0xffeed5);
  private up=new THREE.Vector3(0,1,0);private groundQ=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2);
  private lampMap:THREE.Texture;
  constructor(private world:World,private scene:THREE.Scene,private night:number,lampMap:THREE.Texture,private parked:ParkedCars){
    this.lampMap=lampMap;this.group.name="walk-five-style-lighting";
    this.led.color.multiplyScalar(night>.02?2.1:1);
    for(let type=0;type<5;type++){
      const [body,lens]=this.design(type);this.owned.push(body,lens);
      const a=new THREE.InstancedMesh(body,this.metal,CAP),b=new THREE.InstancedMesh(lens,this.led,CAP);
      for(const mesh of [a,b]){mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.group.add(mesh);}
      a.userData.streetLightType=STREET_LIGHT_TYPES[type];this.fixtures.push(a);this.lenses.push(b);
    }
    const c=document.createElement("canvas");c.width=c.height=128;const d=c.getContext("2d")!,gradient=d.createRadialGradient(64,64,0,64,64,64);
    gradient.addColorStop(0,"rgba(255,255,255,.85)");gradient.addColorStop(.18,"rgba(255,255,255,.55)");gradient.addColorStop(.52,"rgba(255,255,255,.16)");gradient.addColorStop(1,"rgba(255,255,255,0)");d.fillStyle=gradient;d.fillRect(0,0,128,128);this.texture=new THREE.CanvasTexture(c);
    const quad=(capacity:number,opacity:number)=>{const geo=new THREE.PlaneGeometry(1,1);this.owned.push(geo);const mat=new THREE.MeshBasicMaterial({map:this.texture,transparent:true,opacity,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-2});this.materials.push(mat);const im=new THREE.InstancedMesh(geo,mat,capacity);im.count=0;im.frustumCulled=false;im.renderOrder=3;im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.group.add(im);return im;};
    this.pool=quad(CAP,.27*night);this.beams=quad(144,.30*night);this.halos=quad(288,.64*night);
    if(night>.02)for(let i=0;i<2;i++){const s=new THREE.SpotLight(0xfff1d7,0,62,.40,.72,2);s.castShadow=false;this.group.add(s,s.target);this.spots.push(s);}this.stats.spotlights=this.spots.length;
    this.scene.add(this.group);
  }
  private design(type:number):[THREE.BufferGeometry,THREE.BufferGeometry]{
    const body:THREE.BufferGeometry[]=[],led:THREE.BufferGeometry[]=[],h=HEIGHT[type];
    const box=(w:number,y:number,z:number,x:number,yy:number,zz:number,light=false)=>{const g=new THREE.BoxGeometry(w,y,z).toNonIndexed().translate(x,yy,zz);(light?led:body).push(g);};
    const pole=(height:number,r:number,x=0,z=0)=>body.push(new THREE.CylinderGeometry(r*.7,r,height,10).toNonIndexed().translate(x,height/2,z));
    box(.34,.15,.34,0,.075,0);pole(h,type===4?.085:.12);
    if(type===0||type===1){for(const sign of type===1?[-1,1]:[1]){box(.10,.12,REACH[type],0,h-.18,sign*REACH[type]/2);box(.38,.12,.85,0,h-.22,sign*REACH[type]);box(.30,.025,.68,0,h-.295,sign*REACH[type],true);}}
    if(type===2){const points=[new THREE.Vector3(0,h-1,0),new THREE.Vector3(0,h-.10,.42),new THREE.Vector3(0,h+.06,1),new THREE.Vector3(0,h-.08,1.6)];body.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),12,.065,6,false).toNonIndexed());box(.32,.11,.72,0,h-.11,1.6);box(.26,.025,.60,0,h-.18,1.6,true);}
    if(type===3){box(.48,.08,.48,0,h+.08,0);box(.32,.26,.32,0,h-.10,0,true);box(.46,.06,.46,0,h-.27,0);for(const x of [-.19,.19])for(const z of [-.19,.19])box(.025,.32,.025,x,h-.10,z);}
    if(type===4){box(.22,.19,.22,0,h-.13,0,true);box(.29,.06,.29,0,h+.005,0);box(.29,.05,.29,0,h-.25,0);}
    const merged=(parts:THREE.BufferGeometry[])=>{const g=mergeGeometries(parts)!;parts.forEach(p=>p.dispose());return g;};return[merged(body),merged(led)];
  }
  /** Attach only at night and preserve every existing facade/material hook. */
  private surface(m:THREE.Material){
    if(this.night<.02||m.userData.walkNightSurface||!(m as THREE.MeshStandardMaterial).isMeshStandardMaterial||m.userData.carGlass)return;
    m.userData.walkNightSurface=true;const before=m.onBeforeCompile,key=m.customProgramCacheKey();
    m.onBeforeCompile=(sh,r)=>{before.call(m,sh,r);sh.uniforms.walkLampPositions={value:this.positions};sh.uniforms.walkLampColors={value:this.colors};
      sh.vertexShader=sh.vertexShader.replace("#include <common>","#include <common>\nvarying vec3 walkLitWorld;").replace("#include <project_vertex>",`#include <project_vertex>
        vec4 walkLitP=vec4(transformed,1.0);
        #ifdef USE_INSTANCING
          walkLitP=instanceMatrix*walkLitP;
        #endif
        walkLitWorld=(modelMatrix*walkLitP).xyz;`);
      sh.fragmentShader=sh.fragmentShader.replace("#include <common>",`#include <common>\nvarying vec3 walkLitWorld;uniform vec4 walkLampPositions[${NEAR_LIGHTS}];uniform vec3 walkLampColors[${NEAR_LIGHTS}];`).replace("#include <lights_fragment_end>",`#include <lights_fragment_end>
        for(int wi=0;wi<${NEAR_LIGHTS};wi++){
          vec3 dl=walkLampPositions[wi].xyz-walkLitWorld;float ds=dot(dl,dl);
          float rangeFade=pow(clamp(1.0-ds/625.0,0.0,1.0),2.0);
          float facing=max(0.0,dot(normal,normalize((viewMatrix*vec4(dl,0.0)).xyz)));
          reflectedLight.directDiffuse+=diffuseColor.rgb*walkLampColors[wi]*(walkLampPositions[wi].w*rangeFade*facing/(ds+2.0));
        }`);
    };m.customProgramCacheKey=()=>key+"-walk-bounded-night-lamps-v1";m.needsUpdate=true;
  }
  prepare(group:THREE.Object3D){group.traverse(o=>{const mesh=o as THREE.Mesh;if(!mesh.isMesh||o.parent===this.group)return;for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]){this.surface(m);if(m.userData.carModel&&!m.userData.carGlass){const physical=m as THREE.MeshStandardMaterial;physical.emissiveMap=this.lampMap;physical.emissive.set(0xffffff);physical.emissiveIntensity=this.night*2.4;}}});}
  private scanMaterials(){this.prepare(this.scene);}
  private lastX=Infinity;private lastY=Infinity;
  /** on a carriageway: no lamp or bollard stands there (ground/streetTruth.ts) */
  onRoad:((x:number,y:number)=>boolean)|null=null;
  /** the roads changed: laid out again at the next update */
  invalidate(){this.lastX=Infinity;this.next=0;}
  private rebuild(x:number,y:number,all:Entrance[]){
    // (only the entrances within reach weighed against each lamp: a town has a thousand of them)
    const entrances=all.filter(e=>Math.hypot(e.x-x,e.y-y)<305);
    const sites:Site[]=[],keys=new Set<string>();
    const add=(site:Site)=>{
      if(Math.hypot(site.x-x,site.y-y)>300)return;
      for(const shift of [0,1.5,-1.5,3,-3]){const s={...site,x:site.x+Math.cos(site.yaw)*shift,y:site.y-Math.sin(site.yaw)*shift};
        const key=`${Math.round(s.x/3)}:${Math.round(s.y/3)}`;
        if(keys.has(key)||this.onRoad?.(s.x,s.y)||this.parked.cameraBlocked(s.x,s.y,s.z+.4,.6)||this.world.buildingAt([s.x,s.y])>0||this.world.wetAt(s.x,s.y)||entrances.some(e=>Math.hypot(e.x-s.x,e.y-s.y)<2.8))continue;
        s.z=this.world.surfaceAt(s.x,s.y);if(!Number.isFinite(s.z))continue;keys.add(key);sites.push(s);break;
      }
    };
    for(const tile of this.world.tiles.values()){const L=tile.result?.lamps;if(!L)continue;for(let i=0;i<L.length;i+=4){const hash=Math.abs(Math.round(L[i]/45)+Math.round(L[i+1]/45));add({x:L[i],y:L[i+1],z:L[i+2],yaw:L[i+3],type:hash%3});}}
    for(const e of entrances){if(Math.hypot(e.x-x,e.y-y)>300)continue;const hx=Math.cos(e.heading),hy=Math.sin(e.heading);
      for(const [along,out,type]of [[-4,3.2,3],[4,3.2,3],[-7,6,4],[7,6,4]]){const sx=e.x+hx*out-hy*along,sy=e.y+hy*out+hx*along;if(this.world.buildingAt([sx,sy])>0||this.world.wetAt(sx,sy)||this.onRoad?.(sx,sy))continue;add({x:sx,y:sy,z:this.world.surfaceAt(sx,sy),yaw:0,type});}
    }
    sites.sort((a,b)=>(a.x-x)**2+(a.y-y)**2-((b.x-x)**2+(b.y-y)**2));this.sites=sites.slice(0,CAP);this.stats.types.fill(0);this.pool.count=0;
    for(const s of this.sites){const k=this.stats.types[s.type]++;this.q.setFromAxisAngle(this.up,s.yaw);this.matrix.compose(this.p.set(s.x,s.z,-s.y),this.q,this.scale.setScalar(1));this.fixtures[s.type].setMatrixAt(k,this.matrix);this.lenses[s.type].setMatrixAt(k,this.matrix);
      if(this.night>.02){const reach=REACH[s.type],px=s.x+Math.sin(s.yaw)*reach,py=s.y-Math.cos(s.yaw)*reach,size=s.type===4?3.5:s.type===3?8:15;
        this.matrix.compose(this.p.set(px,this.world.surfaceAt(px,py)+.10,-py),this.groundQ,this.scale.set(size,size,1));this.pool.setMatrixAt(this.pool.count,this.matrix);this.pool.setColorAt(this.pool.count++,new THREE.Color(s.type>=3?0xffcc85:0xffe6bb));}
    }
    this.fixtures.forEach((mesh,i)=>{mesh.count=this.lenses[i].count=this.stats.types[i];mesh.instanceMatrix.needsUpdate=this.lenses[i].instanceMatrix.needsUpdate=true;});
    this.pool.instanceMatrix.needsUpdate=true;if(this.pool.instanceColor)this.pool.instanceColor.needsUpdate=true;this.stats.fixtures=this.sites.length;
    for(let i=0;i<NEAR_LIGHTS;i++){const s=this.sites[i];if(!s){this.positions[i].set(0,0,0,0);continue;}const reach=REACH[s.type];this.positions[i].set(s.x+Math.sin(s.yaw)*reach,s.z+HEIGHT[s.type]-.1,-s.y+Math.cos(s.yaw)*reach,this.night*(s.type===4?3:s.type===3?22:95));this.colors[i].set(s.type>=3?0xffd49a:0xffedcf);}
    this.stats.surfaceLights=Math.min(NEAR_LIGHTS,this.sites.length);
  }
  update(now:number,camera:THREE.Camera,entrances:Entrance[],traffic:Traffic,driving:DrivingCars|null){
    const x=camera.position.x,y=-camera.position.z;
    // (laid out again when the eye has moved 12 m, or every 4 s: each pass weighs every lamp)
    if(now>this.next&&(Math.hypot(x-this.lastX,y-this.lastY)>12||now>this.next+3350)){this.next=now+650;this.lastX=x;this.lastY=y;this.rebuild(x,y,entrances);}
    if(now>this.materialScan){this.materialScan=now+1800;this.scanMaterials();}
    this.beams.count=this.halos.count=0;this.spots.forEach(s=>s.intensity=0);if(this.night<.02)return;
    const active=driving?.active;
    const vehicle=(matrix:THREE.Matrix4,length:number,width:number,height:number,player=false,brake=false)=>{
      matrix.decompose(this.carPos,this.carQ,this.carScale);if(this.carPos.distanceToSquared(camera.position)>170**2)return;
      const origin=this.carPos,forward=this.forward.set(0,0,1).applyQuaternion(this.carQ),right=this.right.set(1,0,0).applyQuaternion(this.carQ),lampHeight=Math.min(.90,height*.48);
      for(let side=-1;side<=1;side+=2){
        const front=this.front.copy(origin).addScaledVector(forward,length*.46).addScaledVector(right,width*.33*side);front.y+=lampHeight;
        const rear=this.rear.copy(origin).addScaledVector(forward,-length*.47).addScaledVector(right,width*.34*side);rear.y+=Math.min(1.1,height*.53);
        if(this.halos.count+2<=288){this.matrix.compose(front,camera.quaternion,this.scale.set(.42,.42,1));this.halos.setMatrixAt(this.halos.count,this.matrix);this.halos.setColorAt(this.halos.count++,this.headColor);
          const size=brake?.52:.33;this.matrix.compose(rear,camera.quaternion,this.scale.set(size,size,1));this.halos.setMatrixAt(this.halos.count,this.matrix);this.halos.setColorAt(this.halos.count++,brake?this.brakeColor:this.tailColor);}
        if(origin.distanceToSquared(camera.position)<85**2&&this.beams.count<144){const target=this.target.copy(front).addScaledVector(forward,10),h=this.world.surfaceAt(target.x,-target.z);if(Math.abs(h-origin.y)<.4&&this.world.buildingAt([target.x,-target.z])===0){target.y=h+.12;const yaw=Math.atan2(forward.x,forward.z);this.q.setFromAxisAngle(this.up,yaw).multiply(this.groundQ);this.matrix.compose(target,this.q,this.scale.set(4.8,16,1));this.beams.setMatrixAt(this.beams.count,this.matrix);this.beams.setColorAt(this.beams.count++,this.beamColor);}}
        if(player){const spot=this.spots[side===-1?0:1];spot.position.copy(front);spot.target.position.copy(front).addScaledVector(forward,30);spot.target.position.y-=1.15;spot.intensity=520*this.night;}
      }
    };
    for(const o of traffic.group.children){const mesh=o as THREE.InstancedMesh;if(!mesh.isInstancedMesh)continue;if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox!;for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,this.carMatrix);vehicle(this.carMatrix,box.max.z-box.min.z,box.max.x-box.min.x,box.max.y-box.min.y);}}
    if(active)vehicle(active.visual.root.matrixWorld,active.record.length,active.record.width,active.record.height,true,active.vehicle.braking);
    for(const im of [this.beams,this.halos]){im.instanceMatrix.needsUpdate=true;if(im.instanceColor)im.instanceColor.needsUpdate=true;}
    this.stats.vehicleBeams=this.beams.count;this.stats.vehicleHalos=this.halos.count;
  }
  /** Include new courtyard posts in walk, bicycle and vehicle collisions. */
  blocks(x:number,y:number,hx:number,hy:number,hl:number,hw:number){for(const s of this.sites){const dx=s.x-x,dy=s.y-y;if(Math.abs(dx*hx+dy*hy)<hl+.15&&Math.abs(-dx*hy+dy*hx)<hw+.15)return true;}return false;}
  cameraHeight(x:number,y:number){for(const s of this.sites)if(Math.abs(s.x-x)<.28&&Math.abs(s.y-y)<.28)return s.z+HEIGHT[s.type]+.15;return 0;}
  dispose(){for(const im of [...this.fixtures,...this.lenses,this.pool,this.beams,this.halos])im.dispose();this.owned.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.metal.dispose();this.led.dispose();this.texture.dispose();this.spots.forEach(s=>s.dispose());this.group.removeFromParent();}
}
