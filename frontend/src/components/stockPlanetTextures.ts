import * as THREE from "three";
import { stablePlanetHash } from "./premiumPlanetTextures";

type PlanetCase = {
  id: string; label: string; height: boolean; cloud: boolean;
  roughness: boolean; invertRoughness: boolean; emissive: boolean; atmosphere: number;
};

export interface StockPlanetMaps {
  surface: THREE.Texture;
  landformMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
  emissiveMap: THREE.Texture | null;
  clouds: THREE.Texture | null;
  cloudAlpha: THREE.Texture | null;
  cloudsSecondary: THREE.Texture | null;
  atmosphereTexture: THREE.Texture | null;
  oceanColor: THREE.Color; terrainTint: THREE.Color; atmosphere: THREE.Color;
  kind: string; kindLabel: string; cloudOpacity: number; cloudSpeed: number;
  uvOffset: number; landformOffset: number; seaLevel: number; landformBlend: number;
  invertLandform: number; invertRoughness: number;
}

const LOCAL_ROOT = "/planet-assets/stock-planets-v3";
const CDN_ROOT =
  import.meta.env.VITE_PLANET_TEXTURE_CDN ||
  "https://cdn.jsdelivr.net/gh/fdx5/stock_market@fbf59bc/planet-assets/stock-planets-v3";
const ROOT = (import.meta.env.DEV ? LOCAL_ROOT : CDN_ROOT).replace(/\/$/, "");
const ASSET_VERSION = "20260901-2k-v1";
const C = (id: string, label: string, height: boolean, cloud: boolean, roughness: boolean, invertRoughness: boolean, emissive: boolean, atmosphere: number): PlanetCase =>
  ({ id, label, height, cloud, roughness, invertRoughness, emissive, atmosphere });

// One canonical entry per usable equirectangular folder. The duplicate Desert 03
// archive and the square, model-specific Coruscant UV set are deliberately omitted.
const CASES: PlanetCase[] = [
  C("desert-01","Desert 01",false,true,false,false,false,0xd9aa73),
  C("desert-03","Desert 03",false,true,false,false,true,0xd6a06a),
  C("desert-05","Desert 05",true,true,true,true,true,0xd7a66f),
  C("desert-07","Desert 07",true,true,true,true,true,0xd4a16b),
  C("desert-08","Desert 08",true,true,true,true,true,0xd9ad79),
  C("exotic-01","Exotic 01",true,true,true,false,true,0xb47ee5),
  C("exotic-02","Exotic 02",true,true,true,false,true,0xcf88dc),
  C("exotic-03","Exotic 03",true,true,true,false,true,0xa886e8),
  C("felucia","Felucia",true,true,true,true,true,0x8fd58f),
  C("gaseous-01","Gaseous 01",true,false,true,true,false,0xe4bd83),
  C("gaseous-03","Gaseous 03",true,false,true,true,false,0xb9c7e7),
  C("ice-05","Ice 05",true,true,true,false,true,0xbdeaff),
  C("ice-06","Ice 06",true,true,true,false,true,0xc9efff),
  C("korriban-4k","Korriban",true,true,true,false,false,0xcf735d),
  C("oceanic-01","Oceanic 01",true,true,true,true,true,0x77d7ef),
  C("oceanic-02","Oceanic 02",false,true,false,false,true,0x79d9f0),
  C("oceanic-03","Oceanic 03",true,true,true,true,true,0x7fdcf1),
  C("oceanic-04","Oceanic 04",true,true,true,true,true,0x72d3ec),
  C("oceanic-05","Oceanic 05",true,true,true,false,true,0x83dff4),
  C("taris","Taris",true,true,true,true,true,0xb7d9ec),
  C("terran-02","Terran 02",false,true,false,false,true,0xa8def2),
  C("terran-05","Terran 05",true,true,false,false,true,0xa4dcf1),
  C("terran-06","Terran 06",true,true,true,true,true,0xa2daf0),
  C("terran-07","Terran 07",false,true,false,false,true,0xa6ddf2),
  C("terran-08","Terran 08",true,true,true,true,true,0x9fdcf4),
  C("terran-09-variant-2","Terran 09 Variant 2",true,true,true,false,true,0xa9e1f5),
  C("terran-09","Terran 09",true,true,true,false,true,0xa9e1f5),
  C("terran-10","Terran 10",true,true,true,false,true,0xa4ddf3),
  C("mandalore-legends-4k","Mandalore Legends",true,true,true,false,true,0xb8c9d7),
  C("nar-shaddaa","Nar Shaddaa",true,true,true,false,true,0xd1a0d9),
  C("csilla-4k","Csilla",true,true,true,false,true,0xbceaff),
  C("volcanic-02","Volcanic 02",true,true,true,true,true,0xff7547),
  C("volcanic-03","Volcanic 03",true,true,true,true,true,0xff6d42),
  C("volcanic-04","Volcanic 04",true,true,true,true,true,0xff7948),
  C("volcanic-05","Volcanic 05",true,true,true,false,true,0xff7044),
  C("volcanic-06","Volcanic 06",true,true,true,false,true,0xff6840),
];

const loader = new THREE.TextureLoader();
const bitmapLoader =
  typeof createImageBitmap === "function"
    ? new THREE.ImageBitmapLoader().setOptions({ imageOrientation: "flipY" })
    : null;
const textureCache = new Map<string, Promise<THREE.Texture>>();

function loadTexture(path: string) {
  if (!bitmapLoader) return loader.loadAsync(path);
  // Some mobile WebKit/Chromium builds expose createImageBitmap but intermittently
  // reject large cross-origin WebP decodes. Fall back to the broadly supported image
  // element path instead of leaving the planet on its placeholder forever.
  return bitmapLoader.loadAsync(path).then(
    (image) => {
      const map = new THREE.Texture(image);
      map.flipY = false;
      map.needsUpdate = true;
      return map;
    },
    () => loader.loadAsync(path),
  );
}

