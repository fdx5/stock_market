import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {transformSync} from 'esbuild';

const source=readFileSync(new URL('../src/components/ComplexHologram.tsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('scene.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let method;
function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='layMarksOnce')method=n.initializer.getText(tree);ts.forEachChild(n,visit);}visit(tree);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
class Group{children=[];parent=null;add(...objects){for(const obj of objects){obj.removeFromParent();this.children.push(obj);obj.parent=this;}}removeFromParent(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);this.parent=null;}}
function fixture(){
 const paint=deferred(),ground=deferred(),calls=[];
 const f={group:Object.assign(new Group(),{geometry:{}}),disposed:0,dispose(){this.disposed++;}};
 const m={group:new Group(),disposed:0,dispose(){this.disposed++;}};
 const scope={module:{exports:{}},Promise,AbortController,performance,THREE:{Group},preparedRoadArms:{roads:[],at:null,inside:null,crossings:[]},
  pavementExclusions:[],physicalFootprints:[],roadFootprints:()=>[],roadWater:null,roadLayer:null,marks:null,surface:null,
  data:{},alive:true,laidWater:null,marksGen:0,sliceDeadline:()=>Infinity,roadTerrain:{},hostRef:{current:null},pausedRef:{current:false},
  cutGroundToRoads:()=>{calls.push('ground');return ground.promise;},groundGeo:{},buildRoadSurface:async()=>{calls.push('asphalt');return f;},
  buildRoadMarkings:()=>{calls.push('paint');return paint.promise;},roadHeight:()=>0,textureBudgetEnabled:()=>true,
  cutSceneSurface:async()=>{},drapeRoadOffThread:async()=>{},drapeRoadSurface:async()=>{},clipSceneStreetBox:async()=>{},FAR_HALF:680,
  stage:{addWarm:(p,o)=>p.add(o),drawReady:()=>true},decor:new Group(),roadBvhAbort:null,roadBvhEnabled:()=>false,asphaltAt:null,roadSurfaceHeight:()=>()=>0,relayWalks:null,
  initialRoadStop:new AbortController(),initialRoads:null};
 vm.runInNewContext(transformSync('module.exports='+method,{loader:'ts',format:'cjs'}).code,scope);
 return{scope,run:scope.module.exports,calls,paint,ground,f,m};
}
test('paint starts while ground/asphalt is pending and transfers only once the complete layer is ready',async()=>{
 const f=fixture(),job=f.run();assert.deepEqual(f.calls,['paint','ground']);
 f.paint.resolve(f.m);f.ground.resolve();await job;
 assert.equal(f.scope.marks,f.m);assert.equal(f.scope.surface,f.f);assert.equal(f.m.disposed,0);assert.ok(f.m.group.parent);
});
test('leaving while ground runs releases completed paint without publishing stale geometry',async()=>{
 const f=fixture(),job=f.run();f.paint.resolve(f.m);await Promise.resolve();f.scope.alive=false;f.ground.resolve();await job;
 assert.equal(f.scope.marks,null);assert.equal(f.m.disposed,1);assert.equal(f.m.group.parent,null);
});
test('a failed ground job still disposes paint that arrives after its owner has ended',async()=>{
 const f=fixture(),job=f.run();f.ground.reject(Error('ground failed'));await assert.rejects(job,/ground failed/);
 f.paint.resolve(f.m);await Promise.resolve();await Promise.resolve();assert.equal(f.m.disposed,1);assert.equal(f.m.group.parent,null);
});
test('a paint failure is observed by the owner and never publishes an incomplete markings layer',async()=>{
 const f=fixture(),job=f.run();f.paint.reject(Error('paint failed'));f.ground.resolve();await assert.rejects(job,/paint failed/);
 assert.equal(f.scope.marks,null);
});

test('first-visible lane ribbons survive until the full replacement is ready, then release once',async()=>{
 const f=fixture(),preview={disposed:0,dispose(){this.disposed++;}};f.scope.initialRoads=preview;
 const job=f.run();assert.equal(preview.disposed,0);assert.equal(f.scope.initialRoadStop.signal.aborted,false);
 f.paint.resolve(f.m);f.ground.resolve();await job;
 assert.equal(preview.disposed,1);assert.equal(f.scope.initialRoadStop.signal.aborted,true);assert.equal(f.scope.initialRoads,null);
});

test('initial lane work starts from the first ground result without waiting for scene/traffic completion',async()=>{
 let expression;function find(n){if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='initialRoadJob')expression=n.initializer.getText(tree);ts.forEachChild(n,find);}find(tree);
 const ground=deferred(),calls=[],stop=new AbortController();
 const scope={module:{exports:{}},roads:[{line:[[0,0],[20,0]],width:8,lanes:2}],groundGridJob:ground.promise,initialRoadStop:stop,terrain:{grid:{}},physicalFootprints:[],FAR_HALF:680,
  prepareInitialRoads:(job,signal)=>{calls.push({job,signal});return Promise.resolve({paint:[]});}};
 vm.runInNewContext(transformSync('module.exports='+expression,{loader:'ts',format:'cjs'}).code,scope);
 assert.equal(calls.length,0);const grid={position:new Float32Array(12),grid:{xs:new Float64Array(2),ys:new Float64Array(2)}};ground.resolve(grid);
 await scope.module.exports;assert.equal(calls.length,1);assert.equal(calls[0].job.ground,grid.position);assert.equal(calls[0].signal,stop.signal);
});
