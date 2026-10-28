import * as THREE from "three";

/* Fur by shells: a part drawn as N copies of itself, each pushed out along its normals a little
 * further, where only the strands are kept (a hash of the skin position decides which and how
 * thick, thinner toward the tips). One geometry and one draw a part; a strand runs straight through
 * the layers because every layer hashes the same skin point. Roots in shade, tips in the light. */

export interface FurOptions {
  length: number; density: number; layers: number; root: THREE.ColorRepresentation; tip: THREE.ColorRepresentation; droop?: number; clump?: number; sweep?: number;
  /** a second coat colour (markings), blended in by the geometry's furMix attribute (0 first … 1 second) */
  root2?: THREE.ColorRepresentation; tip2?: THREE.ColorRepresentation;
}

/** the shell material (lit like the rest: the zone patch runs after this one) */
export function furMaterial(o: FurOptions): THREE.MeshPhysicalMaterial {
  // (alpha to coverage: the strands' edges soft against the multisampled frame, no sorting)
  const m = new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.8, sheen: 0.7, sheenColor: new THREE.Color("#fff2e0"), sheenRoughness: 0.4, alphaToCoverage: true });
  const u = { furLen: { value: o.length }, furDensity: { value: o.density }, furRoot: { value: new THREE.Color(o.root) }, furTip: { value: new THREE.Color(o.tip) }, furDroop: { value: o.droop ?? 0.3 }, furClump: { value: o.clump ?? 0.5 }, furSweep: { value: o.sweep ?? 0.5 }, furRoot2: { value: new THREE.Color(o.root2 ?? o.root) }, furTip2: { value: new THREE.Color(o.tip2 ?? o.tip) } };
  m.userData.programKey = "fur1";
  m.userData.fur = u;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
        attribute float furLayer; attribute float furMix;
        uniform float furLen; uniform float furDroop; uniform float furSweep;
        varying float vLayer; varying vec3 vSkin; varying float vMix;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vLayer = furLayer; vSkin = position; vMix = furMix;
        // out along the normal, combed back (−z, toward the tail in the part's frame) and a little down
        // toward the tips
        transformed += objectNormal * furLen * furLayer + (vec3(0.0, -1.0, 0.0) * furDroop + vec3(0.0, 0.0, -1.0) * furSweep) * furLen * furLayer * furLayer;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform float furDensity; uniform vec3 furRoot; uniform vec3 furTip; uniform vec3 furRoot2; uniform vec3 furTip2; uniform float furClump;
        varying float vLayer; varying vec3 vSkin; varying float vMix;
        float fh(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        if (vLayer > 0.001) {
          // the dense undercoat near the skin, the guard hairs longer and finer toward the tips
          vec3 q = vSkin * furDensity, c = floor(q), f = fract(q) - 0.5;
          float h = fh(c), len = 0.3 + 0.7 * fh(c + 7.1);
          float clump = mix(1.0, 0.65 + 0.7 * fh(floor(vSkin * furDensity * 0.15)), furClump);
          float reach = len * clump;
          float r = mix(0.62, 0.12, vLayer / max(reach, 0.01));
          float d = length(f + (vec3(h, fh(c + 3.3), fh(c + 5.7)) - 0.5) * 0.35);
          float under = 1.0 - smoothstep(0.15, 0.35, vLayer);
          float a = max(under, smoothstep(r + 0.08, r - 0.08, d)) * step(vLayer, reach);
          if (a < 0.02) discard;
          diffuseColor.a = a;
        }
        // (the markings' edge broken up strand by strand, as real ones are)
        float mk = clamp(vMix + (fh(floor(vSkin * furDensity)) - 0.5) * 0.35, 0.0, 1.0);
        mk = smoothstep(0.3, 0.7, mk);
        diffuseColor.rgb *= mix(mix(furRoot, furTip, smoothstep(0.0, 1.0, vLayer)), mix(furRoot2, furTip2, smoothstep(0.0, 1.0, vLayer)), mk) * mix(0.8, 1.0, vLayer);`);
  };
  return m;
}

/** a part's shells: its geometry repeated `layers` times with the layer (0 skin … 1 tips) */
export function furShells(g: THREE.BufferGeometry, layers: number): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.getAttribute("position"), nor = src.getAttribute("normal"), mix = src.getAttribute("furMix"), n = pos.count;
  const P = new Float32Array(n * 3 * layers), N = new Float32Array(n * 3 * layers), L = new Float32Array(n * layers), X = new Float32Array(n * layers);
  for (let l = 0; l < layers; l++) {
    P.set(pos.array as Float32Array, l * n * 3); N.set(nor.array as Float32Array, l * n * 3);
    L.fill(l / (layers - 1), l * n, (l + 1) * n);
    if (mix) X.set(mix.array as Float32Array, l * n);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(P, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(N, 3));
  out.setAttribute("furLayer", new THREE.BufferAttribute(L, 1));
  out.setAttribute("furMix", new THREE.BufferAttribute(X, 1));
  out.computeBoundingSphere();
  if (out.boundingSphere) out.boundingSphere.radius += 0.06;
  if (src !== g) src.dispose();
  return out;
}
