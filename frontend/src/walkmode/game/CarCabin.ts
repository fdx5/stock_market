import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeMeshChildren } from "../interior/geom";
import type { CarProfile } from "./carProfiles";
import type { CabinFit } from "./carCabinFit";
import type { CarCabinSurfaces } from "./carCabinSurfaces";

/** Type-specific driver controls; dimensions, trim, screen layout and wheel vary
 * by the actual selected car. The exterior's cabin seats remain visible outside. */
export class CarCabin {
  readonly group = new THREE.Group(); private wheel = new THREE.Group();
  private geometries: THREE.BufferGeometry[] = []; private materials: THREE.Material[] = [];
  private canvas = document.createElement("canvas"); private texture: THREE.CanvasTexture;
  private last = -Infinity;
  constructor(private profile: CarProfile, private label: string,fit:CabinFit,surfaces?:CarCabinSurfaces) {
    const { spec, eye, seed, layout } = profile, [ex, ey, ez] = eye;
    const palette = ["#22272e", "#35302b", "#212c32", "#3a2426", "#282b32", "#252b23"];
    const mat = (color: string, roughness: number, metalness = 0) => { const m = new THREE.MeshStandardMaterial({ color, roughness, metalness }); this.materials.push(m); return m; };
    const soft = mat(palette[layout], .83), trim = mat(["#b0b4b5", "#71523b", "#8e999f", "#3b3e42"][seed % 4], .32, seed % 4 === 1 ? .05 : .68);
    const dark = mat("#0e1116", .91), accent = mat(["#426b8b", "#977d4a", "#6e677e", "#5e8078"][seed % 4], .42);
    const headliner=mat("#b6b2a9",.95),seam=mat("#8a8580",.85),glass=mat("#627580",.08,.92);
    if(surfaces){soft.map=surfaces.leather;soft.normalMap=surfaces.leatherNormal;soft.normalScale.set(.13,.13);soft.roughnessMap=surfaces.leatherArm;headliner.map=surfaces.linen;headliner.normalMap=surfaces.linenNormal;headliner.normalScale.set(.10,.10);}
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const g = new RoundedBoxGeometry(w,h,d,2,Math.min(w,h,d,.06)*.23); this.geometries.push(g); const mesh = new THREE.Mesh(g,m); mesh.position.set(x,y,z); mesh.receiveShadow = true; this.group.add(mesh); return mesh;
    };
    const dashY = Math.max(fit.belt-.14,ey-.38), dashZ = Math.min(fit.front-.03,ez+.86),depth=.22;
    box(fit.width, .17, depth, 0, dashY, dashZ, soft);
    box(fit.width*.97,.23,depth,0,dashY-.17,dashZ,soft);
    box(fit.width*.97, .025, .02, 0, dashY - .065, dashZ - depth/2-.01, trim);
    box(.23, .14, .65, 0, ey - .66, ez + .12, soft);
    for (const side of [-1,1]) { box(.04,.26,.8,side*spec.width*.42,ey-.43,ez-.08,soft); box(.024,.026,.52,side*spec.width*.40,ey-.30,ez-.12,trim); }
    const rim = new THREE.TorusGeometry((profile.engine==="truck"?.140:.105) + (seed % 4) * .002,.014,12,56); this.geometries.push(rim);
    const rimMesh = new THREE.Mesh(rim, dark); if (layout === 4) rimMesh.scale.set(1.07,.83,1); this.wheel.add(rimMesh);
    const hubGeo = new THREE.CylinderGeometry(.041,.048,.035,24); hubGeo.rotateX(Math.PI/2); this.geometries.push(hubGeo); this.wheel.add(new THREE.Mesh(hubGeo,soft));
    const spokes = 2 + seed % 3;
    for (let i=0;i<spokes;i++) { const a=i/spokes*Math.PI*2 + Math.PI/2, g=new THREE.BoxGeometry(.08,.019,.014); this.geometries.push(g); const m=new THREE.Mesh(g,trim); m.position.set(Math.cos(a)*.070,Math.sin(a)*.070,0); m.rotation.z=a; this.wheel.add(m); }
    const wheelZ=Math.min(dashZ-.15,ez+.56),wheelDrop=profile.engine==="truck"?.24:.27,mount = new THREE.Group(); mount.position.set(ex,ey-wheelDrop,wheelZ); mount.rotation.x=-.20; mount.add(this.wheel); this.group.add(mount);
    const columnLength=Math.max(.04,dashZ-depth/2-wheelZ);box(.085,.08,columnLength,ex,ey-wheelDrop-.01,wheelZ+columnLength/2,soft);
    for (let i=0;i<4+seed%3;i++) box(.06,.015,.035,(i-(3+seed%3)/2)*.10,dashY+.10,dashZ-.08,accent);
    for(const row of [0,1])for(const side of [-1,1]){
      const x=side*spec.width*.215,z=ez-.12-row*.82;
      box(.44,.11,.46,x,ey-.78,z,soft);box(.44,.45,.12,x,ey-.51,z-.19,soft);box(.22,.18,.10,x,ey-.18,z-.19,soft);
    }
    const cabinLength=fit.front-fit.rear;
    box(fit.width,.035,cabinLength,0,Math.max(.14,ey-.94),(fit.front+fit.rear)/2,dark);
    // A closed headliner and solid A-pillars stay opaque from every interior
    // direction, including meshes whose external roof was only single-sided.
    const roofLength=Math.max(.25,fit.frontTop-fit.rear),roofWidth=fit.width*.94;
    const roof=box(roofWidth,.035,roofLength,0,fit.top-.025,(fit.frontTop+fit.rear)/2,headliner);roof.userData.cabinRoof=true;
    const beam=(a:THREE.Vector3,b:THREE.Vector3,width:number,m:THREE.Material)=>{const centre=a.clone().add(b).multiplyScalar(.5),mesh=box(width,a.distanceTo(b),width,centre.x,centre.y,centre.z,m);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());return mesh;};
    for(const side of [-1,1]){
      const pillar=beam(new THREE.Vector3(side*fit.width*.50,fit.belt-.03,fit.front+.10),new THREE.Vector3(side*roofWidth*.50,fit.top-.02,fit.frontTop),.055,headliner);pillar.userData.cabinPillar=true;
      box(.28,.045,.11,side*fit.width*.25,fit.top-.075,fit.frontTop-.10,headliner);
      box(.15,.026,.025,side*fit.width*.40,ey-.34,ez-.16,trim);
      for(let j=0;j<3;j++)box(.025,.010,.025,side*fit.width*.39,ey-.32,ez-.13-j*.045,dark);
    }
    box(.15,.028,.14,0,fit.top-.07,fit.frontTop-.23,trim);
    box(.22,.065,.04,0,Math.min(fit.top-.10,ey+.22),fit.front-.20,dark);
    box(.19,.045,.008,0,Math.min(fit.top-.10,ey+.22),fit.front-.225,glass);
    // Vents, seams and controls are merged by material with the cockpit.
    for(const x of [-fit.width*.34,0,fit.width*.34]){box(.17,.055,.018,x,dashY+.035,dashZ-.075,dark);for(let j=0;j<5;j++)box(.15,.003,.025,x,dashY+.012+j*.010,dashZ-.09,trim);}
    for(const side of [-1,1])for(let j=0;j<2;j++)box(.003,.37,.005,side*spec.width*.215+(j?1:-1)*.18,ey-.51,ez-.315,seam);
    this.canvas.width=512; this.canvas.height=256; this.texture=new THREE.CanvasTexture(this.canvas); this.texture.colorSpace=THREE.SRGBColorSpace;
    const screenMat = new THREE.MeshBasicMaterial({map:this.texture,toneMapped:false}); this.materials.push(screenMat);
    const screenWidth=Math.min(.36,.52*(dashZ-ez)),screenHeight=screenWidth*.36;
    const screenGeo = new THREE.PlaneGeometry(screenWidth,screenHeight); this.geometries.push(screenGeo);
    const display = new THREE.Mesh(screenGeo,screenMat); display.rotation.y=Math.PI;display.position.set(ex,ey-.105,dashZ-.055);display.userData.driverDisplay=true;this.group.add(display);
    box(screenWidth+.025,screenHeight+.025,.028,ex,ey-.105,dashZ-.035,dark);
    for(const object of [...this.group.children,mount,this.wheel]) this.geometries.push(...mergeMeshChildren(object));
    this.update(0,"P",0);
  }
  update(speed: number, gear: string, steer: number) {
    this.wheel.rotation.z=-steer*(11+this.profile.seed%5);
    const now=performance.now(); if(now-this.last<100)return;this.last=now;
    const d=this.canvas.getContext("2d")!; d.fillStyle="#081017";d.fillRect(0,0,512,256);
    const color=["#6bd4ed","#e8ca82","#a2e0c7","#c6baff","#f0f3f5","#8ab9ed"][this.profile.layout];d.fillStyle=color;
    d.font="18px sans-serif";d.fillText(this.label,20,30);d.font="bold 88px sans-serif";d.fillText(String(Math.round(Math.abs(speed)*3.6)),28,135);
    d.font="26px sans-serif";d.fillText("km/h",210,130);d.fillText(gear,420,126);
    d.font="18px sans-serif";d.fillText(this.profile.engine.toUpperCase()+"  ·  MAX "+Math.round(this.profile.topKmh)+" km/h",20,202);
    if(this.profile.layout===0||this.profile.layout===3){d.strokeStyle=color;for(const x of [332,428]){d.beginPath();d.arc(x,182,35,Math.PI,Math.PI*2);d.stroke();}}
    this.texture.needsUpdate=true;
  }
  dispose(){this.group.removeFromParent();this.geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.texture.dispose();}
}
