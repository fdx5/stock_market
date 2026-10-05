import * as THREE from "three";

/* The drive game's materials: a fixed set made once a session, shared by every tile — so a tile
 * coming in never brings a new shader to compile while driving. Textures are the game's own:
 * the facades copied into /3d/drive/facades, the rest painted here once. */

export type Style = "apt" | "villa" | "shop" | "office";
export const STYLES: Style[] = ["apt", "villa", "shop", "office"];

export interface Materials {
  ground: THREE.MeshStandardMaterial; water: THREE.MeshStandardMaterial; asphalt: THREE.MeshStandardMaterial;
  walks: THREE.MeshStandardMaterial; marks: THREE.MeshStandardMaterial; concrete: THREE.MeshStandardMaterial;
  roofs: THREE.MeshStandardMaterial; facades: Record<Style, THREE.MeshStandardMaterial>;
  lampPost: THREE.MeshStandardMaterial; lampHead: THREE.MeshStandardMaterial;
  trunk: THREE.MeshStandardMaterial; crown: THREE.MeshStandardMaterial;
  /** the light a street lamp throws on the road at night (an additive pool) */
  pool: THREE.MeshBasicMaterial;
  /** night: 0 day .. 1 night (windows and lamps lit) */
  setNight(k: number): void;
  dispose(): void;
}

