import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {transformSync} from 'esbuild';
import * as THREE from 'three';
const read=name=>readFileSync(new URL('../src/components/'+name,import.meta.url),'utf8');
const declarations=(name,names)=>{const text=read(name),ast=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true);return ast.statements.filter(n=>names.some(name=>ts.isFunctionDeclaration(n)&&n.name?.text===name||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)===name))).map(n=>n.getText(ast).replace(/^export /,'')).join('\n');};
const context={THREE};
const source=declarations('surfaceGeometry.ts',['surfaceGeometryRules'])+'\nconst surfaceGeometry=surfaceGeometryRules();\n'+read('bridgeDeck.ts').replace(/^import .*\r?\n/gm,'').replace(/^export /gm,'')+'\n'+declarations('sceneLandmarks.ts',['GWANGAN','SUSP','gwanganDeck','buildGwanganBridge'])+'\nthis.kit={bridgeSections,bridgeTileLanes,bridgeContains,gwanganDeck,buildGwanganBridge};';
vm.runInNewContext(transformSync(source,{loader:'ts'}).code,context);
const {bridgeSections,bridgeTileLanes,bridgeContains,gwanganDeck,buildGwanganBridge}=context.kit;
const project=(lon,lat)=>[(lon-129.1283)*111320*Math.cos(35.1457*Math.PI/180),(lat-35.1457)*110540];
const sea=-5,ground=(x,y)=>y>1700?6:y<-950?8:sea;
const deck=gwanganDeck(project,sea,ground);
const laneList=packed=>{const out=[];for(let o=0;o<packed.length;){const n=packed[o++],w=packed[o++];out.push({w,p:Array.from({length:n},()=>[packed[o++],packed[o++],packed[o++]])});}return out;};
test('bridge approach ends match the common road pavement lift exactly',()=>{assert.ok(Math.abs(deck.upper(0)-ground(...deck.P[0])-.08)<1e-8);assert.ok(Math.abs(deck.upper(deck.total)-ground(...deck.P.at(-1))-.08)<1e-8);});
test('shared sections retain every surveyed bend and use slab interpolation between samples',()=>{for(const p of deck.P)assert.ok(deck.sections.points.some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<1e-7));for(let i=1;i<deck.sections.stations.length;i++){const a=deck.sections.stations[i-1],b=deck.sections.stations[i];assert.ok(Math.abs(deck.upper((a+b)/2)-(deck.upper(a)+deck.upper(b))/2)<1e-8);}});
test('all-sea suspended section has four lanes on each storey in opposite directions',()=>{const p=deck.sections.at((deck.s0+deck.s1)/2),lanes=laneList(bridgeTileLanes(deck.sections,deck.lower,[p.x-100,p.y-100,p.x+100,p.y+100]));assert.equal(lanes.length,8);const direction=l=>Math.sign(l.p.at(-1)[0]-l.p[0][0]);assert.ok(lanes.slice(0,4).every(l=>direction(l)===-1));assert.ok(lanes.slice(4).every(l=>direction(l)===1));for(let i=0;i<4;i++)assert.ok(Math.abs(lanes[i].p[0][2]-lanes[i+4].p[0][2]-7.5)<.0001);});
test('real Gwangan slab and lane positions agree throughout curves and approaches',()=>{
 const model=buildGwanganBridge(project,sea,false,ground,deck),mesh=model.group.getObjectByName('deck');model.group.updateMatrixWorld(true);
 const lanes=laneList(bridgeTileLanes(deck.sections,deck.lower,[-5000,-5000,5000,5000]));let samples=0;
 for(const lane of lanes)for(let i=1;i<lane.p.length;i+=7){const a=lane.p[i-1],b=lane.p[i];for(const f of [.25,.75]){const x=a[0]+(b[0]-a[0])*f,y=a[1]+(b[1]-a[1])*f,z=a[2]+(b[2]-a[2])*f;const ray=new THREE.Raycaster(new THREE.Vector3(x,z+.1,-y),new THREE.Vector3(0,-1,0),0,.3),hit=ray.intersectObject(mesh)[0];assert.ok(hit,`lane outside slab at ${x},${y},${z}`);assert.ok(Math.abs(z-hit.point.y-.02)<.035,`${z-hit.point.y} m from slab`);samples++;}}
 assert.ok(samples>300);model.dispose();
});
test('bridge tile cuts conserve each lane path with matching heights at seams',()=>{const sections=bridgeSections([[-120,0],[20,20],[140,30]],s=>2+s*.07),lower=sections.points.slice(0,-1).map(()=>true);const a=laneList(bridgeTileLanes(sections,lower,[-200,-100,0,100])),b=laneList(bridgeTileLanes(sections,lower,[0,-100,200,100]));for(let i=0;i<8;i++){const edge=l=>l.p.find(p=>Math.abs(p[0])<1e-5);const x=edge(a[i]),y=edge(b[i]);assert.ok(x&&y);for(let k=0;k<3;k++)assert.ok(Math.abs(x[k]-y[k])<.0001);}});
test('unrelated shore road and perpendicular crossings do not acquire the landmark deck',()=>{assert.equal(bridgeContains([[-100,0],[100,0]],0,30,1,0),false);assert.equal(bridgeContains([[-100,0],[100,0]],0,0,0,1),false);assert.equal(bridgeContains([[-100,0],[100,0]],0,5,1,0),true);});
// Actual traffic code without network, model loading or browser state.
const trafficContext={module:{exports:{}},exports:{},THREE,CAR_SPECS:{},DIMS:{},loadCarModels:()=>new Promise(()=>{}),carModelMaterial:()=>new THREE.MeshStandardMaterial()};
vm.runInNewContext(transformSync(read('droneTraffic.ts').replace(/^import .*\r?\n/gm,''),{loader:'ts',format:'cjs'}).code,trafficContext);
const Traffic=trafficContext.module.exports.DroneTraffic;
const packed=(a,b)=>new Float32Array([2,14,...a,...b]);
test('overlapping bridge storeys cannot transfer vehicles at a tile seam',()=>{const t=new Traffic(13);t.addTile('a',packed([-90,0,40],[0,0,40]));t.addTile('wrong',packed([0,0,32.5],[100,0,32.5]));t.addTile('right',packed([0,0,40],[100,0,40]));const from=t.lanes.get('a')[0];for(let i=0;i<40;i++)assert.equal(t.next(0,0,90,0,from).tile,'right');t.dispose();});
test('ordinary sloping approach remains connected but an unrendered steep jump is rejected',()=>{const t=new Traffic(5);t.addTile('a',packed([-90,0,10],[0,0,10]));t.addTile('ramp',packed([8,0,10.7],[100,0,11]));const from=t.lanes.get('a')[0];assert.equal(t.next(0,0,90,0,from).tile,'ramp');t.removeTile('ramp');t.addTile('jump',packed([8,0,15],[100,0,15]));assert.equal(t.next(0,0,90,0,from),null);t.dispose();});
test('cars keep moving near a long bridge midpoint even when both lane ends are far away',()=>{const t=new Traffic(2);t.addTile('long',packed([-2000,0,40],[2000,0,40]));const car=t.cars.find(c=>Math.abs(c.s-2000)<150),s=car.s;t.update(.1,new THREE.Vector3(0,60,0));assert.ok(car.s>s);t.dispose();});
