import * as THREE from "three";

export type PremiumPlanetKind = "rock" | "ocean" | "ocean-clouds";

export interface PremiumPlanetMaps {
  surface: THREE.Texture;
  landformMap: THREE.Texture | null;
  clouds: THREE.Texture | null;
  atmosphereTexture: THREE.Texture | null;
  oceanColor: THREE.Color;
  terrainTint: THREE.Color;
  atmosphere: THREE.Color;
  kindLabel: string;
  cloudSpeed: number;
  uvOffset: number;
  landformOffset: number;
  seaLevel: number;
  landformBlend: number;
  invertLandform: number;
}

const ROOT = "/img/planet-surfaces/";
const ROCK_MAPS = ["2k_mercury.jpg", "2k_moon.jpg", "2k_venus_surface.jpg"];
const LANDFORM_MAPS = [
  "2k_mercury.jpg",
  "2k_moon.jpg",
  "2k_venus_surface.jpg",
  "nasa-mars-mola-topography.jpg",
];
const loader = new THREE.TextureLoader();
const textureCache = new Map<string, Promise<THREE.Texture>>();

export function stablePlanetHash(value: string) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function loadTexture(file: string, anisotropy: number, color = true) {
  const key = `${file}:${color ? "color" : "data"}`;
  let pending = textureCache.get(key);
  if (!pending) {
    pending = loader.loadAsync(`${ROOT}${file}`).then((texture) => {
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = anisotropy;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      return texture;
    });
    textureCache.set(key, pending);
  }
  return pending;
}

export async function loadPremiumPlanetMaps(
  code: string,
  kind: PremiumPlanetKind,
  anisotropy: number,
  whiteAtmosphere = false,
): Promise<PremiumPlanetMaps> {
  const hash = stablePlanetHash(code);
  const surface = await loadTexture(
    ROCK_MAPS[(hash >>> 4) % ROCK_MAPS.length],
    anisotropy,
  );
  const hasOcean = kind !== "rock";
  const hasClouds = kind === "ocean-clouds";
  const [landformMap, atmosphereTexture] = await Promise.all([
    hasOcean
      ? loadTexture(
          LANDFORM_MAPS[(hash >>> 8) % LANDFORM_MAPS.length],
          anisotropy,
          false,
        )
      : null,
    hasOcean ? loadTexture("2k_earth_clouds.jpg", anisotropy, false) : null,
  ]);
  const oceanPalettes = [0x031d3d, 0x063c4b, 0x082b68, 0x164552];
  const terrainPalettes = [0xd7b08c, 0xbac5b5, 0xc69872, 0xb8a7a0];
  const oceanColor = new THREE.Color(oceanPalettes[(hash >>> 10) % 4]);
  const terrainTint = new THREE.Color(terrainPalettes[(hash >>> 14) % 4]);
  const atmospherePalettes = [
    0x64f59a, // green
    0xff655d, // red
    0xffd75f, // yellow
    0x55aaff, // blue
  ];
  const atmosphere = hasOcean
    ? new THREE.Color(
        whiteAtmosphere
          ? 0xf1f7ff
          : atmospherePalettes[(hash >>> 6) % atmospherePalettes.length],
      )
    : terrainTint.clone().lerp(new THREE.Color(0xffd1a3), 0.42);

  return {
    surface,
    landformMap,
    clouds: hasClouds ? atmosphereTexture : null,
    atmosphereTexture,
    oceanColor,
    terrainTint,
    atmosphere,
    kindLabel:
      kind === "rock"
        ? "고해상도 암석형"
        : kind === "ocean"
          ? "암석 · 해양형"
          : "암석 · 해양 · 구름형",
    cloudSpeed: 0.035 + ((hash >>> 18) % 30) / 1000,
    uvOffset: ((hash >>> 20) % 1000) / 1000,
    landformOffset: ((hash >>> 2) % 1000) / 1000,
    seaLevel: 0.38 + ((hash >>> 12) % 24) / 100,
    landformBlend: 0.2 + ((hash >>> 16) % 45) / 100,
    invertLandform: (hash >>> 22) % 2,
  };
}