function canvasTexture(size: number, paint: (g: CanvasRenderingContext2D, s: number) => void, srgb = true) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  paint(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const rng = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

/** Asphalt: dark aggregate, a little worn, tiling every 4 m. */
function asphaltTexture() {
  return canvasTexture(512, (g, s) => {
    const r = rng(11);
    g.fillStyle = "#3b3d40"; g.fillRect(0, 0, s, s);
    const img = g.getImageData(0, 0, s, s), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = (r() - 0.5) * 34; d[i] += v; d[i + 1] += v; d[i + 2] += v + 1; }
    g.putImageData(img, 0, 0);
    for (let k = 0; k < 900; k++) { const v = 70 + r() * 70; g.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + r() * 0.4})`; g.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2); }
    for (let k = 0; k < 14; k++) { g.fillStyle = `rgba(20,20,22,${0.05 + r() * 0.08})`; g.beginPath(); g.ellipse(r() * s, r() * s, 20 + r() * 60, 10 + r() * 40, r() * 3, 0, Math.PI * 2); g.fill(); }
  });
}
/** Sidewalk paving: grey blocks 25 × 50 cm (tiling every 4 m: 8 × 16 blocks). */
function pavingTexture() {
  return canvasTexture(512, (g, s) => {
    const r = rng(23), bw = s / 8, bh = s / 16;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) {
      const v = 150 + r() * 30 | 0, ox = (y % 2) * bw / 2;
      g.fillStyle = `rgb(${v},${v - 4},${v - 10})`; g.fillRect(x * bw + ox, y * bh, bw, bh);
      g.fillStyle = `rgb(${v},${v - 4},${v - 10})`; if (ox) g.fillRect(x * bw + ox - s, y * bh, bw, bh);
    }
    g.strokeStyle = "rgba(60,58,55,0.55)"; g.lineWidth = 2;
    for (let y = 0; y <= 16; y++) { g.beginPath(); g.moveTo(0, y * bh); g.lineTo(s, y * bh); g.stroke(); }
    for (let y = 0; y < 16; y++) for (let x = 0; x <= 8; x++) { const ox = (y % 2) * bw / 2; g.beginPath(); g.moveTo(x * bw + ox, y * bh); g.lineTo(x * bw + ox, (y + 1) * bh); g.stroke(); }
  });
}
/** Concrete for bridges: mottled grey. */
function concreteTexture() {
  return canvasTexture(256, (g, s) => {
    const r = rng(5);
    g.fillStyle = "#9a9a96"; g.fillRect(0, 0, s, s);
    for (let k = 0; k < 600; k++) { const v = 120 + r() * 60; g.fillStyle = `rgba(${v},${v},${v - 4},0.25)`; g.beginPath(); g.arc(r() * s, r() * s, 1 + r() * 6, 0, 7); g.fill(); }
  });
}
/** Water: a soft ripple normal map (tiling 20 m). */
function rippleNormal() {
  return canvasTexture(256, (g, s) => {
    const img = g.createImageData(s, s), d = img.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const u = (x / s) * Math.PI * 2, v = (y / s) * Math.PI * 2;
      const nx = 0.18 * Math.cos(u * 3 + Math.sin(v * 2) * 1.5) + 0.08 * Math.cos(u * 7 + v * 5);
      const ny = 0.18 * Math.cos(v * 4 + Math.sin(u * 3) * 1.2) + 0.08 * Math.sin(v * 9 - u * 2);
      const i = (y * s + x) * 4; d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = 230; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, false);
}

type Params = { file: string; wrapS: number; wrapT: number; flipY: boolean; anisotropy: number; colorSpace: string; repeat: [number, number]; offset: [number, number] };

async function facadeTextures(): Promise<Record<Style, Record<string, THREE.Texture>>> {
  const manifest: Record<Style, Record<string, Params>> = await fetch("/3d/drive/facades/manifest.json").then(r => r.json());
  const out = {} as Record<Style, Record<string, THREE.Texture>>;
  await Promise.all(STYLES.map(async style => {
    out[style] = {};
    await Promise.all(Object.entries(manifest[style]).map(async ([name, p]) => {
      const blob = await fetch(`/3d/drive/facades/${p.file}`).then(r => r.blob());
      const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none", imageOrientation: "none" });
      const t = new THREE.Texture(bmp as unknown as HTMLImageElement);
      t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
      t.repeat.set(p.repeat[0], p.repeat[1]); t.offset.set(p.offset[0], p.offset[1]);
      if (p.colorSpace === "srgb") t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      out[style][name] = t;
    }));
  }));
  return out;
}

export async function makeMaterials(): Promise<Materials> {
  const fac = await facadeTextures();
  const asphaltMap = asphaltTexture(), paving = pavingTexture(), concreteMap = concreteTexture(), ripple = rippleNormal();
  const ground = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const water = new THREE.MeshStandardMaterial({ color: "#1d3646", roughness: 0.16, metalness: 0.05, normalMap: ripple, normalScale: new THREE.Vector2(0.22, 0.22), transparent: true, opacity: 0.96, envMapIntensity: 0.55 });
  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltMap, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const walks = new THREE.MeshStandardMaterial({ map: paving, roughness: 0.85, metalness: 0 });
  const marks = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const concrete = new THREE.MeshStandardMaterial({ map: concreteMap, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const roofs = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const facades = {} as Record<Style, THREE.MeshStandardMaterial>;
  for (const s of STYLES) {
    const t = fac[s];
    facades[s] = new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), vertexColors: true,
      roughnessMap: t.rmMap, metalnessMap: t.rmMap, roughness: 1, metalness: 1,
      emissiveMap: t.emissiveMap, emissive: new THREE.Color("#ffd9a8"), emissiveIntensity: 0,
    });
  }
  // (the lamp: one material; uv 0.25 the post, 0.75 the head — light and emissive there)
  const lampTex = (a: [number, number, number], b: [number, number, number]) => { const d = new Uint8Array([...a, 255, ...b, 255]); const t = new THREE.DataTexture(d, 2, 1); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
  const lampColor = lampTex([91, 97, 104], [233, 228, 218]), lampGlow = lampTex([0, 0, 0], [255, 255, 255]);
  const lampPost = new THREE.MeshStandardMaterial({ map: lampColor, emissiveMap: lampGlow, emissive: "#ffd29a", emissiveIntensity: 0, roughness: 0.45, metalness: 0.5 });
  const lampHead = lampPost;
  const trunk = new THREE.MeshStandardMaterial({ color: "#5a4636", roughness: 0.95 });
  const crown = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: false });
  const poolTex = canvasTexture(128, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, "rgba(255,214,150,1)"); gr.addColorStop(0.35, "rgba(255,190,120,.55)"); gr.addColorStop(1, "rgba(255,170,100,0)");
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
  poolTex.wrapS = poolTex.wrapT = THREE.ClampToEdgeWrapping;
  const pool = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  pool.visible = false;
  const all = [ground, water, asphalt, walks, marks, concrete, roofs, ...Object.values(facades), lampPost, trunk, crown, pool];
  return {
    ground, water, asphalt, walks, marks, concrete, roofs, facades, lampPost, lampHead, trunk, crown, pool,
    setNight(k) {
      for (const s of STYLES) facades[s].emissiveIntensity = k * 1.6;
      lampPost.emissiveIntensity = k * 9;
      pool.opacity = k * 0.42; pool.visible = k > 0.05;
    },
    dispose() {
      all.forEach(m => m.dispose());
      [asphaltMap, paving, concreteMap, ripple, lampColor, lampGlow, poolTex].forEach(t => t.dispose());
      for (const s of STYLES) Object.values(fac[s]).forEach(t => t.dispose());
    },
  };
}
