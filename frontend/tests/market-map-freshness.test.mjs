import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({entryPoints:[fileURLToPath(new URL('../src/marketMapSnapshot.ts', import.meta.url))],bundle:true,write:false,format:'esm'});
const {mergeMapSnapshot} = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const row = (code, pct, stamp) => ({code, change_pct:pct, quote_time:stamp});

test('a late full response never reverts Hyundai from 3.60 to 2.88', () => {
  const partial = [row('005380',3.60,200)];
  const full = [row('005380',2.88,100),row('005930',1,200)];
  assert.equal(mergeMapSnapshot(partial,full,true)[0].change_pct,3.60);
  assert.equal(mergeMapSnapshot(full,partial,false)[0].change_pct,3.60);
});

test('full responses retain authoritative membership and refreshed tail prices', () => {
  const previous=[row('A',1,200),row('removed',1,200)];
  const next=mergeMapSnapshot(previous,[row('A',2,300),row('B',3,300)],true);
  assert.deepEqual(next.map(x=>x.code),['A','B']);
  assert.equal(next[0].change_pct,2);
});

test('US extended quotes survive an older regular close or missing live quote', () => {
  const previous=[{...row('AAPL',3.60,200),session:'post'}];
  for(const timestamp of [100,null,undefined]) {
    const next=mergeMapSnapshot(previous,[{...row('AAPL',2.88,timestamp),session:'regular',quote_source:'snapshot'}],true);
    assert.equal(next[0].session,'post');
    assert.equal(next[0].change_pct,3.60);
  }
  assert.equal(mergeMapSnapshot(previous,[{...row('AAPL',4,300),session:'pre'}],true)[0].session,'pre');
});

test('sources without trade times compare server receipt time, never response arrival', () => {
  const previous=[{...row('005380',3.60,null),quote_received_at:200}];
  assert.equal(mergeMapSnapshot(previous,[{...row('005380',2.88,null),quote_received_at:100}],true)[0].change_pct,3.60);
});
