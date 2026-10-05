import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {sourceMaterialsMatch,boundTextures,retireUnusedMaterials} from '../src/components/tidewater/materialLifetime.js';
test('same version does not make a different source material interchangeable',()=>{
 const a={version:0},b={version:0},native={source:a,srcVersion:0};
 assert.equal(sourceMaterialsMatch(native,a),true);
 assert.equal(sourceMaterialsMatch(native,b),false);
 a.version++;assert.equal(sourceMaterialsMatch(native,a),false);
});
test('every array slot must match identity and version',()=>{
 const a={version:2},b={version:2},c={version:2};
 const native=[{source:a,srcVersion:2},{source:b,srcVersion:2}];
 assert.equal(sourceMaterialsMatch(native,[a,b]),true);
 assert.equal(sourceMaterialsMatch(native,[a,c]),false);
 assert.equal(sourceMaterialsMatch(native,a),false);
 assert.equal(sourceMaterialsMatch(native[0],[a]),false);
});
test('actual GPU bindings and still drawn array materials survive deferred replacements',()=>{
 const tex={isTexture:true},previous={bindings:{map:{texture:tex}}},next={bindings:{}};
 assert.ok(boundTextures([previous,next]).has(tex));
 const pending=[previous],freed=[];
 retireUnusedMaterials(pending,[{material:[previous,next]}],m=>freed.push(m));
 assert.equal(freed.length,0);
 retireUnusedMaterials(pending,[{material:next}],m=>freed.push(m));
 assert.deepEqual(freed,[previous]);assert.equal(pending.length,0);
});

function syncFixture(text) {
 const begin=text.indexOf('  sync(source'),end=text.indexOf('\n  /** The materials of a model',begin);
 assert.ok(begin>=0 && end>begin, 'renderer sync method must be exercised');
 const invoke=new Function('source','sourceMaterialsMatch','boundTextures','sameMatrix','performance','camera',text.slice(begin,end).replace(/  sync\(source(?:, camera)?\) \{/,'') .replace(/\}\s*$/,''));
 const sourceA={version:0,userData:{}},sourceB={version:0,userData:{}};
 const old={source:sourceA,srcVersion:0,bindings:{},uniformBlock:{buffer:{destroy(){}}},dispose(){this.disposed=true;}};
 const replacement={source:sourceB,srcVersion:0,bindings:{},uniformBlock:{buffer:{destroy(){}}},dispose(){this.disposed=true;}};
 const obj={isMesh:true,material:sourceB,matrixWorld:{},count:1};
 const mesh={material:old,matrix:{},count:1,castShadow:false};
 const api={detailReady:true,shown:true,frameNo:100,meshes:new Map([[obj,mesh]]),materials:new Map([[sourceA,old]]),textures:new Map(),unusedAt:new Map([[sourceA,0]]),sweep:119,scene:{},
  imagesReady:()=>true,material(){this.materials.set(sourceB,replacement);return replacement;},renderer:{materialReady:()=>false,forgetMaterial(){},pipelines:new Map()}};
 const source={updateMatrixWorld(){},traverseVisible(fn){fn(obj);}};
 invoke.call(api,source,sourceMaterialsMatch,boundTextures,()=>true,{now:()=>25001});
 return {old,mesh,replacement,api,source,invoke};
}
test('actual old sync disposes a still drawn same-version replacement; fixed sync retains it until ready',()=>{
 const oldCode=execFileSync('git',['show','4e3b741:frontend/src/components/tidewater/ComplexRenderer.js'],{encoding:'utf8'});
 const before=syncFixture(oldCode);
 assert.equal(before.mesh.material,before.old);assert.equal(before.old.disposed,true);
 const after=syncFixture(readFileSync(new URL('../src/components/tidewater/ComplexRenderer.js',import.meta.url),'utf8'));
 assert.equal(after.mesh.material,after.old);assert.equal(after.old.disposed,undefined);
 after.api.renderer.materialReady=()=>true;
 after.invoke.call(after.api,after.source,sourceMaterialsMatch,boundTextures,()=>true,{now:()=>26001});
 assert.equal(after.mesh.material,after.replacement);
});
