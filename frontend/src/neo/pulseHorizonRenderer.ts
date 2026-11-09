import { MOODS, PULSES, RIDGE_FRAGMENT, RIDGE_VERTEX, SKY_FRAGMENT, SKY_VERTEX, type Mood } from "./pulseHorizonShaders";

export interface PulseHorizonController {
  dispose(): void;
  /** Recolour the sea; the palette glides to the new mood over ~1.5 s. */
  setMood(mood: Mood): void;
  /** Swell height multiplier, roughly .8 (quiet) to 1.7 (volatile). */
  setEnergy(energy: number): void;
  /** A heartbeat born under a screen x (0..1); strength ~.3..1.2. */
  emit(screenX: number, strength: number, beacon?: boolean): void;
  /** Sea height under screen x near the viewer (ridges + heartbeat waves), its slope along x and across. */
  sampleSwell(screenX: number, spread?: number): { height: number; slope: number; cross: number };
}
/* CPU twin of the ridge terrain. Float32 rounding in the hash keeps it close to what the GPU draws. */
const f32 = Math.fround;
const fract = (v: number) => v - Math.floor(v);
function hash(x: number, y: number) {
  let px = fract(f32(x * 123.34)), py = fract(f32(y * 456.21));
  const d = f32(px * (px + 45.32) + py * (py + 45.32));
  px += d; py += d;
  return fract(f32(px * py));
}
function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const wx = fx * fx * (3 - 2 * fx), wy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return (a + (b - a) * wx) + ((c + (d - c) * wx) - (a + (b - a) * wx)) * wy;
}
function fbm(x: number, y: number) {
  let s = 0, a = .5;
  for (let i = 0; i < 4; i++) { s += a * (vnoise(x, y) - .5) + a * .5; const nx = 1.7 * x - 1.1 * y + 7.1, ny = 1.1 * x + 1.7 * y + 3.3; x = nx; y = ny; a *= .47; }
  return s + .02;
}
const smooth = (a: number, b: number, x: number) => { const v = Math.max(0, Math.min(1, (x - a) / (b - a))); return v * v * (3 - 2 * v); };
function terrainAt(xw: number, zw: number, xs: number, z: number, time: number, amp: number) {
  const qx = xw * 1.2 + time * .04, qy = zw * .5;
  const n = fbm(qx, qy), swell = vnoise(xw * .2 - time * .006, zw * .14 + 4);
  const spine = 1 - Math.abs(vnoise(qx * .18 + 3.1, qy * .18 + 7.7) * 2 - 1);
  const side = smooth(.15, 1.1, Math.abs(xs)) * smooth(.6, 5, z);
  return (.22 + (.72 - .22) * side) * amp * (Math.max(n - .22, 0) * 1.05 + swell * swell * .32 + spine * spine * .3 * side);
}
const gauss = (x: number, w: number) => Math.exp(-(x * x) / (w * w));
/** CPU twin of the shader's heartbeat(): ECG-shaped wavefronts expanding from each pulse. */
function heartbeatAt(xw: number, zw: number, z: number, pulses: Float32Array) {
  let height = 0;
  const k = 1.3 + z * .16;
  for (let i = 0; i < pulses.length; i += 4) {
    const age = pulses[i], px = pulses[i + 1], pz = pulses[i + 2], w = pulses[i + 3];
    if (w <= 0) continue;
    const R = age * 1.7, s = (R - Math.hypot(xw - px, zw - pz)) / k;
    if (s < -.5 || s > 2.6) continue;
    const e = .12 * gauss(s - .15, .14) - .22 * gauss(s - .48, .08) + gauss(s - .64, .09) - .28 * gauss(s - .82, .09) + .2 * gauss(s - 1.35, .24);
    height += e * .2 * w * Math.exp(-R * .075) * Math.min(1, age / .35) * k;
  }
  return height;
}
const PALETTE_KEYS = ["up", "down", "flat", "hot", "haze", "band1", "band2", "band3", "fog"] as const;
const flatten = (mood: Mood) => [...PALETTE_KEYS.flatMap(key => [...MOODS[mood][key]]), MOODS[mood].variety];

