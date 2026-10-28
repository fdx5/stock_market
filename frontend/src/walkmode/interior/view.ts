import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/* What the windows look out on. Entered from the walk, it is the real street round the building,
 * photographed in six directions from the flat's height (WalkGame.captureView). Opened on its own
 * (/walk?interior=demo) it is a painted stand-in: sky at the hour, a park below, and the
 * neighbouring blocks of a Korean apartment complex with their windows lit at night. */

export interface SunState { dir: THREE.Vector3; elevation: number; color: THREE.Color; intensity: number; sky: THREE.Color; skyIntensity: number; night: number }

/** The sun at a clock hour (October, Seoul): +z south, +x east, y up. */
export function sunAt(hour: number): SunState {
  const day = (hour - 6.6) / (17.6 - 6.6);
  const elevation = day > 0 && day < 1 ? Math.sin(day * Math.PI) * 40 : -12;
  const az = ((hour - 12.2) * 15 * Math.PI) / 180;
  const e = (Math.max(elevation, 3) * Math.PI) / 180;
  const dir = new THREE.Vector3(-Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e)).normalize();
  const night = THREE.MathUtils.smoothstep(-elevation, -2, 8);
  const low = 1 - THREE.MathUtils.smoothstep(elevation, 4, 22);
  const color = new THREE.Color("#fff3e2").lerp(new THREE.Color("#ffb070"), low);
  const intensity = elevation > 0 ? 3.4 * THREE.MathUtils.smoothstep(elevation, 0, 10) : 0;
  const sky = new THREE.Color("#d3dfeb").lerp(new THREE.Color("#f2c7a4"), low * 0.6).lerp(new THREE.Color("#1b2740"), night);
  const skyIntensity = 0.06 + 0.94 * (1 - night);
  return { dir, elevation, color, intensity, sky, skyIntensity, night };
}

