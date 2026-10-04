import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';

const source = readFileSync(new URL('../src/components/ComplexHologram.tsx', import.meta.url), 'utf8');
const start = source.indexOf('    const layMarks = async');
const body = source.slice(start, source.indexOf('    stage.roadDetail =', start));
const script = ts.transpile(`${body}\nreturn layMarks;`, { target: ts.ScriptTarget.ES2020 });
for(const bvhEnabled of [false,true])test(`new roads use new region coordinates and keep old asphalt/paint until both replacements are GPU ready (BVH ${bvhEnabled})`, async () => {
  const oldRoads = [{ line: [[-900, 0], [-800, 0]] }], newRoads = [{ line: [[10, 0], [110, 0]] }];
  let ready = false, oldDisposed = 0, slices = 0;
  const make = () => ({ group: new THREE.Group(), dispose() {}, setDetail() {} });
  const decor = new THREE.Group();
  const calls = [];
  const deps = { THREE, performance, preparedRoadArms: { roads: newRoads, at() {}, inside() {} },
    stage: { traffic: { arms: { roads: oldRoads } }, addWarm: (parent, obj) => parent.add(obj), drawReady: () => ready },
    marksGen: 0, alive: true, roadTerrain: {}, physicalFootprints: [], groundGeo: {},
    roadBvhAbort:null,roadBvhEnabled:()=>bvhEnabled,
    buildRoadBvh:async()=>{assert.equal(oldDisposed,0);return {parts:[],buildMs:1,workers:1};},roadBvhIndex:()=>({query:()=>[]}),
    cutSceneSurface: async () => {}, textureBudgetEnabled: () => false, drapeRoadSurface: async () => {},
    buildRoadSurface: async roads => { calls.push(roads); return make(); },
    buildRoadMarkings: async roads => { calls.push(roads); return make(); },
    raiseRoadPaint: async () => {}, roadLayer: null, decor,
    surface: { group: new THREE.Group(), dispose: () => { oldDisposed++; } },
    marks: { group: new THREE.Group(), dispose: () => { oldDisposed++; } },
    asphaltAt: null, roadSurfaceHeight: () => () => 0, hostRef: { current: null }, later: async () => true,
    frameSlice: async () => { assert.equal(oldDisposed, 0); slices++; ready = true; } };
  await new Function(...Object.keys(deps), script)(...Object.values(deps))();
  assert.deepEqual(calls, [newRoads, newRoads]);
  assert.equal(slices, 1); assert.equal(oldDisposed, 2);
  assert.equal(decor.children.length, 1);
  assert.equal(decor.children[0].children.length, 2);
});
