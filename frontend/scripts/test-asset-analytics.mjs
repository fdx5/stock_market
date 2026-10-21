import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';

function moduleSource(file, require) {
  const source=ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const module={exports:{}};new Function('module','exports','require',source)(module,module.exports,require);return module.exports;
}
const assets=moduleSource('../src/marketAssets.ts',()=>({}));
const {pageLabel,routeTemplate}=moduleSource('../src/useActivityTracking.ts',name=>name==='./marketAssets'?assets:{});
const labels=[];
for(const asset of assets.MARKET_ASSETS){
  const path=`/prices/${asset.key}`;
  assert.equal(routeTemplate(`${path}/?source=test`),path);
  assert.equal(pageLabel(`${path}/?source=test`),`${asset.ko} 시세 상세`);
  labels.push(pageLabel(path));
}
assert.equal(new Set(labels).size,7);
assert.equal(routeTemplate('/stock/005930'),'/stock/{code}');
assert.equal(routeTemplate('/stock/AAPL'),'/stock/{ticker}');
assert.equal(pageLabel('/unregistered-page'),'기타');
console.log('Seven asset page labels remain distinct in admin ranking and route grouping.');
