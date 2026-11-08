// Isolated storage and YouTube doubles. No browser media, existing storage or DB access.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const path=require('node:path');
const ts=require('typescript');
const frontendRoot=path.resolve(__dirname,'..');
const compile=path=>ts.transpileModule(fs.readFileSync(require('node:path').join(frontendRoot,path),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const playlistCode=compile('src/bgmPlaylist.ts'),storeCode=compile('src/desk2/deskBgmStore.ts');
function createStore(saved=new Map(),allow=true,sessionSeed=[]){
 const listeners=new Map(),timers=new Map();let next=0,apiLoads=0,plays=0,loads=0,player;
 const add=(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn)};
 const remove=(name,fn)=>listeners.get(name)?.delete(fn);
 const emit=(name,event={isTrusted:true,target:null})=>[...(listeners.get(name)||[])].forEach(fn=>fn(event));
 const storage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
 const sessions=new Map(sessionSeed),sessionStorage={getItem:key=>sessions.get(key)??null,setItem:(key,value)=>sessions.set(key,value)};
 class Element{constructor(){this.style={};this.children=[];}setAttribute(){}appendChild(child){this.children.push(child);return child;}closest(){return null;}}
 const document={hidden:false,visibilityState:'visible',body:new Element(),createElement:()=>new Element(),addEventListener:add,removeEventListener:remove};
 const window={localStorage:storage,sessionStorage,location:{origin:'http://127.0.0.1:5188'},matchMedia:()=>({matches:false}),addEventListener:add,removeEventListener:remove,setTimeout:(fn,delay)=>{timers.set(++next,{fn,delay});return next;},clearTimeout:id=>timers.delete(id),setInterval:()=>++next,clearInterval(){}};
 const playlistContext={exports:{},window};vm.runInNewContext(playlistCode,playlistContext);const playlist=playlistContext.exports;const context={exports:{},window,document,Element,URLSearchParams};
 const options={allow};
 class Player{
  constructor(frame,config){this.events=config.events;this.state=2;this.frame=frame;player=this;queueMicrotask(()=>this.events.onReady({target:this}));}
  emit(data){this.state=data;this.events.onStateChange({target:this,data});}
  loadVideoById(id){loads++;this.id=id;this.playVideo();}
  playVideo(){plays++;if(options.allow)this.emit(1);else this.events.onAutoplayBlocked?.();}
  pauseVideo(){this.emit(2);}
  getPlayerState(){return this.state;}
  getCurrentTime(){return 0;}
  setVolume(){}destroy(){}
 }
 context.exports={};context.require=name=>name==='react'?{useSyncExternalStore(){}}:name==='../bgmPlaylist'?playlist:name==='../youtubePlayer'?{loadApi(){apiLoads++;return Promise.resolve({Player});}}:(()=>{throw Error(name)})();
 vm.runInNewContext(storeCode,context);
 return {api:context.exports,saved,sessions,options,emit,fire:delay=>{for(const[id,timer]of [...timers])if(timer.delay===delay){timers.delete(id);timer.fn();}},get apiLoads(){return apiLoads;},get plays(){return plays;},get loads(){return loads;},get player(){return player;}};
}
(async()=>{
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 const first=createStore();assert.equal(first.api.getDeskBgmState().on,true);const leave=first.api.attachDeskBgm();await flush();
 assert.equal(first.apiLoads,1);assert.equal(first.player.id,'bcmTHIqefMk');assert.equal(first.api.getDeskBgmState().playing,true);assert.ok(first.player.frame.src.includes('autoplay=1'));
 first.api.next();assert.notEqual(first.player.id,'bcmTHIqefMk');
 const reentered=createStore(first.saved,true,[...first.sessions]);reentered.api.attachDeskBgm();await flush();assert.equal(reentered.player.id,'bcmTHIqefMk','fresh document must restart the approved opening track');assert.equal(reentered.api.getDeskBgmState().position,1);
 first.api.setDeskBgmOn(false);assert.equal(first.saved.get(first.api.BGM_ENABLED_KEY),'off');
 const off=createStore(first.saved);off.api.attachDeskBgm();await flush();assert.equal(off.api.getDeskBgmState().on,false);assert.equal(off.apiLoads,0);off.emit('pointerdown');off.api.startDroneBgm();assert.equal(off.plays,0);assert.equal(off.api.getDeskBgmState().on,false,'drone entry must honor saved OFF');
 first.api.setDeskBgmOn(true);assert.equal(first.saved.get(first.api.BGM_ENABLED_KEY),'on');const on=createStore(first.saved);on.api.attachDeskBgm();await flush();assert.equal(on.api.getDeskBgmState().playing,true);
 leave();first.fire(800);assert.equal(first.saved.get(first.api.BGM_ENABLED_KEY),'on');first.api.attachDeskBgm();assert.equal(first.api.getDeskBgmState().on,true);
 const blocked=createStore(new Map(),false);blocked.api.attachDeskBgm();await flush();assert.equal(blocked.api.getDeskBgmState().blocked,true);assert.equal(blocked.api.getDeskBgmState().on,true);blocked.options.allow=true;blocked.emit('pointerdown');assert.equal(blocked.api.getDeskBgmState().playing,true);
 blocked.api.toggleDeskBgmPlay();const before=blocked.plays;blocked.emit('pointerdown');assert.equal(blocked.plays,before,'ordinary interaction must not cancel a deliberate pause');
 blocked.api.setDeskBgmOn(false);blocked.emit('keydown');assert.equal(blocked.plays,before,'saved OFF must not unlock');
 console.log(JSON.stringify({fresh_document_always_restarts_opening:true,default_autoplay:true,opening_track:'bcmTHIqefMk',saved_off_survives_reentry:true,saved_on_survives_reentry:true,route_unmount_keeps_preference:true,blocked_autoplay_recovers_on_gesture:true,manual_pause_respected:true,off_never_unlocks:true,real_audio_played:false}));
})().catch(error=>{console.error(error);process.exitCode=1;});
