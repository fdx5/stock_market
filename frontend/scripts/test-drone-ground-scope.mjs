import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import {transformSync} from 'esbuild';
import * as THREE from 'three';

const read=name=>readFileSync(new URL('../src/components/'+name,import.meta.url),'utf8');
const scope={module:{exports:{}},exports:{},THREE};
vm.runInNewContext(transformSync(read('coastGeometry.ts').replace(/^import .*\r?\n/gm,''),{loader:'ts',format:'cjs'}).code,scope);
const {seaOutsideBox}=scope.module.exports;
function session(source){
 const ast=ts.createSourceFile('mode.ts',source,ts.ScriptTarget.Latest,true),cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='DroneSession');
 const body=cls.members.filter(n=>['keepGroundToSquare','end'].includes(n.name?.getText(ast))).map(n=>n.getText(ast)).join('\n');
 const ctx={THREE,seaOutsideBox};vm.runInNewContext(transformSync('class Session {'+body+'};globalThis.Session=Session;',{loader:'ts'}).code,ctx);return ctx.Session;
}
const Current=session(read('droneMode.ts'));
const Previous=session(execFileSync('git',['show','d595657:frontend/src/components/droneMode.ts'],{encoding:'utf8'}));
const fresh=(Class,cut)=>{
 const s=new Class(),scene=new THREE.Scene(),geometry=new THREE.PlaneGeometry(2600,2600,8,8);
 const p=geometry.attributes.position;for(let i=0;i<p.count;i++)p.setZ(i,60+p.getX(i)*.003+p.getY(i)*.002);
 const material=new THREE.MeshBasicMaterial(),ground=new THREE.Mesh(geometry,material);ground.rotation.x=-Math.PI/2;scene.add(ground);
 Object.assign(s,{p:{ground,scene,extent:{farHalf:680},hq:true,setSky(){}},cutStop:new AbortController(),ended:false,
  coastJobs:{cut:cut??(async(g,b,m,inside)=>seaOutsideBox(g,b,m,inside)),dispose(){}},
  seaStop:new AbortController(),restoreView(){},restoreWater(){},flight:{setAutopilot(){},setAutoRotate(){}},audio:{stop(){}},world:{dispose(){}},model:{materials:()=>[],dispose(){}},trafficFilters:new Map()});
 return {s,scene,ground,original:geometry};
};

test('departure backdrop reproduced a hovering sheet over lower destination terrain; no such layer survives',async()=>{
 for(const [Class,expected] of [[Previous,'drone backdrop'],[Current,'actual destination ground']]){
  const {s,scene}=fresh(Class);s.keepGroundToSquare();await s.groundCut;
  const target=new THREE.Mesh(new THREE.PlaneGeometry(340,340),new THREE.MeshBasicMaterial());target.rotation.x=-Math.PI/2;target.position.x=900;target.name='actual destination ground';scene.add(target);scene.updateMatrixWorld(true);
  const hit=new THREE.Raycaster(new THREE.Vector3(900,500,0),new THREE.Vector3(0,-1,0)).intersectObjects(scene.children,true)[0];
  assert.equal(hit.object.name,expected);if(Class===Previous)assert.ok(hit.point.y>30);
  scene.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});
 }
});

test('actual departure relief is retained inside its surveyed square and restored on exit',async()=>{
 const {s,scene,ground,original}=fresh(Current);s.keepGroundToSquare();await s.groundCut;
 assert.equal(s.groundBackup,original);assert.notEqual(ground.geometry,original);assert.equal(scene.children.length,1);
 const p=ground.geometry.attributes.position;assert.ok(p.count>0);
 for(let i=0;i<p.count;i++){assert.ok(Math.abs(p.getX(i))<=680.001&&Math.abs(p.getY(i))<=680.001);assert.ok(Math.abs(p.getZ(i)-(60+p.getX(i)*.003+p.getY(i)*.002))<.00002);}
 s.end();assert.equal(ground.geometry,original);assert.equal(s.groundBackup,null);assert.equal(s.cutStop.signal.aborted,true);
 original.dispose();ground.material.dispose();
});

test('unavailable clipping worker uses the same bounded geometry fallback without creating a second layer',async()=>{
 const {s,scene,ground,original}=fresh(Current,async()=>null);s.keepGroundToSquare();await s.groundCut;
 assert.equal(scene.children.length,1);ground.geometry.computeBoundingBox();assert.ok(ground.geometry.boundingBox.max.x<=680.001);
 s.end();original.dispose();ground.material.dispose();
});

test('a clipping answer after exit is disposed and cannot replace restored ground',async()=>{
 let answer;const {s,ground,original}=fresh(Current,()=>new Promise(resolve=>answer=resolve));s.keepGroundToSquare();s.end();
 const late=new THREE.PlaneGeometry(10,10);let disposed=0;late.addEventListener('dispose',()=>disposed++);answer(late);await s.groundCut;
 assert.equal(ground.geometry,original);assert.equal(disposed,1);original.dispose();ground.material.dispose();
});
