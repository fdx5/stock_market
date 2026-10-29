import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Avatar } from "../player/avatar";
import { Crowd, type NearbyPerson } from "./crowd";
import { findPath, planFloor, type BuildingPlan, type FloorPlan, type Mat } from "./plan";
import { dialogFor } from "./npcDialog";

/* Inside a building that is not a block of flats (an office, a hospital, a store…): its floors from
 * the register (plan.ts), one built and drawn at a time, rendered live — floors in their finish by
 * use (stone in a lobby, carpet in offices, vinyl in a hospital, epoxy in a car park), a ceiling of
 * LED panels, the glazed outer wall with the city outside seen from the floor's own height; the
 * lift bank (the register's lifts) whose doors open and take you to the floor you choose, stairs
 * up and down, escalators between a store's floors that carry you; and the floor's people (crowd.ts).
 * Walk with WASD, look with the mouse, E for the lifts, the stairs and the door out. */

export interface BuildingHud {
  building: string; floor: string; uses: string; people: number; prompt: string | null; riding: boolean; view: "first" | "third";
  source: string; loading: boolean;lifts:number;notice:string;coverage:"layout"|"boundary"|"reconstructed";
}
export interface BuildingTalk { name: string; text: string; destinations: { label: string; x: number; z: number }[]; directory: { label: string; uses: string }[]; questions?: string[] }
export interface BuildingOptions {
  plan: BuildingPlan; seed: number; hour: number;
  onHud?(h: BuildingHud): void;
  /** the lift's panel: open with the floors to choose from (null closes it) */
  onLiftPanel?(p: { levels: { level: number; label: string; uses: string }[]; current: number } | null): void;
  onProgress?(k: number, text: string): void;
  onExit?(): void;
  loadFloor?(level: number): Promise<FloorPlan | null>;
  onTalk?(talk: BuildingTalk | null): void;
}

const EYE = 1.6, RADIUS = 0.28;
/** a floor's tiles: built within REACH of the visitor, let go beyond it */
const TILE = 32, REACH = 64;
interface Tile { cx: number; cz: number; boxes: FloorPlan["boxes"]; segs: FloorPlan["segs"]; spots: FloorPlan["spots"]; decor: FloorPlan["decor"]; panels: [number, number][]; group: THREE.Group | null; tex: THREE.Texture[]; mats: THREE.Material[] }
const TEX = "/3d/walk/tex/";

export class BuildingInterior {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(68, 1, 0.05, 900);
  private avatar = new Avatar(7);
  private floorGroup = new THREE.Group();
  private crowd: Crowd | null = null;
  private plan!: FloorPlan;
  level = 1;
  private pos = new THREE.Vector2(); private vel = new THREE.Vector2(); yaw = Math.PI; pitch = -0.05;
  private keys = new Set<string>(); private stick = new THREE.Vector2(); private runStick = false;
  view: "first" | "third" = "third";
  private running = false; private disposed = false; private raf = 0; private last = 0;
  private solids: { x0: number; z0: number; x1: number; z1: number }[] = [];
  /** the outline's walls, for walking into */
  private walls: [number, number, number, number][] = [];
  private mats = new Map<Mat, THREE.Material>();
  private textures: THREE.Texture[] = [];
  private owned: { dispose(): void }[] = [];
  private liftDoors: { leaves: THREE.Mesh[]; x: number; z: number; open: number; want: number;half:number }[] = [];
  private escal: { mesh: THREE.Mesh; steps: THREE.InstancedMesh; x: number; z0: number; z1: number; up: boolean; w: number; offset: number; H: number }[] = [];
  private riding: { esc: BuildingInterior["escal"][number]; t: number } | null = null;
  private fade = 0; private pending: (() => void) | null = null;
  private hud: BuildingHud | null = null;
  private loadingFloor = false; private talking = false; private nextHud = 0;
  private panelOpen=false;
  private notice="";
  /** the visitor's errand on this floor: a place to find (no route shown), timed, for points */
  private mission:{label:string;x:number;z:number;start:number}|null=null;private score=0;private missionHud=0;
  private newMission(){
    if(this.disposed)return;
    const doors=(this.plan.points??[]).filter(p=>p.kind==="room").map(p=>({label:p.label,x:p.x,z:p.z}));
    const zones=this.plan.zones.filter(z=>z.label&&z.kind!=="lobby"&&z.label.length>1&&!/공실|창고|설비/.test(z.label)).map(z=>({label:z.label,x:(z.rect[0]+z.rect[2])/2,z:(z.rect[1]+z.rect[3])/2}));
    const all=[...doors,...zones].filter(c=>{const d=Math.hypot(c.x-this.pos.x,c.z-this.pos.y);return d>12&&d<90;});
    if(!all.length){this.mission=null;return;}
    const c=all[Math.floor(Math.random()*all.length)];this.mission={...c,start:performance.now()};this.missionHud=0;
  }
  private tickMission(){
    const m=this.mission;if(!m||this.ticket||this.talking||this.route.length)return;
    const now=performance.now(),sec=Math.floor((now-m.start)/1000),d=Math.hypot(m.x-this.pos.x,m.z-this.pos.y);
    if(d<2.4){
      const pts=Math.max(50,300-sec*2);this.score+=pts;
      let best="";try{const key=`walk-mission:${this.o.plan.info.name??""}`,prev=Number(localStorage.getItem(key)||0);if(this.score>prev){localStorage.setItem(key,String(this.score));best=" · 이 건물 최고 기록";}}catch{/* storage unavailable */}
      this.notice=`미션 완료! ${m.label} 도착 · ${sec}초 · +${pts}점 (총 ${this.score}점${best})`;this.chime();this.emitHud(true);
      this.mission=null;setTimeout(()=>this.newMission(),5000);return;
    }
    if(now<this.missionHud)return;this.missionHud=now+1000;
    const hint=d>40?"멀리":d>15?"가까이":"바로 근처";
    this.notice=`미션: '${m.label}' 찾아가기 · ${this.where(m.x,m.z)} (${hint}) · ${sec}초 · 총 ${this.score}점 — 막히면 직원에게 물어보세요`;this.emitHud(true);
  }
  /** the visitor's queue ticket: its number, when it is called, the window it is called to */
  private ticket:{no:number;due:number;called:boolean;window:[number,number,number]|null;windows:[number,number,number][]}|null=null;
  private pointAt(){return this.plan.points?.find(p=>Math.hypot(this.pos.x-p.x,this.pos.y-p.z)<(p.kind==="ticket"?1.4:1.2))??null;}
  private chime(){try{const a=new AudioContext(),t=a.currentTime;[[659,0],[523,0.45]].forEach(([f,d])=>{const o=a.createOscillator(),g=a.createGain();o.frequency.value=f;g.gain.setValueAtTime(0.0001,t+d);g.gain.exponentialRampToValueAtTime(0.18,t+d+0.03);g.gain.exponentialRampToValueAtTime(0.0001,t+d+0.9);o.connect(g).connect(a.destination);o.start(t+d);o.stop(t+d+1);});setTimeout(()=>void a.close(),2000);}catch{/* no audio */}}
  private tickTicket(){
    const tk=this.ticket;if(!tk)return;const now=performance.now();
    if(!tk.called&&now>tk.due){
      tk.called=true;const w=tk.windows[Math.floor(Math.random()*tk.windows.length)];tk.window=w;this.chime();
      if(w){this.guideTo(w[0],w[1]);this.notice=`딩동 — ${tk.no}번 고객님, ${w[2]}번 창구로 오세요. 청록색 경로를 따라가세요.`;}else this.notice=`딩동 — ${tk.no}번 고객님, 창구로 오세요.`;
      this.emitHud(true);
    } else if(tk.called&&tk.window&&Math.hypot(this.pos.x-tk.window[0],this.pos.y-tk.window[1])<1.6){
      // (at the window: registered; on to a consulting room's door)
      const doors=(this.plan.points??[]).filter(p=>p.kind==="room"&&p.label.includes("진료실"));
      const d=doors.sort((a,b)=>Math.hypot(a.x-this.pos.x,a.z-this.pos.y)-Math.hypot(b.x-this.pos.x,b.z-this.pos.y))[Math.min(doors.length-1,2)];
      this.ticket=null;
      this.score+=150;
      if(d){this.guideTo(d.x,d.z);this.notice=`접수 완료 +150점 (총 ${this.score}점) — ${d.label} 앞 대기석으로 안내합니다.`;}else this.notice=`접수가 완료되었습니다. +150점 (총 ${this.score}점)`;
      this.emitHud(true);
    }
  }
  private route: [number,number][] = []; private routeMesh: THREE.Line | null = null;
  get mapState() { return { plan:this.plan,pos:this.pos,yaw:this.yaw,route:this.route }; }
  private skyline: THREE.Mesh | null = null; private ground: THREE.Mesh | null = null;
  private hemi = new THREE.HemisphereLight("#f4f6ff", "#8a8578", 0.7);
  private sun = new THREE.DirectionalLight("#fff2dc", 1.4);
  private bob = 0; private shownPos = new THREE.Vector3(); private shownInit = false;

