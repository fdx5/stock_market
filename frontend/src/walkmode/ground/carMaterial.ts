import * as THREE from "three";
import { carModelMaterial } from "../../drivegame/vehicle/cars";

/* The walk's cars in real materials. The drive game's car models paint every part from a 16-swatch
 * strip (cars.ts PART_RGB, swatch i at u = (i + ½)/16) under one plastic material; seen from the
 * pavement that reads as toys. Here each swatch is its own surface: the body metallic paint under a
 * clear coat (the only part taking the car's colour), dark reflective glazing, matt rubber, black
 * trim, alloy wheels, chrome, lamp lenses. One material, one program (the walk only). */

// Same slots as cars.ts PART_RGB: body, glass, trim, rim, chrome, head,
// tail, plate, amber signal, TYRE, aluminium panel, white cab.
const ROUGH = [0.23, 0.045, 0.66, 0.24, 0.12, 0.075, 0.13, 0.48, 0.13, 0.94, 0.36, 0.25, 0.04, 0.05, 0.44, 0.88];
const METAL = [0.42, 0.05, 0, 0.88, 1, 0.08, 0, 0, 0, 0, 0.82, 0.3, 0.05, 0.05, 0.86, 0];
const COAT = [1, 0.85, 0, 0.25, 0.15, 0.9, 0.8, 0, 0.7, 0, 0.1, 1, 0, 0, 0, 0];
/** the glazing darker than its swatch (reflections make it read as glass) */
const GLASS_RGB = new THREE.Color("#18232b");

