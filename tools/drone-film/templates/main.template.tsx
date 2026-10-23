import preset from './preset.json';
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import * as T from 'three';
import ComplexHologram from '../../src/components/ComplexHologram';
import {ComplexRenderer} from '../../src/components/tidewater/ComplexRenderer';
import {GPU} from '../../src/vendor/tidewater/engine/gpu/GPU';
import '../../src/desk2/realestate-hologram.css';

const W=preset.video.width,H=preset.video.height,FPS=preset.video.fps,DURATION=preset.video.seconds,N=Math.round(DURATION*FPS);
let native:any=null,renderArgs:any[]=[],offline=false;
const render=ComplexRenderer.prototype.render;
ComplexRenderer.prototype.render=function(...args:any[]){native=this;renderArgs=args;if(!offline)return render.apply(this,args);};
const resize=ComplexRenderer.prototype.setSize;
ComplexRenderer.prototype.setSize=function(){return resize.call(this,W,H,1);};
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const stage=()=> (window as any).__complexStage;
const place={...preset.center,kind:preset.center.kind as any};
type Shot={name:string;points:number[][];target:number[];endTarget?:number[];fov:number;endFov?:number;};
const shots:Shot[]=preset.shots;

// Keep shot length compatible with 100-200 km/h over 162 seconds.
for(const shot of shots)shot.points=shot.points.map(([x,y,z])=>[x*preset.shotScale,y,z*preset.shotScale]);

// Route locally around the registered building volumes, at the shot's lowest height.
function safeCurve(shot:Shot,world:any){
 const altitude=Math.min(...shot.points.map(p=>p[1]));
 const dry=(x:number,z:number)=>Math.hypot(x,z)<preset.radius-10&&[[-7,-7],[7,-7],[-7,7],[7,7],[0,0]].every(([dx,dz])=>world.roofAt(x+dx,-z-dz)-world.groundAt(x+dx,-z-dz)<altitude-10);
 const step=12,lim=Math.ceil(preset.radius/12),key=(x:number,z:number)=>`${x},${z}`;
 const gridPoint=(p:number[])=>{
  const x=Math.round(p[0]/step),z=Math.round(p[2]/step);
  for(let r=0;r<=20;r++)for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){
   if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;
   if(dry((x+dx)*step,(z+dz)*step))return [x+dx,z+dz];
  }
  throw Error(`No clear camera anchor: ${shot.name}`);
 };
 const walk=(a:number[],b:number[])=>{
  const start=gridPoint(a),end=gridPoint(b),goal=key(end[0],end[1]);
  const open=[start],cost=new Map([[key(...start as [number,number]),0]]),came=new Map<string,string>(),coords=new Map([[key(...start as [number,number]),start]]);
  let found=false;
  for(let n=0;open.length&&n<20000;n++){
   let best=0,score=Infinity;for(let i=0;i<open.length;i++){const q=open[i],f=cost.get(key(q[0],q[1]))!+Math.hypot(q[0]-end[0],q[1]-end[1]);if(f<score){score=f;best=i;}}
   const p=open.splice(best,1)[0],pk=key(p[0],p[1]);if(pk===goal){found=true;break;}
   for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
    const x=p[0]+dx,z=p[1]+dz;if(Math.abs(x)>lim||Math.abs(z)>lim||!dry(x*step,z*step)||!dry((x+p[0])*step/2,(z+p[1])*step/2))continue;
    const k=key(x,z),v=cost.get(pk)!+Math.hypot(dx,dz);if(v>=(cost.get(k)??Infinity))continue;
    const fresh=!cost.has(k);cost.set(k,v);came.set(k,pk);coords.set(k,[x,z]);if(fresh)open.push([x,z]);
   }
  }
  if(!found)throw Error(`No clear route: ${shot.name}`);
  const result:number[][]=[];let k=goal;while(k){const p=coords.get(k)!;result.push([p[0]*step,p[1]*step]);k=came.get(k)!;}result.reverse();
  return result.filter((_,i)=>i===0||i===result.length-1||i%3===0);
 };
 const points:T.Vector3[]=[];
 for(let i=1;i<shot.points.length;i++){
  const a=shot.points[i-1],b=shot.points[i];const path=walk(a,b);
  path.forEach(([x,z],j)=>{if(i>1&&!j)return;points.push(new T.Vector3(x,T.MathUtils.lerp(a[1],b[1],j/Math.max(1,path.length-1)),z));});
 }
 let curve=new T.CatmullRomCurve3(points,false,'centripetal');curve.arcLengthDivisions=4000;
 for(let i=0;i<=3000;i++){const p=curve.getPointAt(i/3000);if(!dry(p.x,p.z)){
   // Linear interpolation preserves the checked A* corridor if spline corners overshoot.
   const path=new T.CurvePath<T.Vector3>();for(let k=1;k<points.length;k++)path.add(new T.LineCurve3(points[k-1],points[k]));return path;
 }}
 return curve;
}

