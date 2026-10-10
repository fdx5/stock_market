import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const {code}=transformSync(readFileSync(new URL('../src/components/sceneDeviceBudget.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'});
const {sceneDeviceBudget,capSceneRatio,prepareCanvasResize,fixedSceneResolution}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('Safari desktop iPad UA without deviceMemory gets a bounded profile',()=>{
 const b=sceneDeviceBudget({userAgent:'Mozilla/5.0 Macintosh Safari/605.1.15',platform:'MacIntel',maxTouchPoints:5});
 assert.equal(b.constrained,true);assert.equal(b.retainPrevious,false);assert.equal(b.samples,0);
 assert.equal(b.paintEdge,768);
 for(const [w,h] of [[1024,1366],[2048,2732],[5120,1440]])for(const desired of [1,2,4,100]){
  const ratio=capSceneRatio(w,h,desired,b);
  assert.ok(w*h*ratio*ratio<=2e6+1);assert.ok(ratio<=1.5);
  assert.ok(Math.round(w*ratio)*Math.round(h*ratio)<=2e6);
 }
});

test('desktop resolution is locked at initial sharpness across loading and fullscreen resizes',()=>{
 const b=fixedSceneResolution(1,true,sceneDeviceBudget({deviceMemory:8}));
 const first=b.forSize(1440,1000);assert.equal(first,1.75);
 for(let i=0;i<150;i++)for(const [w,h]of [[1440,1000],[1920,1080],[5120,1440],[800,600]])assert.equal(b.forSize(w,h),first);
});
test('memory profiles cannot silently lower native display resolution',()=>{
 for(const dpr of [1,1.5,2,3])for(const deviceMemory of [2,4,8]){
  const b=fixedSceneResolution(dpr,false,sceneDeviceBudget({deviceMemory}));
  assert.equal(b.forSize(1920,1080),dpr);assert.equal(b.forSize(3840,2160),dpr);
 }
});
test('empty layout does not lock resolution and explicit user comparison ratios stay fixed',()=>{
 const budget=sceneDeviceBudget({deviceMemory:8}),b=fixedSceneResolution(1,true,budget);
 assert.equal(b.forSize(0,0),1);assert.equal(b.forSize(1440,1000),1.75);
 const manual=fixedSceneResolution(2,true,budget,1.25);
 assert.equal(manual.forSize(1440,1000),1.25);assert.equal(manual.forSize(3840,2160),1.25);
});
test('classic iPad and iPhone are covered; a desktop Mac retains desktop quality',()=>{
 assert.equal(sceneDeviceBudget({userAgent:'iPad Safari'}).constrained,true);
 assert.equal(sceneDeviceBudget({userAgent:'iPhone Safari'}).constrained,true);
 const b=sceneDeviceBudget({platform:'MacIntel',maxTouchPoints:0});
 assert.equal(b.constrained,false);assert.equal(b.maxPixels,14e6);assert.equal(b.samples,4);
});
test('reported small memory is bounded independently of touch or browser',()=>{
 assert.equal(sceneDeviceBudget({deviceMemory:4}).constrained,true);
 assert.equal(sceneDeviceBudget({deviceMemory:8}).constrained,false);
});
test('portrait/landscape canvas setters cannot allocate an oversized intermediate rectangle',()=>{
 let w=1000,h=2000,peak=0;
 const canvas={get width(){return w;},set width(v){w=v;peak=Math.max(peak,w*h);},get height(){return h;},set height(v){h=v;peak=Math.max(peak,w*h);}};
 for(const [width,height] of [[2000,1000],[1000,2000],[500,4000],[4000,500]]){
  prepareCanvasResize(canvas,width,height,2e6);canvas.width=width;canvas.height=height;
  assert.ok(peak<=2e6);assert.equal(w*h,2e6);
 }
});
