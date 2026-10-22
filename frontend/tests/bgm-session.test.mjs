import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const ids = ['-lbbHQbZNKg','pF2tXC1pXNo','DUWRbl3eVi0','6WQjgHuUDWU','vP4jqXzphvc','uYjUI_zeeJk','TrNDRrDXQdo','8PqN8kexaT0','TMXlHacZSh0','7dn32JVyB6s','DzYp5uqixz0','DHNZeIy4kjs'];
const source = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
function memoryStorage() {
  const data = new Map();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
function load(name, globals = {}, require = () => { throw new Error('unexpected dependency'); }) {
  const context = vm.createContext({ exports: {}, console, ...globals, require });
  vm.runInContext(source(name), context);
  return context.exports;
}
const playlist = load('bgmPlaylist');
function lap(session) {
  const result = [];
  for (let i = 0; i < session.total; i++) { result.push(session.track.id); session.advance(1); }
  return result;
}

test('catalogue contains exactly the twelve supplied uploads, including both Lost Within URLs', () => {
  assert.deepEqual(Array.from(playlist.BGM_TRACKS, track => track.id), ids);
});
test('shuffle is made once per tab session; full laps, previous and reload retain order and cursor', () => {
  const storage = memoryStorage();
  const session = playlist.createBgmSession(storage, () => 0.25);
  const order = lap(session);
  assert.equal(new Set(order).size, 12);
  assert.deepEqual(lap(session), order);
  session.advance(4);
  const restored = playlist.createBgmSession(storage, () => { throw new Error('must not reshuffle'); });
  assert.equal(restored.position, 5);
  assert.equal(restored.track.id, order[4]);
  restored.advance(-1); assert.equal(restored.track.id, order[3]);
  restored.advance(-4); assert.equal(restored.track.id, order[11]);
});
test('independent sessions can have different orders and malformed/old state cannot restore retired music', () => {
  assert.notDeepEqual(lap(playlist.createBgmSession(undefined, () => 0)), lap(playlist.createBgmSession(undefined, () => 0.99)));
  for (const corrupt of ['broken', '{"order":["retired-video"]}', JSON.stringify({ catalogue: ids.join(','), order: ids.map(() => ids[0]), cursor: 0 })]) {
    const storage = memoryStorage(); storage.setItem(playlist.BGM_SESSION_KEY, corrupt);
    assert.deepEqual(lap(playlist.createBgmSession(storage)).sort(), [...ids].sort());
  }
});
test('unavailable browser storage preserves an in-memory fixed order', () => {
  const session = playlist.createBgmSession({getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }});
  assert.deepEqual(lap(session), lap(session));
});

const envelope = load('bgmEnvelope');
test('every approved track has a complete dynamic 14-band audio envelope', () => {
  for (const id of ids) {
    const doc = JSON.parse(readFileSync(new URL(`../public/bgm/${id}.json`, import.meta.url), 'utf8'));
    assert.ok(envelope.validEnvelope(doc), id);
    assert.equal(doc.bands, 14);
    assert.ok(doc.duration > 100, id);
    for (let i = 0; i < doc.bands; i++) {
      const values = new Set();
      for (let offset = i; offset < doc.data.length; offset += doc.bands) values.add(doc.data[offset]);
      assert.ok(values.size > 5, `${id} band ${i} should vary with the audio`);
    }
  }
});
test('compact resampling includes the highest source band and clamps time safely', () => {
  const doc = { fps: 20, bands: 14, duration: .05, data: '0000000000000z' };
  assert.ok(envelope.envelopeLevel(doc, 0, 11, 12) > .8);
  assert.equal(envelope.envelopeLevel(doc, -10, 0, 14), 0);
  assert.equal(envelope.envelopeLevel(doc, 100, 13, 14), 1);
  assert.equal(envelope.envelopeLevel(doc, NaN, 13, 14), 0);
  assert.equal(envelope.validEnvelope({...doc, data:'?'}), false);
});
test('concurrent controls share one envelope fetch', async () => {
  let calls = 0;
  const doc = { fps: 20, bands: 1, duration: .05, data: 'z' };
  const api = load('bgmEnvelope', { fetch: async () => { calls++; return {ok:true,json:async()=>doc}; }});
  const results = await Promise.all([api.loadBgmEnvelope(ids[0]), api.loadBgmEnvelope(ids[0])]);
  assert.equal(calls, 1); assert.equal(results[0], results[1]);
});