let scans: { rubber: THREE.Texture; alloy: THREE.Texture; refs: number } | null = null;
function acquireScans() {
  if (!scans) {
    const load = (name: string) => { const t = new THREE.TextureLoader().load(`/3d/walk/cars/${name}-scan-2k.webp`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
    scans = { rubber: load("rubber"), alloy: load("alloy"), refs: 0 };
  }
  const owned = scans; owned.refs++;
  return { ...owned, release() { if (--owned.refs === 0) { owned.rubber.dispose(); owned.alloy.dispose(); if (scans === owned) scans = null; } } };
}

export function realCarMaterial(): THREE.MeshPhysicalMaterial {
  const base = carModelMaterial(), map = base.map; base.dispose();
  const m = new THREE.MeshPhysicalMaterial({ map, roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.075, envMapIntensity: 1.15, specularIntensity: 1 });
  const surface = acquireScans();
  m.userData.carModel = true;
  m.userData.walkSurfaceQuality = "layered-paint-photographic-rubber-alloy-2k-v3";
  // Fine orange-peel normal and metallic flakes, in model metres rather than the
  // swatch UV. A small shared-per-material mipmapped map avoids sparkling noise.
  const size = 256, data = new Uint8Array(size * size * 4); let seed = 7121;
  const rand = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  for (let i = 0; i < data.length; i += 4) { data[i] = 128 + (rand() - 0.5) * 42; data[i + 1] = 128 + (rand() - 0.5) * 42; data[i + 2] = 128 + (rand() - 0.5) * 80; data[i + 3] = 255; }
  const grain = new THREE.DataTexture(data, size, size); grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.generateMipmaps = true; grain.minFilter = THREE.LinearMipmapLinearFilter; grain.magFilter = THREE.LinearFilter; grain.needsUpdate = true;
  m.addEventListener("dispose", () => { grain.dispose(); surface.release(); });
  m.onBeforeCompile = sh => {
    sh.uniforms.partRough = { value: ROUGH }; sh.uniforms.partMetal = { value: METAL }; sh.uniforms.partCoat = { value: COAT };
    sh.uniforms.glassRgb = { value: GLASS_RGB };
    sh.uniforms.carGrain = { value: grain };
    sh.uniforms.carRubber = { value: surface.rubber }; sh.uniforms.carAlloy = { value: surface.alloy };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 carLocalPosition;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\ncarLocalPosition = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float partRough[16]; uniform float partMetal[16]; uniform float partCoat[16]; uniform vec3 glassRgb; uniform sampler2D carGrain; uniform sampler2D carRubber; uniform sampler2D carAlloy; varying vec3 carLocalPosition;\nint carPart;\nvec3 partBase;\nvec3 carMicro; vec4 carScan;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        carPart = int(clamp(floor(vMapUv.x * 16.0), 0.0, 15.0)); partBase = diffuseColor.rgb;
        if (carPart == 1 || carPart == 12 || carPart == 13) partBase = glassRgb;
        if (carPart == 14) partBase = vec3(0.18, 0.19, 0.20);
        if (carPart == 15) partBase = vec3(0.016, 0.019, 0.022);
        carScan = vec4(0.5, 0.5, 0.5, 0.5);
        if (carPart == 9 || carPart == 2) carScan = texture2D(carRubber, carLocalPosition.zy * 7.0);
        if (carPart == 3 || carPart == 14) carScan = texture2D(carAlloy, carLocalPosition.zy * 2.5);
      `)
      // (only the body takes the car's paint)
      .replace("#include <color_fragment>", "#include <color_fragment>\nif (carPart != 0) diffuseColor.rgb = partBase;\nif (carPart == 9 || carPart == 3 || carPart == 14) diffuseColor.rgb *= clamp(carScan.a * 2.0, 0.8, 1.15);")
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
        carMicro = texture2D(carGrain, (carLocalPosition.xy + carLocalPosition.zy) * 21.0).rgb;
        metalnessFactor = partMetal[carPart]; roughnessFactor = partRough[carPart];
        if (carPart == 0 || carPart == 11) roughnessFactor += (carMicro.b - 0.5) * 0.055;
        if (carPart == 9) roughnessFactor = clamp(roughnessFactor + (carMicro.b - 0.5) * 0.12, 0.82, 1.0);
        if (carPart == 9 || carPart == 2) roughnessFactor = clamp(0.78 + carScan.b * 0.22, 0.78, 1.0);
        if (carPart == 3) roughnessFactor = 0.18 + carScan.b * 0.18;
      `)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        if (carPart == 9 || carPart == 3 || carPart == 14) {
          vec3 tangent = dFdx(-vViewPosition), bitangent = dFdy(-vViewPosition);
          tangent /= max(length(tangent), 0.00001); bitangent /= max(length(bitangent), 0.00001);
          normal = normalize(normal + (tangent * (carScan.r - 0.5) + bitangent * (carScan.g - 0.5)) * (carPart == 9 ? 0.20 : 0.08));
        }
      `)
      .replace("#include <clearcoat_normal_fragment_maps>", `#include <clearcoat_normal_fragment_maps>
        if (carPart == 0 || carPart == 11) {
          vec3 tangent = dFdx(-vViewPosition), bitangent = dFdy(-vViewPosition);
          tangent /= max(length(tangent), 0.00001); bitangent /= max(length(bitangent), 0.00001);
          clearcoatNormal = normalize(clearcoatNormal + (tangent * (carMicro.r - 0.5) + bitangent * (carMicro.g - 0.5)) * 0.055);
        }
      `)
      .replace("#include <lights_physical_fragment>", "#include <lights_physical_fragment>\nmaterial.clearcoat *= partCoat[carPart];\nif (carPart == 1) material.clearcoatRoughness = 0.025;");
  };
  m.customProgramCacheKey = () => "walkCar3";
  return m;
}

/** Separate alpha-blended glazing. Real cabin geometry remains visible through
 * the front/rear/side windows; the coating reflects the local street probe. */
export function carGlassMaterial() {
  const base = carModelMaterial();
  const m = new THREE.MeshPhysicalMaterial({ map: base.map, color: "#ffffff", roughness: 0.035, metalness: 0.16, clearcoat: 1,
    clearcoatRoughness: 0.018, ior: 1.52, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, envMapIntensity: 1.5 });
  base.dispose(); m.userData.carModel = true; m.userData.carGlass = true;
  const front = new THREE.Color("#324c59"), rear = new THREE.Color("#13212e"), side = new THREE.Color("#172935");
  m.onBeforeCompile = sh => {
    sh.uniforms.glassFront = { value: front }; sh.uniforms.glassRear = { value: rear }; sh.uniforms.glassSide = { value: side };
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 glassFront; uniform vec3 glassRear; uniform vec3 glassSide;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        int glazingPart = int(floor(vMapUv.x * 16.0));
        diffuseColor.rgb = glazingPart == 12 ? glassFront : glazingPart == 13 ? glassRear : glassSide;
        diffuseColor.a = gl_FrontFacing ? (glazingPart == 12 ? 0.62 : glazingPart == 13 ? 0.97 : 0.86) : 0.12;
      `);
  };
  m.customProgramCacheKey = () => "walk-car-independent-glazing-v2-tinted-rear"; return m;
}