  constructor(readonly renderer: THREE.WebGLRenderer, private o: BuildingOptions) {
    this.scene.add(this.floorGroup, this.avatar.root, this.hemi, this.sun);
    this.avatar.shoes(true);
  }

  // ------------------------------------------------------------------ materials
  private tex(name: string, rep: number, srgb = true) {
    const t = new THREE.TextureLoader().load(`${TEX}${name}.webp`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(t); return t;
  }
  private makeMaterials() {
    const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
    const tiled = (set: string, color: string, rough: number) => std({ map: this.tex(`${set}_diff`, 1), normalMap: this.tex(`${set}_nor`, 1, false), color, roughness: rough });
    const M: [Mat, THREE.Material][] = [
      ["floor", tiled("large_floor_tiles_02", "#ffffff", 0.35)],
      ["tile", tiled("square_tiles_02", "#f2f2f0", 0.4)],
      ["carpet", tiled("poly_wool_herringbone", "#8a8f97", 0.95)],
      ["concrete", tiled("plastered_wall_02", "#9a9a98", 0.9)],
      ["wall", tiled("plastered_wall_02", "#ecebe7", 0.85)],
      ["glass", new THREE.MeshPhysicalMaterial({ color: "#cfe1e8", transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide })],
      ["desk", tiled("white_oak_veneer", "#f4efe6", 0.55)],
      ["wood", tiled("walnut_veneer", "#c9a27c", 0.5)],
      ["chair", std({ color: "#2b2e33", roughness: 0.6 })],
      ["fabric", tiled("rough_linen", "#5c6f86", 0.9)],
      ["metal", std({ color: "#b8bcc0", roughness: 0.3, metalness: 0.85 })],
      ["shelf", std({ color: "#e9e9e6", roughness: 0.5, metalness: 0.2 })],
      ["bed", std({ color: "#dfe7ee", roughness: 0.7 })],
      ["sheet", tiled("rough_linen", "#eef2f4", 0.85)],
      // (a counter's solid surface: off-white, satin — the marble tile texture read as gravel)
      ["counter", std({ color: "#eeece6", roughness: 0.32, metalness: 0.02 })],
      ["car", std({ color: "#5d6670", roughness: 0.35, metalness: 0.6 })],
      ["line", std({ color: "#f2d24a", roughness: 0.6 })],
      ["plant", std({ color: "#3f6b3a", roughness: 0.8 })],
      ["lift", std({ color: "#c9ced2", roughness: 0.22, metalness: 0.9 })],
      ["dark", std({ color: "#25282c", roughness: 0.5 })],
      ["screen", std({ color: "#101418", roughness: 0.2, emissive: new THREE.Color("#3a5a7a"), emissiveIntensity: 0.35 })],
      ["white", std({ color: "#f3f3f1", roughness: 0.5 })],
      // (interiors: a department's accent band, the corridors' wood wainscot, waiting seats' vinyl)
      ["accent", std({ color: "#2e8c9a", roughness: 0.45 })],
      ["wainscot", tiled("white_oak_veneer", "#d8c3a5", 0.5)],
      ["cushion", std({ color: "#3d6f9f", roughness: 0.55 })],
      ["water", new THREE.MeshPhysicalMaterial({ color: "#2f86b8", transparent: true, opacity: 0.55, roughness: 0.05, emissive: new THREE.Color("#0d4f78"), emissiveIntensity: 0.6, depthWrite: false })],
    ];
    for (const [k, m] of M) { this.mats.set(k, m); this.owned.push(m); }
  }

  async load() {
    this.o.onProgress?.(0.1, "건물 정보를 읽는 중");
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.shadowMap.enabled = false;
    const pm = new THREE.PMREMGenerator(this.renderer), roomEnvironment=new RoomEnvironment(),env = pm.fromScene(roomEnvironment, 0.04);roomEnvironment.dispose();
    this.scene.environment = env.texture; this.scene.environmentIntensity = 0.55; this.owned.push(env, pm);
    this.makeMaterials();
    this.sky();
    this.o.onProgress?.(0.5, "층을 짓는 중");
    await this.prepareFloor(1); if(this.disposed) return;
    this.goTo(1, null);
    // the street door: start just inside it, facing in
    const door = this.plan.door;
    // (past the vestibule's inner doors, facing in)
    this.safeSpawn(this.plan.spawn ?? [door ? door.x : this.o.plan.W / 2, (door?.z ?? 0) + 4.2]);
    this.o.onProgress?.(0.85, "셰이더를 준비하는 중");
    await this.renderer.compileAsync(this.scene, this.camera);
    this.o.onProgress?.(1, "입장합니다");
    setTimeout(()=>this.newMission(),4000);
  }

  // the city outside: a far ring painted with a skyline and a ground plane, at the floor's height below
  private sky() {
    const night = this.o.hour < 6 || this.o.hour >= 19;
    this.scene.background = new THREE.Color(night ? "#0d1420" : "#a9c6de");
    const c = document.createElement("canvas"); c.width = 2048; c.height = 512; const g = c.getContext("2d")!;
    const sky = g.createLinearGradient(0, 0, 0, 512); sky.addColorStop(0, night ? "#0d1420" : "#9cc0dc"); sky.addColorStop(1, night ? "#1c2533" : "#dfe9ef");
    g.fillStyle = sky; g.fillRect(0, 0, 2048, 512);
    let s = 7; const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let layer = 0; layer < 3; layer++) {
      let x = 0;
      while (x < 2048) {
        const w = 20 + R() * 60, h = 60 + R() * (220 - layer * 40), y = 512 - 40 - h + layer * 25;
        const v = night ? 18 + layer * 6 : 150 - layer * 25 + R() * 20;
        g.fillStyle = `rgb(${v * 0.9},${v * 0.95},${v})`; g.fillRect(x, y, w, 512 - y);
        for (let wy = y + 6; wy < 500; wy += 9) for (let wx = x + 4; wx < x + w - 4; wx += 7) if (R() < (night ? 0.35 : 0.5)) { g.fillStyle = night ? "rgba(255,214,140,0.85)" : "rgba(80,95,110,0.55)"; g.fillRect(wx, wy, 3, 4); }
        x += w + 2;
      }
    }
    g.fillStyle = night ? "#10151c" : "#5d6a63"; g.fillRect(0, 472, 2048, 40);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.x = 2; this.textures.push(t);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(420, 420, 260, 64, 1, true), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false }));
    this.skyline = cyl; this.scene.add(cyl); this.owned.push(cyl.geometry, cyl.material as THREE.Material);
    const gr = new THREE.Mesh(new THREE.CircleGeometry(430, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: night ? "#151a20" : "#6f7a72" }));
    this.ground = gr; this.scene.add(gr); this.owned.push(gr.geometry, gr.material as THREE.Material);
    this.sun.position.set(-30, 60, -20); this.sun.intensity = night ? 0.15 : 1.4; this.hemi.intensity = night ? 0.45 : 0.75;
  }

  // ------------------------------------------------------------------ a floor
  private async prepareFloor(level: number) {
    if(this.o.plan.floors.get(level) || !this.o.loadFloor) return;
    const fp=await this.o.loadFloor(level);
    if(fp && !this.disposed) this.o.plan.floors.set(level,fp);
  }
  private safeSpawn(target: [number,number]) {
    const g=this.plan.grid; let best=Infinity, at=target;
    for(let j=0;j<g.nz;j++) for(let i=0;i<g.nx;i++) if(g.free[j*g.nx+i]) {const x=(i+.5)*g.cell,z=(j+.5)*g.cell,d=Math.hypot(x-target[0],z-target[1]);if(d<best){best=d;at=[x,z];}}
    this.pos.set(...at); this.vel.set(0,0); this.updateTiles(true);
    // Face the clearest direction, so entry never starts by walking straight into a core wall.
    let longest=-1;
    for(let k=0;k<16;k++){const yaw=k*Math.PI/8;let distance=0;for(let d=.4;d<6;d+=.4){const x=at[0]-Math.sin(yaw)*d,z=at[1]-Math.cos(yaw)*d,i=Math.floor(x/g.cell),j=Math.floor(z/g.cell);if(i<0||j<0||i>=g.nx||j>=g.nz||!g.free[j*g.nx+i])break;distance=d;}if(distance>longest){longest=distance;this.yaw=yaw;}}
    this.shownInit=false;
  }
  private async travel(level: number, place: {x:number;z:number;yaw:number}|null) {
    if(this.loadingFloor || this.disposed || !this.o.plan.levels.includes(level)) return;
    this.loadingFloor=true;this.keys.clear();this.closeTalk();this.emitHud(true);
    try {await this.prepareFloor(level);if(this.disposed)return;this.goTo(level,place);this.safeSpawn(this.plan.spawn??[this.pos.x,this.pos.y]);
      this.newMission();
      // (the new floor's materials compiled before it is walked: no stall on its first frames)
      await this.renderer.compileAsync(this.scene,this.camera).catch(()=>undefined);}
    finally {this.loadingFloor=false;if(!this.disposed)this.emitHud(true);}
  }
  private goTo(level: number, place: { x: number; z: number; yaw: number } | null) {
    // (the floor laid out the first time it is visited)
    const b = this.o.plan;
    let fp = b.floors.get(level);
    if (!fp) { fp = planFloor(b, level, this.o.seed); b.floors.set(level, fp); }
    this.plan = fp; this.level = level;this.notice="";
    const entry=fp.spawn??[fp.door?.x??b.W/2,(fp.door?.z??0)+4.2];
    if(!fp.spots.some(s=>s.kind==="clerk"&&Math.hypot(s.x-entry[0],s.z-entry[1])<8)){
      const g=fp.grid;let best=Infinity,at:[number,number]|null=null;
      for(let j=0;j<g.nz;j++)for(let i=0;i<g.nx;i++)if(g.free[j*g.nx+i]){const x=(i+.5)*g.cell,z=(j+.5)*g.cell,d=Math.hypot(x-entry[0],z-entry[1]);if(d>1.6&&d<7){const score=Math.hypot(x-entry[0]-2,z-entry[1]-1);if(score<best){best=score;at=[x,z];}}}
      if(at)fp.spots.unshift({x:at[0],z:at[1],y:0,yaw:Math.PI,kind:"clerk",zone:-1});
    }
    this.clearFloor();
    this.buildFloor(fp);
    this.crowd = new Crowd(fp, this.o.seed * 31 + level);
    this.floorGroup.add(this.crowd.group);
    // the city at this height: the floor ~ (level − 1) × 3.8 m above the street
    const above = Math.max(-4, (level - 1) * 3.8 + (level < 0 ? -3 : 0));
    this.skyline!.position.set(b.W / 2, 130 - above - 38, b.D / 2); this.ground!.position.set(b.W / 2, -above - 0.3, b.D / 2);
    const under = level < 0;
    this.skyline!.visible = this.ground!.visible = !under;
    this.scene.background = new THREE.Color(under ? "#202326" : this.o.hour < 6 || this.o.hour >= 19 ? "#0d1420" : "#a9c6de");
    if (place) { this.pos.set(place.x, place.z); this.yaw = place.yaw; }
    this.shownInit = false;
    this.emitHud(true);
  }
  private clearFloor() {
    this.route=[];this.routeMesh=null;
    this.crowd?.dispose(); this.crowd = null;
    for (const c of [...this.floorGroup.children]) { this.floorGroup.remove(c);c.traverse(o=>{const m=o as THREE.Mesh;if(m.geometry)m.geometry.dispose();}); }
    this.liftDoors = []; this.escal = []; this.solids = []; this.walls = [];
    for (const t of this.tiles.values()) { t.tex.forEach(x => x.dispose()); t.mats.forEach(x => x.dispose()); t.tex = []; t.mats = []; t.group = null; }
    this.tiles = new Map();
    this.floorTex.forEach(t => t.dispose()); this.floorMats.forEach(m => m.dispose()); this.floorTex = []; this.floorMats = [];
  }
  private buildFloor(fp: FloorPlan) {
    const { W, D } = this.o.plan, H = fp.height;
    // What does not move with the visitor is made once: the collisions of the whole floor, its floor
    // and ceiling, its lifts, its long outer walls. The rest (walls, furniture, chairs, signs, ceiling
    // lights) is kept in 32 m tiles, built round the visitor as they walk and let go behind them:
    // a 300 m mall is never built, or held in memory, at once.
    const byMat = new Map<Mat, THREE.BufferGeometry[]>();
    const push = (m: Mat, g: THREE.BufferGeometry) => { const l = byMat.get(m); if (l) l.push(g); else byMat.set(m, [g]); };
    for (const q of fp.boxes) if (q.solid && q.y0 < 1.5 && q.y1 > 0.3) this.solids.push({ x0: q.x0, z0: q.z0, x1: q.x1, z1: q.z1 });
    for (const s of fp.segs) if (s.solid && s.y0 < 1.5 && s.y1 > 0.3) this.walls.push([s.ax, s.az, s.bx, s.bz]);
    this.tiles = new Map();
    const tile = (x: number, z: number) => {
      const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE), k = tx * 100003 + tz;
      let t = this.tiles.get(k);
      if (!t) { t = { cx: (tx + 0.5) * TILE, cz: (tz + 0.5) * TILE, boxes: [], segs: [], spots: [], decor: [], panels: [], group: null, tex: [], mats: [] }; this.tiles.set(k, t); }
      return t;
    };
    for (const q of fp.boxes) tile((q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2).boxes.push(q);
    const longSegs: FloorPlan["segs"] = [];
    for (const s of fp.segs) { if (Math.hypot(s.bx - s.ax, s.bz - s.az) > TILE * 0.75) longSegs.push(s); else tile((s.ax + s.bx) / 2, (s.az + s.bz) / 2).segs.push(s); }
    for (const sp of fp.spots) if (sp.y >= .3 && ["desk", "clerk", "class", "table", "seat"].includes(sp.kind)) tile(sp.x, sp.z).spots.push(sp);
    for (const d of fp.decor) tile(d.x, d.z).decor.push(d);
    this.segGeos(longSegs, push);
    // the floor: the outline's shape (each zone in its finish within it); the ceiling the same
    const floorOf: Record<string, Mat> = { office: "carpet", lobby: "floor", clinic: "floor", ward: "floor", retail: "floor", food: "wood", class: "tile", gym: "dark", hotel: "carpet", parking: "concrete", rooms: "wood", plant: "concrete" };
    const polygons = fp.polygons ?? [[this.o.plan.poly ?? [[0,0],[W,0],[W,D],[0,D]]]] as [number,number][][][];
    const poly = polygons[0][0];
    const shapeGeo = (pts: [number, number][], y: number, up: boolean, su: number, holes: [number,number][][]=[]) => {
      const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
      sh.holes=holes.map(r=>new THREE.Path(r.map(([x,z])=>new THREE.Vector2(x,z))));
      const g = new THREE.ShapeGeometry(sh); g.rotateX(Math.PI / 2); g.translate(0, y, 0);
      if (up) { const idx = g.getIndex()!; for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, a); } g.computeVertexNormals(); }
      const pos = g.getAttribute("position") as THREE.BufferAttribute, uv = g.getAttribute("uv") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / su, pos.getZ(i) / su);
      return g;
    };
    for(const p of polygons) push(fp.kinds[0] === "parking" ? "concrete" : "floor", shapeGeo(p[0], 0, true, 2,p.slice(1)));
    for (const z of fp.zones) {
      const [x0, z0, x1, z1] = z.rect, part = z.polygon?.[0] ?? clip(poly, x0, z0, x1, z1);
      if (part.length >= 3) push(floorOf[z.kind] ?? "floor", shapeGeo(part, 0.004, true, 2,z.polygon?.slice(1)));
    }
    // the ceiling: the outline's shape, its LED panels on a 2.4 m grid inside it (one emissive material)
    for(const p of polygons) push(fp.kinds[0] === "parking" ? "concrete" : "white", shapeGeo(p[0], H, false, 3,p.slice(1)));
    for (let x = 1.2; x < W - 1; x += 2.4) for (let z = 1.2; z < D - 1; z += 2.4) if (polygons.some(p=>inside(x,z,p[0])&&!p.slice(1).some(h=>inside(x,z,h)))) tile(x, z).panels.push([x, z]);
    this.panelMat = new THREE.MeshBasicMaterial({ color: fp.kinds[0] === "parking" ? "#e6f0ff" : "#fffdf6" }); this.floorMats.push(this.panelMat);
    this.tileH = H; this.tileParking = fp.kinds[0] === "parking";
    this.flush(byMat, this.floorGroup);
    // the floor's light: a few broad lights under the ceiling (no shadows: the panels light it evenly)
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight("#fff6ea", fp.kinds[0] === "parking" ? 18 : 26, 30, 1.6); l.position.set(W * (0.2 + 0.2 * i), H - 0.4, D / 2); this.floorGroup.add(l); }
    // the lift doors: two leaves each, sliding apart
    const doorM = this.mats.get("lift")!;
    for (const l of fp.lifts) {
      const root=new THREE.Group();root.position.set(l.x,0,l.z);root.rotation.y=Math.atan2(l.nx??0,l.nz??-1);this.floorGroup.add(root);
      const leaves: THREE.Mesh[] = [];
      for (const side of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(l.w / 2, 2.25, 0.05), doorM); m.position.set(side * l.w / 4, 1.125, .02);root.add(m); leaves.push(m); }
      const frames=[new THREE.BoxGeometry(.14,2.55,.2).translate(-l.w/2-.07,1.275,0),new THREE.BoxGeometry(.14,2.55,.2).translate(l.w/2+.07,1.275,0),new THREE.BoxGeometry(l.w+.28,.15,.2).translate(0,2.55,0)];
      const frame=mergeGeometries(frames,false);frames.forEach(g=>g.dispose());if(frame)root.add(new THREE.Mesh(frame,this.mats.get("metal")!));
      const call=new THREE.Mesh(new THREE.BoxGeometry(.18,.4,.07),this.mats.get("screen")!);call.position.set(l.w/2+.3,1.25,.1);root.add(call);
      // (the car beyond: a lit box)
      const car = new THREE.Mesh(new THREE.BoxGeometry(l.w, 2.4, 1.8), new THREE.MeshStandardMaterial({ color: "#d9dcdd", roughness: 0.3, metalness: 0.6, side: THREE.BackSide }));
      car.position.set(0, 1.2, -1.0);root.add(car);this.floorMats.push(car.material as THREE.Material);
      this.liftDoors.push({ leaves, x: l.x, z: l.z, open: 0, want: 0,half:l.w/4 });
      const nx=l.nx??0,nz=l.nz??-1;this.walls.push([l.x-nz*l.w/2,l.z+nx*l.w/2,l.x+nz*l.w/2,l.z-nx*l.w/2]);
    }
    // escalators: a sloped body, moving steps, glass balustrades
    for (const e of fp.escalators) {
      const len = Math.abs(e.z1 - e.z0), dir = Math.sign(e.z1 - e.z0), rise = H;
      const body = new THREE.Mesh(new THREE.BoxGeometry(e.w + 0.3, 0.6, Math.hypot(len, rise)), this.mats.get("metal")!);
      const ang = Math.atan2(rise, len) * (e.up ? 1 : -1) * dir;
      body.position.set(e.x + e.w / 2, (e.up ? rise / 2 : rise / 2) - 0.35, (e.z0 + e.z1) / 2); body.rotation.x = -Math.atan2(rise, len) * dir * (e.up ? 1 : -1);
      void ang; this.floorGroup.add(body);
      const n = Math.ceil(Math.hypot(len, rise) / 0.4);
      const steps = new THREE.InstancedMesh(new THREE.BoxGeometry(e.w, 0.04, 0.38), this.mats.get("dark")!, n + 2); steps.frustumCulled = false;
      this.floorGroup.add(steps);
      for (const sx of [e.x - 0.05, e.x + e.w + 0.05]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, Math.hypot(len, rise)), this.mats.get("glass")!); rail.position.copy(body.position).setX(sx); rail.position.y += 0.75; rail.rotation.x = body.rotation.x; this.floorGroup.add(rail); }
      this.escal.push({ mesh: body, steps, x: e.x, z0: e.z0, z1: e.z1, up: e.up, w: e.w, offset: 0, H: rise });
    }
    // (what the floor shows, its signs, comes with its tiles)
    this.renderer.setClearColor(this.scene.background as THREE.Color);
  }

  private tiles = new Map<number, Tile>(); private tileH = 3; private tileParking = false; private panelMat: THREE.Material | null = null;
  private flush(byMat: Map<Mat, THREE.BufferGeometry[]>, into: THREE.Object3D) {
    for (const [m, list] of byMat) {
      // (indexed boxes and the chairs' rounded parts are merged alike: mixed, all made non-indexed)
      const mixed = list.some(x => x.index) && list.some(x => !x.index), parts = mixed ? list.map(x => x.index ? x.toNonIndexed() : x) : list;
      const g = mergeGeometries(parts, false); list.forEach(x => x.dispose()); if (mixed) parts.forEach(x => x.dispose());
      if (!g) continue;
      const mesh = new THREE.Mesh(g, this.mats.get(m)!); mesh.matrixAutoUpdate = false;
      if (m === "glass") mesh.renderOrder = 2;
      into.add(mesh);
    }
  }
  private segGeos(segs: FloorPlan["segs"], push: (m: Mat, g: THREE.BufferGeometry) => void) {
    for (const s of segs) {
      const len = Math.hypot(s.bx - s.ax, s.bz - s.az), g = new THREE.BoxGeometry(len, s.y1 - s.y0, s.t);
      const uv = g.getAttribute("uv") as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 1.6, uv.getY(i) * (s.y1 - s.y0) / 1.6);
      g.rotateY(-Math.atan2(s.bz - s.az, s.bx - s.ax)).translate((s.ax + s.bx) / 2, (s.y0 + s.y1) / 2, (s.az + s.bz) / 2);
      push(s.m, g);
    }
  }
  /** one tile's walls, furniture, chairs, ceiling lights and signs */
  private buildTile(t: Tile) {
    const byMat = new Map<Mat, THREE.BufferGeometry[]>();
    const push = (m: Mat, g: THREE.BufferGeometry) => { const l = byMat.get(m); if (l) l.push(g); else byMat.set(m, [g]); };
    const furnishing=(m:Mat,x:number,y:number,z:number,w:number,h:number,d:number,yaw=0,r=.025)=>push(m,new RoundedBoxGeometry(w,h,d,1,Math.min(r,w/4,h/4,d/4)).rotateY(yaw).translate(x,y,z));
    for (const q of t.boxes) {
      const w = Math.max(0.01, q.x1 - q.x0), h = Math.max(0.005, q.y1 - q.y0), d = Math.max(0.01, q.z1 - q.z0);
      const g = new THREE.BoxGeometry(w, h, d);
      // (uv in metres: the box's faces scaled to their own size)
      const uv = g.getAttribute("uv") as THREE.BufferAttribute, nrm = g.getAttribute("normal") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) { const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)); const su = ax > 0.5 ? d : w, sv = ay > 0.5 ? d : h; uv.setXY(i, uv.getX(i) * su / 1.6, uv.getY(i) * sv / 1.6); }
      const seat=q.m==="fabric"&&q.y0===0&&h<=.5&&w<.8&&d<.9;
      const table=(q.m==="desk"||q.m==="wood")&&q.y0===0&&q.y1>=.65&&q.y1<=.95&&d<=2&&w>=.6;
      if(seat||table){
        g.scale(1,.07/h,1);g.translate((q.x0+q.x1)/2,q.y1-.035,(q.z0+q.z1)/2);
        for(const x of [q.x0+.07,q.x1-.07])for(const z of [q.z0+.07,q.z1-.07])furnishing("metal",x,(q.y1-.07)/2,z,.035,q.y1-.07,.035);
      }else g.translate((q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2, (q.z0 + q.z1) / 2);
      push(q.m, g);
    }
    // Occupied workstations need actual chairs, rather than an NPC sitting on an invisible spot.
    for(const s of t.spots){
      if(t.boxes.some(q=>(q.m==="fabric"||q.m==="chair")&&q.y0<.5&&s.x>=q.x0&&s.x<=q.x1&&s.z>=q.z0&&s.z<=q.z1))continue;
      const transform=(dx:number,dz:number):[number,number]=>[s.x+dx*Math.cos(s.yaw)+dz*Math.sin(s.yaw),s.z-dx*Math.sin(s.yaw)+dz*Math.cos(s.yaw)];
      const cm:Mat=s.kind==="seat"?"cushion":"fabric";
      furnishing(cm,s.x,s.y-.035,s.z,.48,.09,.46,s.yaw,.035);
      const [bx,bz]=transform(0,-.2);furnishing(cm,bx,s.y+.22,bz,.47,.44,.07,s.yaw,.035);
      for(const dx of [-.19,.19])for(const dz of [-.17,.17]){const [x,z]=transform(dx,dz);furnishing("metal",x,(s.y-.08)/2,z,.032,s.y-.08,.032,s.yaw);}
      for(const dx of [-.27,.27]){const [x,z]=transform(dx,0);furnishing("chair",x,s.y+.16,z,.045,.045,.38,s.yaw);}
    }
    this.segGeos(t.segs, push);
    const group = new THREE.Group();
    this.flush(byMat, group);
    if (t.panels.length && this.panelMat) {
      const panels = t.panels.map(([x, z]) => new THREE.PlaneGeometry(this.tileParking ? 1.2 : 0.6, this.tileParking ? 0.15 : 0.6).rotateX(Math.PI / 2).translate(x, this.tileH - 0.01, z));
      const pg = mergeGeometries(panels, false); panels.forEach(x => x.dispose());
      if (pg) group.add(new THREE.Mesh(pg, this.panelMat));
    }
    for (const d of t.decor) this.decorate(d, group, t);
    t.group = group; this.floorGroup.add(group);
  }
  private unloadTile(t: Tile) {
    if (!t.group) return;
    this.floorGroup.remove(t.group); t.group.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    t.tex.forEach(x => x.dispose()); t.mats.forEach(x => x.dispose()); t.tex = []; t.mats = []; t.group = null;
  }
  /** tiles within reach built (all at once on arrival, else one a frame, nearest first); far ones let go */
  private updateTiles(sync = false) {
    if (!this.tiles.size) return;
    const near = [...this.tiles.values()].map(t => ({ t, d: Math.hypot(t.cx - this.pos.x, t.cz - this.pos.y) })).sort((a, b) => a.d - b.d);
    let built = 0;
    for (const { t, d } of near) { if (d < REACH && !t.group) { if (!sync && built >= 1) break; this.buildTile(t); built++; } }
    for (const { t, d } of near) if (d > REACH + 28 && t.group) this.unloadTile(t);
  }
  private decorate(d: FloorPlan["decor"][number], into: THREE.Object3D = this.floorGroup, own: { tex: THREE.Texture[]; mats: THREE.Material[] } = { tex: this.floorTex, mats: this.floorMats }) {
    // (the canvas as fine as the sign is large: ~260 px a metre, 1024 at most a side)
    const ppm = 260, cw = Math.max(64, Math.min(1024, Math.round(d.w * ppm))), ch = Math.max(48, Math.min(1024, Math.round(d.h * ppm)));
    const c = document.createElement("canvas"); c.width = cw; c.height = ch;
    const g = c.getContext("2d")!, W = c.width, H = c.height, font = (wt: number, sz: number) => `${wt} ${sz}px Pretendard, 'Noto Sans KR', 'Malgun Gothic', sans-serif`;
    let emissive = 0.25;
    if (d.kind === "directory") {
      // the floors, top down: each its label and its uses (the register's)
      g.fillStyle = "#1d2733"; g.fillRect(0, 0, W, H); g.fillStyle = "#e9f1f8"; g.font = font(800, W * 0.09); g.fillText("층별 안내", W * 0.07, H * 0.07);
      const levels = [...this.o.plan.levels].reverse(), row = Math.min(H * 0.06, (H * 0.86) / levels.length);
      levels.forEach((l, i) => {
        const y = H * 0.12 + i * row; if (l === this.level) { g.fillStyle = "rgba(94,180,255,0.35)"; g.fillRect(0, y - row * 0.1, W, row); }
        g.fillStyle = "#ffd36b"; g.font = font(800, row * 0.62); g.fillText(this.labelOf(l), W * 0.05, y + row * 0.62);
        g.fillStyle = "#dfe7ee"; g.font = font(500, row * 0.5); g.fillText((this.usesOf(l) || "-").slice(0, 22), W * 0.32, y + row * 0.6);
      });
      emissive = 0.5;
    } else if (d.kind === "floor") {
      g.fillStyle = "#f4f4f2"; g.fillRect(0, 0, W, H); g.fillStyle = "#1d2733"; g.font = font(900, H * 0.5); g.textAlign = "center"; g.fillText(d.text ?? "", W / 2, H * 0.58);
      g.font = font(600, H * 0.15); g.fillText(this.usesOf(this.level).slice(0, 18), W / 2, H * 0.86);
    } else if (d.kind === "sign") {
      // (the lettering as large as the sign allows: measured, never cut off)
      g.fillStyle = "#1f4f7a"; g.fillRect(0, 0, W, H); g.fillStyle = "#ffffff"; g.textAlign = "center"; g.textBaseline = "middle";
      let sz = H * 0.62; g.font = font(800, sz); const tw = g.measureText(d.text ?? "").width; if (tw > W * 0.9) { sz *= W * 0.9 / tw; g.font = font(800, sz); }
      g.fillText(d.text ?? "", W / 2, H * 0.54);
      g.fillStyle = "rgba(255,255,255,0.25)"; g.fillRect(0, H - H * 0.06, W, H * 0.06);
      emissive = 0.6;
    } else if (d.kind === "tv") {
      const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, "#0e5a8a"); grd.addColorStop(1, "#0b2236"); g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.fillStyle = "#ffffff"; g.font = font(800, H * 0.13); g.fillText("진료 대기 현황", W * 0.06, H * 0.2);
      g.font = font(600, H * 0.1); for (let i = 0; i < 4; i++) g.fillText(`${["내과", "정형외과", "소아청소년과", "영상의학과"][i]}  대기 ${3 + ((i * 7 + this.level) % 9)}명`, W * 0.08, H * (0.42 + i * 0.15));
      emissive = 1.0;
    } else {
      g.fillStyle = "#ffffff"; g.beginPath(); g.arc(W / 2, H / 2, W * 0.46, 0, Math.PI * 2); g.fill(); g.strokeStyle = "#222"; g.lineWidth = W * 0.04; g.stroke();
      const t = new Date(), hr = (this.o.hour % 12) + t.getMinutes() / 60, mn = t.getMinutes();
      for (const [a, l] of [[hr / 12, 0.25], [mn / 60, 0.36]] as [number, number][]) { g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 + Math.sin(a * Math.PI * 2) * W * l, H / 2 - Math.cos(a * Math.PI * 2) * H * l); g.stroke(); }
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; own.tex.push(tex);
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color("#ffffff"), emissiveIntensity: emissive, roughness: 0.5 }); own.mats.push(m);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), m);
    mesh.position.set(d.x, d.y, d.z); mesh.rotation.y = d.yaw; into.add(mesh);
  }
  private floorTex: THREE.Texture[] = []; private floorMats: THREE.Material[] = [];

  // ------------------------------------------------------------------ moving about
  keyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.matches?.("input, textarea")) return;
    if (e.code === "KeyE" && !e.repeat) { this.interact(); return; }
    if (e.code === "KeyV" && !e.repeat) { this.toggleView(); return; }
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right))$/.test(e.code)) { e.preventDefault(); this.keys.add(e.code); }
  };
  keyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private blur = () => this.keys.clear();
  setStick(x: number, y: number, run: boolean) { this.stick.set(x, y); this.runStick = run; }
  look(dx: number, dy: number) { this.yaw -= dx; this.pitch = Math.max(-1.3, Math.min(1.2, this.pitch - dy)); }
  toggleView() { this.view = this.view === "first" ? "third" : "first"; if (this.view === "first") this.pitch = -0.04; this.emitHud(true); }

  private collide(x: number, z: number): THREE.Vector2 {
    const p = new THREE.Vector2(x, z), r = RADIUS;
    for (let it = 0; it < 3; it++) {
      let pushed = false;
      for (const b of this.solids) {
        if (p.x < b.x0 - r || p.x > b.x1 + r || p.y < b.z0 - r || p.y > b.z1 + r) continue;
        const cx = Math.max(b.x0, Math.min(b.x1, p.x)), cz = Math.max(b.z0, Math.min(b.z1, p.y)), dx = p.x - cx, dz = p.y - cz, d = Math.hypot(dx, dz);
        if (d < r) {
          if (d > 1e-5) { p.x = cx + dx / d * r; p.y = cz + dz / d * r; }
          else { const l = p.x - b.x0, rr = b.x1 - p.x, t = p.y - b.z0, bb = b.z1 - p.y, m = Math.min(l, rr, t, bb); if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r; else if (m === t) p.y = b.z0 - r; else p.y = b.z1 + r; }
          pushed = true;
        }
      }
      for (const [ax, az, bx, bz] of this.walls) {
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - az) * dz) / l2));
        const cx = ax + dx * t, cz = az + dz * t, ex = p.x - cx, ez = p.y - cz, d = Math.hypot(ex, ez);
        if (d < r + 0.1 && d > 1e-6) { p.x = cx + ex / d * (r + 0.1); p.y = cz + ez / d * (r + 0.1); pushed = true; }
      }
      if (!pushed) break;
    }
    const { W, D } = this.o.plan; p.x = Math.max(0.3, Math.min(W - 0.3, p.x)); p.y = Math.max(-1, Math.min(D - 0.3, p.y));
    return p;
  }
  private move(dt: number) {
    if(this.loadingFloor || this.talking||this.panelOpen) {this.vel.set(0,0);return;}
    if (this.riding) { this.ride(dt); return; }
    const k = this.keys;
    let fx = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) + this.stick.x;
    let fz = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) + this.stick.y;
    const l = Math.hypot(fx, fz); if (l > 1) { fx /= l; fz /= l; }
    const run = k.has("ShiftLeft") || k.has("ShiftRight") || this.runStick, speed = run ? 3.4 : 1.45;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = (fx * cy - fz * sy) * speed, wz = (-fx * sy - fz * cy) * speed, a = 1 - Math.exp(-dt * 9);
    this.vel.x += (wx - this.vel.x) * a; this.vel.y += (wz - this.vel.y) * a;
    const p = this.collide(this.pos.x + this.vel.x * dt, this.pos.y + this.vel.y * dt);
    const moved = p.distanceTo(this.pos); this.pos.copy(p); this.bob += moved * 4.4;
    this.avatar.update(dt, moved / Math.max(1e-4, dt));
    // stepping onto an escalator's foot: carried
    for (const e of this.escal) {
      const foot = e.z0, inX = this.pos.x > e.x && this.pos.x < e.x + e.w, dir = Math.sign(e.z1 - e.z0);
      if (inX && Math.abs(this.pos.y - (foot - dir * 0.4)) < 0.45 && (this.vel.x * 0 + this.vel.y * dir) > 0.2) { this.riding = { esc: e, t: 0 }; this.emitHud(true); break; }
    }
  }
  private ride(dt: number) {
    const r = this.riding!, e = r.esc, len = Math.abs(e.z1 - e.z0), dir = Math.sign(e.z1 - e.z0);
    r.t = Math.min(1, r.t + dt * 0.55 / Math.hypot(len, e.H) * 1.8);
    this.pos.set(e.x + e.w / 2, e.z0 + dir * len * r.t);
    this.avatar.update(dt, 0);
    if (r.t >= 1) {
      const to = this.level + (e.up ? 1 : -1) === 0 ? (e.up ? 1 : -1) : this.level + (e.up ? 1 : -1);
      this.riding = null;
      // off at the top (or the bottom) of the floor reached: by the matching escalator's other end
      this.fadeTo(() => { const x = this.pos.x, z = e.z1 + dir * 1.2; void this.travel(to, { x, z, yaw: dir > 0 ? Math.PI : 0 }); });
    }
  }
  private fadeTo(fn: () => void) { this.pending = fn; this.fade = 0.0001; }

  /** E: the lift (its panel), the stairs (up a floor, or down when there is none above), the street door */
  interact() {
    if(this.loadingFloor||this.talking||this.panelOpen) return;
    const p = this.pos;
    const lift = this.liftAt();
    if (lift) {
      const d = this.liftDoors.find(d => d.x === lift.x); if (d) d.want = 1;
      this.panelOpen=true;this.keys.clear();this.o.onLiftPanel?.({ levels: this.o.plan.levels.map(l => ({ level: l, label: this.labelOf(l), uses: this.usesOf(l) })), current: this.level });
      return;
    }
    const st = this.stairAt();
    if (st) {
      const lv = this.o.plan.levels, i = lv.indexOf(this.level);
      const to = this.keys.has("ShiftLeft") || i === lv.length - 1 ? lv[i - 1] : lv[i + 1];
      if (to === undefined) return;
      this.fadeTo(() => {void this.travel(to, { x: this.pos.x, z: this.pos.y, yaw: this.yaw });});
      return;
    }
    const pt=this.pointAt();
    if(pt?.kind==="ticket"){
      if(this.ticket){this.notice=`이미 번호표가 있습니다 — 대기번호 ${this.ticket.no}번`;this.emitHud(true);return;}
      const waiting=3+Math.floor(Math.random()*6),no=100+Math.floor(Math.random()*800);
      this.ticket={no,due:performance.now()+(6+waiting*2)*1000,called:false,window:null,windows:pt.windows??[]};
      this.notice=`번호표 발급 — 대기번호 ${no}번 · 앞 대기 ${waiting}명. 호출되면 창구로 안내합니다.`;this.emitHud(true);return;
    }
    if(pt?.kind==="room"){const wait=Math.floor(Math.random()*7);this.notice=`${pt.label} · ${wait?`진료중 · 대기 ${wait}명`:"대기 없음"} — 문 옆 화면에 호출 순서가 표시됩니다.`;this.emitHud(true);return;}
    const person=this.nearbyPerson();
    if(person){this.openTalk(person);return;}
    if (this.atDoor()) this.o.onExit?.();
  }
  /** the panel's choice: the doors close, the car goes, they open on the floor chosen */
  ride_to(level: number) {
    if(this.disposed||this.loadingFloor||!this.o.plan.levels.includes(level))return;
    this.panelOpen=false;
    this.o.onLiftPanel?.(null);
    for (const d of this.liftDoors) d.want = 0;
    const near = this.plan.lifts.reduce((a, l) => (Math.abs(l.x - this.pos.x) < Math.abs(a.x - this.pos.x) ? l : a), this.plan.lifts[0]);
    setTimeout(() => {if(this.disposed)return;this.fadeTo(() => {void this.travel(level,null).then(()=>{
      if(this.disposed)return;
      const l = this.plan.lifts.find(x => x.index === near?.index) ?? this.plan.lifts[0];
      // (out of the car, its back to the lifts, facing the floor)
      if (l) { this.safeSpawn([l.x+(l.nx??0)*1.3,l.z+(l.nz??-1)*1.3]); const d = this.liftDoors.find(d => d.x === l.x); if (d) { d.open = 1; d.want = 1; setTimeout(() => (d.want = 0), 3500); } }
    });});}, 700);
  }
  closeLiftPanel() {this.panelOpen=false; this.o.onLiftPanel?.(null); for (const d of this.liftDoors) d.want = 0; }
  private liftAt(){return this.plan.lifts.find(l=>Math.hypot(this.pos.x-l.x-(l.nx??0)*1.1,this.pos.y-l.z-(l.nz??-1)*1.1)<2);}
  guideToLift(){const lifts=this.plan.lifts.map(l=>({l,d:Math.hypot(this.pos.x-l.x,this.pos.y-l.z)})).sort((a,b)=>a.d-b.d);for(const {l} of lifts){if(findPath(this.plan.grid,this.pos.x,this.pos.y,l.x+(l.nx??0)*1.3,l.z+(l.nz??-1)*1.3,25000)){this.guideTo(l.x+(l.nx??0)*1.3,l.z+(l.nz??-1)*1.3);this.notice="청록색 경로를 따라 승강기 앞에서 E를 누르면 층을 선택할 수 있습니다.";this.emitHud(true);return true;}}this.notice="현재 위치에서 승강기까지 통행 가능한 경로를 찾지 못했습니다.";this.emitHud(true);return false;}
  private stairAt() { return this.plan.stairs.find(s => {if(s.entry)return Math.hypot(this.pos.x-s.entry[0],this.pos.y-s.entry[1])<2.2; const doorX = s.x < this.o.plan.W / 2 ? s.x + s.w : s.x; return Math.abs(this.pos.x - doorX) < 1.6 && this.pos.y > s.z + 1.0 && this.pos.y < s.z + 3.2; }); }
  private atDoor() { const d = this.plan.door; return !!d && Math.hypot(this.pos.x-d.x,this.pos.y-d.z)<2.6; }
  private labelOf(l: number) { return this.o.plan.regFloors.find(f => f.level === l)?.label ?? (l < 0 ? `B${-l}` : `${l}F`); }
  private usesOf(l: number) { const r = this.o.plan.regFloors.find(f => f.level === l); return r ? [...new Set(r.uses.map(u => u.detail || u.use))].slice(0, 3).join(" · ") : l < 0 ? "주차장" : ""; }

  private nearbyPerson() {
    const x=this.pos.x,z=this.pos.y;
    return this.crowd?.nearest(x,z,(px,pz)=>!this.walls.some(([ax,az,bx,bz])=>{
      const dx=px-x,dz=pz-z,ex=bx-ax,ez=bz-az,den=dx*ez-dz*ex;
      if(Math.abs(den)<1e-6)return false;
      const t=((ax-x)*ez-(az-z)*ex)/den,u=((ax-x)*dz-(az-z)*dx)/den;
      return t>.03&&t<.97&&u>=0&&u<=1;
    }))??null;
  }
  /** the questions a person can be asked here, each answered from the floor itself (and a route) */
  private talkQs:{q:string;a:string;to?:[number,number]}[]=[];private talkHead:Omit<BuildingTalk,"text">|null=null;
  private where(x:number,z:number){
    const dx=x-this.pos.x,dz=z-this.pos.y,d=Math.hypot(dx,dz),f=-Math.sin(this.yaw)*dx-Math.cos(this.yaw)*dz,r=Math.cos(this.yaw)*dx-Math.sin(this.yaw)*dz;
    const dir=Math.abs(f)>=Math.abs(r)?(f>0?"앞쪽":"뒤쪽"):(r>0?"오른쪽":"왼쪽");
    return d<6?"바로 근처":`${dir}으로 약 ${Math.round(d/5)*5||5}m`;
  }
  private openTalk(person: NearbyPerson) {
    this.talking=true;this.keys.clear();this.crowd?.talkTo(person.id);
    const zone=this.plan.zones[person.zone],medical=this.plan.kinds.some(k=>k==="clinic"||k==="ward");
    const near=<T extends {x:number;z:number}>(l:T[])=>l.slice().sort((a,b)=>Math.hypot(a.x-this.pos.x,a.z-this.pos.y)-Math.hypot(b.x-this.pos.x,b.z-this.pos.y))[0];
    const doors=(this.plan.points??[]).filter(p=>p.kind==="room");
    const depts=[...new Set(doors.filter(p=>p.label.includes("진료실")).map(p=>p.label.split(" ")[0]))];
    const shops=this.plan.zones.filter(z=>(z.kind==="retail"||z.kind==="food")&&z.label&&!/공실/.test(z.label)).map(z=>({x:(z.rect[0]+z.rect[2])/2,z:(z.rect[1]+z.rect[3])/2,label:z.label}));
    const waiting=4+(person.id*7+this.level)%9;
    const dialog=dialogFor(person.role,medical,{id:person.id,hour:this.o.hour,medical,zone:zone?.label??"",floor:this.labelOf(this.level),depts,shops:shops.map(s=>s.label),waiting});
    const qs:{q:string;a:string;to?:[number,number]}[]=[];
    // (은/는 by the name's last syllable)
    const topic=(w:string)=>{const c=w.charCodeAt(w.length-1);return c>=0xac00&&c<=0xd7a3?((c-0xac00)%28?`${w}은`:`${w}는`):`${w}은(는)`;};
    const add=(q:string,name:string,x:number,z:number,extra="")=>qs.push({q,a:`${topic(name)} ${this.where(x,z)}에 있어요.${extra} 바닥의 청록색 경로를 따라가세요.`,to:[x,z]});
    const toilet=near(this.plan.decor.filter(d=>d.text==="화장실"));if(toilet)add("화장실 어디예요?","화장실",toilet.x-Math.sin(toilet.yaw)*-1.2,toilet.z-Math.cos(toilet.yaw)*-1.2);
    const tk=near((this.plan.points??[]).filter(p=>p.kind==="ticket"));if(medical&&tk)add("접수·수납은 어디서 해요?","원무과 번호표 발급기",tk.x,tk.z,` 번호표를 뽑으면 호출 순서대로 창구에서 접수해요. 지금 대기 약 ${waiting}명이에요.`);
    for(const d of depts.slice(0,4)){const door=near(doors.filter(p=>p.label.startsWith(d+" ")));if(door)add(`${d}는 어디예요?`,d,door.x,door.z,` 진료실 앞 대기석에 앉아 계시면 문 옆 화면에 순서가 표시돼요.`);}
    for(const s of shops.filter(s=>/카페|편의점|약|은행|푸드|식당/.test(s.label)).slice(0,3))add(`${s.label} 어디예요?`,s.label,s.x,s.z);
    const lift=near(this.plan.lifts.map(l=>({x:l.x+(l.nx??0)*1.3,z:l.z+(l.nz??-1)*1.3})));if(lift)add("엘리베이터는요?","가장 가까운 엘리베이터",lift.x,lift.z," 앞에서 E를 누르면 층을 고를 수 있어요.");
    if(this.plan.door)add("나가는 문은요?","정문 출입구",this.plan.door.x,this.plan.door.z);
    const others=this.o.plan.levels.filter(l=>l!==this.level).map(l=>`${this.labelOf(l)} ${this.usesOf(l)||"-"}`).slice(0,8).join(" / ");
    qs.push({q:"다른 층에는 뭐가 있어요?",a:`층별로 보면 ${others}. 엘리베이터로 이동하시면 돼요.`});
    this.talkQs=qs;
    this.talkHead={name:zone?.label?`${zone.label} · ${person.label}`:person.label,destinations:[],questions:qs.map(q=>q.q),
      directory:person.role==="staff"?this.o.plan.levels.map(l=>({label:this.labelOf(l),uses:this.usesOf(l)||this.o.plan.tenants.filter(t=>t.level===l).map(t=>t.name).slice(0,3).join(" · ")||"층별 용도 미제공"})):[]};
    this.o.onTalk?.({...this.talkHead,text:dialog.text});
  }
  /** a question chosen: the answer, and a route when it is a place */
  ask(i:number){
    const q=this.talkQs[i];if(!q||!this.talkHead)return;
    if(q.to){this.guideTo(q.to[0],q.to[1]);this.notice=this.route.length?q.a:`${q.a.split(".")[0]}. 다만 지금 위치에서 이어지는 통로를 찾지 못했어요.`;this.emitHud(true);return;}
    this.o.onTalk?.({...this.talkHead,text:q.a});
  }
  closeTalk(){this.talking=false;this.crowd?.talkTo(null);this.o.onTalk?.(null);this.keys.clear();}
  guideTo(x:number,z:number){
    // (a target inside a wall or a counter: the nearest open cell to it, within 4 m)
    const g=this.plan.grid,open=(px:number,pz:number)=>{const i=Math.floor(px/g.cell),j=Math.floor(pz/g.cell);return i>=0&&j>=0&&i<g.nx&&j<g.nz&&!!g.free[j*g.nx+i];};
    if(!open(x,z)){let best=Infinity,bx=x,bz=z;for(let dz=-4;dz<=4;dz+=g.cell/2)for(let dx=-4;dx<=4;dx+=g.cell/2){const d=Math.hypot(dx,dz);if(d<best&&open(x+dx,z+dz)){best=d;bx=x+dx;bz=z+dz;}}x=bx;z=bz;}
    const path=findPath(this.plan.grid,this.pos.x,this.pos.y,x,z,60000);this.closeTalk();
    this.route=path??[];
    this.notice=path?.length?"청록색 경로를 따라 이동하세요.":"해당 목적지의 통행 경로를 확인하지 못했습니다.";this.emitHud(true);
    if(this.routeMesh){this.floorGroup.remove(this.routeMesh);this.routeMesh.geometry.dispose();const mat=this.routeMesh.material as THREE.Material;this.floorMats=this.floorMats.filter(m=>m!==mat);mat.dispose();this.routeMesh=null;}
    if(path?.length){const geo=new THREE.BufferGeometry().setFromPoints(path.map(([a,c])=>new THREE.Vector3(a,.045,c))),mat=new THREE.LineBasicMaterial({color:0x32ffe5,depthTest:false});this.routeMesh=new THREE.Line(geo,mat);this.routeMesh.renderOrder=20;this.floorGroup.add(this.routeMesh);this.floorMats.push(mat);}
  }

  private emitHud(force = false) {
    if(!force&&performance.now()<this.nextHud)return;this.nextHud=performance.now()+100;
    const prompt = this.riding ? null : this.liftAt() ? "엘리베이터 타기 · 층 선택"
      : this.stairAt() ? "계단으로 이동 (Shift+E 아래층)" : this.pointAt()?.kind==="ticket" ? "번호표 뽑기" : this.pointAt()?.kind==="room" ? `${this.pointAt()!.label} 안내 보기` : this.nearbyPerson()?`${this.nearbyPerson()!.label}에게 말 걸기`:this.atDoor() ? "건물 밖으로 나가기":null;
    const s=this.plan.survey;
    const source=this.plan.basis?`${this.plan.basis}`:s?`SGIS ${s.year} · 층 경계${s.partitions?"·공간 구획":""}${s.facilities?"·시설 위치":""} 실측 / ${s.partitions?"가구·출입문 재구성":"내부구조 자료 없음 · 추정 배치"}`:"건축물대장·건물 외곽 기반 / 실내 배치 추정";
    const h: BuildingHud = { building: this.o.plan.info.name ?? "건물", floor: this.labelOf(this.level), uses: this.usesOf(this.level), people: this.crowd?.count ?? 0, prompt, riding: !!this.riding, view: this.view,source,loading:this.loadingFloor,lifts:this.plan.lifts.length,notice:this.notice,coverage:s?.partitions?"layout":s?"boundary":"reconstructed" };
    if (force || !this.hud || h.prompt !== this.hud.prompt || h.floor !== this.hud.floor || h.people !== this.hud.people || h.riding !== this.hud.riding || h.view !== this.hud.view ||h.loading!==this.hud.loading) { this.hud = h; this.o.onHud?.(h); }
  }

  // ------------------------------------------------------------------ the frame
  start() {
    if (this.running) return;
    this.running = true;
    window.addEventListener("keydown", this.keyDown, true); window.addEventListener("keyup", this.keyUp, true); window.addEventListener("blur", this.blur);
    this.last = performance.now(); this.raf = requestAnimationFrame(this.loop);
  }
  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    this.move(dt);
    this.tickTicket();
    this.tickMission();
    this.updateTiles();
    // lift doors
    for (const d of this.liftDoors) { d.open += Math.sign(d.want - d.open) * Math.min(Math.abs(d.want - d.open), dt * 1.4); const k = d.open * d.open * (3 - 2 * d.open); d.leaves.forEach((m, i) => (m.position.x = (i ? 1 : -1) * (d.half + k * .98))); }
    // escalator steps flow
    for (const e of this.escal) {
      e.offset = (e.offset + dt * 0.5) % 0.4;
      const len = Math.abs(e.z1 - e.z0), dir = Math.sign(e.z1 - e.z0), L = Math.hypot(len, e.H), n = e.steps.count, m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const t = ((i * 0.4 + e.offset) % (L + 0.8)) / L, tt = Math.min(1, Math.max(0, t));
        const y = (e.up ? tt : 1 - tt) * e.H, z = e.z0 + dir * len * tt;
        m.makeTranslation(e.x + e.w / 2, y + 0.02, z); e.steps.setMatrixAt(i, m);
      }
      e.steps.instanceMatrix.needsUpdate = true;
    }
    this.crowd?.update(dt, this.camera.position);
    // the fade between floors (the lift's ride, the stairs)
    if (this.fade > 0) {
      this.fade += dt * 2.2;
      if (this.fade >= 1 && this.pending) { const f = this.pending; this.pending = null; f(); }
      if (this.fade >= 2) this.fade = 0;
    }
    this.placeCamera(dt);
    this.emitHud();
    this.renderer.toneMappingExposure = this.fade > 0 ? Math.max(0.02, Math.abs(1 - this.fade)) : 1.0;
    this.renderer.render(this.scene, this.camera);
  };
  private placeCamera(dt: number) {
    const y = this.riding ? (this.riding.esc.up ? this.riding.t : 1 - this.riding.t) * this.riding.esc.H : 0;
    const ar = this.avatar.root;
    ar.position.set(this.pos.x, y, this.pos.y); ar.rotation.set(0, this.yaw + Math.PI, 0);
    ar.visible = this.view === "third";
    const look = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const head = new THREE.Vector3(this.pos.x, y + EYE + (this.view === "first" ? Math.sin(this.bob) * 0.012 : 0), this.pos.y);
    let want = head.clone();
    if (this.view === "third") {
      // behind the shoulder, pulled in before a wall
      let d = 2.6;
      for (let t = 0.3; t <= 2.6; t += 0.15) { const px = head.x - look.x * t, pz = head.z - look.z * t;const wall=this.walls.some(([ax,az,bx,bz])=>{const dx=bx-ax,dz=bz-az,k=Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(px-ax-dx*k,pz-az-dz*k)<.23;});if (wall||this.solids.some(b => px > b.x0 - 0.15 && px < b.x1 + 0.15 && pz > b.z0 - 0.15 && pz < b.z1 + 0.15)) { d = Math.max(0.35, t - 0.2); break; } }
      want = head.clone().addScaledVector(look, -d).add(new THREE.Vector3(0, 0.35, 0));
    }
    if (!this.shownInit) { this.shownPos.copy(want); this.shownInit = true; } else this.shownPos.lerp(want, 1 - Math.exp(-dt * 14));
    this.camera.position.copy(this.shownPos);
    this.camera.lookAt(head.clone().add(look.multiplyScalar(3)));
  }

  resize(w: number, h: number) { this.renderer.setSize(w, h, false); this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix(); }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.keyDown, true); window.removeEventListener("keyup", this.keyUp, true); window.removeEventListener("blur", this.blur);
    this.clearFloor(); this.avatar.dispose(); this.owned.forEach(o => o.dispose()); this.textures.forEach(t => t.dispose());
    this.scene.environment = null;
  }
}

