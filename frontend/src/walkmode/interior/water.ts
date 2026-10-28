import * as THREE from "three";

/* Running water and still water: a stream is a thin tube whose streaks scroll down (no particles),
 * a pool a disc that swirls when a toilet flushes. Shared time uniform, set once a frame. */

export const waterTime = { value: 0 };

export function streamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: waterTime, uOn: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uOn;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      float h(float x) { return fract(sin(x * 91.7) * 43758.5); }
      void main() {
        float a = vUv.x * 18.0, v = vUv.y * 9.0 + uTime * 7.0;
        float streak = 0.55 + 0.45 * sin(a * 3.1 + floor(v) * 1.7) * (0.6 + 0.4 * h(floor(v) + floor(a)));
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        // a clear rope of water: its body a cool shade (what shows it against white china), its
        // edges bright with what it reflects, a glint running down its front
        float glint = smoothstep(0.92, 1.0, sin(vUv.x * 6.2832 * 2.0 + 0.6)) * (0.6 + 0.4 * sin(v * 2.0));
        float alpha = (0.42 + 0.5 * fres) * (0.75 + 0.25 * streak) + glint * 0.4;
        // (it reaches down as it starts: the stream "grows" from the spout)
        alpha *= smoothstep(0.0, 0.04, vUv.y - (1.0 - uOn));
        vec3 col = mix(vec3(0.5, 0.63, 0.72), vec3(1.1), fres * 0.85 + glint);
        gl_FragColor = vec4(col, min(1.0, alpha) * uOn);
      }`,
  });
}

export function poolMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: waterTime, uSwirl: { value: 0 }, uRipple: { value: 0 }, uFoam: { value: 0 }, uTint: { value: new THREE.Color("#9fbfcc") } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vV; varying vec3 vN;
      void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uSwirl; uniform float uRipple; uniform float uFoam; uniform vec3 uTint;
      varying vec2 vUv; varying vec3 vV; varying vec3 vN;
      float h2(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec2 p = vUv * 2.0 - 1.0; float r = length(p), ang = atan(p.y, p.x);
        float sw = sin(ang * 5.0 + r * 9.0 - uTime * 9.0) * uSwirl;
        float rp = sin(r * 40.0 - uTime * 14.0) * uRipple * (1.0 - r);
        float n = 0.5 + 0.5 * (sw + rp);
        // a flush's foam: white arms wound into the drain, turning, broken into bubbles
        float arm = ang * 3.0 + log(r + 0.05) * 5.0 + uTime * 11.0;
        vec2 cell = vec2(arm * 2.2, r * 26.0 - uTime * 3.0);
        float bub = step(0.62, h2(floor(cell))) * smoothstep(0.5, 0.15, length(fract(cell) - 0.5));
        float foam = uFoam * clamp(smoothstep(0.2, 0.9, 0.5 + 0.5 * sin(arm)) * 0.7 + bub * 0.8, 0.0, 1.0) * smoothstep(0.05, 0.35, r);
        float fres = pow(1.0 - abs(dot(vN, vV)), 3.0);
        vec3 col = mix(uTint * 0.9, vec3(1.0), n * 0.35 + fres * 0.6);
        col = mix(col, vec3(1.0), foam);
        float alpha = 0.32 + 0.4 * fres + 0.12 * abs(sw + rp) + 0.5 * foam;
        gl_FragColor = vec4(col, alpha * smoothstep(1.0, 0.92, r));
      }`,
  });
}

/** The rim wash of a flush: water sheeting down the inside of the bowl from under the rim, in
 * streaks turning round it. On a lathe of the bowl's inner wall (uv.y: rim 0 → water 1).
 * uOn its strength, uFront how far down the first water has come (0…1). */
export function washMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
    uniforms: { uTime: waterTime, uOn: { value: 0 }, uFront: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uOn; uniform float uFront;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      float h(float x) { return fract(sin(x * 91.7) * 43758.5); }
      void main() {
        // streaks round the bowl, swept sideways as they fall (the jets are angled), scrolling down
        float u = vUv.x * 30.0 + vUv.y * 7.0 + uTime * 1.6, v = vUv.y * 5.0 - uTime * 4.5;
        float lane = floor(u);
        float streak = smoothstep(0.5, 0.05, abs(fract(u) - 0.5) - 0.2) * (0.6 + 0.4 * h(lane));
        float pulse = 0.65 + 0.35 * sin(v * 6.2832 + h(lane) * 6.0);
        float a = streak * pulse * uOn * smoothstep(uFront, uFront - 0.15, vUv.y);
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        // (on white china water shows by its shade and glints: a blue-grey sheet, bright crests)
        float crest = smoothstep(0.75, 1.0, pulse * streak);
        vec3 col = mix(vec3(0.55, 0.68, 0.76), vec3(1.15), crest * 0.8 + fres * 0.3);
        gl_FragColor = vec4(col, min(1.0, a * (0.75 + 0.4 * fres)));
      }`,
  });
}

/** Where a tap's stream hits: a little crown of spray and bubbles, flickering (a short open cone
 * round the stream's foot, uv.y: 0 at the rim, 1 at the foot). */
export function splashMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
    uniforms: { uTime: waterTime, uOn: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uOn; varying vec2 vUv;
      float h2(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec2 c = vec2(vUv.x * 40.0, vUv.y * 6.0 + uTime * 9.0);
        vec2 id = floor(c);
        float drop = step(0.55, h2(id + floor(uTime * 24.0) * 0.37)) * smoothstep(0.5, 0.1, length(fract(c) - 0.5));
        float a = (drop * 0.9 + 0.25 * vUv.y) * smoothstep(0.0, 0.5, vUv.y) * uOn;
        gl_FragColor = vec4(mix(vec3(0.62, 0.74, 0.8), vec3(1.15), drop), a);
      }`,
  });
}
