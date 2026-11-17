import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const result=await build({entryPoints:[new URL('../src/neo/mobileMenuModel.ts',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,write:false,format:'esm',platform:'node'});
const {MOBILE_MENU_GROUPS,filterMobileMenu,menuLinkActive}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const links=MOBILE_MENU_GROUPS.flatMap(group=>group.links);
test('major pages keep canonical URLs, nonempty English labels and unique tree leaves',()=>{
 for(const path of ['/','/desk','/global','/map','/kosdaq-map','/sp500-map','/nasdaq100-map','/hot-issues','/etf/kr','/etf/us','/news','/market-brief','/ai-prediction','/global-top100','/community/kr']) assert.ok(links.some(([to])=>to===path),path);
 assert.equal(new Set(links.map(([to])=>to)).size,links.length);
 for(const [,ko,en] of links){assert.ok(ko&&en);assert.ok(!/[\uac00-\ud7a3]/.test(en),en);}
 assert.ok(links.find(([to])=>to.startsWith('/discussion-explorer?')),'discussion context query is preserved');
});
test('menu searches Korean, English and URLs without case or spacing sensitivity',()=>{
 for(const query of ['NASDAQ','nasdaq','나스닥100','나스닥 100']) assert.ok(filterMobileMenu(query).some(group=>group.links.some(([to])=>to==='/nasdaq100-map')),query);
 assert.ok(filterMobileMenu('S&P500').some(group=>group.links.some(([to])=>to==='/sp500-map')));
 assert.equal(filterMobileMenu('no-such-page-xyz').length,0);
 assert.equal(filterMobileMenu(' ').length,MOBILE_MENU_GROUPS.length);
});
test('exact child routes win over parent links and dynamic reports keep their parent active',()=>{
 assert.equal(menuLinkActive('/ai-prediction','/ai-prediction/grading'),false);
 assert.equal(menuLinkActive('/ai-prediction/grading','/ai-prediction/grading'),true);
 assert.equal(menuLinkActive('/market-brief','/market-brief/2026-11-17'),true);
 assert.equal(menuLinkActive('/','/global'),false);
});
