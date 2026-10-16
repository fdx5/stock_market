// Deterministic city fixture. No app APIs, account state or existing databases.
import * as THREE from 'three';
import { ComplexRenderer, QUALITY } from '../src/components/tidewater/ComplexRenderer.js';
import { GPU } from '../src/vendor/tidewater/engine/gpu/GPU.js';
GPU.verifyAsyncShaders = new URLSearchParams(location.search).has('verify-shaders');

const qa = window as any;
qa.__flight = { ready: false, errors: [], shaderJobs: { reach: 0, finish: 0 }, draws: 0, samples: [] };
const originalPost = Worker.prototype.postMessage;
Worker.prototype.postMessage = function(message: any, ...args: any[]) {
  if (message?.op in qa.__flight.shaderJobs) qa.__flight.shaderJobs[message.op]++;
  return (originalPost as any).call(this, message, ...args);
};
const scene = new THREE.Scene(); scene.matrixAutoUpdate = false;
scene.fog = new THREE.FogExp2('#a8c1d0', .00035);
const mats = Array.from({ length: 48 }, (_, i) => new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(.08 + i % 9 * .012, .07, .35 + i % 7 * .055), roughness: .65 + (i % 3) * .1 }));
const box = new THREE.BoxGeometry(20, 1, 18), crown = new THREE.SphereGeometry(5, 8, 6);
for (let row = 0; row < 30; row++) for (let col = 0; col < 40; col++) {
  const i = row * 40 + col, height = 10 + (i * 17 % 80);
  const mesh = new THREE.Mesh(box, mats[i % mats.length]);
  mesh.position.set((col - 20) * 35, height / 2, (row - 15) * 35); mesh.scale.y = height;
  mesh.castShadow = true; mesh.updateMatrix(); mesh.matrixAutoUpdate = false; scene.add(mesh);
  if (i % 3 === 0) {
    const tree = new THREE.Mesh(crown, mats[(i + 13) % mats.length]);
    tree.position.set(mesh.position.x + 15, 6, mesh.position.z + 14); tree.castShadow = true;
    tree.updateMatrix(); tree.matrixAutoUpdate = false; scene.add(tree);
  }
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshStandardMaterial({ color: '#77786c', roughness: .95 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -.1; ground.updateMatrix(); ground.matrixAutoUpdate = false; scene.add(ground);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, .5, 4000);
const look = { keyElev: 45, keyAz: 135, key: new THREE.Color(1, .93, .84), keyI: 2.5,
  hemiSky: new THREE.Color(.5, .65, .85), hemiI: 1, fog: new THREE.Color('#a8c1d0'), exposure: 1,
  stars: 0, env: 1, bloom: .15, bloomAt: 4 };
function pose(t: number) { camera.position.set(380 * Math.sin(t), 140 + 35 * Math.sin(t * .6), 420 * Math.cos(t)); camera.lookAt(0, 25, 0); camera.updateMatrixWorld(); }
pose(0);
const started = performance.now();
const view = await ComplexRenderer.create(document.getElementById('stage'), QUALITY.high);
view.setSize(innerWidth, innerHeight, 1.25);
qa.__view = view;
const originalSync = view.sync;
view.sync = function(...args: any[]) { const t = performance.now(); try { return originalSync.apply(this, args); } finally { qa.__flight.syncMs = performance.now() - t; } };
const once = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
try {
  for (let n = 0; n < 3600; n++) {
    await once(); view.render(scene, camera, look, 20);
    if (view.shown && !view.pending && view.meshes.size === scene.children.length) break;
  }
  if (!view.shown) throw Error('Fixture did not become visible');
  qa.__flight.loadedMs = performance.now() - started;
  qa.__flight.ready = true;
  qa.__flight.quality = view.quality;
  qa.__flight.canvas = [view.canvas.width, view.canvas.height];
  qa.__flight.objects = scene.children.length;
  const info = GPU.adapter.info;
  qa.__flight.gpu = { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description };
  qa.__flight.run = async (seconds = 12) => {
    const samples: number[] = [], cpu: number[] = [], sync: number[] = [], windows: number[] = [];
    const start = performance.now(); let last = start, windowAt = start, count = 0;
    while (performance.now() - start < seconds * 1000) {
      const at = await once(); pose((at - start) * .00012);
      const before = performance.now(); view.render(scene, camera, look, 20);
      const end = performance.now(); cpu.push(end - before); sync.push(qa.__flight.syncMs);
      samples.push(end - last); last = end; count++;
      if (end - windowAt >= 1000) { windows.push(count * 1000 / (end - windowAt)); windowAt = end; count = 0; }
    }
    const summary = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return { median: b[Math.floor(b.length * .5)], p95: b[Math.floor(b.length * .95)], max: b.at(-1) }; };
    const result = { seconds, frames: samples.length, meanFps: samples.length * 1000 / (last - start), minWindowFps: Math.min(...windows), over20: samples.filter(x => x > 20).length,
      frameMs: summary(samples), cpuMs: summary(cpu), syncMs: summary(sync), canvas: qa.__flight.canvas, quality: view.quality, objects: scene.children.length, shaderJobs: { ...qa.__flight.shaderJobs }, gpuMs: { ...view.timer.ms } };
    qa.__flight.samples.push(result); return result;
  };
  qa.__flight.freeze = async () => { pose(0); for (let i = 0; i < 96; i++) { await once(); view.render(scene, camera, look, 20); } };
} catch (error) { qa.__flight.errors.push(String(error)); throw error; }
