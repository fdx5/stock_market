import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { hash, type SynapseGraph, type SynapseSignal } from "./synapseModel";
import type { SynapseGeometry } from "./synapseGeometry";

export interface SceneOptions { selected: string | null; domain: string; query: string; isolate: boolean; faultsOnly: boolean; motion: boolean; autoRotate: boolean; paused: boolean; speed: number; quality: "high" | "balanced" | "eco"; faults: Set<string> }
const lineVertex = `attribute vec3 color; attribute float aAlong; attribute float aStart; attribute float aFault; attribute float aVisible;
 varying vec3 vColor; varying float vAlong; varying float vStart; varying float vFault; varying float vVisible;
 void main(){vColor=color;vAlong=aAlong;vStart=aStart;vFault=aFault;vVisible=aVisible;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const lineFragment = `uniform float uTime; uniform float uMotion; uniform float uSpeed; uniform float uDensity; varying vec3 vColor; varying float vAlong; varying float vStart; varying float vFault; varying float vVisible;
 void main(){float travel=(uTime-vStart)*uSpeed;float pulse=1.-smoothstep(0.,.17,abs(vAlong-travel));pulse*=step(0.,travel)*step(travel,1.2)*uMotion;
 vec3 c=mix(vColor,vec3(1.,.22,.39),vFault);float a=(.16*uDensity+pulse*.88)*vVisible;gl_FragColor=vec4(c+vec3(pulse*.5),min(.95,a));}`;
const pointVertex = `attribute vec3 color; attribute float aSize; attribute float aVisible; attribute float aImpact; varying vec3 vColor; varying float vVisible; uniform float uDpr;uniform float uTime;uniform float uMotion;
 void main(){float impact=max(0.,1.-(uTime-aImpact)*1.5)*step(aImpact,uTime)*uMotion;vColor=color+impact*.5;vVisible=aVisible;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(aSize*(1.+impact*1.5)*uDpr*640./max(80.,-p.z),2.,85.);}`;
const pointFragment = `varying vec3 vColor;varying float vVisible;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;float core=exp(-d*d*40.);float glow=pow(1.-d,2.)*.55;gl_FragColor=vec4(vColor+core*.65,(core+glow)*vVisible);}`;
const packetVertex = `attribute vec3 p0;attribute vec3 p1;attribute vec3 p2;attribute vec3 p3;attribute vec3 color;attribute float aStart;attribute float aFault;attribute float aVisible;attribute float aOffset;
 uniform float uTime;uniform float uSpeed;uniform float uDpr;uniform float uMotion;varying vec3 vColor;varying float vVisible;
 void main(){float t=(uTime-aStart)*uSpeed-aOffset;vVisible=step(0.,t)*step(t,1.)*aVisible*uMotion; t=clamp(t,0.,1.);float s=1.-t;
 vec3 p=s*s*s*p0+3.*s*s*t*p1+3.*s*t*t*p2+t*t*t*p3;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
 gl_PointSize=clamp((8.-aOffset*24.)*uDpr*600./max(100.,-mv.z),2.,28.);vColor=mix(color,vec3(1.,.27,.43),aFault)+.22;}`;

/** Three draw calls for topology regardless of edge count: segments, nodes, packets.
 * Curves and packet interpolation run on the GPU; snapshots only update attributes. */
export class SynapseScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(47, 1, 1, 3000);
  private controls: OrbitControls;
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private lineGeometry = new THREE.BufferGeometry();
  private nodeGeometry = new THREE.BufferGeometry();
  private packetGeometry = new THREE.BufferGeometry();
  private uniforms = { uTime: { value: 0 }, uMotion: { value: 1 }, uSpeed: { value: 1.5 }, uDpr: { value: 1 }, uDensity: { value: 1 } };
  private options: SceneOptions = { selected: null, domain: "all", query: "", isolate: false, faultsOnly: false, motion: true, autoRotate: true, paused: false, speed: 1.5, quality: "balanced", faults: new Set() };
  private labels: { element: HTMLButtonElement; index: number }[] = [];
  private linkIndex = new Map<string, number>();
  private frame = 0; private disposed = false; private lost = false;
  private last = 0; private lastReport = 0; private frameCount = 0;
  private elapsed = 0; private drawn = 0; private observer: ResizeObserver;
  private dragStart = { x: 0, y: 0 }; private pointer = new THREE.Vector3();
  private core = new THREE.Group(); private selectRing: THREE.Mesh;
  private celestialFrame=new THREE.Group();private coreEnergy=0;private rotationHoldUntil=0;
  private divisions = 20;
  private topology = new THREE.Group();
  private worker: Worker;
  private revision = 0;
  private building: SynapseGraph | null = null;
  private pendingGraph: SynapseGraph | null = null;
  private pendingSignals: SynapseSignal[] = [];
  private topologyReady = false;
  private lineMaterial: THREE.ShaderMaterial;
  private nodeMaterial: THREE.ShaderMaterial;
  private packetMaterial: THREE.ShaderMaterial;
  private width = 0; private height = 0; private schedule = 0;
  private filterKey = ""; private faultKey = "";
  onReady: () => void = () => {};
  private visibleNodes: boolean[] = [];
  private destination: THREE.Vector3 | null = null;
  private narrow: boolean | null = null;
  onSelect: (id: string) => void = () => {};
  onHover: (id: string | null) => void = () => {};
  onStats: (fps: number, draws: number) => void = () => {};
  onFailure: (message: string) => void = () => {};

  constructor(private host: HTMLElement, private labelHost: HTMLElement, public graph: SynapseGraph, private seen = new Set<string>()) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x040a13, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute("aria-label", "입체 통신 신경망. 드래그로 회전, 휠로 확대. 노드는 목록에서도 선택할 수 있습니다.");
    this.renderer.domElement.setAttribute("role", "img");
    this.camera.position.set(0, -90, 780);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = .065;
    this.controls.minDistance = 65; this.controls.maxDistance = 2600;
    this.controls.rotateSpeed = .45; this.controls.zoomSpeed = .75;
    this.controls.autoRotateSpeed=.65;
    this.controls.addEventListener("start", this.cancelFocus);
    this.divisions = graph.links.length > 12000 ? 10 : 20;
    this.uniforms.uDensity.value=Math.min(1,Math.pow(2200/Math.max(1,graph.links.length),.65));
    this.lineMaterial = this.shader(lineVertex, lineFragment); this.lineMaterial.blending = THREE.NormalBlending;
    this.nodeMaterial = this.shader(pointVertex, pointFragment);
    this.packetMaterial = this.shader(packetVertex, pointFragment);
    this.scene.add(this.topology); this.buildAtmosphere();
    this.worker = new Worker(new URL("./synapseGeometry.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = ({ data }) => {
      if (this.disposed || data.revision !== this.revision || !this.building) return;
      const graph = this.building; this.building = null;
      this.installTopology(graph, data.geometry);
      const pending = this.pendingGraph; this.pendingGraph = null;
      if (pending && pending !== graph) this.updateGraph(pending);
    };
    this.worker.onerror = () => { if (!this.disposed) this.onFailure("연결 구조를 준비하지 못했습니다. 3D 다시 연결을 눌러 주세요."); };
    const ringGeo = new THREE.RingGeometry(10, 10.5, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: "#e3faff", transparent: true, opacity: .7, side: THREE.DoubleSide, depthWrite: false });
    this.selectRing = new THREE.Mesh(ringGeo, ringMat); this.selectRing.visible = false;
    this.scene.add(this.selectRing); this.geometries.push(ringGeo); this.materials.push(ringMat);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.addEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.addEventListener("pointerleave", this.pointerLeave);
    this.renderer.domElement.addEventListener("webglcontextlost", this.contextLost);
    document.addEventListener("visibilitychange", this.visibility);
    this.resize(); this.applyOptions(this.options); this.frame = requestAnimationFrame(this.animate);
    host.dataset.state = "loading"; this.updateGraph(graph);
  }
  private cancelFocus = () => { this.destination = null;this.rotationHoldUntil=performance.now()+4000; };
  private shader(vertexShader: string, fragmentShader: string) {
    const m = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.materials.push(m); return m;
  }
  private attr(geometry: THREE.BufferGeometry, key: string, values: Float32Array, size = 1) { geometry.setAttribute(key, new THREE.BufferAttribute(values, size).setUsage(key.startsWith("a") && key !== "aAlong" && key !== "aOffset" || key === "color" ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage)); }
  updateGraph(graph: SynapseGraph) {
    if (this.disposed || this.lost || (this.topologyReady && graph === this.graph)) return;
    if (this.building) { this.pendingGraph = graph; return; }
    this.building = graph;
    this.worker.postMessage({ revision: ++this.revision, graph });
  }
  private installTopology(graph: SynapseGraph, data: SynapseGeometry) {
    const active = new Map<string, [number, number]>();
    if (this.topologyReady) {
      const starts = this.packetGeometry.getAttribute("aStart"), faults = this.packetGeometry.getAttribute("aFault");
      this.graph.links.forEach((e,i) => { const start = starts.getX(i*4); if (start > this.elapsed-3) active.set(e.id,[start,faults.getX(i*4)]); });
    }
    this.topology.clear();
    [this.lineGeometry,this.nodeGeometry,this.packetGeometry].forEach(g=>g.dispose());
    this.lineGeometry=new THREE.BufferGeometry(); this.nodeGeometry=new THREE.BufferGeometry(); this.packetGeometry=new THREE.BufferGeometry();
    this.graph=graph;
    this.uniforms.uDensity.value=Math.min(1,Math.pow(2200/Math.max(1,graph.links.length),.65));
    this.buildTopology(data);
    active.forEach(([start,fault],id)=>{const index=this.linkIndex.get(id);if(index===undefined)return;
      for(const [geo,stride] of [[this.lineGeometry,this.divisions*2],[this.packetGeometry,4]] as const){
        (geo.getAttribute("aStart").array as Float32Array).fill(start,index*stride,(index+1)*stride);
        (geo.getAttribute("aFault").array as Float32Array).fill(fault,index*stride,(index+1)*stride);
      }
    });
    this.labels.forEach(l=>l.element.remove()); this.labels=[];
    graph.nodes.forEach((node, index) => {
      if (node.parent || node.kind === "module" || node.kind === "api") return;
      const element = document.createElement("button"); element.className = "sn-space-label";
      element.style.setProperty("--signal", node.color);
      const caption = document.createElement("small"); caption.textContent = node.kind === "core" ? "CENTRAL NEXUS" : node.kind.toUpperCase();
      const title = document.createElement("span"); title.textContent = node.label.split(" · ")[0];
      element.append(caption, title); element.setAttribute("aria-label", `${node.label} 노드 선택`);
      element.onclick = () => this.onSelect(node.id); this.labelHost.appendChild(element); this.labels.push({ element, index });
    });
    this.topologyReady=true;this.filterKey="";this.faultKey="";this.applyOptions(this.options);
    this.ingest(this.pendingSignals);this.pendingSignals=[];
    this.host.dataset.state="ready";this.host.dataset.nodes=String(graph.nodes.length);this.host.dataset.links=String(graph.links.length);
    this.host.dataset.topologyRevision=String(this.revision);this.onReady();
  }
  private buildTopology(data: SynapseGeometry) {
    const { nodes, links } = this.graph;
    const { pos, colors, along, pp, pc, offsets, np, nc, ns } = data;
    const count = along.length, packets = offsets.length;
    this.divisions = data.divisions;
    this.linkIndex = new Map(links.map((e, i) => [e.id, i]));
    this.attr(this.lineGeometry, "position", pos, 3); this.attr(this.lineGeometry, "color", colors, 3); this.attr(this.lineGeometry, "aAlong", along);
    this.attr(this.lineGeometry, "aStart", new Float32Array(count).fill(-100)); this.attr(this.lineGeometry, "aFault", new Float32Array(count)); this.attr(this.lineGeometry, "aVisible", new Float32Array(count).fill(1));
    // Alpha composition preserves domain colors even where tens of thousands of
    // axons overlap. Additive light is reserved for measured packets and nodes.
    this.topology.add(new THREE.LineSegments(this.lineGeometry,this.lineMaterial));
    this.attr(this.packetGeometry, "position", new Float32Array(packets * 3), 3);
    pp.forEach((p,i) => this.attr(this.packetGeometry, `p${i}`, p, 3)); this.attr(this.packetGeometry, "color", pc, 3);
    this.attr(this.packetGeometry, "aStart", new Float32Array(packets).fill(-100)); this.attr(this.packetGeometry, "aFault", new Float32Array(packets)); this.attr(this.packetGeometry, "aVisible", new Float32Array(packets).fill(1)); this.attr(this.packetGeometry, "aOffset", offsets);
    const packetObject = new THREE.Points(this.packetGeometry, this.packetMaterial); packetObject.frustumCulled = false; this.topology.add(packetObject);
    this.attr(this.nodeGeometry, "position", np, 3); this.attr(this.nodeGeometry, "color", nc, 3); this.attr(this.nodeGeometry, "aSize", ns); this.attr(this.nodeGeometry, "aVisible", new Float32Array(nodes.length).fill(1));
    this.attr(this.nodeGeometry,"aImpact",new Float32Array(nodes.length).fill(-100));
    this.topology.add(new THREE.Points(this.nodeGeometry, this.nodeMaterial));
  }
  private buildAtmosphere() {
    const stars = new Float32Array(2100 * 3);
    for (let i = 0; i < 2100; i++) { stars[i*3] = (hash(`sx${i}`)-.5)*1800; stars[i*3+1]=(hash(`sy${i}`)-.5)*1100; stars[i*3+2]=-100-hash(`sz${i}`)*850; }
    const starGeo = new THREE.BufferGeometry(); this.attr(starGeo, "position", stars, 3);
    const starMat = new THREE.PointsMaterial({ color: "#90b9df", size: .7, transparent: true, opacity: .43, depthWrite: false });
    this.scene.add(new THREE.Points(starGeo, starMat)); this.geometries.push(starGeo); this.materials.push(starMat);
    for (const node of this.graph.domains) {
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 120; i++) { const a = i / 120 * Math.PI*2; points.push(new THREE.Vector3(Math.cos(a)*90, Math.sin(a)*62, Math.sin(a*2)*18)); }
      const geo = new THREE.BufferGeometry().setFromPoints(points), mat = new THREE.LineBasicMaterial({ color: node.color, transparent: true, opacity: .10, depthWrite: false });
      const ring = new THREE.Line(geo, mat); ring.position.set(...node.position); this.scene.add(ring); this.geometries.push(geo); this.materials.push(mat);
    }
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.TorusGeometry(22 + i*6, .22, 5, 120), mat = new THREE.MeshBasicMaterial({ color: i === 1 ? "#b596ff" : "#79e4ee", transparent: true, opacity: .48, blending: THREE.AdditiveBlending });
      const ring = new THREE.Mesh(geo, mat); ring.rotation.set(i*.9, i*.7, .3); this.core.add(ring); this.geometries.push(geo); this.materials.push(mat);
    }
    const geo = new THREE.IcosahedronGeometry(13, 1), mat = new THREE.MeshBasicMaterial({ color: "#8de9ff", wireframe: true, transparent: true, opacity: .38 });
    this.core.add(new THREE.Mesh(geo, mat)); this.geometries.push(geo); this.materials.push(mat); this.scene.add(this.core);
    // A translucent plasma membrane gives the central core volume without a
    // full-screen bloom pass. All surrounding orbits are explicitly decorative.
    const membraneGeo=new THREE.SphereGeometry(18,40,28);
    const membrane=this.shader(`varying vec3 n;varying vec3 eye;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);eye=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
      `uniform float uTime;uniform float uMotion;varying vec3 n;varying vec3 eye;void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(eye))),2.3);float wave=.6+.4*sin(n.y*22.+uTime*uMotion*1.8);vec3 c=mix(vec3(.18,.55,1.),vec3(.35,1.,.88),n.y*.5+.5);gl_FragColor=vec4(c,rim*(.4+wave*.32));}`);
    this.core.add(new THREE.Mesh(membraneGeo,membrane));this.geometries.push(membraneGeo);
    for(let ring=0;ring<3;ring++){
      const points:THREE.Vector3[]=[],ticks:THREE.Vector3[]=[];const radius=365+ring*20;
      for(let i=0;i<=240;i++){const a=i/240*Math.PI*2;points.push(new THREE.Vector3(Math.cos(a)*radius,Math.sin(a)*radius*.68,0));}
      for(let i=0;i<120;i++){const a=i/120*Math.PI*2,len=i%10===0?8:3;ticks.push(new THREE.Vector3(Math.cos(a)*radius,Math.sin(a)*radius*.68,0),new THREE.Vector3(Math.cos(a)*(radius+len),Math.sin(a)*(radius+len)*.68,0));}
      const ringGeo=new THREE.BufferGeometry().setFromPoints(points),tickGeo=new THREE.BufferGeometry().setFromPoints(ticks);
      const ringMat=new THREE.LineBasicMaterial({color:ring===1?"#9e85de":"#539fb5",transparent:true,opacity:ring===0?.16:.07,depthWrite:false});
      const group=new THREE.Group();group.add(new THREE.Line(ringGeo,ringMat),new THREE.LineSegments(tickGeo,ringMat));group.rotation.set(ring*.42,.2+ring*.2,ring*.32);this.celestialFrame.add(group);
      this.geometries.push(ringGeo,tickGeo);this.materials.push(ringMat);
    }
    this.scene.add(this.celestialFrame);
  }
  applyOptions(options: SceneOptions) {
    const prevQuality = this.options.quality; this.options = options;
    this.uniforms.uMotion.value = options.motion && !options.paused ? 1 : 0; this.uniforms.uSpeed.value = options.speed;
    if (prevQuality !== options.quality) this.resize();
    this.host.dataset.motion = String(options.motion && !options.paused);
    if (!this.topologyReady) return;
    const faultKey = [...options.faults].sort().join("\n");
    const filterKey = JSON.stringify([options.selected,options.domain,options.query,options.isolate,options.faultsOnly,options.faultsOnly?faultKey:""]);
    if (faultKey !== this.faultKey) {
      this.faultKey=faultKey;
      const nc=this.nodeGeometry.getAttribute("color") as THREE.BufferAttribute,color=new THREE.Color();
      this.graph.nodes.forEach((n,i)=>{color.set(options.faults.has(n.id)?"#ff668f":n.color);nc.setXYZ(i,color.r,color.g,color.b);});nc.needsUpdate=true;
    }
    if (filterKey === this.filterKey) return;
    this.filterKey=filterKey;
    const selected = options.selected ? this.graph.byId.get(options.selected) : undefined;
    const neighbors = new Set<number>(selected === undefined ? [] : [selected]);
    if (selected !== undefined) this.graph.adjacency.get(selected)?.forEach(i => { neighbors.add(this.graph.links[i].source); neighbors.add(this.graph.links[i].target); });
    const query = options.query.trim().toLowerCase();
    this.visibleNodes = this.graph.nodes.map((n,i) => (options.domain === "all" || n.group === options.domain || n.id === options.domain) && (!query || `${n.label} ${n.detail}`.toLowerCase().includes(query)) && (!options.isolate || selected === undefined || neighbors.has(i)) && (!options.faultsOnly || options.faults.has(n.id)));
    const nv = this.nodeGeometry.getAttribute("aVisible") as THREE.BufferAttribute;
    this.visibleNodes.forEach((v,i) => nv.setX(i, v ? 1 : .07)); nv.needsUpdate = true;
    const lv = this.lineGeometry.getAttribute("aVisible") as THREE.BufferAttribute, pv = this.packetGeometry.getAttribute("aVisible") as THREE.BufferAttribute;
    this.graph.links.forEach((e,i) => { const visible = this.visibleNodes[e.source] && this.visibleNodes[e.target]; const related = selected === e.source || selected === e.target; const value = visible ? related ? 2.8 : 1 : related && !options.faultsOnly && !query ? .65 : .025;
      for (let k = 0; k < this.divisions*2; k++) lv.setX(i*this.divisions*2+k, value);
      for (let k = 0; k < 4; k++) pv.setX(i*4+k, visible || related ? 1 : 0);
    }); lv.needsUpdate = true; pv.needsUpdate = true;
    this.selectRing.visible = selected !== undefined;
    if (selected !== undefined) this.selectRing.position.set(...this.graph.nodes[selected].position);
    this.labels.forEach(({element,index}) => { element.dataset.dim = String(!this.visibleNodes[index]); element.setAttribute("aria-pressed", String(selected === index)); });
    this.host.dataset.motion = String(options.motion && !options.paused);
  }
  ingest(signals: SynapseSignal[], replay = false) {
    if (!this.topologyReady || this.building) this.pendingSignals=signals;
    if (!this.topologyReady || this.options.paused || !this.options.motion) return;
    let touched = false;
    const latest = new Map<number, SynapseSignal>();
    for (const signal of signals) {
      if (!replay && this.seen.has(signal.key)) continue;
      if (!replay && Date.now()/1000 - signal.ts > 8) { this.seen.add(signal.key); continue; }
      const index = this.linkIndex.get(signal.link); if (index === undefined) continue;
      this.seen.add(signal.key);
      const previous=latest.get(index); if(!previous || signal.ts>=previous.ts)latest.set(index,signal);
    }
    for (const [index,signal] of latest) {
      const start = this.elapsed + hash(signal.key)*.45;
      const target=this.graph.links[index].target;
      const impact=this.nodeGeometry.getAttribute("aImpact") as THREE.BufferAttribute;impact.setX(target,start+1/this.options.speed);impact.addUpdateRange(target,1);
      this.coreEnergy=Math.min(1,this.coreEnergy+.12);
      for (const [geometry, stride] of [[this.lineGeometry, this.divisions*2], [this.packetGeometry,4]] as const) {
        const starts = geometry.getAttribute("aStart") as THREE.BufferAttribute, faults = geometry.getAttribute("aFault") as THREE.BufferAttribute;
        (starts.array as Float32Array).fill(start,index*stride,(index+1)*stride);
        (faults.array as Float32Array).fill(signal.fault?1:0,index*stride,(index+1)*stride);
        starts.addUpdateRange(index*stride,stride);faults.addUpdateRange(index*stride,stride);
      }
      touched = true;
    }
    if (this.seen.size > 16000) { let remove=this.seen.size-8000; for(const key of this.seen){this.seen.delete(key);if(--remove<=0)break;} }
    if (touched) for (const geo of [this.lineGeometry, this.packetGeometry]) for (const key of ["aStart","aFault"]) (geo.getAttribute(key) as THREE.BufferAttribute).needsUpdate = true;
    if(touched)(this.nodeGeometry.getAttribute("aImpact") as THREE.BufferAttribute).needsUpdate=true;
  }
  focus(id: string) { const at = this.graph.byId.get(id); if (at !== undefined) this.destination = new THREE.Vector3(...this.graph.nodes[at].position); }
  captureView() { return {position:this.camera.position.toArray(),target:this.controls.target.toArray()}; }
  restoreView(view: {position:number[];target:number[]}) { this.camera.position.fromArray(view.position);this.controls.target.fromArray(view.target);this.controls.update(); }
  home() { this.destination = null; this.controls.target.set(0,0,0); this.camera.position.set(0,-100,Math.max(660,370/(this.camera.aspect*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))))); this.controls.update(); }
  zoom(factor: number) { this.camera.position.sub(this.controls.target).multiplyScalar(factor).add(this.controls.target); this.controls.update(); }
  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    const ratio = Math.min(window.devicePixelRatio || 1, this.options.quality === "high" ? 2 : this.options.quality === "eco" ? 1 : 1.4);
    this.width=w;this.height=h;
    this.renderer.setPixelRatio(ratio); this.uniforms.uDpr.value = ratio; this.renderer.setSize(w,h); this.camera.aspect = w/h; this.camera.updateProjectionMatrix();
    const narrow=w/h<.85;if(this.narrow!==narrow){this.narrow=narrow;this.home();}
  }
  private pick(x: number, y: number): string | null {
    const rect = this.host.getBoundingClientRect(); let nearest: string | null = null, distance = 16;
    this.graph.nodes.forEach((n,i) => { if (!this.visibleNodes[i]) return; this.pointer.set(...n.position).project(this.camera); if (this.pointer.z > 1 || this.pointer.z < -1) return;
      const d = Math.hypot((this.pointer.x*.5+.5)*rect.width+rect.left-x,(-this.pointer.y*.5+.5)*rect.height+rect.top-y);
      if (d < distance) { distance = d; nearest = n.id; }
    }); return nearest;
  }
  private pointerDown = (e: PointerEvent) => { this.dragStart = { x:e.clientX, y:e.clientY }; };
  private pointerUp = (e: PointerEvent) => { if (Math.hypot(e.clientX-this.dragStart.x,e.clientY-this.dragStart.y) < 5) { const id=this.pick(e.clientX,e.clientY); if(id)this.onSelect(id); } };
  private pointerMove = (e: PointerEvent) => { if (e.buttons) return; const id=this.pick(e.clientX,e.clientY); this.host.style.cursor=id?"pointer":"grab"; this.onHover(id); };
  private pointerLeave = () => this.onHover(null);
  private contextLost = (event: Event) => { event.preventDefault(); this.lost=true; cancelAnimationFrame(this.frame); this.host.dataset.state="lost"; this.onFailure("그래픽 연결이 중단되었습니다. 노드 목록과 관측 로그는 계속 사용할 수 있습니다."); };
  private visibility = () => { cancelAnimationFrame(this.frame); this.last=0; this.schedule=0; this.frameCount=0; this.lastReport=0;
    if(document.hidden&&this.topologyReady)for(const geo of [this.lineGeometry,this.packetGeometry]){const start=geo.getAttribute("aStart") as THREE.BufferAttribute;(start.array as Float32Array).fill(-100);start.needsUpdate=true;}
    if(!document.hidden&&!this.disposed&&!this.lost)this.frame=requestAnimationFrame(this.animate); };
  private animate = (now: number) => {
    if (this.disposed || this.lost || document.hidden) return;
    this.frame=requestAnimationFrame(this.animate);
    const budget=this.options.quality==="eco"?1000/30:1000/60;
    // Carry the fractional deadline: slightly early RAF callbacks must not
    // turn a 60Hz stream into alternating 16/33ms frames.
    const since=now-this.schedule;
    if(this.schedule && since<budget-.75)return;
    this.schedule=now-(Math.max(0,since)%budget);
    const dt=this.last?Math.min(.1,(now-this.last)/1000):0; this.last=now;
    if(this.options.motion&&!this.options.paused) {this.elapsed+=dt;this.core.rotation.y+=dt*.16;this.core.rotation.z+=dt*.09;this.celestialFrame.rotation.z+=dt*.008;this.coreEnergy*=Math.exp(-dt*1.5);this.core.scale.setScalar(1+Math.sin(this.elapsed*1.3)*.025+this.coreEnergy*.13);}
    this.uniforms.uTime.value=this.elapsed;
    if(this.destination){const delta=this.destination.clone().sub(this.controls.target).multiplyScalar(.07);this.controls.target.add(delta);this.camera.position.add(delta);if(delta.length()<.01)this.destination=null;}
    this.controls.autoRotate=this.options.autoRotate&&this.options.motion&&!this.options.paused&&now>this.rotationHoldUntil;
    this.controls.update(dt); this.selectRing.quaternion.copy(this.camera.quaternion);
    this.host.dataset.rotating=String(this.controls.autoRotate);
    const w=this.width,h=this.height;
    for(const {element,index} of this.labels){this.pointer.set(...this.graph.nodes[index].position).project(this.camera);const x=(this.pointer.x*.5+.5)*w,y=(-this.pointer.y*.5+.5)*h;
      element.style.visibility=this.pointer.z>1||x<0||x>w||y<0||y>h?"hidden":"visible";
      element.style.transform=`translate(${x.toFixed(1)}px,${(y+19).toFixed(1)}px) translateX(-50%)`;
    }
    this.renderer.render(this.scene,this.camera);this.frameCount++;this.drawn++;
    if(!this.lastReport)this.lastReport=now;
    if(now-this.lastReport>1500){this.onStats(Math.round(this.frameCount*1000/(now-this.lastReport)),this.renderer.info.render.calls);this.frameCount=0;this.lastReport=now;this.host.dataset.frames=String(this.drawn);}
  };
  dispose() {
    this.disposed=true;this.worker.terminate();[this.lineGeometry,this.nodeGeometry,this.packetGeometry].forEach(g=>g.dispose());cancelAnimationFrame(this.frame);this.observer.disconnect();document.removeEventListener("visibilitychange",this.visibility);
    const canvas=this.renderer.domElement;canvas.removeEventListener("pointerdown",this.pointerDown);canvas.removeEventListener("pointerup",this.pointerUp);canvas.removeEventListener("pointermove",this.pointerMove);canvas.removeEventListener("pointerleave",this.pointerLeave);canvas.removeEventListener("webglcontextlost",this.contextLost);
    this.controls.removeEventListener("start",this.cancelFocus);this.controls.dispose();this.geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.renderer.dispose();canvas.remove();this.labels.forEach(l=>l.element.remove());
  }
}