type FxLevel = "full" | "balanced" | "minimal";
type Program = { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null>; position: number };

const F = 1.6, H = .62, NEAR = .55, SPAN = 17;
const BG = [11 / 255, 7 / 255, 14 / 255];

/**
 * One native-resolution WebGL canvas. Geometry is a single static strip reused
 * by every ridge; heights, colors and heartbeats are evaluated on the GPU, so
 * nothing is uploaded per frame except a handful of uniforms.
 */
export function installPulseHorizon(canvas: HTMLCanvasElement, level: FxLevel, onFailure: () => void, onRestore: () => void, initial: { mood?: Mood; energy?: number; intensity?: number; horizon?: number } = {}): PulseHorizonController {
  const context = canvas.getContext("webgl", { alpha: false, antialias: true, depth: true, stencil: false, powerPreference: "default" });
  if (!context) throw new Error("WebGL unavailable");
  const gl: WebGLRenderingContext = context;
  const ridges = level === "full" ? 72 : 60;
  const points = level === "full" ? 960 : 720;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const still = () => level === "minimal" || reduced.matches;
  const programs: Program[] = [], buffers: WebGLBuffer[] = [];
  let frame = 0, last = 0, elapsed = 0, disposed = false, lost = false;
  let viewWidth = 0, viewHeight = 0, pixelRatio = 0;
  let travel = 0, scrollTarget = 0, scrollSmooth = 0, lastScroll = 0;
  const cam = { x: 0, y: 0, tx: 0, ty: 0 };
  // pulse slots: age, world x, world z, strength (+ beacon strength)
  const pulses = Array.from({ length: PULSES }, () => ({ born: -99, x: 0, z: 0, w: 0, beacon: 0 }));
  let nextPulse = 1.2, lastClick = -9, seed = 9;
  const palette = flatten(initial.mood ?? "calm"), paletteTarget = [...palette];
  let amp = initial.energy ?? 1, ampTarget = amp;
  const gain = initial.intensity ?? 1;
  // horizon height in clip space: .3 sits 35% down the screen, lower values sink the sea
  const HORIZON = initial.horizon ?? .3;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  function program(vertexSource: string, fragmentSource: string): Program {
    const shaders: WebGLShader[] = [];
    try {
      const linked = gl.createProgram();
      if (!linked) throw new Error("Program unavailable");
      for (const [kind, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
        const shader = gl.createShader(kind);
        if (!shader) throw new Error("Shader unavailable");
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Shader compilation failed");
        gl.attachShader(linked, shader);
      }
      gl.linkProgram(linked);
      if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(linked) || "Shader link failed");
      const result = { program: linked, uniforms: new Map<string, WebGLUniformLocation | null>(), position: gl.getAttribLocation(linked, "a_pos") };
      programs.push(result); return result;
    } finally { shaders.forEach(shader => gl.deleteShader(shader)); }
  }
  const uniform = (active: Program, name: string) => {
    if (!active.uniforms.has(name)) active.uniforms.set(name, gl.getUniformLocation(active.program, name));
    return active.uniforms.get(name)!;
  };
  function buffer(data: Float32Array) {
    const result = gl.createBuffer();
    if (!result) throw new Error("Buffer unavailable");
    buffers.push(result); gl.bindBuffer(gl.ARRAY_BUFFER, result); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return result;
  }

  let sky: Program, ridge: Program, strip: WebGLBuffer, quad: WebGLBuffer;
  try {
    sky = program(SKY_VERTEX, SKY_FRAGMENT);
    ridge = program(RIDGE_VERTEX, RIDGE_FRAGMENT);
    const data = new Float32Array(points * 4);
    for (let i = 0; i < points; i++) data.set([i / (points - 1), -1, i / (points - 1), 1], i * 4);
    strip = buffer(data);
    quad = buffer(new Float32Array([-1, -1, 3, -1, -1, 3]));
  } catch (error) {
    buffers.forEach(value => gl.deleteBuffer(value)); programs.forEach(value => gl.deleteProgram(value.program)); throw error;
  }

  const pulseData = new Float32Array(PULSES * 4);
  const ridgeZ = (index: number) => NEAR + (((index * SPAN / ridges - travel) % SPAN) + SPAN) % SPAN;
  function spawn(x: number, z: number, strength: number, beacon: number) {
    const slot = pulses.reduce((oldest, pulse) => pulse.born < oldest.born ? pulse : oldest, pulses[0]);
    Object.assign(slot, { born: elapsed, x, z, w: strength, beacon });
  }
  function heartbeat() {
    const aspect = viewWidth / Math.max(1, viewHeight);
    const z = NEAR + SPAN * (.42 + random() * .14);
    const xs = (random() - .5) * 1.5;
    spawn(xs * z * aspect / F, z + travel, .75 + random() * .2, 1);
  }
  function onPointerMove(event: PointerEvent) {
    cam.tx = (event.clientX / innerWidth - .5) * 2;
    cam.ty = (event.clientY / innerHeight - .5) * 2;
  }
  function onPointerDown(event: PointerEvent) {
    if (still() || elapsed - lastClick < .7) return;
    lastClick = elapsed;
    const aspect = innerWidth / Math.max(1, innerHeight);
    const x = event.clientX / innerWidth * 2 - 1, y = 1 - event.clientY / innerHeight * 2;
    const z = y < HORIZON - .02 ? Math.min(NEAR + SPAN * .75, Math.max(NEAR + .9, (H - .2) * F / (HORIZON - y))) : NEAR + SPAN * .7;
    spawn(x * z * aspect / F, z + travel, .4, y < HORIZON - .02 ? 0 : .5);
  }
  function onScroll(event: Event) {
    const target = event.target;
    scrollTarget = target instanceof Element ? target.scrollTop : scrollY;
  }

  function draw(now: number) {
    frame = 0;
    if (disposed || lost || document.hidden) return;
    const dt = last ? Math.min(.05, (now - last) / 1000) : 0;
    last = now;
    if (!still()) elapsed += dt;
    if (viewWidth !== innerWidth || viewHeight !== innerHeight || pixelRatio !== (devicePixelRatio || 1)) {
      viewWidth = innerWidth; viewHeight = innerHeight; pixelRatio = devicePixelRatio || 1;
      canvas.width = Math.round(viewWidth * pixelRatio); canvas.height = Math.round(viewHeight * pixelRatio);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    // scrolling the page flies the camera forward through the field
    const ease = 1 - Math.exp(-dt * 1.8);
    scrollSmooth += (scrollTarget - scrollSmooth) * ease;
    const scrollDelta = scrollSmooth - lastScroll; lastScroll = scrollSmooth;
    travel += dt * .15 + scrollDelta * .0012;
    cam.x += (cam.tx - cam.x) * (1 - Math.exp(-dt * .8));
    cam.y += (cam.ty - cam.y) * (1 - Math.exp(-dt * .8));
    if (!still() && elapsed > nextPulse) { heartbeat(); nextPulse = elapsed + 8.5 + random() * 4.5; }
    if (still() && pulses.every(pulse => pulse.w === 0)) { elapsed = 6; spawn(.6, NEAR + 7 + travel, 1, 1); pulses[0].born = 3.2; }
    const glide = still() ? 1 : 1 - Math.exp(-dt * 1.6);
    for (let i = 0; i < palette.length; i++) palette[i] += (paletteTarget[i] - palette[i]) * glide;
    amp += (ampTarget - amp) * (still() ? 1 : 1 - Math.exp(-dt * .7));
    const color = (key: typeof PALETTE_KEYS[number]) => palette.slice(PALETTE_KEYS.indexOf(key) * 3, PALETTE_KEYS.indexOf(key) * 3 + 3);
    const FOG = color("fog");
    const setPalette = (active: Program) => {
      for (const key of PALETTE_KEYS) { const location = uniform(active, `u_${key}`); if (location) gl.uniform3fv(location, color(key)); }
      const variety = uniform(active, "u_variety"); if (variety) gl.uniform1f(variety, palette[palette.length - 1]);
    };

    const intensity = (level === "full" ? .94 : level === "minimal" ? .72 : .84) * gain;
    const aspect = viewWidth / Math.max(1, viewHeight);
    pulseData.fill(0); const beaconData = new Float32Array(PULSES * 4);
    pulses.forEach((pulse, index) => {
      const age = elapsed - pulse.born;
      const alive = pulse.w > 0 && age < 18;
      pulseData.set([age, pulse.x, pulse.z, alive ? pulse.w : 0], index * 4);
      const z = pulse.z - travel;
      const sx = z > .2 ? pulse.x * F / (z * aspect) : 0;
      beaconData.set([age, sx, .55, alive && z > 2 ? pulse.beacon : 0], index * 4);
    });

    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.depthMask(true);
    gl.clearColor(BG[0], BG[1], BG[2], 1); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // sky
    gl.useProgram(sky.program);
    gl.uniform2f(uniform(sky, "u_res"), canvas.width, canvas.height);
    gl.uniform1f(uniform(sky, "u_time"), elapsed + 30);
    gl.uniform1f(uniform(sky, "u_horizon"), HORIZON);
    gl.uniform2f(uniform(sky, "u_cam"), cam.x, cam.y);
    gl.uniform3fv(uniform(sky, "u_bg"), BG); gl.uniform3fv(uniform(sky, "u_fog"), FOG);
    gl.uniform1f(uniform(sky, "u_intensity"), intensity);
    gl.uniform4fv(uniform(sky, "u_beacon[0]"), beaconData);
    setPalette(sky);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(sky.position); gl.vertexAttribPointer(sky.position, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ridges
    gl.useProgram(ridge.program);
    gl.uniform2f(uniform(ridge, "u_res"), canvas.width, canvas.height);
    gl.uniform1f(uniform(ridge, "u_time"), elapsed + 30);
    gl.uniform1f(uniform(ridge, "u_near"), NEAR); gl.uniform1f(uniform(ridge, "u_span"), SPAN);
    gl.uniform1f(uniform(ridge, "u_horizon"), HORIZON); gl.uniform1f(uniform(ridge, "u_points"), points); gl.uniform1f(uniform(ridge, "u_cssWidth"), viewWidth);
    gl.uniform2f(uniform(ridge, "u_cam"), cam.x, cam.y);
    gl.uniform4fv(uniform(ridge, "u_pulse[0]"), pulseData);
    gl.uniform3fv(uniform(ridge, "u_bg"), BG); gl.uniform3fv(uniform(ridge, "u_fog"), FOG);
    gl.uniform1f(uniform(ridge, "u_intensity"), intensity);
    gl.uniform1f(uniform(ridge, "u_amp"), amp);
    setPalette(ridge);
    gl.bindBuffer(gl.ARRAY_BUFFER, strip);
    gl.enableVertexAttribArray(ridge.position); gl.vertexAttribPointer(ridge.position, 2, gl.FLOAT, false, 0, 0);
    const order = Array.from({ length: ridges }, (_, index) => ({ z: ridgeZ(index) })).sort((a, b) => a.z - b.z);
    const setRidge = (z: number) => {
      const world = z - NEAR + travel;
      gl.uniform1f(uniform(ridge, "u_ridgeZ"), z);
      gl.uniform1f(uniform(ridge, "u_ridgeWorld"), world);
      gl.uniform1f(uniform(ridge, "u_ridgeSeed"), Math.round(world * ridges / SPAN));
    };
    // opaque bodies front-to-back so hidden ones are rejected early
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
    gl.uniform1f(uniform(ridge, "u_pass"), 0);
    for (const item of order) { setRidge(item.z); gl.drawArrays(gl.TRIANGLE_STRIP, 0, points * 2); }
    // glowing strokes, additive, occluded only by nearer bodies
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform1f(uniform(ridge, "u_pass"), 1);
    const scale = pixelRatio;
    for (const item of order) {
      const near = 1 - Math.min(1, (item.z - NEAR) / (SPAN * .55));
      gl.uniform1f(uniform(ridge, "u_width"), (6 + 11 * near) * scale);
      gl.uniform1f(uniform(ridge, "u_core"), (.55 + .85 * near) * scale);
      setRidge(item.z); gl.drawArrays(gl.TRIANGLE_STRIP, 0, points * 2);
    }
    gl.disable(gl.BLEND); gl.depthMask(true);
    canvas.dataset.state = still() ? "still" : "live";
    if (!still()) frame = requestAnimationFrame(draw);
  }
  function sync() { cancelAnimationFrame(frame); frame = 0; last = 0; if (!document.hidden && !disposed && !lost) frame = requestAnimationFrame(draw); }
  function contextLost(event: Event) { event.preventDefault(); lost = true; cancelAnimationFrame(frame); canvas.dataset.state = "unavailable"; onFailure(); }
  function contextRestored() { if (!disposed) onRestore(); }
  canvas.dataset.state = "loading"; canvas.dataset.ridges = String(ridges);
  addEventListener("pointermove", onPointerMove, { passive: true });
  addEventListener("pointerdown", onPointerDown, { passive: true });
  document.addEventListener("scroll", onScroll, { passive: true, capture: true });
  document.addEventListener("visibilitychange", sync); addEventListener("resize", sync); reduced.addEventListener("change", sync);
  canvas.addEventListener("webglcontextlost", contextLost); canvas.addEventListener("webglcontextrestored", contextRestored);
  sync();
  const dispose = () => {
    disposed = true; cancelAnimationFrame(frame);
    removeEventListener("pointermove", onPointerMove); removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("scroll", onScroll, { capture: true });
    document.removeEventListener("visibilitychange", sync); removeEventListener("resize", sync); reduced.removeEventListener("change", sync);
    canvas.removeEventListener("webglcontextlost", contextLost); canvas.removeEventListener("webglcontextrestored", contextRestored);
    buffers.forEach(value => gl.deleteBuffer(value)); programs.forEach(value => gl.deleteProgram(value.program));
  };
  return {
    dispose,
    setMood(mood) { paletteTarget.splice(0, paletteTarget.length, ...flatten(mood)); if (still()) sync(); },
    setEnergy(energy) { ampTarget = Math.max(.6, Math.min(1.9, energy)); if (still()) sync(); },
    sampleSwell(screenX, spread = .12) {
      const aspect = viewWidth / Math.max(1, viewHeight), z = 2.4, t = elapsed + 30;
      const at = (sx: number, depth: number) => {
        const xs = sx * 2 - 1, xw = xs * depth * aspect / F, zw = depth - NEAR + travel;
        return terrainAt(xw, zw, xs, depth, t, amp) + heartbeatAt(xw, zw, depth, pulseData);
      };
      // bow/stern samples give pitch, near/far samples give roll
      const bow = at(screenX + spread, z), stern = at(screenX - spread, z);
      const near = at(screenX, z - .35), far = at(screenX, z + .35);
      return { height: (bow + stern + near + far) / 4, slope: bow - stern, cross: near - far };
    },
    emit(screenX, strength, beacon = true) {
      if (still() || disposed) return;
      const aspect = viewWidth / Math.max(1, viewHeight);
      const z = NEAR + SPAN * (.26 + random() * .12);
      const xs = Math.max(-1.1, Math.min(1.1, screenX * 2 - 1));
      spawn(xs * z * aspect / F, z + travel, Math.max(.2, Math.min(1.25, strength)), beacon ? Math.min(1, .45 + strength * .6) : 0);
    },
  };
}
