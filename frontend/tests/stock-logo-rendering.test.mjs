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

const require = createRequire(import.meta.url), modules = new Map();
const root = fileURLToPath(new URL('../src/', import.meta.url));
function load(filename) {
  if (modules.has(filename)) return modules.get(filename);
  const exports = {};
  modules.set(filename, exports);
  const source = ts.transpileModule(readFileSync(filename,'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX},
  }).outputText;
  vm.runInNewContext(source, {exports,require:dependency=>{
    if (!dependency.startsWith('.')) return require(dependency);
    const base=path.resolve(path.dirname(filename),dependency);
    for(const extension of ['.ts','.tsx']) {
      try {return load(base+extension);} catch(error) {if(error.code!=='ENOENT')throw error;}
    }
    throw new Error(`Missing module ${dependency}`);
  }});
  return exports;
}
const UsStockIcon=load(path.join(root,'components/UsStockIcon.tsx')).default;
const EtfStockLogo=load(path.join(root,'components/EtfStockLogo.tsx')).default;
const StockLogo=load(path.join(root,'components/StockLogo.tsx')).default;
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));

test('every directly rendered US logo has contrast treatment without losing caller sizing',()=>{
  for(const code of ['AAPL','CB','MCO','MSFT','GOOGL']) {
    const html=render(UsStockIcon,{code,className:'ed-holding-logo'});
    assert.ok(html.includes('class="ed-holding-logo stock-logo--us"'),code);
    assert.ok(html.includes('loading="lazy"')&&html.includes('decoding="async"'),code);
  }
  assert.ok(render(UsStockIcon,{code:'AAPL'}).includes('class="stock-logo--us"'));
});
test('stock wrapper and direct ETF users receive a single contrast modifier',()=>{
  assert.ok(render(StockLogo,{code:'AAPL',className:'ed-holding-logo'}).includes('class="ed-holding-logo stock-logo--us"'));
  assert.ok(render(StockLogo,{code:'SPY',className:'ef-logo',assetType:'etf'}).includes('class="ef-logo stock-logo--etf"'));
  assert.ok(render(EtfStockLogo,{code:'QQQ'}).includes('class="stock-logo--etf"'));
});
test('KR stock icons and missing ETF monograms retain their own presentation',()=>{
  const kr=render(StockLogo,{code:'005930',className:'d2-table-logo'});
  assert.ok(kr.includes('class="d2-table-logo"'));assert.ok(!kr.includes('stock-logo--us'));
  const fallback=render(StockLogo,{code:'UNKNOWN',className:'ef-logo',name:'Unknown fund',assetType:'etf'});
  assert.ok(fallback.startsWith('<span'));assert.ok(fallback.includes('stock-logo--mono'));
  assert.ok(!fallback.includes('stock-logo--etf'));
});
