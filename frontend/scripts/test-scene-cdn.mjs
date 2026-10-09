import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
const load=env=>{const scope={module:{exports:{}},exports:{}};vm.runInNewContext(transformSync(readFileSync(new URL('../src/staticCdn.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs',define:{'import.meta.env':JSON.stringify(env)}}).code,scope);return scope.module.exports;};
test('only five new landscape assets use their uploaded commit',()=>{const {cdn,STATIC_PIN,SCENE_STATIC_PIN}=load({DEV:false});for(const file of ['trees-compact.bin','trees-compact.json','dense-twigs.webp','dense-twigs.bc7.gz','dense-twigs.etc2.gz'])assert.ok(cdn('/3d/'+file).includes('@'+SCENE_STATIC_PIN+'/'));for(const file of ['cars.bin','trees.bin','cars.json'])assert.ok(cdn('/3d/'+file).includes('@'+STATIC_PIN+'/'));});
test('new drone assets use the deployed origin instead of the older CDN pin',()=>{const {cdn}=load({DEV:false});for(const file of ['sky.jpg','start.wav','hover.wav'])assert.equal(cdn('/3d/drone/'+file),'/3d/drone/'+file);});
test('local previews override both asset roots and development keeps relative paths',()=>{for(const env of [{DEV:false,VITE_STATIC_CDN:'http://127.0.0.1:4195/'},{DEV:true}]){const {cdn}=load(env);for(const file of ['trees-compact.bin','cars.bin'])assert.equal(cdn('/3d/'+file),(env.DEV?'':'http://127.0.0.1:4195')+'/3d/'+file);}});
