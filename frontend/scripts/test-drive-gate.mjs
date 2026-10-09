import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/components/driveEntry.ts', import.meta.url), 'utf8');
const script = ts.transpile(source, { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS });
const entry = { exports: {} };
new Function('exports', 'localStorage', script)(entry.exports, new Proxy({}, { get() { throw Error('development access must not read browser storage'); } }));
const { developmentDriveEnabled: unlock, driveEntryUrl } = entry.exports;
test('only this URL devgame=1 can display development controls, regardless of previous visits', () => {
  for (const search of ['', '?devgame=0', '?devgame=true', '?devgame=2', '?devgame=', '?devgame=01']) assert.equal(unlock(search), false);
  for (const search of ['?devgame=1', '?complex=sample&devgame=1']) assert.equal(unlock(search), true);
});
test('ordinary navigation cannot restore a secret parameter from old browsing records', () => {
  const source = readFileSync(new URL('../src/browsingMemory.ts', import.meta.url), 'utf8');
  const file = ts.createSourceFile('browsingMemory.ts', source, ts.ScriptTarget.Latest, true);
  const functions = file.statements.filter(node => ts.isFunctionDeclaration(node) && ['lastMapUrl', 'restoredBrowsingUrl', 'resolvedBrowsingUrl'].includes(node.name?.text));
  const script = ts.transpile(functions.map(node => node.getText(file).replace(/^export /, '')).join('\n') + '\nreturn {lastMapUrl,resolvedBrowsingUrl};', {target:ts.ScriptTarget.ES2020});
  let saved = '/realestate-map?complex=sample&devgame=1#view';
  const {lastMapUrl, resolvedBrowsingUrl} = new Function('read','MAPS','isBrowsingPage','window',script)(()=>saved,new Set(['/realestate-map']),url=>url.split(/[?#]/)[0]==='/realestate-map',{location:{origin:'https://kospimap.com'}});
  assert.equal(resolvedBrowsingUrl('/realestate-map'), '/realestate-map?complex=sample#view');
  assert.equal(lastMapUrl(), '/realestate-map?complex=sample#view');
  assert.equal(saved, '/realestate-map?complex=sample&devgame=1#view');
  assert.equal(resolvedBrowsingUrl('/realestate-map?devgame=1'), '/realestate-map?devgame=1');
  saved = '/realestate-map?complex=sample#view';
  assert.equal(resolvedBrowsingUrl('/realestate-map'), saved);
});
test('the drive starts at the selected complex and current drone location, and returns to the same view', () => {
  const id = '11710:잠실동:19:잠실엘스', back = `/drone-explore?complex=${encodeURIComponent(id)}&devgame=1`;
  const url = new URL(driveEntryUrl(id, { lat: 37.5122, lon: 127.0719 }, 18, back), 'https://kospimap.com');
  assert.equal(url.pathname, '/drive');
  assert.equal(url.searchParams.get('id'), id); assert.equal(url.searchParams.get('back'), back);
  assert.equal(url.searchParams.get('lat'), '37.5122'); assert.equal(url.searchParams.get('lon'), '127.0719');
  assert.equal(url.searchParams.get('t'), 'sunset'); assert.equal(url.searchParams.has('auto'), false);
  for (const at of [null, undefined, { lat: NaN, lon: 127 }]) {
    const q = new URL(driveEntryUrl(id, at, 22, back), 'https://kospimap.com').searchParams;
    assert.equal(q.has('lat'), false); assert.equal(q.has('lon'), false); assert.equal(q.get('t'), 'night');
  }
  assert.equal(new URL(driveEntryUrl(id, null, 12, back), 'https://kospimap.com').searchParams.get('t'), 'day');
});
test('shared public 3D links remove development access', () => {
  const source = readFileSync(new URL('../src/components/share3d.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export function view3dUrl');
  const end = source.indexOf('\n}', start) + 2;
  const script = ts.transpile(source.slice(start, end).replace('export ', '') + ';return view3dUrl;', { target: ts.ScriptTarget.ES2020 });
  for (const pathname of ['/realestate-map', '/drone-explore']) {
    const share = new Function('location', script)({ pathname, search: '?devgame=1&complex=old', origin: 'https://kospimap.com' });
    const url = new URL(share('11680:sample', 12, 'clear')), q = url.searchParams;
    assert.equal(q.has('devgame'), false); assert.equal(q.get('complex'), '11680:sample');
    assert.equal(url.pathname, pathname); assert.equal(q.has('3d'), pathname==='/realestate-map');
  }
});
