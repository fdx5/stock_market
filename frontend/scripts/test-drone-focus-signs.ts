import assert from "node:assert/strict";
import * as THREE from "three";
import { apartmentDroneLabels } from "../src/components/droneFocusSigns";
import { DroneSigns } from "../src/components/droneSigns";
import type { RealEstateBuildingsResponse } from "../src/api/client";
for(const name of ["강남데시앙포레","신도6차","다른아파트"]){
 const id="drone-point:37.480907:127.090167",home=`11680:수서동:219:${name}`;
 const data:RealEstateBuildingsResponse={id,name,address:"",built:2014,found:true,site:[],context:[],buildings:[{rings:[[[-20,-20],[20,-20],[20,20],[-20,20]]],name,title:name,use:"02000",height:60,floors:20,base:0,height_source:"floors"}]};
 const labels=apartmentDroneLabels([{id,name,x:30,y:30,z:60,here:true}],data,home,"아파트");
 assert.equal(labels.length,1);assert.equal(labels[0].kind,"apt");assert.equal(labels[0].info?.complexId,home);assert.equal(labels[0].x,0);
 assert.equal(apartmentDroneLabels([{id,name,x:0,y:0,z:60,here:true}],data,"11290:길음동:1288:이전단지","장소")[0].info?.complexId,undefined);
 assert.equal(apartmentDroneLabels([{id,name,x:0,y:0,z:60,here:true}],data,home,"학교").length,0);
 const signs=new DroneSigns(),context=new Proxy({measureText:(s:string)=>({width:s.length*10})},{get:(o,k)=>k in o?o[k as keyof typeof o]:()=>{}});
 Object.assign(globalThis,{window:{devicePixelRatio:1}});signs.canvas={width:0,height:0,getContext:()=>context} as unknown as HTMLCanvasElement;
 signs.set("public",[{name:"공공시설",kind:"gov",x:0,y:0,top:60,n:1}]);signs.set("collected-complexes",labels);
 const camera=new THREE.PerspectiveCamera(60,1,.1,3000);camera.position.set(0,100,200);camera.lookAt(0,60,0);camera.updateMatrixWorld();
 signs.draw(camera,1000,1000,[1200,2000]);
 const boxes=(signs as unknown as {boxes:{x:number;y:number;w:number;h:number;s:{name:string}}[]}).boxes;
 const box=boxes.find(b=>b.s.name===name);assert.ok(box,"focused apartment must win label overlap on the first frame");
 assert.equal(signs.hit(box.x+box.w/2,box.y+box.h/2)?.info?.complexId,home);
}
console.log("drone first destination: coordinate apartment sign, true identity, priority and click hit PASS");
