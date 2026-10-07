import * as T from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createAtlasSpider } from "./atlasSpider";
import { createServiceLandmark } from "./atlasServiceSculptures";
import { createAtlasWeb } from "./atlasWebEffect";
import { DOMAIN_COLORS, FLOW_HEIGHT as H, FLOW_WIDTH as W, flowPositions, flowRecords, callDestination, UNIT_COLORS, type FlowRecord, type FlowState, type CrawlEvent } from "./atlasFlowModel";
import type { AtlasArchitecture } from "./systemAtlasApi";

export type NexusQuality = "cinematic" | "balanced" | "eco";
export function createNexusWorld(host: HTMLElement, graph: AtlasArchitecture, quality: NexusQuality, current: () => FlowState, activity: (value: CrawlEvent) => void, recover: () => void) {
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0, 0); renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.domElement.className = "af-world-canvas"; renderer.domElement.setAttribute("aria-label", "관측 트래픽 경로를 다리로 기어가는 3D 거미, 기능별 랜드마크와 선택·도착 지점에 퍼지는 거미줄"); renderer.domElement.setAttribute("role", "img"); host.appendChild(renderer.domElement);
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
  const landmarks = graph.nodes.filter(n => n.kind === "service").map(n => createServiceLandmark(scene, n.id, world(n.id)));
  const webs = new Map(graph.nodes.filter(n=>positions[n.id]).map(n=>[n.id,createAtlasWeb(scene,n.id,world(n.id,-6),n.kind==="service"?[104,76]:n.id==="gateway"?[105,91]:[101,34])]));
  for (const node of graph.nodes) {
    if (!positions[node.id] || node.kind === "service" || node.id === "gateway") continue;
    const hue = node.color, pad = add(new T.CylinderGeometry(22, 25, 5, node.kind === "storage" ? 36 : 6), new T.MeshStandardMaterial({ color: "#1d3048", emissive: hue, emissiveIntensity: .12, metalness: .72, roughness: .28 }), world(node.id, -12)); pad.rotation.x = Math.PI / 2; pad.position.x -= 91;
    add(new T.RingGeometry(23, 24.5, 48), basic(hue, .32), pad.position.clone().add(new T.Vector3(0, 0, 6)));
    if (node.kind === "storage") for (let i=0;i<3;i++) { const disk=add(new T.CylinderGeometry(15,15,4,32),new T.MeshStandardMaterial({color:"#8299bc",emissive:hue,emissiveIntensity:.12,metalness:.8,roughness:.25}),pad.position.clone().add(new T.Vector3(0,7+i*5,7+i*3)));disk.rotation.x=1.05; }
  }
  const gateway = new T.Group(); gateway.position.copy(world("gateway", -15)); scene.add(gateway);
  const cage = new T.Mesh(new T.IcosahedronGeometry(53, 1), new T.MeshBasicMaterial({ color: "#7adfff", wireframe: true, transparent: true, opacity: .48 })); gateway.add(cage);
  const crystal = new T.Mesh(new T.OctahedronGeometry(36), new T.MeshStandardMaterial({ color: "#162943", emissive: "#42b2df", emissiveIntensity: .6, metalness: .85, roughness: .2 })); gateway.add(crystal);
  const rings: T.Mesh[] = [];
  for (let i = 0; i < 3; i++) { const ring = new T.Mesh(new T.TorusGeometry(65 + i * 8, 1.3, 6, 120), basic(i === 1 ? "#ba9cff" : "#70dfff", .65)); ring.rotation.set(i * .8, i * .5, .5); gateway.add(ring); rings.push(ring); }
  graph.edges.filter(e => positions[e.source] && positions[e.target]).forEach(e => rail(e.source, e.target, DOMAIN_COLORS[e.source] || DOMAIN_COLORS[e.target] || "#8499bf", e.source === "gateway"));
  const dots = new T.InstancedMesh(new T.SphereGeometry(1, 12, 10), new T.MeshBasicMaterial(), 260); dots.instanceMatrix.setUsage(T.DynamicDrawUsage); dots.frustumCulled = false; scene.add(dots);
  const tails = new T.InstancedMesh(new T.SphereGeometry(1, 7, 5), new T.MeshBasicMaterial({ transparent: true, opacity: .27, depthWrite: false, blending: T.AdditiveBlending }), 520); tails.instanceMatrix.setUsage(T.DynamicDrawUsage); tails.frustumCulled = false; scene.add(tails);
  const units = UNIT_COLORS.slice(0,1).map((color, i) => {
    const spider = createAtlasSpider(scene, i, quality === "cinematic", color); spider.group.position.copy(world("gateway", 40)).add(new T.Vector3(-25,-112,0)); spider.group.scale.setScalar(1.8);
    const badge = document.createElement("div"); badge.className = `af-unit-tag af-unit-${i}`; badge.innerHTML = `<b>W-0${i + 1}</b><span>대기</span>`; host.appendChild(badge);
    return { spider, impactAt:-10, impactTarget:"", badge, target: "gateway", position: spider.group.position, record: null as FlowRecord | null, steps:[] as string[], step:-1, curve:null as T.Curve<T.Vector3>|null, length:1, progress:0, hold:0, walked:0, heading:0, stage:"idle" };
  });
  type Playing = { record: FlowRecord; start: number; duration: number };
  let playing: Playing[] = [], queue: FlowRecord[] = [], crawlQueue: FlowRecord[] = [], records: FlowRecord[] = [], seen = new Set<string>(), lastSnapshot = -1, lastReplay = -1, lastFocus = "", lastSelected = "", nextLaunch = 0, eventId = 0, arrivals = 0, clock = 0, maxStep = 0;
  let sim = 0, frames = 0, raf = 0, lastFrame = 0, disposed = false, released = false, lost = false, dirty = true, ratio = quality === "cinematic" ? 1.5 : quality === "balanced" ? 1.15 : .8, slowFrames = 0;
  let width = 1, height = 1;
  const resize = () => { width = Math.max(1, host.clientWidth); height = Math.max(1, host.clientHeight); renderer.setPixelRatio(ratio); renderer.setSize(width, height); dirty = true; }; const observer = new ResizeObserver(resize); observer.observe(host); resize();
  const transform = new T.Object3D(), color = new T.Color();
  function drawPacket(path: Rail, progress: number, hue: string, radius: number, index: number) {
    if (index >= 260) return index;
    transform.position.copy(path.curve.getPoint(T.MathUtils.clamp(progress, 0, 1))); transform.position.z += 24; transform.scale.setScalar(radius); transform.updateMatrix(); dots.setMatrixAt(index, transform.matrix); dots.setColorAt(index, color.set(hue));
    for (let j = 0; j < 2; j++) { transform.position.copy(path.curve.getPoint(T.MathUtils.clamp(progress - .018 * (j + 1), 0, 1))); transform.position.z += 23; transform.scale.setScalar(radius * (1.5 - j * .35)); transform.updateMatrix(); tails.setMatrixAt(index * 2 + j, transform.matrix); tails.setColorAt(index * 2 + j, color); }
    return index + 1;
  }
  function dock(id: string, i: number) { return world(id,40).add(new T.Vector3(-38+i*12,35-i*11,0)); }
  function beginLeg(u: typeof units[number], i: number) {
    const source=u.step<0 ? "" : u.steps[u.step], target=u.steps[u.step+1];
    if(!target) { u.record=null;u.curve=null;u.stage="idle";u.badge.querySelector("span")!.textContent="대기";return; }
    u.target=target; const from=u.position.clone(), to=dock(target,i), forward=rails.get(`${source}:${target}`), reverse=rails.get(`${target}:${source}`);
    if(forward || reverse) {
      const path=(forward||reverse)!.curve, a=reverse&&!forward?path.v2:path.v1, b=reverse&&!forward?path.v1:path.v2;
      const shift=new T.Vector3(-38+i*12,35-i*11,0), c1=a.clone().add(shift), c2=b.clone().add(shift); c1.z=c2.z=40;
      u.curve=new T.CubicBezierCurve3(from,c1,c2,to);
    } else { const bend=Math.min(90,from.distanceTo(to)*.3);u.curve=new T.CubicBezierCurve3(from,from.clone().add(new T.Vector3(bend,0,0)),to.clone().sub(new T.Vector3(bend,0,0)),to); }
    u.length=Math.max(1,u.curve.getLength());u.progress=0;u.stage=u.step<0?"approach":"crawl";
    u.badge.querySelector("span")!.textContent=graph.nodes.find(n=>n.id===target)?.label.split(" · ")[0]||"배치";
    if(u.record && u.step>=0) activity({id:++eventId,unit:i,target,kind:"depart",record:u.record});
  }
  function advanceUnit(u: typeof units[number], i:number, delta:number, state:FlowState, moving:boolean) {
    let walking=false;
    if(moving) {
      if(u.hold>0) u.hold=Math.max(0,u.hold-delta);
      if(!u.record && crawlQueue.length) {
        const r=crawlQueue.shift()!; u.record=r;u.step=-1;u.steps=r.batch?["batch",callDestination(graph,r.request),"batch"]:["gateway",r.group,...r.calls.flatMap(c=>[callDestination(graph,c),r.group]),"gateway"];beginLeg(u,i);
      }
      if(u.record && !u.curve && !u.hold) beginLeg(u,i);
      if(u.curve && !u.hold) {
        const velocity=154+state.speed*22, remaining=(1-u.progress)*u.length, easing=T.MathUtils.clamp(remaining/42,.34,1);
        u.progress=Math.min(1,u.progress+delta*velocity*easing/u.length);
        const next=u.curve.getPointAt(u.progress), travel=next.clone().sub(u.position), distance=travel.length();maxStep=Math.max(maxStep,distance);
        if(distance>.02) { const angle=Math.atan2(travel.y,travel.x);u.heading+=Math.atan2(Math.sin(angle-u.heading),Math.cos(angle-u.heading))*Math.min(1,delta*9);u.walked+=distance/u.spider.group.scale.x;walking=true; }
        u.position.copy(next); u.spider.group.rotation.z=u.heading;
        if(u.progress===1) {
          const approach=u.step<0;u.step++;u.curve=null;u.hold=approach?.12:.46;u.stage="arrived";
          if(!approach && u.record) {
            arrivals++;u.impactAt=clock;u.impactTarget=u.target;
            const hue=u.record.fault?"#ff668e":DOMAIN_COLORS[u.record.group]||UNIT_COLORS[i];webs.get(u.target)?.play(clock,hue,state.selected===u.target);
            activity({id:++eventId,unit:i,target:u.target,kind:"arrival",record:u.record});
          }
        }
      }
      u.spider.update(u.walked,walking,clock);
    }
    u.badge.style.left=`${(u.position.x+W/2)/W*width}px`;u.badge.style.top=`${(H/2-u.position.y+39)/H*height}px`;
  }
  function tick(stamp: number) {
    if (disposed || lost || document.hidden) return;
    raf = requestAnimationFrame(tick); if (stamp - lastFrame < (quality === "cinematic" ? 1000 / 45 : 1000 / 30)) return;
    const delta = lastFrame ? Math.min(.08, (stamp - lastFrame) / 1000) : .03; lastFrame = stamp;
    const state = current(), moving = state.motion && !state.reduced, changed = state.live?.at !== lastSnapshot || state.selected !== lastSelected || (state.focus || "") !== lastFocus || state.replay !== lastReplay;
    if (!moving && !dirty && !changed) return; if (moving) { sim += delta * state.speed; clock += delta; }
    if (state.live?.at !== lastSnapshot) {
      records = flowRecords(graph, state.live); const retained = new Set(records.map(r => r.key)); playing = playing.filter(p => retained.has(p.record.key)); const fresh = records.filter(r => !seen.has(r.key)); fresh.forEach(r => seen.add(r.key)); crawlQueue=[...crawlQueue.filter(r=>retained.has(r.key)),...fresh.filter(r=>(state.selected==="gateway"||r.group===state.selected)&&(!state.focus||r.key===state.focus))].slice(-24); if(!records.length) units.forEach(u=>{u.record=null;u.curve=null;u.stage="idle";}); queue = [...queue.filter(r => retained.has(r.key)), ...fresh.filter(r => state.selected === "gateway" || r.group === state.selected).reverse()].slice(-80); if (seen.size > 1000) seen = new Set(records.map(r => r.key)); lastSnapshot = state.live?.at || 0;
      records.flatMap(r => r.calls.map(call => [r.batch ? "batch" : r.group, callDestination(graph, call)] as const)).forEach(([from, to]) => rail(from, to, DOMAIN_COLORS[from] || "#ba9bff", true));
    }
    if(state.selected!==lastSelected) {
      webs.forEach(w=>w.deselect(clock));
      if(state.selected!=="gateway") webs.get(state.selected)?.play(clock,DOMAIN_COLORS[state.selected]||"#cde7f7",true,!moving);
    }
    if (state.replay !== lastReplay || state.selected !== lastSelected || (state.focus || "") !== lastFocus) { playing = []; queue = records.filter(r => (state.selected === "gateway" || r.group === state.selected) && (!state.focus || r.key === state.focus)).slice(0, 40).reverse(); crawlQueue = queue.slice(-24); units.forEach(u=>{u.record=null;u.curve=null;u.hold=0;u.stage="idle";}); nextLaunch = sim; lastReplay = state.replay; lastSelected = state.selected; lastFocus = state.focus || ""; }
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
    landmarks.forEach(l=>l.update(clock,state.selected===l.id));
    cage.rotation.set(clock * .08, clock * .12, .3); crystal.rotation.y = -clock * .17; rings.forEach((r, i) => { r.rotation.x = i * .8 + clock * .13; r.rotation.y = i * .5 + clock * .09; });
    units.forEach((u,i)=>advanceUnit(u,i,delta,state,moving));
    let visibleWebs=0;webs.forEach(w=>{if(w.update(clock,renderer.getPixelRatio()))visibleWebs++;});
    host.parentElement?.querySelectorAll<HTMLElement>("[data-flow-node]").forEach(el=>{const hit=units.some(u=>u.impactTarget===el.dataset.flowNode&&clock-u.impactAt<1.1);el.dataset.impact=hit?"on":"off";});
    const begin = performance.now(); renderer.render(scene, camera); const elapsed = performance.now() - begin; slowFrames = elapsed > 38 ? slowFrames + 1 : Math.max(0, slowFrames - 1); if (slowFrames > 25 && ratio > .85) { ratio = Math.max(.85, ratio * .82); slowFrames = 0; resize(); }
    frames++; dirty = false; host.dataset.state = "ready"; host.dataset.frames = String(frames); host.dataset.motion = moving ? "running" : "paused"; host.dataset.simulationTime = sim.toFixed(3); host.dataset.packets = String(count); host.dataset.queued = String(queue.length); host.dataset.seen = String(seen.size); host.dataset.assignments = units.map(u => u.target).join(","); host.dataset.effect="silk-web";host.dataset.webs=String(visibleWebs);host.dataset.webTargets=[...webs.values()].filter(w=>w.group.visible).map(w=>w.id).join(",");host.dataset.webProgress=[...webs.values()].filter(w=>w.group.visible).map(w=>`${w.id}:${w.uniforms.progress.value.toFixed(3)}`).join(",");host.dataset.spiders = String(units.length); host.dataset.legs = "8"; host.dataset.arrivals = String(arrivals); host.dataset.walking = String(units.filter(u=>u.curve).length); host.dataset.crawlQueued=String(crawlQueue.length); host.dataset.maxStep=maxStep.toFixed(2); host.dataset.gait=units.map(u=>u.walked.toFixed(1)).join(","); host.dataset.camera = "fixed"; host.dataset.speed = String(state.speed); host.dataset.positions = units.map(u => `${u.position.x.toFixed(0)}:${u.position.y.toFixed(0)}`).join(",");
  }
  function release() { if (released) return; released = true; const geos = new Set<T.BufferGeometry>(), mats = new Set<T.Material>(); scene.traverse(o => { if (o instanceof T.InstancedMesh) o.dispose(); if (o instanceof T.Mesh || o instanceof T.Line || o instanceof T.Points) { geos.add(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m)); } }); geos.forEach(g => g.dispose()); mats.forEach(m => m.dispose()); env.dispose(); renderer.dispose(); }
  const lose = (event: Event) => { event.preventDefault(); lost = true; host.dataset.state = "context-lost"; cancelAnimationFrame(raf); release(); }, restore = () => { if (!disposed) recover(); };
  renderer.domElement.addEventListener("webglcontextlost", lose); renderer.domElement.addEventListener("webglcontextrestored", restore);
  const visibility = () => { cancelAnimationFrame(raf); if (!document.hidden && !disposed && !lost) { lastFrame = 0; dirty = true; raf = requestAnimationFrame(tick); } }; document.addEventListener("visibilitychange", visibility); raf = requestAnimationFrame(tick);
  return { invalidate: () => { dirty = true; }, dispose: () => { disposed = true; cancelAnimationFrame(raf); observer.disconnect(); document.removeEventListener("visibilitychange", visibility); renderer.domElement.removeEventListener("webglcontextlost", lose); renderer.domElement.removeEventListener("webglcontextrestored", restore); release(); renderer.forceContextLoss(); host.replaceChildren(); Object.keys(host.dataset).forEach(k => delete host.dataset[k]); } };
}
