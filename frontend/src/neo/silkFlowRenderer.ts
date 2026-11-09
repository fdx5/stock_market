import { COMPOSITE_FRAGMENT, DECAY_FRAGMENT, PARTICLE_FRAGMENT, PARTICLE_VERTEX, QUAD_VERTEX, RIVERS, UPDATE_FRAGMENT } from "./silkFlowShaders";

type FxLevel = "full" | "balanced" | "minimal";
type Program = { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> };
type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer };
type StateTarget = { state: WebGLTexture; motion: WebGLTexture; framebuffer: WebGLFramebuffer };

/**
 * GPU particle silk. State lives in two float textures (ping-pong); light is
 * accumulated in a half-float buffer that decays every frame, then tone-mapped
 * with a mip-based halo. Nothing but uniforms crosses the bus per frame.
 */
export function installSilkFlow(canvas: HTMLCanvasElement, level: FxLevel, onFailure: () => void, onRestore: () => void) {
  const context = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: "default" });
  if (!context) throw new Error("WebGL2 unavailable");
  const gl: WebGL2RenderingContext = context;
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("Float render targets unavailable");
  const texWidth = 256, texHeight = level === "full" ? 384 : 256;
  const count = texWidth * texHeight;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const still = () => level === "minimal" || reduced.matches;
  const programs: Program[] = [], textures: WebGLTexture[] = [], framebuffers: WebGLFramebuffer[] = [];
  let frame = 0, last = 0, elapsed = 0, frameIndex = 0, disposed = false, lost = false, painted = false;
  let viewWidth = 0, viewHeight = 0, pixelRatio = 0;
  let acc: Target[] = [], accIndex = 0;
  let scrollTarget = 0, scrollSmooth = 0, drift = 0;
  const pointer = { x: -9, y: -9, strength: 0, lastMove: -99 };
  const pulse = { x: -1, river: -1, strength: 0, next: 5 };
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  function compile(vertexSource: string, fragmentSource: string): Program {
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
      gl.bindAttribLocation(linked, 0, "a_pos");
      gl.linkProgram(linked);
      if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(linked) || "Shader link failed");
      const result = { program: linked, uniforms: new Map<string, WebGLUniformLocation | null>() };
      programs.push(result); return result;
    } finally { shaders.forEach(shader => gl.deleteShader(shader)); }
  }
  const uniform = (active: Program, name: string) => {
    if (!active.uniforms.has(name)) active.uniforms.set(name, gl.getUniformLocation(active.program, name));
    return active.uniforms.get(name)!;
  };
  function texture(width: number, height: number, format: number, levels = 1, data: Float32Array | null = null) {
    const result = gl.createTexture();
    if (!result) throw new Error("Texture unavailable");
    textures.push(result);
    gl.bindTexture(gl.TEXTURE_2D, result);
    gl.texStorage2D(gl.TEXTURE_2D, levels, format, width, height);
    if (data) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.FLOAT, data);
    const filter = format === gl.RGBA32F ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return result;
  }
  function framebuffer(attachments: WebGLTexture[]) {
    const result = gl.createFramebuffer();
    if (!result) throw new Error("Framebuffer unavailable");
    framebuffers.push(result);
    gl.bindFramebuffer(gl.FRAMEBUFFER, result);
    attachments.forEach((attachment, index) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + index, gl.TEXTURE_2D, attachment, 0));
    gl.drawBuffers(attachments.map((_, index) => gl.COLOR_ATTACHMENT0 + index));
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Framebuffer incomplete");
    return result;
  }

  let update: Program, particles: Program, decay: Program, composite: Program;
  let states: StateTarget[] = [], stateIndex = 0;
  const quad = gl.createBuffer(), emptyVao = gl.createVertexArray(), quadVao = gl.createVertexArray();
  try {
    if (!quad || !emptyVao || !quadVao) throw new Error("Buffer unavailable");
    update = compile(QUAD_VERTEX, UPDATE_FRAGMENT);
    particles = compile(PARTICLE_VERTEX.replace("in vec2 a_pos;", ""), PARTICLE_FRAGMENT);
    decay = compile(QUAD_VERTEX, DECAY_FRAGMENT);
    composite = compile(QUAD_VERTEX, COMPOSITE_FRAGMENT);
    gl.bindVertexArray(quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    // particles begin already dead at staggered moments, so the field fills in gently
    const aspect = innerWidth / Math.max(1, innerHeight);
    const state = new Float32Array(count * 4), motion = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      state.set([random() * aspect, random(), 0, RIVERS], i * 4);
      motion.set([0, 0, 0, random() * 1.6], i * 4);
    }
    for (let i = 0; i < 2; i++) {
      const stateTexture = texture(texWidth, texHeight, gl.RGBA32F, 1, state);
      const motionTexture = texture(texWidth, texHeight, gl.RGBA32F, 1, motion);
      states.push({ state: stateTexture, motion: motionTexture, framebuffer: framebuffer([stateTexture, motionTexture]) });
    }
  } catch (error) { release(); throw error; }

  function release() {
    framebuffers.forEach(value => gl.deleteFramebuffer(value)); textures.forEach(value => gl.deleteTexture(value));
    programs.forEach(value => gl.deleteProgram(value.program));
    if (quad) gl.deleteBuffer(quad); if (emptyVao) gl.deleteVertexArray(emptyVao); if (quadVao) gl.deleteVertexArray(quadVao);
  }
  function resizeTargets() {
    acc.forEach(target => { gl.deleteFramebuffer(target.framebuffer); gl.deleteTexture(target.texture); });
    acc = [];
    const levels = Math.floor(Math.log2(Math.max(canvas.width, canvas.height))) + 1;
    for (let i = 0; i < 2; i++) {
      const target = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, target);
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA16F, canvas.width, canvas.height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      acc.push({ texture: target, framebuffer: fb });
    }
  }
  function field(active: Program, aspect: number) {
    gl.uniform1f(uniform(active, "u_time"), elapsed + 40);
    gl.uniform1f(uniform(active, "u_aspect"), aspect);
    gl.uniform4f(uniform(active, "u_pulse"), pulse.x, pulse.river, pulse.strength, 0);
    gl.uniform3f(uniform(active, "u_pointer"), pointer.x, pointer.y, pointer.strength);
  }
  function step(dt: number, aspect: number) {
    // 1. advect particles
    const from = states[stateIndex], to = states[1 - stateIndex];
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.framebuffer);
    gl.viewport(0, 0, texWidth, texHeight);
    gl.disable(gl.BLEND);
    gl.useProgram(update.program); field(update, aspect);
    gl.uniform1f(uniform(update, "u_dt"), dt);
    gl.uniform1f(uniform(update, "u_drift"), drift);
    gl.uniform1f(uniform(update, "u_frame"), frameIndex++ % 4096);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, from.state);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, from.motion);
    gl.uniform1i(uniform(update, "u_state"), 0); gl.uniform1i(uniform(update, "u_motion"), 1);
    gl.bindVertexArray(quadVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    stateIndex = 1 - stateIndex;
    // 2. fade the long exposure
    const src = acc[accIndex], dst = acc[1 - accIndex];
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.framebuffer);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(decay.program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.texture);
    gl.uniform1i(uniform(decay, "u_acc"), 0);
    gl.uniform1f(uniform(decay, "u_decay"), Math.pow(.955, dt * 60));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // 3. deposit silk
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(particles.program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, states[stateIndex].state);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, states[stateIndex].motion);
    gl.uniform1i(uniform(particles, "u_state"), 0); gl.uniform1i(uniform(particles, "u_motion"), 1);
    gl.uniform1i(uniform(particles, "u_texWidth"), texWidth);
    gl.uniform2f(uniform(particles, "u_res"), canvas.width, canvas.height);
    gl.uniform1f(uniform(particles, "u_aspect"), aspect);
    gl.uniform1f(uniform(particles, "u_width"), 1.05 * pixelRatio);
    gl.uniform1f(uniform(particles, "u_dt"), Math.max(dt, 1 / 120));
    gl.uniform1f(uniform(particles, "u_gain"), level === "full" ? .062 : .075);
    gl.uniform4f(uniform(particles, "u_pulse"), pulse.x, pulse.river, pulse.strength, 0);
    gl.bindVertexArray(emptyVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);
    accIndex = 1 - accIndex;
  }
  function present() {
    const target = acc[accIndex];
    gl.bindTexture(gl.TEXTURE_2D, target.texture); gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(composite.program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.uniform1i(uniform(composite, "u_acc"), 0);
    gl.uniform1f(uniform(composite, "u_time"), elapsed + 40);
    gl.uniform1f(uniform(composite, "u_aspect"), canvas.width / Math.max(1, canvas.height));
    gl.uniform1f(uniform(composite, "u_exposure"), 1.12);
    gl.uniform1f(uniform(composite, "u_glow"), level === "minimal" ? .7 : .95);
    gl.bindVertexArray(quadVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function draw(now: number) {
    frame = 0;
    if (disposed || lost || document.hidden) return;
    const dt = last ? Math.min(1 / 20, (now - last) / 1000) : 1 / 60;
    last = now;
    if (viewWidth !== innerWidth || viewHeight !== innerHeight || pixelRatio !== (devicePixelRatio || 1) || !acc.length) {
      viewWidth = innerWidth; viewHeight = innerHeight; pixelRatio = devicePixelRatio || 1;
      canvas.width = Math.round(viewWidth * pixelRatio); canvas.height = Math.round(viewHeight * pixelRatio);
      resizeTargets();
    }
    const aspect = viewWidth / Math.max(1, viewHeight);
    if (still()) {
      if (!painted) { for (let i = 0; i < 240; i++) { elapsed += 1 / 60; step(1 / 60, aspect); } present(); painted = true; }
      canvas.dataset.state = "still";
      return;
    }
    elapsed += dt;
    // scrolling lifts the silk like a parallax layer
    const previous = scrollSmooth;
    scrollSmooth += (scrollTarget - scrollSmooth) * (1 - Math.exp(-dt * 4));
    drift = Math.max(-.6, Math.min(.6, (scrollSmooth - previous) / Math.max(dt, 1e-3) / viewHeight * .35));
    pointer.strength += ((elapsed - pointer.lastMove < 2.5 ? 1 : 0) - pointer.strength) * (1 - Math.exp(-dt * 1.4));
    // a liquidity surge travels along one river every so often
    if (pulse.river < 0 && elapsed > pulse.next) { pulse.river = Math.floor(random() * RIVERS); pulse.x = -.3; }
    if (pulse.river >= 0) {
      pulse.x += dt * .42;
      pulse.strength = Math.min(1, pulse.strength + dt * .8) * (pulse.x > aspect + .1 ? 0 : 1);
      if (pulse.x > aspect + .3) { pulse.river = -1; pulse.strength = 0; pulse.next = elapsed + 7 + random() * 6; }
    }
    step(dt, aspect);
    present();
    canvas.dataset.state = "live";
    frame = requestAnimationFrame(draw);
  }
  function onPointerMove(event: PointerEvent) {
    pointer.x = event.clientX / innerWidth * (innerWidth / Math.max(1, innerHeight));
    pointer.y = 1 - event.clientY / innerHeight;
    pointer.lastMove = elapsed;
  }
  function onScroll(event: Event) {
    const target = event.target;
    scrollTarget = target instanceof Element ? target.scrollTop : scrollY;
  }
  function sync() { cancelAnimationFrame(frame); frame = 0; last = 0; painted = false; if (!document.hidden && !disposed && !lost) frame = requestAnimationFrame(draw); }
  function contextLost(event: Event) { event.preventDefault(); lost = true; cancelAnimationFrame(frame); canvas.dataset.state = "unavailable"; onFailure(); }
  function contextRestored() { if (!disposed) onRestore(); }
  canvas.dataset.state = "loading"; canvas.dataset.particles = String(count);
  addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("scroll", onScroll, { passive: true, capture: true });
  document.addEventListener("visibilitychange", sync); addEventListener("resize", sync); reduced.addEventListener("change", sync);
  canvas.addEventListener("webglcontextlost", contextLost); canvas.addEventListener("webglcontextrestored", contextRestored);
  sync();
  return () => {
    disposed = true; cancelAnimationFrame(frame);
    removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("scroll", onScroll, { capture: true });
    document.removeEventListener("visibilitychange", sync); removeEventListener("resize", sync); reduced.removeEventListener("change", sync);
    canvas.removeEventListener("webglcontextlost", contextLost); canvas.removeEventListener("webglcontextrestored", contextRestored);
    acc.forEach(target => { gl.deleteFramebuffer(target.framebuffer); gl.deleteTexture(target.texture); });
    release();
  };
}