function App(){
 const [status,setStatus]=useState(`${W}×${H} / ${FPS}fps / ${DURATION}s · 장면 로딩 중`),[busy,setBusy]=useState(false);
 const update=(v:string)=>{setStatus(v);document.title=v.slice(0,70);};
 const prepare=async()=>{
  setBusy(true);
  try{
   for(let k=0;k<900;k++){
    const st=stage();
    if(st?.drone&&native?.shown){
      st.atmos.hour=preset.hour;st.atmos.dirty=true;st.drone.audio.setMuted?.(true);
      st.drone.flight.pos.set(0,350,0);st.drone.flight.vel.set(0,0,0);
      const s=st.drone.world.stats(),d=document.querySelector<HTMLElement>('[data-renderer]')?.dataset;
      update(`4K 모델 준비 ${s.ready}/${s.tiles} · 상세 ${s.detailReady}/${s.detailPending+s.detailReady} · 수목 ${d?.plantsPhase??'대기'}`);
      if(s.ready>=s.tiles-2&&s.tiles>20&&s.loading===0&&s.detailRunning===0&&d?.plantsPhase==='complete'&&d?.farPlantsReadyAt){
       update('4K 장면 준비 완료 · 경로 검사 및 출력 가능');return;
      }
    }
    if(native&&stage()?.model){for(let warm=0;warm<8;warm++){render.call(native,stage().scene,stage().camera,stage().look,performance.now()/1000);await GPU.queue.onSubmittedWorkDone();await pause(0);}}
    await pause(200);
   }
   throw Error('Scene load deadline');
  }catch(e){update(String(e));}finally{setBusy(false);}
 };
 const capture=async(preview=false)=>{
  setBusy(true);let encoder:VideoEncoder|undefined;let restore=()=>{};
  try{
   const st=stage();if(!st?.drone||!native?.shown)throw Error('Scene not ready');
   const world=st.drone.world;
   update('건물 충돌 경로 검사 중…');await pause(20);
   const curves=shots.map(s=>safeCurve(s,world)),lengths=curves.map(c=>c.getLength()),total=lengths.reduce((a,b)=>a+b,0),base=total/DURATION;
   let speedMin=base*.84*3.6,speedMax=base*1.16*3.6;
   if(speedMin<preset.minSpeed||speedMax>preset.maxSpeed)throw Error(`Route speed outside band: ${speedMin.toFixed(1)}–${speedMax.toFixed(1)} km/h; length ${total.toFixed(1)}`);
   const beatCounts=lengths.map(l=>Math.round(l/total*(DURATION*preset.music.bpm/60)));beatCounts[shots.length-1]+=Math.round(DURATION*preset.music.bpm/60)-beatCounts.reduce((a,b)=>a+b,0);
   const durations=beatCounts.map(n=>n*60/preset.music.bpm);
   durations[durations.length-1]+=DURATION-durations.reduce((a,b)=>a+b,0);
   const ends=durations.map((_,i)=>durations.slice(0,i+1).reduce((a,b)=>a+b,0));
   speedMin=Math.min(...lengths.map((l,i)=>l/durations[i]*.84*3.6));speedMax=Math.max(...lengths.map((l,i)=>l/durations[i]*1.16*3.6));
   if(speedMin<preset.minSpeed||speedMax>preset.maxSpeed)throw Error('Beat-aligned speed outside band');
   const id=(await fetch('/__film/start',{method:'POST'}).then(r=>r.json())).id;
   const canvas=new OffscreenCanvas(W,H),ctx=canvas.getContext('2d',{alpha:false})!;
   offline=true;
   const tick=st.drone.tick.bind(st.drone),viewTicks=st.tick.slice();st.drone.tick=()=>{};st.tick=[];st.controls.enabled=false;if(st.balloon)st.balloon.group.visible=false;restore=()=>{st.drone.tick=tick;st.tick=viewTicks;offline=false;};
   let previousShot=-1;const route:any[]=[];let minimumClearance=Infinity;
   const frames=preview?Math.min(360,N):N;
   for(let i=0;i<frames;i++){
    const t=preview?i/(frames-1)*(DURATION-1/FPS):i/FPS;
    const shotIndex=Math.min(shots.length-1,ends.findIndex(e=>t<e)<0?shots.length-1:ends.findIndex(e=>t<e)),shot=shots[shotIndex],start=shotIndex?ends[shotIndex-1]:0;
    const u=Math.max(0,Math.min(1,(t-start)/durations[shotIndex]));
    // Arc-length speed eases by ±16%; the integral is exactly one full route.
    const travel=u+.16*(1-Math.cos(u*Math.PI*2))/(Math.PI*2);
    const pos=curves[shotIndex].getPointAt(Math.min(1,travel)),target=new T.Vector3(...shot.target as [number,number,number]);
    if(shot.endTarget)target.lerp(new T.Vector3(...shot.endTarget as [number,number,number]),u*u*(3-2*u));
    pos.y=T.MathUtils.clamp(pos.y,preset.minAltitude,preset.maxAltitude);const ground=world.groundAt(pos.x,-pos.z);pos.y+=ground;const alt=pos.y-ground,clearance=pos.y-world.roofAt(pos.x,-pos.z);minimumClearance=Math.min(minimumClearance,clearance);
    if(Math.hypot(pos.x,pos.z)>preset.radius||alt<preset.minAltitude-.01||alt>preset.maxAltitude+.01||clearance<6)throw Error(`Route violation at ${t.toFixed(3)}: altitude ${alt}, clearance ${clearance}`);
    st.drone.flight.pos.copy(pos);st.drone.flight.vel.set(0,0,0);
    st.camera.position.copy(pos);st.camera.fov=T.MathUtils.lerp(shot.fov,shot.endFov??shot.fov,u);st.camera.aspect=W/H;st.camera.near=.5;st.camera.far=12000;st.camera.updateProjectionMatrix();
    st.camera.up.set(0,1,0);st.camera.lookAt(target);st.camera.updateMatrixWorld();
    if(previousShot!==shotIndex){native.taaValid=false;previousShot=shotIndex;}
    st.now=t;for(const fn of viewTicks)fn(1/FPS);
    const before=native.frameNo;render.call(native,st.scene,st.camera,st.look,t);await GPU.queue.onSubmittedWorkDone();
    if(native.frameNo===before||!native.shown||!native.ready){i--;await pause(20);continue;}
    ctx.drawImage(native.canvas,0,0,W,H);
    // The site's own signs, projected for this exact camera frame and rasterized
    // at 4K. Keep the normal 1080p label size while doubling text pixel density.
    st.drone.signs.lite=false;
    st.drone.signs.draw(st.camera,W/2,H/2,[world.reach*.72,world.reach*.98],{pixelRatio:2,time:t});
    if(st.drone.signs.canvas)ctx.drawImage(st.drone.signs.canvas,0,0,W,H);
    ctx.save();
    ctx.font='500 24px Arial';ctx.fillStyle='rgba(235,244,252,.7)';ctx.fillText('KOSPIMAP 3D · © OpenStreetMap contributors · VWorld',65,H-48);
    if(t<6){ctx.globalAlpha=Math.min(1,t/1.5,(6-t)/1.5);ctx.font='500 38px Arial';ctx.fillText(preset.subtitle,110,150);ctx.font='600 110px Arial';ctx.fillText(preset.title,102,285);}
    if(t>DURATION-8){ctx.globalAlpha=Math.min(1,(t-DURATION+8)/2);ctx.font='600 66px Arial';ctx.fillText(preset.ending,115,170);ctx.font='400 30px Arial';ctx.fillText('Music: '+preset.music.title,120,230);}
    const fade=Math.min(1,t/1.2,(DURATION-t)/1.5);if(fade<1){ctx.globalAlpha=1-fade;ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);}ctx.restore();
    const encodedImage=await canvas.convertToBlob({type:'image/jpeg',quality:1});
    const frameResponse=await fetch(`/__film/frame?id=${id}&seq=${i}`,{method:'POST',body:encodedImage});
    if(!frameResponse.ok)throw Error(await frameResponse.text());
    if(i%60===0){route.push({t,shot:shot.name,x:pos.x,y:pos.y,z:pos.z,altitude:alt,speed:lengths[shotIndex]/durations[shotIndex]*(1+.16*Math.sin(2*Math.PI*u))*3.6,clearance});update(`${preview?'미리보기':'4K 60fps 출력'} ${i}/${frames} (${(i/frames*100).toFixed(1)}%) · ${shot.name} · ${id}`);await pause(0);}
    if((!preview&&i%1200===120)||preview&&i%60===30){const blob=await canvas.convertToBlob({type:'image/png'});await fetch(`/__film/still?id=${id}&frame=${i}`,{method:'POST',body:blob});}
   }

   const metadata={id,width:W,height:H,fps:FPS,frames,seconds:frames/FPS,preview,center:place,route,durations,lengths,speedMin,speedMax,minimumClearance,renderer:'site WebGPU high',music:preset.music.title,musicSource:preset.music.url,profile:preset};
   const done=await fetch(`/__film/finish?id=${id}`,{method:'POST',body:JSON.stringify(metadata)});if(!done.ok)throw Error(await done.text());
   update(`출력 완료: ${id} · ${frames} frames · 3840×2160 / 60fps`);
   st.drone.tick=tick;st.tick=viewTicks;offline=false;
  }catch(e){offline=false;encoder?.close();update(`출력 오류: ${String(e)}`);}finally{restore();setBusy(false);}
 };
 return <><div id="film-tools"><b>해운대 · THE ZENITH · 4K 60fps / 2:42</b><p>반경 800m · 고도 120–350m · 건물 경계 검사 · 원본 프레임 출력</p><button disabled={busy} onClick={prepare}>장면 준비</button><button disabled={busy} onClick={()=>capture(true)}>전체 구도 미리보기</button><button disabled={busy} onClick={()=>capture(false)}>4K 본편 출력</button><output>{status}</output></div><div id="scene"><ComplexHologram complexId="11290:길음동:1288:래미안길음센터피스" explorePlace={place} complexName={place.title} wide autoDrone initialTod="day" /></div></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