test('entrance bars read measured frames and release timers/styles when paused', async () => {
  let cleanup, tick, seconds = 0, cleared = false;
  const classes = new Set(), bars = Array.from({length:14},()=>({style:{}}));
  const containerRef = {current:{children:bars,classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}}};
  const doc = {fps:20,bands:14,duration:.1,data:'0'.repeat(14)+'z'.repeat(14)};
  const hook = load('useBgmEqualizer', {window:{setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{cleared=true;}}}, name =>
    name==='react' ? {useEffect:effect=>{cleanup=effect();}} : {...envelope,loadBgmEnvelope:async()=>doc});
  hook.useBgmEqualizer(containerRef, ids[0], true, ()=>seconds);
  for(let i=0;i<5;i++) await Promise.resolve();
  assert.equal(bars[0].style.transform,'scaleY(0.080)');
  seconds=.075;tick();assert.equal(bars[13].style.transform,'scaleY(1.000)');
  assert.ok(classes.has('is-live'));cleanup();
  assert.ok(cleared);assert.equal(classes.size,0);assert.equal(bars[0].style.transform,'');
});

test('music credits list every approved source with intact Korean text', () => {
  const page=readFileSync(new URL('../public/bgm/credits.html', import.meta.url),'utf8');
  assert.ok(page.includes('음악 출처 및 크레딧'));
  assert.ok(!page.includes('??'));
  for(const id of ids) assert.ok(page.includes(`watch?v=${id}`),id);
});