function hash(value: string) {
  let result = stablePlanetHash(value); result ^= result >>> 16;
  result = Math.imul(result, 0x7feb352d); result ^= result >>> 15;
  result = Math.imul(result, 0x846ca68b); return (result ^ (result >>> 16)) >>> 0;
}

function texture(path: string, anisotropy: number, color: boolean) {
  path += `${path.includes("?") ? "&" : "?"}v=${ASSET_VERSION}`;
  const key = `${path}:${color ? "color" : "data"}`;
  let pending = textureCache.get(key);
  if (!pending) {
    pending = loadTexture(path).then((map) => {
      map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      map.wrapS = THREE.RepeatWrapping; map.wrapT = THREE.ClampToEdgeWrapping;
      map.minFilter = THREE.LinearMipmapLinearFilter; map.magFilter = THREE.LinearFilter;
      map.anisotropy = Math.min(16, anisotropy); return map;
    }).catch((error) => {
      // A rejected promise must not poison later focus/visibility retries.
      textureCache.delete(key);
      throw error;
    });
    textureCache.set(key, pending);
  }
  return pending;
}

function orderedCases(systemKey: string) {
  let state = hash(`${systemKey}:planet-case-order`);
  const shuffle = (items: PlanetCase[]) => {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const j = state % (i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  const familyOf = (item: PlanetCase) => {
      if (item.id.startsWith("desert-") || item.id.startsWith("gaseous-")) return 0;
      if (item.id.startsWith("volcanic-") || item.id.startsWith("exotic-")) return 1;
      if (
        item.id.startsWith("oceanic-") ||
        item.id.startsWith("ice-") ||
        item.id.startsWith("csilla-")
      ) return 2;
      return 3;
    },
    families = [0, 1, 2, 3].map((family) =>
      shuffle(CASES.filter((item) => familyOf(item) === family)),
    ),
    cases: PlanetCase[] = [];
  // Round-robin by visual family, not merely by folder name. Each consecutive
  // four planets therefore contains one arid/gas, one volcanic/exotic, one
  // ocean/ice and one terrestrial/special world. Small families wrap only after
  // every case in that family has appeared once.
  for (let slot = 0; slot < CASES.length; slot++) {
    const family = slot % families.length,
      familyIndex = Math.floor(slot / families.length);
    cases.push(families[family][familyIndex % families[family].length]);
  }
  return cases;
}

export function stockPlanetKind(_code: string, slot = 0, systemKey = "market") {
  return orderedCases(systemKey)[slot % CASES.length].id;
}

function baseMaps(
  code: string,
  spec: PlanetCase,
  surface: THREE.Texture,
): StockPlanetMaps {
  return {
    surface, landformMap: null, roughnessMap: null, emissiveMap: null,
    clouds: null, cloudAlpha: null, cloudsSecondary: null, atmosphereTexture: null,
    oceanColor: new THREE.Color(0x062b52), terrainTint: new THREE.Color(0xffffff),
    atmosphere: new THREE.Color(spec.atmosphere), kind: spec.id, kindLabel: spec.label,
    cloudOpacity: 0.72, cloudSpeed: 0.014 + (hash(`${code}:cloud-speed`) % 24) / 1000,
    uvOffset: (hash(`${code}:surface-offset`) % 1000) / 1000, landformOffset: 0,
    seaLevel: 0.5, landformBlend: 0, invertLandform: 0,
    invertRoughness: spec.invertRoughness ? 1 : 0,
  };
}

export async function loadStockPlanetPreview(
  code: string,
  anisotropy: number,
  slot = 0,
  systemKey = "market",
): Promise<StockPlanetMaps> {
  const spec = orderedCases(systemKey)[slot % CASES.length],
    path = `${ROOT}/${spec.id}`,
    surface = await texture(`${path}/surface-preview.webp`, anisotropy, true);
  return baseMaps(code, spec, surface);
}

export async function loadStockPlanetMaps(code: string, anisotropy: number, slot = 0, systemKey = "market"): Promise<StockPlanetMaps> {
  const spec = orderedCases(systemKey)[slot % CASES.length];
  const path = `${ROOT}/${spec.id}`;
  // Decode material maps serially. Parallel decoding is faster in wall-clock time
  // but causes a visible main-thread/GPU upload spike exactly during camera flight.
  const surface = await texture(`${path}/surface.webp`, anisotropy, true),
    height = spec.height ? await texture(`${path}/height.webp`, anisotropy, false) : null,
    roughness = spec.roughness ? await texture(`${path}/roughness.webp`, anisotropy, false) : null,
    emissive = spec.emissive ? await texture(`${path}/emissive.webp`, anisotropy, true) : null,
    cloudBase = spec.cloud ? await texture(`${path}/cloud.webp`, anisotropy, true) : null,
    cloudAlphaBase = spec.cloud ? await texture(`${path}/cloud-alpha.webp`, anisotropy, false) : null;
  const clouds = cloudBase?.clone() ?? null;
  const cloudAlpha = cloudAlphaBase?.clone() ?? null;
  const cloudOffset = (hash(`${code}:cloud-offset`) % 1000) / 1000;
  if (clouds) { clouds.offset.x = cloudOffset; clouds.needsUpdate = true; }
  if (cloudAlpha) { cloudAlpha.offset.x = cloudOffset; cloudAlpha.needsUpdate = true; }
  return {
    ...baseMaps(code, spec, surface),
    landformMap: height, roughnessMap: roughness, emissiveMap: emissive,
    clouds, cloudAlpha,
  };
}
