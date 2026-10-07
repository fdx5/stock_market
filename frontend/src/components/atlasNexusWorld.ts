import * as T from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createAtlasSentinel } from "./atlasSentinel";
import { DOMAIN_COLORS, FLOW_HEIGHT as H, FLOW_WIDTH as W, flowPositions, flowRecords, callDestination, UNIT_COLORS, type FlowRecord, type FlowState, type SentinelMission } from "./atlasFlowModel";
import type { AtlasArchitecture } from "./systemAtlasApi";

export type NexusQuality = "cinematic" | "balanced" | "eco";
export function createNexusWorld(host: HTMLElement, graph: AtlasArchitecture, quality: NexusQuality, current: () => FlowState, missions: (value: SentinelMission[]) => void, recover: () => void) {
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0, 0); renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.domElement.className = "af-world-canvas"; renderer.domElement.setAttribute("aria-label", "관측 요청을 따라 빠르게 이동하며 서비스와 외부 연결을 스캔하는 3D 센티널 관제 그래픽"); renderer.domElement.setAttribute("role", "img"); host.appendChild(renderer.domElement);
  const scene = new T.Scene(), camera = new T.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 1, 3000); camera.position.z = 1400; camera.lookAt(0, 0, 0);
  scene.add(new T.HemisphereLight("#dceaff", "#192337", 2.2));
  const key = new T.DirectionalLight("#e7f5ff", 2.5); key.position.set(-300, 400, 600); scene.add(key);
  const rim = new T.DirectionalLight("#927dff", 2.7); rim.position.set(600, -150, 160); scene.add(rim);
  const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment(), env = pmrem.fromScene(room, .04); scene.environment = env.texture; scene.environmentIntensity = .55; room.dispose(); pmrem.dispose();
  const positions = flowPositions(graph), world = (id: string, z = 0) => new T.Vector3((positions[id]?.x ?? 205) - W / 2, H / 2 - (positions[id]?.y ?? 318), z);
  const add = (geo: T.BufferGeometry, mat: T.Material, position: T.Vector3) => { const m = new T.Mesh(geo, mat); m.position.copy(position); scene.add(m); return m; };
  const basic = (color: string, opacity = 1) => new T.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false, blending: T.AdditiveBlending });
  type Rail = { source: string; target: string; curve: T.CubicBezierCurve3; material: T.MeshBasicMaterial; observed: boolean };
  const rails = new Map<string, Rail>();
  function rail(source: string, target: string, color: string, observed = false) {
    const id = `${source}:${target}`; if (rails.has(id)) { const existing = rails.get(id)!; existing.observed ||= observed; return existing; }
    const a = world(source, 12), b = world(target, 12), bend = Math.abs(b.x - a.x) * .46;
    const curve = new T.CubicBezierCurve3(a, a.clone().add(new T.Vector3(bend, 0, 38)), b.clone().sub(new T.Vector3(bend, 0, -38)), b);
    const material = basic(color, observed ? .3 : .065);
    add(new T.TubeGeometry(curve, 50, observed ? 1.65 : .72, 6, false), material, new T.Vector3());
    add(new T.TubeGeometry(curve, 50, 5.8, 6, false), basic(color, .025), new T.Vector3());
    const result = { source, target, curve, material, observed }; rails.set(id, result); return result;
  }
  rail("ingress", "gateway", "#68dfff", true);
  const plates: { id: string; ring: T.Mesh; glow: T.MeshBasicMaterial }[] = [];
  for (const node of graph.nodes) {
    if (!positions[node.id] || node.id === "gateway") continue;
    const hue = DOMAIN_COLORS[node.id] || node.color, shape = new T.Shape();
    shape.moveTo(-94, -31); shape.lineTo(82, -31); shape.lineTo(94, -19); shape.lineTo(94, 22); shape.lineTo(83, 33); shape.lineTo(-84, 33); shape.lineTo(-94, 23); shape.closePath();
    add(new T.ExtrudeGeometry(shape, { depth: 13, bevelEnabled: true, bevelSize: 2, bevelThickness: 2, bevelSegments: 2, steps: 1 }), new T.MeshStandardMaterial({ color: "#1a263c", emissive: hue, emissiveIntensity: .07, metalness: .68, roughness: .34 }), world(node.id, -22));
    const glow = basic(hue, .45), ring = add(new T.TorusGeometry(39, .9, 5, 80), glow, world(node.id, -5)); ring.scale.set(2.5, .91, 1); plates.push({ id: node.id, ring, glow });
  }
  const gateway = new T.Group(); gateway.position.copy(world("gateway", -15)); scene.add(gateway);
  const cage = new T.Mesh(new T.IcosahedronGeometry(53, 1), new T.MeshBasicMaterial({ color: "#7adfff", wireframe: true, transparent: true, opacity: .48 })); gateway.add(cage);
  const crystal = new T.Mesh(new T.OctahedronGeometry(36), new T.MeshStandardMaterial({ color: "#162943", emissive: "#42b2df", emissiveIntensity: .6, metalness: .85, roughness: .2 })); gateway.add(crystal);
  const rings: T.Mesh[] = [];
  for (let i = 0; i < 3; i++) { const ring = new T.Mesh(new T.TorusGeometry(65 + i * 8, 1.3, 6, 120), basic(i === 1 ? "#ba9cff" : "#70dfff", .65)); ring.rotation.set(i * .8, i * .5, .5); gateway.add(ring); rings.push(ring); }
  graph.edges.filter(e => positions[e.source] && positions[e.target]).forEach(e => rail(e.source, e.target, DOMAIN_COLORS[e.source] || DOMAIN_COLORS[e.target] || "#8499bf", e.source === "gateway"));
  const dots = new T.InstancedMesh(new T.SphereGeometry(1, 12, 10), new T.MeshBasicMaterial(), 260); dots.instanceMatrix.setUsage(T.DynamicDrawUsage); dots.frustumCulled = false; scene.add(dots);
  const tails = new T.InstancedMesh(new T.SphereGeometry(1, 7, 5), new T.MeshBasicMaterial({ transparent: true, opacity: .27, depthWrite: false, blending: T.AdditiveBlending }), 520); tails.instanceMatrix.setUsage(T.DynamicDrawUsage); tails.frustumCulled = false; scene.add(tails);
  const units = UNIT_COLORS.map((color, i) => {
    const sentinel = createAtlasSentinel(scene, i, quality === "cinematic" ? 80 : 48, false, i === 2 ? "#ff354b" : color); sentinel.group.position.set(-350 + i * 120, 130 - i * 140, 120); sentinel.group.scale.setScalar(i === 0 ? 24 : 21);
    const scanner = add(new T.RingGeometry(18, 20, 70), basic(color, .8), world("gateway", 75)), pulse = add(new T.RingGeometry(34, 35.4, 70), basic(color, .48), world("gateway", 70));
    const link = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), new T.LineBasicMaterial({ color, transparent: true, opacity: .7, depthWrite: false })); scene.add(link);
    const trail = new T.Line(new T.BufferGeometry().setFromPoints(Array.from({ length: 14 }, () => sentinel.group.position.clone())), new T.LineBasicMaterial({ color, transparent: true, opacity: .44, depthWrite: false })); scene.add(trail);
    const badge = document.createElement("div"); badge.className = `af-unit-tag af-unit-${i}`; badge.innerHTML = `<b>S-0${i + 1}</b><span></span>`; host.appendChild(badge);
    return { sentinel, scanner, pulse, link, trail, badge, target: "gateway", position: sentinel.group.position, record: null as FlowRecord | null };
  });
  type Playing = { record: FlowRecord; start: number; duration: number };
  let playing: Playing[] = [], queue: FlowRecord[] = [], records: FlowRecord[] = [], seen = new Set<string>(), lastSnapshot = -1, lastReplay = -1, lastFocus = "", lastSelected = "", nextLaunch = 0, nextMission = 0;
  let sim = 0, frames = 0, raf = 0, lastFrame = 0, disposed = false, released = false, lost = false, dirty = true, ratio = quality === "cinematic" ? 1.5 : quality === "balanced" ? 1.15 : .8, slowFrames = 0;
  let width = 1, height = 1;
  const resize = () => { width = Math.max(1, host.clientWidth); height = Math.max(1, host.clientHeight); renderer.setPixelRatio(ratio); renderer.setSize(width, height); dirty = true; }; const observer = new ResizeObserver(resize); observer.observe(host); resize();
  const transform = new T.Object3D(), color = new T.Color(), destination = new T.Vector3();
  function drawPacket(path: Rail, progress: number, hue: string, radius: number, index: number) {
    if (index >= 260) return index;
    transform.position.copy(path.curve.getPoint(T.MathUtils.clamp(progress, 0, 1))); transform.position.z += 24; transform.scale.setScalar(radius); transform.updateMatrix(); dots.setMatrixAt(index, transform.matrix); dots.setColorAt(index, color.set(hue));
    for (let j = 0; j < 2; j++) { transform.position.copy(path.curve.getPoint(T.MathUtils.clamp(progress - .018 * (j + 1), 0, 1))); transform.position.z += 23; transform.scale.setScalar(radius * (1.5 - j * .35)); transform.updateMatrix(); tails.setMatrixAt(index * 2 + j, transform.matrix); tails.setColorAt(index * 2 + j, color); }
    return index + 1;
  }
  function updateMissions(state: FlowState) {
    const scoped = records.filter(r => (state.selected === "gateway" || r.group === state.selected) && (!state.focus || r.key === state.focus));
    const services = graph.nodes.filter(n => n.kind === "service").map(n => n.id), cycle = Math.floor(sim / 2.1);
    const result: SentinelMission[] = [];
    units.forEach((u, i) => {
      const candidates = scoped.filter(r => i === 0 ? !r.batch : i === 1 ? r.calls.length : r.fault || r.slow);
      const record = candidates[(cycle + i * 3) % Math.max(1, candidates.length)] || scoped[(cycle + i) % Math.max(1, scoped.length)] || null;
      const stage = (Math.floor(sim / 1.8) + i) % 3;
      const target = record ? stage === 0 ? record.batch ? "batch" : "gateway" : stage === 2 && record.calls.length ? callDestination(graph, record.calls[(cycle + i) % record.calls.length]) : record.batch ? callDestination(graph, record.request) : record.group : state.selected !== "gateway" ? stage === 0 ? "gateway" : state.selected : services[(Math.floor(sim / .8) + i * 2) % services.length];
      u.target = target; u.record = record;
      const title = target === "batch" ? "배치 HTTP" : graph.nodes.find(n => n.id === target)?.label.split(" · ")[0] || "표본 대기";
      const detail = record ? record.batch ? `${record.request.host} · ${Math.round(record.request.ms)}ms` : `#${record.request.trace_id || record.request.id} · ${record.request.method} ${record.request.route}` : "새로운 요청 표본 대기";
      result.push({ unit: i, target, title, detail, phase: record ? i === 2 && record.fault ? "오류 구간 스캔" : i === 2 && record.slow ? "지연 구간 스캔" : i === 1 ? "연동 경로 스캔" : "요청 경로 추적" : "표본 대기", record });
      u.badge.querySelector("span")!.textContent = record ? title : "표본 대기";
    }); missions(result); nextMission = sim + 1.8;
  }
  function tick(stamp: number) {
    if (disposed || lost || document.hidden) return;
    raf = requestAnimationFrame(tick); if (stamp - lastFrame < (quality === "cinematic" ? 1000 / 45 : 1000 / 30)) return;
    const delta = lastFrame ? Math.min(.08, (stamp - lastFrame) / 1000) : .03; lastFrame = stamp;
    const state = current(), moving = state.motion && !state.reduced, changed = state.live?.at !== lastSnapshot || state.selected !== lastSelected || (state.focus || "") !== lastFocus || state.replay !== lastReplay;
    if (!moving && !dirty && !changed) return; if (moving) sim += delta * state.speed;
    if (state.live?.at !== lastSnapshot) {
      records = flowRecords(graph, state.live); const retained = new Set(records.map(r => r.key)); playing = playing.filter(p => retained.has(p.record.key)); const fresh = records.filter(r => !seen.has(r.key)); fresh.forEach(r => seen.add(r.key)); queue = [...queue.filter(r => retained.has(r.key)), ...fresh.filter(r => state.selected === "gateway" || r.group === state.selected).reverse()].slice(-80); if (seen.size > 1000) seen = new Set(records.map(r => r.key)); lastSnapshot = state.live?.at || 0;
      records.flatMap(r => r.calls.map(call => [r.batch ? "batch" : r.group, callDestination(graph, call)] as const)).forEach(([from, to]) => rail(from, to, DOMAIN_COLORS[from] || "#ba9bff", true));
    }
    if (state.replay !== lastReplay || state.selected !== lastSelected || (state.focus || "") !== lastFocus) { playing = []; queue = records.filter(r => (state.selected === "gateway" || r.group === state.selected) && (!state.focus || r.key === state.focus)).slice(0, 40).reverse(); nextLaunch = sim; nextMission = 0; lastReplay = state.replay; lastSelected = state.selected; lastFocus = state.focus || ""; }
    if (moving && queue.length && sim >= nextLaunch && playing.length < 18) { const record = queue.shift()!; playing.push({ record, start: sim, duration: 3.8 + Math.min(2.8, record.request.ms / 1000) }); nextLaunch = sim + .18; }
    playing = playing.filter(p => sim - p.start < p.duration); let count = 0;
    for (const p of playing) {
      const r = p.record, progress = (sim - p.start) / p.duration, hue = r.fault ? "#ff6c83" : DOMAIN_COLORS[r.group] || "#bc9fff";
      if (!r.batch) {
        if (progress < .19) count = drawPacket(rails.get("ingress:gateway")!, progress / .19, hue, 3.3, count);
        if (progress >= .16 && progress < .48) count = drawPacket(rails.get(`gateway:${r.group}`)!, (progress - .16) / .32, hue, 3.2, count);
        if (progress > .76) count = drawPacket(rails.get(`gateway:${r.group}`)!, 1 - (progress - .76) / .24, r.fault ? "#ff6481" : "#d7f7ff", 2.8, count);
      }
      r.calls.forEach(call => { const path = rails.get(`${r.batch ? "batch" : r.group}:${callDestination(graph, call)}`); if (!path) return;
        const start = r.batch ? .08 : .35 + T.MathUtils.clamp(((call.ts - call.ms / 1000) - (r.request.ts - r.request.ms / 1000)) * 1000 / Math.max(1, r.request.ms) * .3, 0, .3), end = Math.min(.96, start + .33), portion = (progress - start) / (end - start);
        if (portion >= 0 && portion <= 1) count = drawPacket(path, portion < .55 ? portion / .55 : 1 - (portion - .55) / .45, !call.status || call.status >= 500 ? "#ff6c83" : hue, 3.2, count);
      });
    }
    dots.count = count; tails.count = count * 2; dots.instanceMatrix.needsUpdate = tails.instanceMatrix.needsUpdate = true; if (dots.instanceColor) dots.instanceColor.needsUpdate = true; if (tails.instanceColor) tails.instanceColor.needsUpdate = true;
    rails.forEach(r => { const focused = state.selected === "gateway" || r.source === state.selected || r.target === state.selected || r.source === "ingress", value = r.source === "gateway" ? state.live?.api.groups[r.target]?.count || 0 : state.live?.observed_edges[`${r.source}:${r.target}`] || 0; r.material.opacity = focused ? value ? .2 + Math.min(.3, value / 160) : r.observed ? .13 : .035 : .015; });
    plates.forEach(p => { const selected = state.selected === p.id, stats = state.live?.api.groups[p.id] || state.live?.external.groups[p.id]; p.glow.color.set(stats?.errors ? "#ff6481" : DOMAIN_COLORS[p.id] || graph.nodes.find(n => n.id === p.id)!.color); p.glow.opacity = selected ? .95 : stats?.count ? .5 : .2; p.ring.scale.set(2.5 + (selected ? .04 * Math.sin(sim * 3) : 0), .91, 1); });
    cage.rotation.set(sim * .08, sim * .12, .3); crystal.rotation.y = -sim * .17; rings.forEach((r, i) => { r.rotation.x = i * .8 + sim * .13; r.rotation.y = i * .5 + sim * .09; }); if (sim >= nextMission || changed) updateMissions(state);
    units.forEach((u, i) => {
      destination.copy(world(u.target, 125)); destination.x -= i === 1 ? 117 : 145; destination.y += i === 2 ? -39 : 51; destination.y += Math.sin(sim * 1.7 + i) * 9;
      const travel = destination.clone().sub(u.position); if (moving || frames === 0) u.position.add(travel.clampLength(0, frames === 0 ? 190 : delta * (2400 + state.speed * 350)));
      u.sentinel.group.rotation.set(.4 + Math.sin(sim * .8 + i) * .08, -.84 + Math.sin(sim * .5 + i) * .18, T.MathUtils.clamp(-travel.y / 450, -.32, .32)); u.sentinel.update(sim * .65);
      const node = world(u.target, 55); u.scanner.position.copy(node); u.scanner.scale.setScalar(.7 + (Math.sin(sim * 4 + i) + 1) * .4); u.scanner.rotation.z = sim * .8;
      u.pulse.position.copy(node); u.pulse.scale.setScalar(.75 + (sim * .6 + i * .3) % 1 * 1.8); (u.pulse.material as T.MeshBasicMaterial).opacity = .32 * (1 - (sim * .6 + i * .3) % 1);
      const a = u.link.geometry.attributes.position as T.BufferAttribute; a.setXYZ(0, u.position.x, u.position.y - 16, 90); a.setXYZ(1, node.x, node.y, node.z); a.needsUpdate = true;
      const trail = u.trail.geometry.attributes.position as T.BufferAttribute; for (let j = 13; j > 0; j--) trail.setXYZ(j, trail.getX(j - 1), trail.getY(j - 1), 110); trail.setXYZ(0, u.position.x, u.position.y, 110); trail.needsUpdate = true;
      u.badge.style.left = `${(u.position.x + W / 2) / W * width}px`; u.badge.style.top = `${(H / 2 - u.position.y + 36) / H * height}px`;
    });
    const begin = performance.now(); renderer.render(scene, camera); const elapsed = performance.now() - begin; slowFrames = elapsed > 38 ? slowFrames + 1 : Math.max(0, slowFrames - 1); if (slowFrames > 25 && ratio > .85) { ratio = Math.max(.85, ratio * .82); slowFrames = 0; resize(); }
    frames++; dirty = false; host.dataset.state = "ready"; host.dataset.frames = String(frames); host.dataset.motion = moving ? "running" : "paused"; host.dataset.simulationTime = sim.toFixed(3); host.dataset.packets = String(count); host.dataset.queued = String(queue.length); host.dataset.seen = String(seen.size); host.dataset.assignments = units.map(u => u.target).join(","); host.dataset.sentinels = "3"; host.dataset.camera = "fixed"; host.dataset.speed = String(state.speed); host.dataset.positions = units.map(u => `${u.position.x.toFixed(0)}:${u.position.y.toFixed(0)}`).join(",");
  }
  function release() { if (released) return; released = true; const geos = new Set<T.BufferGeometry>(), mats = new Set<T.Material>(); scene.traverse(o => { if (o instanceof T.InstancedMesh) o.dispose(); if (o instanceof T.Mesh || o instanceof T.Line) { geos.add(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m)); } }); geos.forEach(g => g.dispose()); mats.forEach(m => m.dispose()); env.dispose(); renderer.dispose(); }
  const lose = (event: Event) => { event.preventDefault(); lost = true; host.dataset.state = "context-lost"; cancelAnimationFrame(raf); release(); }, restore = () => { if (!disposed) recover(); };
  renderer.domElement.addEventListener("webglcontextlost", lose); renderer.domElement.addEventListener("webglcontextrestored", restore);
  const visibility = () => { cancelAnimationFrame(raf); if (!document.hidden && !disposed && !lost) { lastFrame = 0; dirty = true; raf = requestAnimationFrame(tick); } }; document.addEventListener("visibilitychange", visibility); raf = requestAnimationFrame(tick);
  return { invalidate: () => { dirty = true; }, dispose: () => { disposed = true; cancelAnimationFrame(raf); observer.disconnect(); document.removeEventListener("visibilitychange", visibility); renderer.domElement.removeEventListener("webglcontextlost", lose); renderer.domElement.removeEventListener("webglcontextrestored", restore); release(); renderer.forceContextLoss(); host.replaceChildren(); Object.keys(host.dataset).forEach(k => delete host.dataset[k]); } };
}
