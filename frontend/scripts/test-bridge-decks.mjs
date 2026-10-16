import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
// bridgeDecks.ts is self-contained (serialised into the road worker): evaluated as its own text.
const src=readFileSync(new URL('../src/components/bridgeDecks.ts',import.meta.url),'utf8').replace(/^export /m,'');
const chainDeckRoads=new Function(transformSync(src,{loader:'ts'}).code+'\nreturn chainDeckRoads;')();
const len=l=>{let s=0;for(let i=1;i<l.length;i++)s+=Math.hypot(l[i][0]-l[i-1][0],l[i][1]-l[i-1][1]);return s;};

test('one bridge, pieces of three widths with a gap: one deck, one width, on the chain line at its offset',()=>{
  const chain={ids:['a','b'],line:[[0,0],[0,500]],deck:{w:34.1,off:8,lanes:8,twoWay:true}};
  const spans=[{chain:'a',line:[[-8,0],[-8,150]]},{chain:'a',line:[[-7.6,150],[-8.3,230]]},{chain:'a',line:[[-8,300],[-8,500]]}];
  const {decks,taken}=chainDeckRoads(spans,[chain]);
  assert.deepEqual(taken,[true,true,true]);
  assert.equal(decks.length,1);
  assert.equal(decks[0].width,34.1);assert.equal(decks[0].lanes,8);
  for(const p of decks[0].line)assert.ok(Math.abs(p[0]+8)<1e-6,`off its line: ${p}`);
  assert.ok(len(decks[0].line)>=500-1e-6,'cut short');
});
test('the two directions of a two-way deck are one deck; a ramp leaving it is kept as it is',()=>{
  const n={ids:['n'],line:[[0,0],[0,400]],deck:{w:30,off:7,lanes:6,twoWay:true}};
  const s={ids:['s'],line:[[-14,400],[-14,0]],deck:{w:30,off:7,lanes:6,twoWay:true}};
  const {decks,taken}=chainDeckRoads([{chain:'n',line:[[-7,0],[-7,200]]},{chain:'s',line:[[-7,380],[-7,180]]},{chain:'n',line:[[60,250],[120,330]]}],[n,s]);
  assert.deepEqual(taken,[true,true,false]);
  assert.equal(decks.length,1);assert.equal(decks[0].chain,'n');
  assert.ok(len(decks[0].line)>=380,'both halves in one deck');
});
