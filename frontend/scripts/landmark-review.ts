import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { DroneWorld } from '../src/components/droneWorld';
import { LANDMARK_SITES, GWANGAN_CENTRE } from '../src/components/sceneLandmarks';
import { FLAT } from '../src/components/sceneTerrain';
import { retainSceneMemory } from '../src/components/sceneMemory';
import { LOOKS } from '../src/components/complexScene';
import { ComplexRenderer } from '../src/components/tidewater/ComplexRenderer';

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
const hemi = new THREE.HemisphereLight('#d4e5ff', '#a0957e', 2.3); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff4df', 3.2); sun.position.set(-600, 900, 400); scene.add(sun);
const sky = new Sky(); sky.scale.setScalar(450000);
Object.assign(sky.material.uniforms.turbidity, { value: 3 });
sky.material.uniforms.rayleigh.value = 1.8;
sky.material.uniforms.sunPosition.value.copy(sun.position); scene.add(sky);
retainSceneMemory();
const world = new DroneWorld({ data: { id: 'landmark-review', center: {lat:site.lat,lon:site.lon}, vworld_key: key, vworld_domain: 'https://kospimap.com' } as any,
  terrain: FLAT, extent: { ring: 0, farHalf: 0 }, seed: 23, hq: true,
  addWarm: (parent, obj) => parent.add(obj), drawReady: obj => native ? native.objectsReady(obj) : !!obj.parent,
  forget: materials => native?.forget(materials),
});
scene.add(world.root);
const status = document.getElementById('status')!;
const review = (window as any).__landmarkReview = { site, world, renderer, native, scene, camera, loaded: false, frames: 0 };
function tick() {
  const horizontal = Math.hypot(camera.position.x, camera.position.z) || 1;
  world.update(camera.position.x, -camera.position.z, 0, 0, camera.position.y,
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
