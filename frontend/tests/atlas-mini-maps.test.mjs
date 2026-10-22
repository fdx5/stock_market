import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../src/',import.meta.url));
function moduleLoader(overrides={},globals={}) {
  const cache=new Map();
  function load(filename) {
    if(cache.has(filename))return cache.get(filename);
    const exports={};cache.set(filename,exports);
    const source=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    vm.runInNewContext(source,{exports,console,...globals,require:dependency=>{
      if(dependency in overrides)return overrides[dependency];
      if(dependency.endsWith('.css'))return {};
      if(!dependency.startsWith('.'))return require(dependency);
      const base=path.resolve(path.dirname(filename),dependency);
      for(const ext of ['.ts','.tsx']){try{return load(base+ext);}catch(error){if(error.code!=='ENOENT')throw error;}}
      throw new Error('Missing dependency '+dependency);
    }});
    return exports;
  }
  return name=>load(path.join(root,name));
}
const model=moduleLoader()('neo/atlasMiniMapModel.ts');
const row=(code,marcap=100,change_pct=1)=>({code,name:code,sector:'Technology',marcap,close:10,change:1,change_pct});

test('preview uses the largest 32 real weights, deduplicates and rejects missing size/quotes',()=>{
  const rows=Array.from({length:60},(_,i)=>row(`STOCK${i}`,60-i,i%2?1:-1));
  rows.push(row('STOCK0',999),row('bad',NaN),{...row('unquoted'),close:0},row('negative',-1));
  const map=model.atlasMiniMap(rows);
  assert.equal(map.count,32);assert.equal(new Set(map.tiles.map(tile=>tile.id)).size,32);
  assert.equal(map.tiles[0].id,'STOCK0');assert.ok(!map.tiles.some(tile=>tile.id==='STOCK40'));
  assert.equal(map.up,16);assert.equal(map.down,16);
});
test('treemap covers its frame without overlapping tiles and preserves capitalization ratios',()=>{
  const map=model.atlasMiniMap([row('A',6),row('B',3),row('C',1)]);
  const area=map.tiles.reduce((sum,tile)=>sum+tile.w*tile.h,0);
  assert.ok(Math.abs(area-model.MINI_MAP_WIDTH*model.MINI_MAP_HEIGHT)<1e-6);
  const a=map.tiles.find(tile=>tile.id==='A'),b=map.tiles.find(tile=>tile.id==='B');
  assert.ok(Math.abs(a.w*a.h/(b.w*b.h)-2)<1e-6);
  for(const tile of map.tiles){assert.ok(tile.x>=0&&tile.y>=0);assert.ok(tile.x+tile.w<=model.MINI_MAP_WIDTH+1e-7);assert.ok(tile.y+tile.h<=model.MINI_MAP_HEIGHT+1e-7);}
  for(let i=0;i<map.tiles.length;i++)for(let j=i+1;j<map.tiles.length;j++){
    const a=map.tiles[i],b=map.tiles[j];
    const overlapX=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
    const overlapY=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
    assert.ok(overlapX<1e-7||overlapY<1e-7);
  }
});
test('missing returns never become an invented unchanged move',()=>{
  const map=model.atlasMiniMap([row('A',1,NaN),row('B',1,0)]);
  assert.equal(map.unknown,1);assert.equal(map.flat,1);
  assert.equal(model.atlasMiniMap([]).tiles.length,0);
});

