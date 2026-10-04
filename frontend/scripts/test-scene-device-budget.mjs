import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const {code}=transformSync(readFileSync(new URL('../src/components/sceneDeviceBudget.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'});
const {sceneDeviceBudget,capSceneRatio,prepareCanvasResize,frameResolutionBudget}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
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

test('10 fps pressure lowers resolution with a floor and cooldown; spare time restores it slowly',()=>{
 const b=frameResolutionBudget();let r=1.1,now=0;
 for(let i=0;i<150;i++){now+=100;r=b.sample(now,100,r,.7,1.1);}
 assert.equal(r,.7);
 const low=r;
 for(let i=0;i<100;i++){now+=16;r=b.sample(now,16,r,.7,1.1);}
 assert.equal(r,low);
 for(let i=0;i<1000;i++){now+=16;r=b.sample(now,16,r,.7,1.1);}
 assert.ok(r>low&&r<=1.1);
});
test('loading stalls and reset do not trigger resolution loss',()=>{
 const b=frameResolutionBudget();let r=1;
 for(let i=0;i<100;i++)r=b.sample(i*1000,1000,r,.7,1.1);
 assert.equal(r,1);
 for(let i=0;i<15;i++){b.sample(i*100,100,r,.7,1.1);b.reset();}
 assert.equal(b.sample(2000,100,r,.7,1.1),1);
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