/** A cube map of the painted view from `eye` metres up. */
export function paintedView(renderer: THREE.WebGLRenderer, hour: number, eye: number, seed: number): THREE.WebGLCubeRenderTarget {
  const sun = sunAt(hour);
  const scene = new THREE.Scene();
  const sky = new Sky(); sky.scale.setScalar(9000);
  const u = sky.material.uniforms;
  u.turbidity.value = 4.5; u.rayleigh.value = sun.night > 0.5 ? 0.3 : 1.6; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(sun.elevation > -4 ? sun.dir : new THREE.Vector3(0, -0.2, 1));
  scene.add(sky);
  const disposables: { dispose(): void }[] = [sky.geometry, sky.material];
  // the ground: a park and paths between the blocks
  const gc = document.createElement("canvas"); gc.width = gc.height = 1024;
  const g = gc.getContext("2d")!;
  g.fillStyle = "#5d6b4c"; g.fillRect(0, 0, 1024, 1024);
  let s = seed * 9973 + 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${40 + rnd() * 40},${60 + rnd() * 50},${30 + rnd() * 30},0.5)`; g.beginPath(); g.arc(rnd() * 1024, rnd() * 1024, 4 + rnd() * 14, 0, 7); g.fill(); }
  g.strokeStyle = "#b9b1a5"; g.lineWidth = 14; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(rnd() * 1024, 0); g.bezierCurveTo(rnd() * 1024, 400, rnd() * 1024, 600, rnd() * 1024, 1024); g.stroke(); }
  g.fillStyle = "#4a4d52"; g.fillRect(0, 700, 1024, 60); g.fillRect(480, 0, 50, 1024);
  const groundTex = new THREE.CanvasTexture(gc); groundTex.colorSpace = THREE.SRGBColorSpace; groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping; groundTex.repeat.set(3, 3);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
  scene.add(ground); disposables.push(ground.geometry, ground.material as THREE.Material, groundTex);
  // trees: dark lumps along the paths
  const tg = new THREE.IcosahedronGeometry(3.2, 1), tm = new THREE.MeshStandardMaterial({ color: "#3d5130", roughness: 1 });
  const trees = new THREE.InstancedMesh(tg, tm, 420);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 420; i++) { const a = rnd() * Math.PI * 2, r = 35 + rnd() * 300; m.makeScale(1, 0.9 + rnd() * 0.6, 1).setPosition(Math.cos(a) * r, 3 + rnd(), Math.sin(a) * r); trees.setMatrixAt(i, m); }
  scene.add(trees); disposables.push(tg, tm);
  // the blocks: 15–25 storey slabs in rows — white walls, a full-width glazed balcony band each
  // storey (확장형 거실 창), slab lines; at night some flats lit, warm or cool, bright or dim
  const FW = 512, FH = 1024, ST = FH / 16, BAY = FW / 4;
  const wc = document.createElement("canvas"); wc.width = FW; wc.height = FH;
  const w = wc.getContext("2d")!;
  w.fillStyle = "#e8e5df"; w.fillRect(0, 0, FW, FH);
  const lit = document.createElement("canvas"); lit.width = FW; lit.height = FH;
  const l = lit.getContext("2d")!; l.fillStyle = "#000"; l.fillRect(0, 0, FW, FH);
  for (let y = 0; y < 16; y++) {
    const top = y * ST;
    w.fillStyle = "#d4d0c9"; w.fillRect(0, top + ST - 5, FW, 5);                              // slab edge
    for (let x = 0; x < 4; x++) {
      const x0 = x * BAY + 6, x1 = (x + 1) * BAY - 6, gy = top + 7, gh = ST * 0.62;
      const gr = w.createLinearGradient(0, gy, 0, gy + gh);
      gr.addColorStop(0, "#8d9aa6"); gr.addColorStop(1, "#5e6a75");
      w.fillStyle = gr; w.fillRect(x0, gy, x1 - x0, gh);                                       // the glazing
      w.fillStyle = "rgba(235,232,226,0.9)";
      for (let m = 0; m <= 4; m++) w.fillRect(x0 + (x1 - x0) * m / 4 - 1, gy, 3, gh);           // mullions
      w.fillStyle = "rgba(255,255,255,0.28)"; w.fillRect(x0, gy + gh * 0.62, x1 - x0, gh * 0.38); // the railing's glass
      w.fillStyle = "#bdb8b0"; w.fillRect(x0, gy + gh * 0.6, x1 - x0, 2);
      if (rnd() < 0.36) {
        const warm = rnd() < 0.75, k = 0.45 + rnd() * 0.55;
        l.fillStyle = warm ? `rgba(255,${190 + rnd() * 30 | 0},${120 + rnd() * 40 | 0},${k})` : `rgba(225,235,255,${k})`;
        // (a lit room is a part of the band, its curtains half drawn)
        const c0 = x0 + (x1 - x0) * (rnd() * 0.4), c1 = c0 + (x1 - x0) * (0.3 + rnd() * 0.3);
        l.fillRect(c0, gy + 2, Math.min(x1, c1) - c0, gh * 0.6);
      }
    }
  }
  const facade = new THREE.CanvasTexture(wc), glow = new THREE.CanvasTexture(lit);
  facade.colorSpace = glow.colorSpace = THREE.SRGBColorSpace;
  const bm = new THREE.MeshStandardMaterial({ map: facade, emissiveMap: glow, emissive: "#ffffff", emissiveIntensity: sun.night * 1.1, roughness: 0.85 });
  // each slab its own box, its texture repeated once a storey and once per four flats
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 + rnd() * 0.08, r = 120 + (i % 3) * 120 + rnd() * 50;
    const floors = 15 + Math.floor(rnd() * 11), h = floors * 2.9, len = 40 + rnd() * 35;
    const g = new THREE.BoxGeometry(len, h, 13);
    const uv = g.getAttribute("uv");
    // (each slab from its own part of the lit pattern)
    const ou = Math.floor(rnd() * 4) / 4, ov = Math.floor(rnd() * 16) / 16;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * len / 28 + ou, uv.getY(k) * floors / 16 + ov);
    // (slabs face south, as Korean ones do: their long side across the view)
    g.rotateY(Math.round(rnd() * 3) * 0.06).translate(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    parts.push(g);
  }
  facade.wrapS = facade.wrapT = glow.wrapS = glow.wrapT = THREE.RepeatWrapping;
  const bg = mergeGeometries(parts)!; parts.forEach(g => g.dispose());
  const blocks = new THREE.Mesh(bg, bm);
  scene.add(blocks); disposables.push(bg, bm, facade, glow);
  // light: the sun and the sky
  const sunL = new THREE.DirectionalLight(sun.color, sun.intensity * 0.9); sunL.position.copy(sun.dir).multiplyScalar(100); scene.add(sunL);
  scene.add(new THREE.HemisphereLight(sun.sky, "#4a463e", 0.6 + 1.2 * (1 - sun.night)));
  scene.fog = new THREE.Fog(sun.sky.clone().lerp(new THREE.Color("#ffffff"), 0.2 * (1 - sun.night)), 200, 1600);
  const rt = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cam = new THREE.CubeCamera(1, 10000, rt);
  cam.position.set(0, eye, 0);
  const tm0 = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
  cam.update(renderer, scene);
  renderer.toneMapping = tm0;
  disposables.forEach(d => d.dispose());
  return rt;
}