async function flush(){for(let i=0;i<10;i++)await Promise.resolve();}
function storeRuntime(api){
  const rt={document:{visibilityState:'visible'},starts:0,stops:0};
  const load=moduleLoader({
    react:{useSyncExternalStore:(subscribe,snapshot)=>{rt.subscribe=subscribe;rt.snapshot=snapshot;return snapshot();}},
    '../api/client':{api},
    '../pollVisibility':{startVisibilityAwareInterval:(callback,ms)=>{rt.starts++;rt.refresh=callback;assert.equal(ms,30000);return ()=>rt.stops++;}},
  },{document:rt.document});
  load('neo/useAtlasMiniMaps.ts').useAtlasMiniMaps();
  return rt;
}
test('all three maps share one request set, skip hidden refreshes and stop after the last reader',async()=>{
  const calls=[];const response={items:[row('A')],generated_at:'2026-10-22T01:00:00Z'};
  const api=Object.fromEntries(['marketMap','kosdaqMap','nasdaq100Map'].map(name=>[name,(...args)=>{calls.push([name,...args]);return Promise.resolve(response);}]))
  const rt=storeRuntime(api),stop1=rt.subscribe(()=>{}),stop2=rt.subscribe(()=>{});await flush();
  assert.equal(calls.length,3);assert.equal(rt.starts,1);
  assert.ok(calls.every(([,limit,fresh])=>limit===60&&fresh===false));
  rt.document.visibilityState='hidden';rt.refresh();await flush();assert.equal(calls.length,3);
  stop1();assert.equal(rt.stops,0);stop2();assert.equal(rt.stops,1);
});
test('a failed market retains its own last good map while the other markets keep updating',async()=>{
  let cycle=0;
  const rt=storeRuntime({
    marketMap:()=>cycle?Promise.reject(new Error('fixture')):Promise.resolve({items:[row('KR')],generated_at:'2026-10-22T01:00:00Z'}),
    kosdaqMap:()=>Promise.resolve({items:[row('KQ',cycle?20:10)],generated_at:'2026-10-22T01:01:00Z'}),
    nasdaq100Map:()=>Promise.resolve({items:[row('US')],generated_at:'2026-10-22T01:00:00Z'}),
  });
  const stop=rt.subscribe(()=>{});await flush();const old=rt.snapshot().kospi.items;
  cycle++;rt.refresh();await flush();
  assert.equal(rt.snapshot().kospi.items,old);assert.equal(rt.snapshot().kospi.delayed,true);
  assert.equal(rt.snapshot().kosdaq.items[0].marcap,20);assert.equal(rt.snapshot().kosdaq.delayed,false);stop();
});
test('a delayed older source response cannot move a preview backwards',async()=>{
  let old=false;
  const response=()=>Promise.resolve({items:[row(old?'OLD':'NEW')],generated_at:old?'2026-10-21T01:00:00Z':'2026-10-22T01:00:00Z'});
  const rt=storeRuntime({marketMap:response,kosdaqMap:response,nasdaq100Map:response});
  const stop=rt.subscribe(()=>{});await flush();old=true;rt.refresh();await flush();
  assert.equal(rt.snapshot().kospi.items[0].code,'NEW');assert.ok(rt.snapshot().kospi.delayed);stop();
});

const Card=moduleLoader({
  '../router':{Link:({to,children,...props})=>React.createElement('a',{href:to,...props},children)},
  '../desk2/lib':{pct:value=>Number.isFinite(value)?`${value>=0?'+':''}${value.toFixed(2)}%`:'—',toneOf:value=>value>0?'up':value<0?'down':'flat'},
  '../i18n/LanguageContext':{useLanguage:()=>({lang:'ko'})},
  './useAtlasMiniMaps':{useAtlasMiniMaps:()=>{throw new Error('Presentational card must not fetch');}},
})('neo/AtlasMiniMaps.tsx').AtlasMiniMapCard;
const render=props=>renderToStaticMarkup(React.createElement(Card,props));
test('each whole card is an accessible link to its actual full-market map, with a clear CTA',()=>{
  const snapshot={items:[row('AAPL',6,1.25),row('MSFT',3,-.5)],generatedAt:'2026-10-22T01:00:00Z',settled:true,delayed:false};
  for(const [market,to] of [['kospi','/map'],['kosdaq','/kosdaq-map'],['nasdaq100','/nasdaq100-map']]){
    const html=render({market,snapshot,quote:{price:1234,change:1},lang:'ko'});
    assert.ok(html.startsWith(`<a href="${to}"`));assert.equal((html.match(/<a /g)||[]).length,1);
    assert.ok(html.includes('전체 맵 보기'));assert.ok(html.includes('data-state="ready"'));assert.ok(html.includes('role="img"'));assert.ok(html.includes('KST'));
  }
});
test('empty and failed cards keep navigation but never show fabricated tiles or prices',()=>{
  for(const settled of [false,true]){
    const html=render({market:'kospi',snapshot:{items:[],generatedAt:null,settled,delayed:settled},quote:{},lang:'ko'});
    assert.ok(html.includes(`data-state="${settled?'unavailable':'loading'}"`));
    assert.ok(!html.includes('<rect'));assert.ok(html.includes('전체 맵 보기'));assert.ok(!html.includes('0.00%'));
  }
});
