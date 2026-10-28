import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
function load(path,deps={}){const source=ts.transpileModule(fs.readFileSync(new URL(`../src/${path}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;const ctx=vm.createContext({exports:{},require:k=>deps[k]??{}});vm.runInContext(source,ctx);return ctx.exports;}
const {roadsideParking}=load('walkmode/ground/parkingPlacement');
const collision=load('walkmode/game/carCollisionSize');
const {ParkedCars}=load('walkmode/game/ParkedCars',{three:THREE,'./carCollisionSize':collision});
const {WalkGame}=load('walkmode/game/WalkGame',{three:THREE});
const road={pts:new Float32Array([0,0,0,120,0,0]),w:8,major:false};
const source={x:45,y:9,heading:1.1,length:4.8,width:2.0};
test('roadside bays align with the road and leave the carriageway and sidewalk clear',()=>{const p=roadsideParking(source,[road],()=>true);assert.ok(p);assert.equal(p.heading,0);assert.ok(p.y-p.width/2>=road.w/2+1.8+.4);});
test('an occupied bay selects the next spaced bay instead of overlapping the first',()=>{const first=roadsideParking(source,[road],()=>true),second=roadsideParking(source,[road],p=>Math.abs(p.x-first.x)>5.8);assert.ok(second);assert.ok(Math.abs(second.x-first.x)>=source.length+1);});
test('no clear bay means no car; a junction approach is kept clear',()=>{assert.equal(roadsideParking(source,[road],()=>false),null);const p=roadsideParking({...source,x:1},[road],()=>true);if(p)assert.ok(p.x>10);});
test('a chase camera does not enter a parked SUV as the pedestrian approaches from any side',()=>{
 const registry=new ParkedCars(),geo=new THREE.BoxGeometry(2,2.4,4.8);geo.translate(0,1.2,0);geo.computeBoundingBox();registry.provide('suv',new THREE.Matrix4(),new THREE.Color('white'),geo);
 const game=Object.create(WalkGame.prototype);Object.assign(game,{camera:new THREE.PerspectiveCamera(62,1.6,.1,500),pos:new THREE.Vector2(),z:0,yaw:0,pitch:-.12,view:'third',avatar:{root:new THREE.Group()},bicycles:{active:null},parkedCars:registry,camEye:new THREE.Vector3(),camInit:false,world:{buildingAt:()=>0,surfaceAt:()=>0}});
 for(let i=0;i<48;i++){const a=i/48*Math.PI*2;game.pos.set(Math.cos(a)*3.4,Math.sin(a)*3.4);game.yaw=a;game.placeCamera(1/60,false);const c=game.camera.position;assert.equal(registry.cameraBlocked(c.x,-c.z,c.y),false,`angle ${a}`);assert.equal(game.avatar.root.visible,true);}
 geo.dispose();registry.dispose();
});
