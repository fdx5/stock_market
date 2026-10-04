import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/components/ComplexHologram.tsx', import.meta.url), 'utf8');
const start = source.indexOf('function gameUnlocked()');
const gate = source.slice(start, source.indexOf('/** The player', start));
const unlock = new Function('location', 'localStorage', `${gate};return gameUnlocked();`);
const storage = new Proxy({}, { get() { throw Error('development access must not read browser storage'); } });
test('only this URL devgame=1 can display development controls, regardless of previous visits', () => {
  for (const search of ['', '?devgame=0', '?devgame=true', '?devgame=2']) assert.equal(unlock({ search }, storage), false);
  assert.equal(unlock({ search: '?devgame=1' }, storage), true);
});
test('shared public 3D links remove development access', () => {
  const source = readFileSync(new URL('../src/components/share3d.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export function view3dUrl');
  const end = source.indexOf('\n}', start) + 2;
  const script = ts.transpile(source.slice(start, end).replace('export ', '') + ';return view3dUrl;', { target: ts.ScriptTarget.ES2020 });
  const share = new Function('location', script)({ search: '?devgame=1&complex=old', origin: 'https://kospimap.com' });
  const q = new URL(share('11680:sample', 12, 'clear')).searchParams;
  assert.equal(q.has('devgame'), false); assert.equal(q.get('complex'), '11680:sample'); assert.equal(q.get('3d'), '1');
});
