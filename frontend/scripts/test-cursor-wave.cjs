// Isolated DOM/GPU API doubles verify wave motion and lifecycle, not image quality.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src/neo/cursorFlow.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function scenario(distance,vertical=0){
 const events=new Map(),pending=new Map(),frames=[],uniforms=new Map();let clock=1000,id=0,contexts=0,released=0;
 const add=(n,fn)=>{if(!events.has(n))events.set(n,new Set());events.get(n).add(fn)};
 const remove=(n,fn)=>events.get(n)?.delete(fn);
 const gl=new Proxy({}, {get:(_,key)=>{
  if(key==='getShaderParameter'||key==='getProgramParameter')return()=>true;
  if(key==='getAttribLocation')return()=>0;
  if(key==='getUniformLocation')return(_,name)=>name;
  if(key==='getExtension')return()=>({loseContext(){released++;}});
  if(key==='uniform4fv')return(name,value)=>{assert.ok([...value].every(Number.isFinite));uniforms.set(name,[...value]);};
  if(key==='uniform1i')return(name,value)=>uniforms.set(name,value);
  if(key==='drawArrays')return()=>frames.push({at:clock,drops:[...uniforms.get('u_drops[0]')],flow:[...uniforms.get('u_flow[0]')],count:uniforms.get('u_count')});
  if(key.startsWith('create'))return()=>({});
  if(key===key.toUpperCase())return 1;
  return()=>{};
 }});
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.classList={add(){}};this.style={setProperty(name,value){this[name]=value;}};}
  append(...items){for(const item of items)this.appendChild(item);}
  appendChild(item){this.children.push(item);item.parent=this;return item;}
  setAttribute(name,value){this.attrs[name]=value;}
  addEventListener(name,fn){add('element:'+name,fn);}removeEventListener(name,fn){remove('element:'+name,fn);}
  getContext(name){assert.equal(name,'webgl');contexts++;return gl;}
  remove(){this.parent.children.splice(this.parent.children.indexOf(this),1);}
 }
 const document={hidden:false,pointerLockElement:null,body:new Element('body'),createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag),addEventListener:add,removeEventListener:remove};
 const window={addEventListener:add,removeEventListener:remove};
 const context={exports:{},document,window,Float32Array,innerWidth:1440,innerHeight:900,devicePixelRatio:2,performance:{now:()=>clock},requestAnimationFrame:fn=>{pending.set(++id,fn);return id;},cancelAnimationFrame:id=>pending.delete(id)};
 vm.runInNewContext(code,context);const dispose=context.exports.installCursorFlow('balanced');
 const emit=(name,event)=>[...(events.get(name)||[])].forEach(fn=>fn(event));
 const move=(x,y,pointerType='mouse')=>emit('pointermove',{clientX:x,clientY:y,pointerType});
 const step=()=>{clock+=16.667;const work=[...pending.values()];pending.clear();work.forEach(fn=>fn(clock));};
 move(200,300,'touch');assert.equal(contexts,0,'touch must not allocate GPU');
 move(200,300);step();for(let i=1;i<=8;i++){move(200+distance*i/8,300+vertical*i/8);step();}
 assert.ok(frames.length>0);const root=document.body.children[0];const glass=root.children.find(e=>e.className==='ng-liquid-refraction');assert.equal(root.dataset.renderer,'detached-wave-thin-film');assert.ok(!glass.style.backdropFilter.includes('blur('),'scene blur must be absent');assert.ok(glass.style.maskImage.includes('transparent 78px'),'pointer center must stay clear');assert.ok(glass.style.maskComposite.startsWith('intersect'),'refraction must exclude the live cursor');const first=frames[0];const length=Math.hypot(distance,vertical),dx=distance/length,dy=vertical/length;assert.ok(first.flow[0]*dx+first.flow[1]*dy>.99);
 const canvas=document.body.children[0].children.find(e=>e.tag==='canvas');assert.equal(canvas.width,2880);assert.equal(canvas.height,1800);
 for(let i=0;i<8;i++)step();const later=frames.find(frame=>frame.at>=first.at+100);assert.ok((later.drops[0]-first.drops[0])*dx+(later.drops[1]-first.drops[1])*dy>10,'wavefront must leave its origin in the input direction');assert.ok(later.drops[2]>first.drops[2]+10,'wavefront must expand away from its origin');
 for(let i=0;i<180;i++)step();assert.equal(pending.size,0,'idle must stop rendering');assert.equal(document.body.children[0].dataset.state,'idle');
 document.pointerLockElement={};const before=frames.length;move(200,200);assert.equal(pending.size,0);assert.equal(frames.length,before);
 dispose();assert.equal(document.body.children.length,0);assert.ok([...events.values()].every(set=>set.size===0));assert.equal(released,1);
 return {energy:first.flow[3],radius:first.drops[2]};
}
const slow=scenario(22),fast=scenario(260);scenario(-200);scenario(0,-150);scenario(160,120);assert.ok(fast.energy>slow.energy);assert.ok(fast.radius>slow.radius);
console.log(JSON.stringify({direction_cases:5,pointer_center_excluded:true,no_scene_blur:true,detached_refraction_mask:true,forward_propagation:true,expands_away_from_cursor:true,fast_input_wider_than_slow:true,slow_energy:slow.energy,fast_energy:fast.energy,full_dpr:'2880x1800 @ 2x',idle_stops:true,touch_ignored:true,pointer_lock_ignored:true,unmount_releases:true,visual_rendering_not_simulated:true}));
