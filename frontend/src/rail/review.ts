import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {SurfaceRailLayer} from './SurfaceRailLayer';
import {loadTerrain,type Terrain,FLAT} from '../components/sceneTerrain';
import {RAIL_ROOT,type RailManifest,type RailCorridor} from './railCore';
import './review.css';

const root=document.getElementById('review')!;
root.innerHTML=`<header><div><span class="eyebrow">K-STOCK HUB · LOCAL REVIEW</span><h1>지상 전철 · 실제 선로를 따라 달리는 열차</h1><p>선로 위치: OpenStreetMap · 고가 높이·차량 모델: 표현용 추정 · 운행: 시뮬레이션</p></div><div class="tools"><select id="place" aria-label="검토 위치"></select><button id="follow">열차 가까이 보기</button><button id="pause">일시정지</button></div></header><main><canvas></canvas><aside><b id="station">선로 자료를 불러옵니다</b><p>마우스로 회전 · 휠로 확대 · 우클릭으로 이동</p><div id="metrics"></div><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors · ODbL</a></aside></main>`;
const canvas=root.querySelector('canvas')!,renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
const scene=new THREE.Scene();scene.background=new THREE.Color('#bed6de');scene.fog=new THREE.Fog('#bed6de',2200,5200);
scene.add(new THREE.HemisphereLight(0xebf6ff,0x586957,2.5));const sun=new THREE.DirectionalLight(0xffffff,3);sun.position.set(400,900,200);scene.add(sun);
const camera=new THREE.PerspectiveCamera(50,1,.2,8000),controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.49;
let layer:SurfaceRailLayer|null=null,terrain:Terrain=FLAT,ground:THREE.Mesh|null=null,revision=0,paused=false,time=0,last=performance.now(),readyAt=0;
const locations=[
  {name:'서울 2호선 · 당산역 / 당산철교',lat:37.53465,lon:126.9027},
  {name:'서울 2호선 · 성수역',lat:37.54465,lon:127.0557},
  {name:'수도권 1호선 · 용산 / 한강철교',lat:37.529,lon:126.962},
  {name:'수도권 1호선 · 구로역',lat:37.5031,lon:126.882},
  {name:'경의중앙선 · 양수역',lat:37.5459,lon:127.3291},
  {name:'부산 동해선 · 센텀역',lat:35.195,lon:129.123},
  {name:'부산김해경전철 · 사상역',lat:35.1635,lon:128.9857},
  {name:'대구 3호선 · 명덕역',lat:35.8578,lon:128.5905},
  {name:'대경선 · 구미역',lat:36.1283,lon:128.331},
  {name:'용인 에버라인 · 기흥역',lat:37.2756,lon:127.1169},
  {name:'의정부 경전철 · 의정부중앙역 / 고무차륜 안내궤도',lat:37.743706,lon:127.049528},
];
const select=root.querySelector<HTMLSelectElement>('#place')!;
locations.forEach((p,i)=>select.add(new Option(p.name,String(i))));
function resize(){const r=canvas.parentElement!.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();}window.addEventListener('resize',resize);resize();
async function choose(i:number){
  gaps.length=0;updates.length=0;
  const generation=++revision,p=locations[i];select.value=String(i);document.body.dataset.ready='';readyAt=performance.now();
  layer?.dispose();layer=null;if(ground){scene.remove(ground);ground.geometry.dispose();(ground.material as THREE.Material).dispose();ground=null;}
  terrain=FLAT;camera.position.set(180,115,180);controls.target.set(0,5,0);controls.update();
  document.querySelector('#station')!.textContent=p.name;
  // Public SRTM terrain only. No application API, server, saved DB or private key.
  const t=await loadTerrain(p,2400).catch(()=>FLAT);if(generation!==revision)return;terrain=t;
  const geo=new THREE.PlaneGeometry(5000,5000,96,96).rotateX(-Math.PI/2),pos=geo.getAttribute('position');
  for(let n=0;n<pos.count;n++)pos.setY(n,terrain.at(pos.getX(n),-pos.getZ(n))-.08);geo.computeVertexNormals();
  ground=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:'#809181',roughness:1}));scene.add(ground);
  layer=new SurfaceRailLayer({origin:p,heightAt:(x,y)=>terrain.at(x,y)});scene.add(layer.group);
}
select.onchange=()=>void choose(+select.value);
root.querySelector('#pause')!.addEventListener('click',()=>{paused=!paused;root.querySelector('#pause')!.textContent=paused?'운행 재개':'일시정지';});
root.querySelector('#follow')!.addEventListener('click',()=>{
  if(!layer)return;let closest:THREE.Vector3|null=null,direction=new THREE.Vector3(0,0,1),best=Infinity;
  layer.group.traverse(o=>{if(o instanceof THREE.InstancedMesh&&o.name==='train-cab')for(let i=0;i<o.count;i++){
    const m=new THREE.Matrix4();o.getMatrixAt(i,m);const p=new THREE.Vector3().setFromMatrixPosition(m),d=p.length();if(d<best){best=d;closest=p;direction.set(0,0,1).transformDirection(m);}
  }});
  if(closest){const p=closest as THREE.Vector3;controls.target.copy(p).add(new THREE.Vector3(0,2,0));camera.position.copy(p).addScaledVector(direction,30).add(new THREE.Vector3(-direction.z*15,12,direction.x*15));controls.update();}
});
const gaps:number[]=[],updates:number[]=[];let frames=0;
function frame(now:number){requestAnimationFrame(frame);const elapsed=now-last,dt=Math.min(.1,elapsed/1000);last=now;if(!paused)time+=dt;
  controls.update();layer?.update(time,camera.position);renderer.render(scene,camera);frames++;
  if(layer&&layer.stats.cars>0){document.body.dataset.ready='yes';if(gaps.length<600){gaps.push(elapsed);updates.push(layer.stats.updateMs);}}
  if(frames%20===0&&layer){const s=layer.inspect();document.querySelector('#metrics')!.innerHTML=`<span>선로 구간 <b>${s.corridors}</b></span><span>열차 / 객차 <b>${s.trains} / ${s.cars}</b></span><span>현재 선로 전송량 <b>${(s.bytes/1024).toFixed(1)} KB</b></span><span>동시 요청 / 메모리 캐시 <b>${s.inflight} / ${s.cache}</b></span><span>운행 계산 <b>${s.updateMs.toFixed(2)} ms</b></span><span>상세 표현 거리 <b>420 m</b></span>${s.error?`<span class="error">${s.error}</span>`:''}`;}
}
requestAnimationFrame(frame);
const requested=Number(new URLSearchParams(location.search).get('place')??0);
void choose(Number.isInteger(requested)&&locations[requested]?requested:0);
Object.assign(window,{__railReview:{locations,select:choose,inspect:()=>({layer:layer?.inspect(),readyMs:performance.now()-readyAt,frames,gaps,updates,render:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles},memory:{...renderer.info.memory}}),camera,controls,scene,renderer}});
