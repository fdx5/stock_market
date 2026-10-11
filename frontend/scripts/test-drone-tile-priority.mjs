import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const code=transformSync(readFileSync(new URL('../src/components/droneLoadPriority.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'}).code;
const {droneTilePriority:priority}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('ground under the camera remains first across negative tile boundaries',()=>{
  for(const box of [[-320,-320,0,0],[0,0,320,320]])assert.equal(priority(box,0,0,[0,1]),0);
});
test('visible forward tiles start before a closer tile behind the camera',()=>{
  assert.ok(priority([-320,640,0,960],0,0,[0,1])<priority([-320,-640,0,-320],0,0,[0,1]));
});
test('looking backward while travelling forward reverses visible priority',()=>{
  const north=[0,320,320,640],south=[0,-640,320,-320];
  assert.ok(priority(north,0,0,[0,1])<priority(south,0,0,[0,1]));
  assert.ok(priority(south,0,0,[0,-1])<priority(north,0,0,[0,-1]));
});
test('all directions retain finite priority and no look uses nearest distance',()=>{
  const boxes=[[0,320,320,640],[320,0,640,320],[0,-640,320,-320],[-640,0,-320,320]];
  assert.ok(boxes.every(box=>Number.isFinite(priority(box,0,0,[0,1]))));
  for(const box of boxes)assert.equal(priority(box,0,0),320);
});