async function playerRuntime(storage = memoryStorage()) {
  const timers = new Map(), events = new Map(), frames = [], calls = [];
  let nextTimer = 0, options, player, actual = -1;
  const session = playlist.createBgmSession(storage, () => .35);
  const element = () => ({ style: {}, setAttribute() {}, appendChild(child) { if (child.src) frames.push(child); } });
  class Player {
    constructor(_frame, opts) { options = opts; player = this; }
    setVolume() {}
    playVideo() { calls.push(['play']); }
    pauseVideo() { calls.push(['pause']); actual = 2; }
    loadVideoById(id) { calls.push(['load', id]); actual = 3; }
    getCurrentTime() { return 42; }
    getPlayerState() { return actual; }
  }
  const window = {
    location:{origin:'https://local.test'}, matchMedia:()=>({matches:false}),
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout:id=>timers.delete(id),
    setInterval: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearInterval:id=>timers.delete(id),
    addEventListener() {},
  };
  const document = { createElement:element, body:element(), visibilityState:'visible', addEventListener:(name,fn)=>events.set(name,fn) };
  const dependencies = {
    react:{useSyncExternalStore:(_subscribe,snapshot)=>snapshot(),useEffect:effect=>effect(),useRef:()=>({current:null})},
    '../youtubePlayer':{loadApi:async()=>({Player})},
    '../bgmPlaylist':{...playlist,bgmSession:session},
  };
  const store = load('desk2/deskBgmStore', {window,document,URLSearchParams}, name => dependencies[name]);
  const entrance = load('useYouTubeBgm', {}, name => name === 'react' ? dependencies.react : store);
  const flush = async () => { for(let i=0;i<5;i++) await Promise.resolve(); };
  const emit = data => {actual=data;options.events.onStateChange({data,target:player});};
  return {store,entrance,storage,session,frames,calls,timers,events,document,flush,emit,
    ready:()=>options.events.onReady({target:player}), error:()=>options.events.onError()};
}
test('entrance and desk use one iframe; warm-up is silent and pause/off never redraw the order', async () => {
  const r = await playerRuntime();
  const initial = r.store.getDeskBgmState().track.id;
  r.store.warmDeskBgm(); r.entrance.useYouTubeBgm().warm(); await r.flush();
  assert.equal(r.frames.length, 1); assert.ok(r.frames[0].src.includes(initial));
  r.ready(); assert.equal(r.calls.length, 0);
  r.entrance.useYouTubeBgm().toggle(); r.emit(1);
  assert.equal(r.store.getDeskBgmState().on, true);
  r.store.toggleDeskBgmPlay(); assert.equal(r.store.getDeskBgmState().playing, false);
  r.entrance.useYouTubeBgm().toggle(); r.emit(1);
  assert.equal(r.store.getDeskBgmState().playing, true);
  r.store.setDeskBgmOn(false); r.emit(1);
  assert.equal(r.store.getDeskBgmState().playing, false);
  assert.equal(r.store.getDeskBgmState().track.id, initial);
  assert.equal(r.calls.filter(([name])=>name==='load').length, 0);
});
test('natural endings follow the saved order across laps, with reversible skips and reload persistence', async () => {
  const r = await playerRuntime();
  const order = lap(playlist.createBgmSession(r.storage));
  r.store.setDeskBgmOn(true); await r.flush(); r.ready(); r.emit(1);
  for (let i=1;i<=24;i++) {
    r.emit(0);
    assert.equal(r.store.getDeskBgmState().track.id, order[i % 12]);
    r.emit(1);
  }
  r.store.next(); r.store.prev(); assert.equal(r.store.getDeskBgmState().track.id, order[0]);
  r.store.next();
  const reloaded = await playerRuntime(r.storage);
  assert.equal(reloaded.store.getDeskBgmState().track.id, order[1]);
  assert.equal(reloaded.store.getDeskBgmState().on, false);
  assert.equal(r.frames.length, 1);
});
test('unavailable tracks are skipped in order; twelve failures stop without looping forever', async () => {
  const r = await playerRuntime();
  const order = lap(playlist.createBgmSession(r.storage));
  r.store.setDeskBgmOn(true); await r.flush(); r.ready();
  for(let i=0;i<12;i++) {
    assert.equal(r.store.getDeskBgmState().track.id, order[i]); r.error();
  }
  assert.equal(r.store.getDeskBgmState().failed, true);
  assert.equal(r.store.getDeskBgmState().on, false);
  assert.equal(r.calls.filter(([name])=>name==='load').length, 12);
});

test('leaving during API warm-up and stale end events cannot start music or advance the session', async () => {
  const r=await playerRuntime();const initial=r.store.getDeskBgmState().track.id;
  r.store.setDeskBgmOn(true);r.store.setDeskBgmOn(false);await r.flush();r.ready();r.emit(0);
  assert.equal(r.calls.length,0);assert.equal(r.store.getDeskBgmState().track.id,initial);
});
test('background return resumes the same track; a deliberate pause remains paused', async () => {
  const r=await playerRuntime();r.store.attachDeskBgm();
  r.store.setDeskBgmOn(true);await r.flush();r.ready();r.emit(1);
  const initial=r.store.getDeskBgmState().track.id;
  r.document.visibilityState='hidden';r.events.get('visibilitychange')();r.emit(2);
  r.document.visibilityState='visible';r.events.get('visibilitychange')();
  assert.equal(r.calls.at(-1)[0],'play');assert.equal(r.store.getDeskBgmState().track.id,initial);
  r.store.toggleDeskBgmPlay();const count=r.calls.length;
  r.document.visibilityState='hidden';r.events.get('visibilitychange')();
  r.document.visibilityState='visible';r.events.get('visibilitychange')();
  assert.equal(r.calls.length,count);
});
