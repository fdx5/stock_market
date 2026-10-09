import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { DroneWorld } from '../src/components/droneWorld';
import { LANDMARK_SITES, GWANGAN_CENTRE } from '../src/components/sceneLandmarks';
import { FLAT } from '../src/components/sceneTerrain';
import { retainSceneMemory } from '../src/components/sceneMemory';
import { LOOKS } from '../src/components/complexScene';
import { ComplexRenderer } from '../src/components/tidewater/ComplexRenderer';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import DroneOverlay from '../src/components/DroneOverlay';
import { DroneSession, type DroneHud } from '../src/components/droneMode';
import '../src/desk2/realestate-hologram.css';

async function main() {
const q = new URLSearchParams(location.search);
const id = q.get('site') || 'gyeongbokgung';
const site = id === 'gwangan' ? { id, name: '광안대교', radius: 950, ...GWANGAN_CENTRE } : LANDMARK_SITES.find(s => s.id === id)!;
const key = await fetch('/review-key').then(r => r.json()).then(d => d.key);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#c1d4df');
scene.fog = new THREE.Fog('#c1d4df', 2200, 7800);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
document.getElementById('view')!.appendChild(renderer.domElement);
const native = q.get('renderer') === 'webgpu' ? await ComplexRenderer.create(document.getElementById('view')!) : null;
if (native) { native.setSize(innerWidth, innerHeight, 1); native.canvas.style.visibility = 'visible'; renderer.domElement.style.display = 'none'; native.droneSky = 1; native.droneFog = [2600, 7800]; }
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 10000);
const size = site.radius;
camera.position.set(size * 0.9, size * 1.15, size * 1.2);
camera.lookAt(0, 10, 0);
if (id === 'gwangan') { camera.position.set(500, 360, 650); camera.lookAt(0, 40, 0); }
if (q.get('view') === 'detail') {
  const target = id === 'gyeongbokgung' ? [116,-132] : id === 'changgyeonggung' ? [86,-171] : [66,-40];
  camera.position.set(target[0]+54,48,-target[1]+80); camera.lookAt(target[0],2,-target[1]);
}
if (q.get('flight') === '1') { camera.position.set(0,175,290); camera.lookAt(0,15,0); }
const hemi = new THREE.HemisphereLight('#d4e5ff', '#a0957e', 2.3); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff4df', 3.2); sun.position.set(-600, 900, 400); scene.add(sun);
const sky = new Sky(); sky.scale.setScalar(450000);
Object.assign(sky.material.uniforms.turbidity, { value: 3 });
sky.material.uniforms.rayleigh.value = 1.8;
sky.material.uniforms.sunPosition.value.copy(sun.position); scene.add(sky);
retainSceneMemory();
const data = { id: 'landmark-review', center: {lat:site.lat,lon:site.lon}, vworld_key: key, vworld_domain: 'https://kospimap.com' } as any;
const sink: { current: ((h:DroneHud)=>void) | null } = { current: null };
const common = { data,
  terrain: FLAT, extent: { ring: 0, farHalf: 0 }, seed: 23, hq: true,
  addWarm: (parent:THREE.Object3D, obj:THREE.Object3D) => { parent.add(obj); }, drawReady: (obj:THREE.Object3D) => native ? native.objectsReady(obj) : !!obj.parent,
  forget: (materials:Set<THREE.Material>) => native?.forget(materials),
};
const session = q.get('flight') === '1' ? new DroneSession({ ...common, scene, camera, ground:null,
  setSky: (k,fog) => { if(native){native.droneSky=k;if(fog)native.droneFog=fog;} }, onHud:h=>sink.current?.(h),
}) : null;
const world = session?.world ?? new DroneWorld(common);
scene.add(world.root);
const status = document.getElementById('status')!;
const review = (window as any).__landmarkReview = { site, world, renderer, native, scene, camera, session, loaded: false, frames: 0, ended:false };
if(session){
  session.start();session.audio.setMuted(true);status.style.display='none';
  const host=document.getElementById('view')!;host.className='re-holo-stage'+(q.get('touch')==='1'?' re-holo--drone-touch':'');host.style.position='relative';
  const overlay=document.createElement('div');host.appendChild(overlay);const root=createRoot(overlay);
  const renderOverlay=()=>root.render(createElement(DroneOverlay,{sink,flight:session.flight,signs:session.signs,touch:q.get('touch')==='1',
    radar:{vkey:key,domain:'https://kospimap.com',origin:data.center,where:session.where},
    onExit:()=>{session.end();review.ended=true;root.unmount();},onMute:m=>session.audio.setMuted(m),
    view:session.view,onView:()=>{session.toggleView();renderOverlay();},
  }));renderOverlay();
  window.addEventListener('keydown',e=>{if(e.code.startsWith('Key') || ['Space','ShiftLeft','ShiftRight','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))session.flight.keys.add(e.code);});
  window.addEventListener('keyup',e=>session.flight.keys.delete(e.code));
  let drag:{x:number;y:number}|null=null;
  host.addEventListener('pointerdown',e=>{if(!(e.target as HTMLElement).closest('button,a,.re-drone-stick,.re-drone-card,.re-drone-radar'))drag={x:e.clientX,y:e.clientY};});
  host.addEventListener('pointermove',e=>{if(drag&&e.buttons){session.flight.look(e.clientX-drag.x,e.clientY-drag.y);drag={x:e.clientX,y:e.clientY};}});
  window.addEventListener('pointerup',()=>{drag=null;});
}
let last=performance.now();
function tick() {
  if(review.ended)return;
  const now=performance.now(),dt=Math.min(.05,(now-last)/1000);last=now;
  const horizontal = Math.hypot(camera.position.x, camera.position.z) || 1;
  if(session)session.tick(dt,innerWidth,innerHeight);
  else world.update(camera.position.x, -camera.position.z, 0, 0, camera.position.y,
    [-camera.position.x / horizontal, camera.position.z / horizontal]);
  if (native) { native.render(scene, camera, LOOKS.day, performance.now() / 1000); if (native.ready) native.shown = true; }
  else renderer.render(scene, camera);
  review.frames++;
  const group = world.landmarks.root.children.find(g => g.name === (id === 'gwangan' ? '광안대교' : `landmark ${site.name}`));
  const stats = world.stats();
  review.models = group?.children.length ?? 0;
  review.loaded = id === 'gwangan' ? !!group : world.landmarks.placedSites().some(s => s.id === id);
  status.textContent = `${site.name} · ${review.loaded ? '모델 로딩 완료' : '모델 로딩 중'} · 모델 ${review.models}개 · 주변 타일 ${stats.ready}/${stats.tiles}`;
  requestAnimationFrame(tick);
}
tick();
}
void main().catch(error => { document.getElementById('status')!.textContent = '검증 장면 초기화 실패'; console.error(error); });
