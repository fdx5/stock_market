import { NANOTUBES, fiberCount, formId, type NanotubeGeometry } from "./nanotubeGeometry";
import { HULL_FRAGMENT, HULL_VERTEX, WIRE_FRAGMENT, WIRE_VERTEX } from "./nanotubeShaders";
import { NanotubePulses } from "./nanotubePulse";

type FxLevel = "full" | "balanced" | "minimal";
type Program = { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> };
type WireBatch = { vertices: WebGLBuffer; indices: WebGLBuffer; halo: WebGLBuffer | null; count: number; haloCount: number };
type TubeBatch = WireBatch & { hullVertices: WebGLBuffer; hullIndices: WebGLBuffer; hullCount: number };

function rgb(hex: string) {
  return [0, 2, 4].map(offset => parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255);
}

/** One native-resolution canvas, depth-tested cages, no per-frame mesh uploads. */
export function installNanotubes(canvas: HTMLCanvasElement, level: FxLevel, onFailure: () => void, onRestore: () => void) {
  const context = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, stencil: false });
  if (!context) throw new Error("WebGL unavailable");
  const gl: WebGLRenderingContext = context;
  const programs: Program[] = [];
  const buffers = new Set<WebGLBuffer>();
  let tubes: TubeBatch[] = [], links: WireBatch | null = null;
  let frame = 0, last = 0, elapsed = 0, disposed = false, lost = false, ready = false;
  let viewWidth = 0, viewHeight = 0, pixelRatio = 0;
  let worker: Worker | null = null;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const shape = new Float32Array(NANOTUBES.flatMap(tube => [tube.radius, tube.offset, tube.lean, tube.depth]));
  const motion = new Float32Array(NANOTUBES.flatMap(tube => [tube.phase, tube.tempo, tube.sway, tube.twist]));
  const colorA = new Float32Array(NANOTUBES.flatMap(tube => rgb(tube.colors[0])));
  const colorB = new Float32Array(NANOTUBES.flatMap(tube => rgb(tube.colors[1])));
  const forms = new Float32Array(NANOTUBES.map(formId));
  const pulses = new NanotubePulses(NANOTUBES.length);

  function program(vertexSource: string, fragmentSource: string): Program {
    const shaders: WebGLShader[] = [];
    let linked: WebGLProgram | null = null;
    try {
      for (const [kind, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
        const shader = gl.createShader(kind);
        if (!shader) throw new Error("Shader unavailable");
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Shader compilation failed");
      }
      linked = gl.createProgram();
      if (!linked) throw new Error("Program unavailable");
      shaders.forEach(shader => gl.attachShader(linked!, shader)); gl.linkProgram(linked);
      if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(linked) || "Shader link failed");
      const result = { program: linked, uniforms: new Map<string, WebGLUniformLocation | null>() };
      programs.push(result); return result;
    } catch (error) { if (linked) gl.deleteProgram(linked); throw error; }
    finally { shaders.forEach(shader => gl.deleteShader(shader)); }
  }
  function uniform(program: Program, name: string) {
    if (!program.uniforms.has(name)) program.uniforms.set(name, gl.getUniformLocation(program.program, name));
    return program.uniforms.get(name)!;
  }
  function buffer(target: number, data: Float32Array | Uint16Array) {
    const result = gl.createBuffer();
    if (!result) throw new Error("Buffer unavailable");
    buffers.add(result); gl.bindBuffer(target, result); gl.bufferData(target, data, gl.STATIC_DRAW); return result;
  }
  function fail(error?: unknown) {
    ready = false; cancelAnimationFrame(frame); frame = 0;
    worker?.terminate(); worker = null;
    canvas.dataset.state = "unavailable";
    // Only a renderer diagnostic, never application data or request state.
    if (error instanceof Error) canvas.dataset.rendererError = error.message.slice(0, 240);
    onFailure();
  }

  let hull: Program, wire: Program;
  try {
    hull = program(HULL_VERTEX, HULL_FRAGMENT); wire = program(WIRE_VERTEX, WIRE_FRAGMENT);
    for (const active of [hull, wire]) {
      gl.useProgram(active.program);
      gl.uniform4fv(uniform(active, "u_shape[0]"), shape); gl.uniform4fv(uniform(active, "u_motion[0]"), motion);
      gl.uniform3fv(uniform(active, "u_colorA[0]"), colorA); gl.uniform3fv(uniform(active, "u_colorB[0]"), colorB);
      gl.uniform1fv(uniform(active, "u_form[0]"), forms);
    }
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.depthFunc(gl.LEQUAL);
    worker = new Worker(new URL("./nanotubeGeometryWorker.ts", import.meta.url), { type: "module", name: "nanotube-geometry" });
    worker.onmessage = (event: MessageEvent<{ geometry?: NanotubeGeometry; error?: string }>) => {
      if (disposed || lost) return;
      try {
        if (!event.data.geometry) throw new Error(event.data.error || "Geometry unavailable");
        const geometry = event.data.geometry;
        tubes = geometry.tubes.map(tube => ({
          vertices: buffer(gl.ARRAY_BUFFER, tube.vertices), indices: buffer(gl.ELEMENT_ARRAY_BUFFER, tube.indices),
          halo: buffer(gl.ELEMENT_ARRAY_BUFFER, tube.haloIndices), count: tube.indices.length, haloCount: tube.haloIndices.length,
          hullVertices: buffer(gl.ARRAY_BUFFER, tube.hullVertices), hullIndices: buffer(gl.ELEMENT_ARRAY_BUFFER, tube.hullIndices), hullCount: tube.hullIndices.length,
        }));
        links = { vertices: buffer(gl.ARRAY_BUFFER, geometry.links.vertices), indices: buffer(gl.ELEMENT_ARRAY_BUFFER, geometry.links.indices), halo: null, count: geometry.links.indices.length, haloCount: 0 };
        canvas.dataset.bonds = String(geometry.edgeCount); canvas.dataset.tubes = String(NANOTUBES.length);
        canvas.dataset.fibers = String(NANOTUBES.reduce((sum, tube) => sum + fiberCount(tube), 0));
        canvas.dataset.forms = NANOTUBES.map(tube => tube.form).join(",");
        ready = true; worker?.terminate(); worker = null; sync();
      } catch (error) { fail(error); }
    };
    worker.onerror = () => fail(new Error("Geometry worker unavailable"));
    canvas.dataset.state = "loading"; worker.postMessage({ build: true });
  } catch (error) {
    worker?.terminate(); buffers.forEach(value => gl.deleteBuffer(value)); programs.forEach(value => gl.deleteProgram(value.program)); throw error;
  }

  const hullUv = gl.getAttribLocation(hull.program, "a_uv");
  const attributes = ["a_edge", "a_style", "a_tubes", "a_link"].map(name => gl.getAttribLocation(wire.program, name));
  const allAttributes = new Set([hullUv, ...attributes].filter(location => location >= 0));
  const scale = () => Math.max(.4, Math.min(viewWidth, viewHeight) / 900);
  function common(active: Program) {
    gl.useProgram(active.program);
    gl.uniform2f(uniform(active, "u_viewport"), viewWidth, viewHeight);
    gl.uniform1f(uniform(active, "u_scale"), scale());
    gl.uniform1f(uniform(active, "u_length"), (viewHeight * .9 + viewWidth * .44) * 1.6);
    gl.uniform1f(uniform(active, "u_time"), elapsed + 4.2);
  }
  function wireBatch(batch: WireBatch, onlyHalo = false) {
    if (onlyHalo && !batch.halo) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.vertices);
    const widths = [4, 4, 2, 2], offsets = [0, 16, 32, 40];
    attributes.forEach((location, index) => {
      if (location < 0) return;
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, widths[index], gl.FLOAT, false, 48, offsets[index]);
    });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, onlyHalo ? batch.halo : batch.indices);
    gl.drawElements(gl.TRIANGLES, onlyHalo ? batch.haloCount : batch.count, gl.UNSIGNED_SHORT, 0);
  }
  function draw(now: number) {
    frame = 0;
    if (disposed || lost || !ready || document.hidden) return;
    if (last) elapsed += Math.min(50, now - last) / 1000;
    last = now;
    if (viewWidth !== innerWidth || viewHeight !== innerHeight || pixelRatio !== (devicePixelRatio || 1)) {
      viewWidth = innerWidth; viewHeight = innerHeight; pixelRatio = devicePixelRatio || 1;
      canvas.width = Math.round(viewWidth * pixelRatio); canvas.height = Math.round(viewHeight * pixelRatio);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    gl.colorMask(true, true, true, true); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    allAttributes.forEach(location => gl.disableVertexAttribArray(location));
    common(hull); gl.colorMask(false, false, false, false); gl.enableVertexAttribArray(hullUv);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
    tubes.forEach((tube, id) => {
      gl.uniform1f(uniform(hull, "u_tube"), id);
      gl.bindBuffer(gl.ARRAY_BUFFER, tube.hullVertices); gl.vertexAttribPointer(hullUv, 3, gl.FLOAT, false, 12, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, tube.hullIndices); gl.drawElements(gl.TRIANGLES, tube.hullCount, gl.UNSIGNED_SHORT, 0);
    });
    gl.disable(gl.POLYGON_OFFSET_FILL); gl.disableVertexAttribArray(hullUv);
    gl.colorMask(true, true, true, true); gl.depthMask(false); gl.enable(gl.BLEND);
    common(wire); gl.uniform1f(uniform(wire, "u_intensity"), level === "full" ? 1.12 : level === "minimal" ? .5 : .9);
    gl.uniform4fv(uniform(wire, "u_packets[0]"), pulses.sample(elapsed + 4.2));
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform1f(uniform(wire, "u_pass"), 2); gl.uniform1f(uniform(wire, "u_width"), 13);
    tubes.forEach(tube => wireBatch(tube, true));
    gl.uniform1f(uniform(wire, "u_pass"), 1); gl.uniform1f(uniform(wire, "u_width"), 2.8);
    tubes.forEach(tube => wireBatch(tube)); if (links) wireBatch(links);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(uniform(wire, "u_pass"), 0);
    tubes.forEach((tube, id) => { gl.uniform1f(uniform(wire, "u_width"), NANOTUBES[id].wire); wireBatch(tube); });
    if (links) { gl.uniform1f(uniform(wire, "u_width"), .52); wireBatch(links); }
    canvas.dataset.state = level === "minimal" || reduced.matches ? "still" : "live";
    if (level !== "minimal" && !reduced.matches) frame = requestAnimationFrame(draw);
  }
  function sync() { cancelAnimationFrame(frame); frame = 0; last = 0; if (ready && !document.hidden && !disposed) frame = requestAnimationFrame(draw); }
  function contextLost(event: Event) { event.preventDefault(); lost = true; cancelAnimationFrame(frame); worker?.terminate(); worker = null; onFailure(); }
  function contextRestored() { if (!disposed) onRestore(); }
  document.addEventListener("visibilitychange", sync); window.addEventListener("resize", sync); reduced.addEventListener("change", sync);
  canvas.addEventListener("webglcontextlost", contextLost); canvas.addEventListener("webglcontextrestored", contextRestored);
  return () => {
    disposed = true; cancelAnimationFrame(frame); worker?.terminate(); worker = null;
    document.removeEventListener("visibilitychange", sync); window.removeEventListener("resize", sync); reduced.removeEventListener("change", sync);
    canvas.removeEventListener("webglcontextlost", contextLost); canvas.removeEventListener("webglcontextrestored", contextRestored);
    gl.colorMask(true, true, true, true); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    buffers.forEach(value => gl.deleteBuffer(value)); programs.forEach(value => gl.deleteProgram(value.program)); tubes = []; links = null;
  };
}