function inside(x: number, z: number, p: [number, number][]) {
  let hit = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) hit = !hit;
  return hit;
}
/** a ring clipped to a rectangle */
function clip(p: [number, number][], x0: number, z0: number, x1: number, z1: number): [number, number][] {
  const edge = (pts: [number, number][], ins: (q: [number, number]) => boolean, cut: (a: [number, number], b: [number, number]) => [number, number]) => { const out: [number, number][] = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], ia = ins(a), ib = ins(b); if (ia) out.push(a); if (ia !== ib) out.push(cut(a, b)); } return out; };
  const lx = (a: [number, number], b: [number, number], x: number): [number, number] => [x, a[1] + (b[1] - a[1]) * (x - a[0]) / ((b[0] - a[0]) || 1e-9)];
  const lz = (a: [number, number], b: [number, number], z: number): [number, number] => [a[0] + (b[0] - a[0]) * (z - a[1]) / ((b[1] - a[1]) || 1e-9), z];
  let q = edge(p, a => a[0] >= x0, (a, b) => lx(a, b, x0)); q = edge(q, a => a[0] <= x1, (a, b) => lx(a, b, x1));
  q = edge(q, a => a[1] >= z0, (a, b) => lz(a, b, z0)); q = edge(q, a => a[1] <= z1, (a, b) => lz(a, b, z1));
  return q;
}
function scaleUv(g: THREE.BufferGeometry, su: number, sv: number) {
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}
