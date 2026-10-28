import * as THREE from "three";

/* Rooms lit by their own lamps only. Area lights cast no shadows, so a bedroom's ceiling light would
 * shine through the wall onto the living room floor. Every interior vertex carries its room's zone
 * (geom.ts) and every area light one too: a light adds to a surface only in its own zone. Lights
 * are switched by intensity (never added or removed), so no program is ever rebuilt. Vertices
 * without a zone (moving parts) take every light. */

export interface ZoneUniform { value: number[] }

// (the area-light loop left rolled: unrolled, a program with twenty area lights takes seconds to
// compile on Windows' Direct3D path, and the zone test skips most of them anyway)
const chunk = THREE.ShaderChunk.lights_fragment_begin;
const a = chunk.indexOf("#if ( NUM_RECT_AREA_LIGHTS > 0 )"), b = chunk.indexOf("#endif", a);
const PATCHED = chunk.slice(0, a) + chunk.slice(a, b)
  .replace("#pragma unroll_loop_start", "").replace("#pragma unroll_loop_end", "")
  .replace("RE_Direct_RectArea( rectAreaLight,", "if ( vZone < 0.5 || abs( rectZone[ i ] - vZone ) < 0.5 ) RE_Direct_RectArea( rectAreaLight,") + chunk.slice(b);

/** each zone's lamps' level (0 off … 1 on), indexed by zone id: one shared array */
export const zoneLevels = { value: new Array(32).fill(1) as number[] };
/** each zone's interreflected light (irradiance, the scene's units): what its lamps and windows put
 * in, spread over the room's surfaces and bounced — Φ/S · ρ/(1−ρ). Index 0: the flat's average. */
export const zoneBounce = { value: new Array(32).fill(0) as number[] };

export function zoneLit(m: THREE.Material, zones: ZoneUniform, lamp = false) {
  const mat = m as THREE.MeshStandardMaterial;
  if (!(mat.isMeshStandardMaterial)) return;
  // (a material with its own shader changes — fur — keeps them: marked by userData.programKey)
  const own = mat.userData.programKey as string | undefined, prev = own ? mat.onBeforeCompile : null;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.rectZone = zones;
    sh.uniforms.zoneBounce = zoneBounce;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float zone;\nvarying float vZone;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvZone = zone;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vZone;\n#if NUM_RECT_AREA_LIGHTS > 0\nuniform float rectZone[ NUM_RECT_AREA_LIGHTS ];\n#endif")
      .replace("#include <lights_fragment_begin>", PATCHED);
    if (lamp) {
      // a lamp's glow follows its room's switch (one material for every room's lamps)
      sh.uniforms.zoneLevel = zoneLevels;
      sh.fragmentShader = sh.fragmentShader
        .replace("varying float vZone;", "varying float vZone;\nuniform float zoneLevel[ 32 ];")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= zoneLevel[ int( vZone + 0.5 ) ];");
    }
  };
  mat.customProgramCacheKey = () => (lamp ? "zoneLamp2" : "zoneLit2") + (own ? `+${own}` : "");
  mat.needsUpdate = true;
}

/** the room the environment probe was taken in (world box) and the probe's position */
export const probeBox = { min: { value: new THREE.Vector3() }, max: { value: new THREE.Vector3() }, at: { value: new THREE.Vector3() } };

/** Reflections corrected for the room's walls (a box-projected probe): a polished floor mirrors the
 * windows and the furniture where they are, not as if they were infinitely far. Surfaces outside
 * the probe's room keep the plain lookup. On top of zoneLit. */
export function boxProjected(m: THREE.Material) {
  const mat = m as THREE.MeshStandardMaterial;
  const prev = mat.onBeforeCompile, key = mat.customProgramCacheKey();
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.boxMin = probeBox.min; sh.uniforms.boxMax = probeBox.max; sh.uniforms.probeAt = probeBox.at;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBoxWorld;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvBoxWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <envmap_physical_pars_fragment>", `
      varying vec3 vBoxWorld;
      uniform vec3 boxMin; uniform vec3 boxMax; uniform vec3 probeAt;
      vec3 boxProject( vec3 v ) {
        vec3 p = vBoxWorld;
        if ( any( lessThan( p, boxMin ) ) || any( greaterThan( p, boxMax ) ) ) return v;
        vec3 f = max( ( boxMax - p ) / v, ( boxMin - p ) / v );
        return normalize( p + v * min( min( f.x, f.y ), f.z ) - probeAt );
      }
      ` + THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
      "reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );",
      "reflectVec = boxProject( transformDirectionByInverseViewMatrix( reflectVec, viewMatrix ) );"));
  };
  mat.customProgramCacheKey = () => key + "box";
  mat.needsUpdate = true;
}
