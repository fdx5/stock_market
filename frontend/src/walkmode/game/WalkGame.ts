import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { originAt, toFrame, toLonLat, tileOf, type Origin } from "../../drivegame/world/geo";
import { pnuAt } from "./pnu";
import { makeMaterials, type Materials } from "../../drivegame/world/materials";
import { World } from "../../drivegame/world/World";
import { Traffic, type Kind } from "../../drivegame/traffic/Traffic";
import { carLampMap } from "../../drivegame/vehicle/cars";
import { Avatar } from "../player/avatar";
import { sunAt } from "../interior/view";
import type { Sound } from "./sound";
import { GroundStream } from "../ground/GroundStream";
import { realCarMaterial, carGlassMaterial } from "../ground/carMaterial";
import { loadWalkCarModels, attachCarWindows } from "../ground/carModels";
import { CarBatches } from "../ground/CarBatches";
import { ParkedCars } from "./ParkedCars";
import { DrivingCars } from "./DrivingCars";
import { carProfile } from "./carProfiles";
import { loadCarRecordings } from "./CarAudio";
import { carCollisionSize } from "./carCollisionSize";
import { RearCameraOcclusion } from "./rearCameraOcclusion";
import { NightLighting } from "../ground/NightLighting";
import { boxesOverlap, type Body } from "../../drivegame/vehicle/physics";
import { Bicycles, type ParkedBicycle } from "./Bicycles";
import { Rooftops } from "../ground/rooftops";
import { BicycleMotion, BICYCLE_LENGTH, BICYCLE_WIDTH } from "./bicycleMotion";
import { bicycleGates } from "./bicycleGates";
import { ApartmentDetails } from "../ground/apartmentFacades";
import { realFacades } from "../ground/facades";
import { buildEntrance, disposeEntranceShared, eraOf } from "../ground/entrances";
import { buildBeds } from "../ground/flowerBeds";
import { SignalHeads } from "../ground/signals";
import { maskInPatches } from "../ground/GroundStream";
import { cutOpenings, setOpenings, type Opening } from "../ground/facades";

/* The street round a complex, on foot: the drive game's streamed world (VWorld buildings, roads,
 * terrain, trees and lamps in fixed tiles, cached in IndexedDB) and its traffic — which stops for a
 * walker in the road as it does for a car — with a person walking in it. Apartment buildings with a
 * registered name and 동 have their 공동현관 marked; standing at one asks to go in. */

export interface Entrance { name: string; dong: string; x: number; y: number; floors: number; heading: number; cx?: number; cy?: number; span?: number }
export interface BicycleHud { riding: boolean; speedKmh: number; nearby: string | null; message: string }
export interface CarHud { driving:boolean; nearby:string|null; label:string; speedKmh:number; topKmh:number; gear:string; message:string;view:"front"|"third" }
export interface WalkOptions {
  lat: number; lon: number; key: string; domain: string; apiBase: string;
  hour: number; weather: string; complexName: string; sound: Sound;
  /** the complex's year of completion (the entrances' era) */
  built?: number | null;
  onProgress?(text: string, k: number): void;
  onNear?(e: Entrance | null): void;
  onBicycle?(hud: BicycleHud): void;
  onCar?(hud:CarHud):void;
  onExit?(): void;
}

const PAINT = ["#f7f7f5", "#ecebe6", "#6b6e72", "#4a4d51", "#141518", "#141518", "#b9bcc0", "#223a5e", "#7a1c22", "#c8bca6"];
const KINDS: [string, number, number, string[] | null][] = [["sedan", 12, 1, PAINT], ["sedan-large", 8, 1, PAINT], ["suv", 10, 1, PAINT], ["suv-small", 8, 1, PAINT], ["hatchback-sports", 4, 1, PAINT], ["taxi", 6, 1, ["#e8772a", "#f2f2f0"]], ["mpv", 4, 0.98, PAINT], ["van", 2, 0.95, ["#f4f4f2", "#c9ccd0"]], ["bus", 3, 0.8, ["#2a6fc4", "#3b9a44"]]];

export class WalkGame {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2600);
  readonly origin: Origin;
  world!: World; traffic!: Traffic; mats!: Materials;
  avatar = new Avatar(7);
  readonly bicycles = new Bicycles();
  readonly bicycleMotion = new BicycleMotion();
  readonly parkedCars=new ParkedCars();
  private drivenCars:DrivingCars|null=null;
  get driving(){return this.drivenCars?.active!=null;}
  private carMessage="";private carHudAt=0;private carHudKey="";
  private footView:"first"|"third"="third";
  private nightLighting:NightLighting|null=null;
  private rearCameraOcclusion=new RearCameraOcclusion();
  get cycling() { return this.bicycles.active !== null; }
  private bicycleMessage = "";
  private bicycleHudAt = 0; private bicycleHudKey = "";
  private pendingBicycle: Entrance | null = null; private bicycleRetryAt = 0;
  private collisionPoints: number[] = [];
  private collisionBody: Body = { x: 0, y: 0, hx: 1, hy: 0, length: 0.6, width: 0.6, speed: 0 };
  private apartmentSurface: ReturnType<typeof realFacades> | null = null;
  private apartmentDetails: ApartmentDetails | null = null;
  private gateBikesPlaced = false;
  entrances: Entrance[] = [];
  /** named non-housing buildings seen in the register (for the map) */
  landmarks: { name: string; x: number; y: number; area: number }[] = [];
  pos = new THREE.Vector2(); z = 0; yaw = 0; pitch = -0.12;
  view: "first" | "third" = "third";
  private vel = new THREE.Vector2();
  private body = { x: 0, y: 0, hx: 1, hy: 0, speed: 0, length: 0.7, width: 0.7, z: 0 };
  private keys = new Set<string>(); private stick = new THREE.Vector2(); private runStick = false;
  private sun = new THREE.DirectionalLight(); private hemi = new THREE.HemisphereLight();
  private sky = new Sky();
  private markers = new THREE.Group();
  private entranceParts: { dispose(): void }[] = [];
  /** the roofs: parapets, decks and what stands on them (ground/rooftops.ts) */
  private rooftops: Rooftops | null = null;
  /** the signs over the doors (the nearest eight within 160 m shown) */
  private beacons: { e: Entrance; sprite: THREE.Sprite }[] = [];
  private waterTime = { value: 0 };
  /** the traffic lights at the signalled junctions, lit as the cars obey them */
  private signals: SignalHeads | null = null;
  private viewFrustum = new THREE.Frustum(); private viewPV = new THREE.Matrix4(); private viewBall = new THREE.Sphere(new THREE.Vector3(), 6);
  private inView = (x: number, y: number) => { this.viewBall.center.set(x, this.z + 1, -y); return this.viewFrustum.intersectsSphere(this.viewBall); };
  /** each entrance's opening through the wall (cut in the wall's shader) and its passage to walk in */
  private openings: (Opening & { e: Entrance; wx: number; wy: number; depth: number; d: number })[] = [];
  private markerMat = new THREE.MeshBasicMaterial({ color: "#5ef0ff", transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
  private raf = 0; private last = 0; private worldAt = 0; private running = false; private disposed = false;
  private near: Entrance | null = null; private stepAcc = 0;
  private camEye = new THREE.Vector3(); private camInit = false;
  private viewRT: THREE.WebGLCubeRenderTarget | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private carReflectionRT: THREE.WebGLRenderTarget | null = null;
  private carMaterial: THREE.MeshPhysicalMaterial | null = null;
  private carBatches: CarBatches | null = null;
  private carGlass: THREE.MeshPhysicalMaterial | null = null;
  private carGlazingMeshes: THREE.InstancedMesh[] = [];
  private loadedCars: Awaited<ReturnType<typeof loadWalkCarModels>> | null = null;
  private scanned = new Set<string>();
  perf = { intervals: [] as number[], worst: 0, frames: 0 };
  /** the ground round the walk, built from the aerial photographs (ground/Ground.ts) */
  ground: GroundStream | null = null;
  /** the way the walker (or the bicycle) faces, as a frame angle (x east, y north) */
  get heading() { return this.cycling ? this.bicycleMotion.heading : Math.atan2(Math.cos(this.yaw), -Math.sin(this.yaw)); }
  private carModels: Map<string, THREE.BufferGeometry> | undefined;

  constructor(readonly renderer: THREE.WebGLRenderer, private o: WalkOptions) {
    this.origin = originAt(o.lat, o.lon);
    this.scene.add(this.avatar.root, this.markers, this.bicycles.group);
    this.setupSky();
  }

  private settings() {
    const r = this.renderer;
    // (a camera's exposure for daylight; a city night is not black: the eye opened to the lamps)
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.74 + 0.45 * sunAt(this.o.hour).night;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
  }

  private setupSky() {
    const s = sunAt(this.o.hour);
    this.sky.scale.setScalar(4500);
    const u = this.sky.material.uniforms;
    u.turbidity.value = this.o.weather === "clear" ? 3.2 : 9; u.rayleigh.value = s.night > 0.5 ? 0.2 : 1.4 + (s.elevation < 15 ? 1.2 : 0);
    u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.85;
    // (the frame's y is north; three's −z)
    const dir = new THREE.Vector3(s.dir.x, s.dir.y, s.dir.z);
    u.sunPosition.value.copy(s.elevation > -4 ? dir : new THREE.Vector3(0.2, -0.3, 0.5));
    this.scene.add(this.sky);
    const fog = s.sky.clone().lerp(new THREE.Color("#ffffff"), 0.25 * (1 - s.night));
    this.scene.fog = new THREE.Fog(fog, 380, 1300);
    this.sun.color.copy(s.color); this.sun.intensity = Math.max(0.12, s.intensity);   // (sun to shade about 4:1, as outdoors: faces read by their light)
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 700;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.5;
    this.hemi.color.set(s.night > 0.5 ? "#5f74a0" : "#dde6f0"); this.hemi.groundColor.set("#5b5348"); this.hemi.intensity = 0.3 + 0.22 * (1 - s.night) + 1.1 * s.night;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.sunDir.copy(s.elevation > 2 ? dir : new THREE.Vector3(-0.3, 0.6, 0.4).normalize());
    // reflections from the sky
    const pm = new THREE.PMREMGenerator(this.renderer), sk = new THREE.Scene(), s2 = new Sky();
    s2.scale.setScalar(4500); s2.material.uniforms.turbidity.value = u.turbidity.value; s2.material.uniforms.rayleigh.value = u.rayleigh.value; s2.material.uniforms.sunPosition.value.copy(u.sunPosition.value);
    // (without the sun's disc: at 19000× the sky it swamped the light every surface takes from the
    // sky — walls in shade came out white whatever their colour; the sun's own light is the sun lamp)
    s2.material.fragmentShader = s2.material.fragmentShader.replace("vSunE * 19000.0", "vSunE * 0.0");
    sk.add(s2);
    // (and the ground under it: the light walls take from below is the street's warm grey, not
    // more blue sky)
    const groundDisc = new THREE.Mesh(new THREE.CircleGeometry(4000, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.1, 0.094, 0.085).multiplyScalar(1 - 0.8 * s.night), side: THREE.DoubleSide }));
    groundDisc.position.y = -2; sk.add(groundDisc);
    this.envRT = pm.fromScene(sk, 0.02);
    groundDisc.geometry.dispose(); (groundDisc.material as THREE.Material).dispose();
    this.scene.environment = this.envRT.texture; this.scene.environmentIntensity = 0.25 + 0.5 * (1 - s.night);
    s2.geometry.dispose(); s2.material.dispose(); pm.dispose();
  }
  private sunDir = new THREE.Vector3();

  async start() {
    const o = this.o, progress = (t: string, k: number) => o.onProgress?.(t, k);
    this.settings();
    progress("거리의 재질과 차량을 준비하는 중", 0.05);
    const [mats, cars] = await Promise.all([makeMaterials(), loadWalkCarModels()]);
    try{await loadCarRecordings();}catch(error){mats.dispose();cars.dispose();throw error;}
    if (this.disposed) { mats.dispose(); cars.dispose(); return; }
    const models = cars.bodies; this.loadedCars = cars;
    this.scene.userData.walkCarQuality = cars.quality;
    this.mats = mats; this.carModels = models;
    // every facade style built in its shader (walls, recessed windows, rooms behind the glass)
    this.apartmentSurface = realFacades(mats, sunAt(o.hour).night);
    for(const material of [...Object.values(mats.facades),mats.roofs])this.rearCameraOcclusion.apply(material);
    // (homes with a light on, by the hour: most in the evening, a few in the small hours)
    { const h = ((o.hour % 24) + 24) % 24, lit = [0.22, 0.14, 0.09, 0.08, 0.1, 0.18, 0.35, 0.42, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.35, 0.55, 0.7, 0.74, 0.72, 0.66, 0.55, 0.38]; this.apartmentSurface.setLit(lit[Math.floor(h)]); }
    this.apartmentDetails = new ApartmentDetails(points => this.world?.buildingAt(points) ?? 0); this.scene.add(this.apartmentDetails.group);
    for (const m of this.apartmentDetails.materials()) cutOpenings(m);
    setOpenings([]);
    // (the walk's own copy of the drive materials: roads and sidewalks in the scanned textures the
    // aerial ground uses — the drive game's tile every 4 m, these ~3 m and 2 m)
    {
      const tl = new THREE.TextureLoader(), load = (n: string, rep: number, srgb: boolean) => { const t = tl.load(`/3d/walk/out/${n}.webp`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
      mats.asphalt.map = load("asphalt_02_diff", 4 / 3, true); mats.asphalt.normalMap = load("asphalt_02_nor", 4 / 3, false); mats.asphalt.color.set("#8a8a88"); mats.asphalt.roughness = 0.92; mats.asphalt.needsUpdate = true;
      mats.walks.map = load("brick_pavement_02_diff", 2, true); mats.walks.normalMap = load("brick_pavement_02_nor", 2, false); mats.walks.color.set("#d6d4ce"); mats.walks.needsUpdate = true;
      maskInPatches(mats.walks);
      // water (rivers, lakes, the sea): two ripple layers drifting across each other in world space,
      // a deep green-blue body, the sky in it by Fresnel (the drone view's look, on foot)
      {
        const w = mats.water, tU = this.waterTime;
        w.color.set("#173843"); w.roughness = 0.05; w.metalness = 0; w.envMapIntensity = 1.5; w.opacity = 0.97;
        w.onBeforeCompile = sh => {
          sh.uniforms.uWaterT = tU;
          sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWaterW;").replace("#include <project_vertex>", "#include <project_vertex>\nvWaterW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
          sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWaterW; uniform float uWaterT;")
            .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
              {
                vec2 q = vWaterW.xz;
                // (three layers at unrelated scales and angles: no tile repeats to the eye)
                vec2 q2 = mat2(0.799, -0.602, 0.602, 0.799) * q, q3 = mat2(0.276, 0.961, -0.961, 0.276) * q;
                vec3 a = texture2D(normalMap, q * 0.031 + vec2(uWaterT * 0.009, uWaterT * 0.006)).xyz * 2.0 - 1.0;
                vec3 b = texture2D(normalMap, q2 * 0.083 + vec2(-uWaterT * 0.016, uWaterT * 0.012)).xyz * 2.0 - 1.0;
                vec3 c = texture2D(normalMap, q3 * 0.19 + vec2(uWaterT * 0.021, -uWaterT * 0.018)).xyz * 2.0 - 1.0;
                float gust = 0.6 + 0.4 * texture2D(normalMap, q * 0.004 + uWaterT * 0.002).x;
                vec2 d = (a.xy * 0.8 + b.xy * 0.6 + c.xy * 0.35) * 0.3 * gust;
                // (the ripples calmed with distance: far off they only made a moiré grid)
                float far = smoothstep(20.0, 170.0, length(vWaterW - cameraPosition));
                d *= 1.0 - 0.88 * far;
                normal = normalize((viewMatrix * vec4(normalize(vec3(d.x, 1.0, d.y)), 0.0)).xyz);
              }`);
        };
        w.customProgramCacheKey = () => "walkWater1"; w.needsUpdate = true;
      }
      // (road paint: retroreflective, a little brighter than the asphalt's light alone)
      mats.marks.roughness = 0.5; mats.marks.color.setScalar(1.25); mats.marks.needsUpdate = true;
    }
    const s = sunAt(o.hour);
    mats.setNight(s.night > 0.6 ? 1 : s.elevation < 12 ? 0.45 : 0);
    // (the lamps' pools of light on the street stronger than the drive game's: seen on foot, close)
    if (s.night > 0.3) mats.pool.opacity = Math.min(0.85, mats.pool.opacity * 2);
    const carMat = this.carMaterial = realCarMaterial();
    this.carGlass = carGlassMaterial();
    this.carBatches = new CarBatches(cars, this.carGlass);
    this.scene.add(this.carBatches.group);
    this.drivenCars=new DrivingCars(cars,carMat,this.carGlass,this.o.sound);this.scene.add(this.drivenCars.group);
    carMat.emissiveMap = carLampMap(); carMat.emissive.set("#ffffff"); carMat.emissiveIntensity = s.night > 0.5 ? 3 : 0;
    const kinds: Kind[] = [];
    const selected = new Set(KINDS.map(k => k[0]));
    const allKinds: typeof KINDS = [...KINDS, ...[...models.keys()].filter(name => !selected.has(name)).map(name => [name, 3, 0.95, PAINT] as [string, number, number, string[]])];
    for (const [name, weight, speed, paint] of allKinds) {
      const g = models.get(name); if (!g) continue;
      g.computeBoundingBox(); const b = g.boundingBox!;
      const hull=carCollisionSize(g);kinds.push({ name, geo: g, length: hull.length, width: hull.width, speed: speed * 0.85, weight, paint });
    }
    this.traffic = new Traffic(kinds, carMat, 90);
    for (const object of [...this.traffic.group.children]) this.carBatches.add(object as THREE.InstancedMesh);
    this.traffic.target = 70; this.traffic.unstick = 20;
    // (the lanes' heights are the road's centre line, ~5 cm under the drawn asphalt: wheels sank)
    this.traffic.lift = 0.06;
    this.scene.add(this.traffic.group);
    this.world = new World({
      origin: this.origin, key: o.key, domain: o.domain, apiBase: o.apiBase, scene: this.scene, mats, customLamps:true,
      onRoads: (added, removed) => { if (removed.length) this.traffic.graph.remove(removed); if (added.length) this.traffic.graph.add(added); },
    });
    progress("지형과 도로를 불러오는 중", 0.12);
    await this.world.init();
    if (this.disposed) return;
    this.nightLighting=new NightLighting(this.world,this.scene,s.night,carMat.emissiveMap!,this.parkedCars);
    this.rooftops = new Rooftops(this.world); this.scene.add(this.rooftops.group);
    this.traffic.setPlayer(this.body);
    this.signals = new SignalHeads(this.traffic, (x, y) => this.world.surfaceAt(x, y)); this.scene.add(this.signals.group);
    // the streets already running when the walk is shown: ~25 s of traffic run behind the loading
    // screen (cars made anywhere then; afterwards only out of sight)
    for (let i = 0; i < 100; i++) this.traffic.update(0.25, this.pos.x, this.pos.y, () => false);
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    const t0 = performance.now();
    for (;;) {
      await new Promise(r => setTimeout(r, 120));
      if (this.disposed) return;
      this.world.update(0, 0, 1, 0, 0);
      const k = this.world.readiness(0, 0, 320);
      progress(`주변 거리를 불러오는 중 · ${Math.round(k * 100)}%`, 0.15 + k * 0.7);
      if ((k >= 0.999 && this.world.backlog === 0) || performance.now() - t0 > 40000) break;
    }
    progress("공동현관을 찾는 중", 0.88);
    await this.scanEntrances();
    // start before the nearest entrance of the complex (or on the nearest pavement)
    const mine = this.entrances.filter(e => e.name && (o.complexName.includes(e.name) || e.name.includes(o.complexName)));
    const first = (mine.length ? mine : this.entrances).sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0];
    if (first) this.placeAt(first, 4); else this.pos.set(0, 0);
    this.z = this.world.surfaceAt(this.pos.x, this.pos.y) || 0;
    // the ground round here, from the aerial photographs: paving, beds, trees, parked cars, people
    progress("항공사진으로 동네를 만드는 중", 0.9);
    try {
      // (in 400 m patches: this one now, the rest within 500 m streamed in as the walk goes — GroundStream)
      this.ground = new GroundStream({ world: this.world, origin: this.origin, key: o.key, scene: this.scene, carModels: this.carModels, carWindows: cars.windows, carGlass: this.carGlass, carBatches: this.carBatches!, parkedCars:this.parkedCars, parkingBlocked:(x,y,hx,hy,hl,hw)=>!!this.nightLighting?.blocks(x,y,hx,hy,hl,hw),prepare:g=>this.prepareGround(g), onProgress: t => progress(t, 0.92) });
      await this.ground.prime(this.pos.x, this.pos.y);
    } catch (e) { console.warn("walk: aerial ground failed", e); this.ground?.dispose(); this.ground = null; }
    if (this.disposed) return;
    if (first) this.placeAt(first, 4);
    // Each dong is ready on first arrival as well as when returning from indoors.
    for (const entrance of this.entrances) this.provideBicycle(entrance, false);
    this.provideGateBicycles(); this.bicycles.sync(this.pos.x, this.pos.y);
    this.publishBicycle(true);
    this.apartmentDetails?.update(this.pos.x, this.pos.y, this.camera);
    progress("셰이더를 준비하는 중", 0.94);
    await this.drivenCars?.prepare();
    this.placeCamera(0, true);
    this.nightLighting?.update(performance.now(),this.camera,this.entrances,this.traffic,this.drivenCars);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.captureCarReflections();
    this.window(true);
    progress("출발", 1);
  }

  /** Apartment 동 with a name, from the tiles' raw data (cached by the world's workers). */
  private scanning: Promise<void> | null = null;
  private seenIds = new Set<string>();
  /** the blocks of each name with no numbered 동, counted (theirs given in order) */
  private unnumbered = new Map<string, number>();
  /** (one scan at a time: the frame loop and the start both ask) */
  private scanEntrances() { return this.scanning ??= this.scan().finally(() => { this.scanning = null; }); }
  private async scan() {
    const db: IDBDatabase | null = await new Promise(res => { try { const rq = indexedDB.open("drivegame", 1); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); rq.onupgradeneeded = () => { rq.transaction?.abort(); res(null); }; } catch { res(null); } });
    if (!db) return;
    const [ci, cj] = tileOf(this.origin, this.pos.x, this.pos.y);
    const keys: string[] = [];
    for (let i = ci - 2; i <= ci + 2; i++) for (let j = cj - 2; j <= cj + 2; j++) if (!this.scanned.has(`${i}_${j}`)) keys.push(`${i}_${j}`);
    const get = (k: string) => new Promise<{ buildings: { r: number[]; h: number; f: number; u: string; n: string; d: string }[] } | null>(res => { try { const rq = db.transaction("raw").objectStore("raw").get(`v4:${k}`); rq.onsuccess = () => res(rq.result ?? null); rq.onerror = () => res(null); } catch { res(null); } });
    const seen = this.seenIds;
    for (const k of keys) {
      const raw = await get(k);
      if (!raw) continue;
      this.scanned.add(k);
      for (const b of raw.buildings) {
        // named landmarks for the map: big or tall non-housing buildings (schools, offices, stations)
        if (b.n && !/^02/.test(b.u) && b.r.length >= 6) {
          let lx = 0, ly = 0, area = 0;
          const fp: [number, number][] = [];
          for (let i = 0; i < b.r.length; i += 2) fp.push(toFrame(this.origin, b.r[i], b.r[i + 1]));
          for (let i = 0; i < fp.length; i++) { const [ax, ay] = fp[i], [bx, by] = fp[(i + 1) % fp.length]; area += ax * by - bx * ay; lx += ax; ly += ay; }
          area = Math.abs(area) / 2; lx /= fp.length; ly /= fp.length;
          const name = b.n.replace(/\(.*?\)/g, "").trim();
          if (name.length >= 2 && (area > 900 || (b.f || 0) >= 8) && !/^(주건축물|부속|창고|주차|관리|경비|기계|전기|화장실)|필지|근린생활|생활시설|\d{2,}\s*[-번]|^[가-힣]+동\s*\d/.test(name)
            && !this.landmarks.some(l => l.name === name && Math.hypot(l.x - lx, l.y - ly) < 250)) this.landmarks.push({ name, x: lx, y: ly, area });
        }
        // apartment blocks only: 공동주택 of six storeys and up (five and under are villas and
        // 연립), with a numbered 동 ("제101동", "101동", "A동"); the register's generic names skipped
        // (every block drawn as a flat block can be gone into: 아파트 are five storeys and up; a
        // block with no numbered 동 — a single block's "주건축물", a name only — gets one in order)
        if (!/^02/.test(b.u) && !/아파트/.test(b.n)) continue;
        const floors = b.f || Math.round((b.h || 0) / 2.9);
        if (floors < 5 || /부속|관리|상가|경비|근린|주차|노인|어린이|복리|기계|전기/.test(b.d || "")) continue;
        const num = (b.d || "").trim().match(/^(?:제\s*)?(\d{1,4}|[A-Z]|[가나다라마바사])\s*동?$/) ?? (b.d || "").match(/(\d{1,4}|[A-Z])\s*동$/);
        const nameKey = b.n || "아파트";
        // (an unnumbered block known by where it stands: the same block comes again in the next tile's data)
        const id = num ? `${b.n}|${num[1]}동` : `${b.n}|@${b.r[0].toFixed(5)},${b.r[1].toFixed(5)}`;
        if (seen.has(id)) continue;
        let dong = num ? `${num[1]}동` : "";
        if (!dong) { const k = (this.unnumbered.get(nameKey) ?? 0) + 1; this.unnumbered.set(nameKey, k); dong = `${k}동`; }
        // the footprint in the frame; the door on the middle of its longest south-facing side
        const pts: [number, number][] = [];
        for (let i = 0; i < b.r.length; i += 2) pts.push(toFrame(this.origin, b.r[i], b.r[i + 1]));
        let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
        let best = -Infinity, door: Entrance | null = null;
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, ay] = pts[i], [bx, by] = pts[i + 1], len = Math.hypot(bx - ax, by - ay);
          if (len < 6) continue;
          let nx = (by - ay) / len, ny = -(bx - ax) / len;
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
          // (Korean slabs face south: their entrances are on the north side, toward the parking)
          const score = len * 0.3 + (-ny) * 6;
          if (score > best) { best = score; door = { name: (b.n || this.o.complexName).replace(/\(.*?\)|\s*(제\s*)?[0-9A-Z]{1,4}\s*동$/g, "").trim() || this.o.complexName, dong, x: mx + nx * 1.6, y: my + ny * 1.6, floors, heading: Math.atan2(ny, nx), cx, cy, span: len / 2 }; }
        }
        if (door) {
          seen.add(id); this.entrances.push(door); this.addMarker(door);
          const ground = Math.min(...pts.map(([x, y]) => this.world.heightAt(x, y)).filter(Number.isFinite));
          const height = b.h > 2 && b.h <= floors * 4.5 + 12 ? b.h : floors * 2.9 + 1.5;
          this.apartmentDetails?.add(id, pts, height, ground, floors);
        }
      }
    }
  }
  private addMarker(e: Entrance) {
    // the 공동현관 as built in the block's era (ground/entrances.ts), the 동 number on its plate;
    // a ring on the ground to stand in
    const night = sunAt(this.o.hour).night, era = eraOf(this.o.built, e.floors);
    const num = parseInt(e.dong, 10), variant = Number.isFinite(num) ? num % 2 : e.dong.charCodeAt(0) % 2;
    const c = document.createElement("canvas"); c.width = 512; c.height = 160;
    const x2 = c.getContext("2d")!;
    // (old blocks: black numerals painted on cream; then a dark plate; now a lit stone-set plate)
    x2.fillStyle = era === "old" ? "#e9e3d4" : era === "mid" ? "#23282d" : "#15171a"; x2.fillRect(0, 0, 512, 160);
    x2.fillStyle = era === "old" ? "#1c1d1f" : era === "mid" ? "#f4f4f2" : "#ffe9c4";
    x2.font = `${era === "new" ? 500 : 800} 96px Pretendard, 'Noto Sans KR', sans-serif`; x2.textAlign = "center"; x2.textBaseline = "middle"; x2.fillText(e.dong, 256, 86);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const built = buildEntrance(era, variant, tex, night);
    const g = built.group;
    this.entranceParts.push(built);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 48).rotateX(-Math.PI / 2), this.markerMat);
    g.add(ring);
    // a sign over the door ("101동 입구"), the same size on screen at any distance: the way in found
    // from across the complex (shown over the nearest few only — Entrances' beacons)
    {
      const bc = document.createElement("canvas"); bc.width = 320; bc.height = 112;
      const b2 = bc.getContext("2d")!;
      b2.fillStyle = "rgba(9,20,28,0.86)"; b2.strokeStyle = "#ffc857"; b2.lineWidth = 5;
      b2.beginPath(); b2.roundRect(4, 4, 312, 76, 18); b2.fill(); b2.stroke();
      b2.fillStyle = "#ffc857"; b2.beginPath(); b2.moveTo(140, 80); b2.lineTo(180, 80); b2.lineTo(160, 108); b2.closePath(); b2.fill();
      b2.fillStyle = "#ffffff"; b2.font = "800 44px Pretendard, 'Noto Sans KR', sans-serif"; b2.textAlign = "center"; b2.textBaseline = "middle";
      b2.fillText(`${e.dong} 입구`, 160, 44);
      const bt = new THREE.CanvasTexture(bc); bt.colorSpace = THREE.SRGBColorSpace;
      const bm = new THREE.SpriteMaterial({ map: bt, transparent: true, depthWrite: false, sizeAttenuation: false, fog: false });
      const beacon = new THREE.Sprite(bm); beacon.center.set(0.5, 0); beacon.scale.set(0.105, 0.037, 1); beacon.position.set(0, 4.4, 1.5); beacon.renderOrder = 5; beacon.visible = false;
      g.add(beacon); this.beacons.push({ e, sprite: beacon });
      this.entranceParts.push({ dispose() { bt.dispose(); bm.dispose(); } });
    }
    const gz = this.world.surfaceAt(e.x, e.y);
    // the door on the wall line, facing out
    const wx = e.x - Math.cos(e.heading) * 1.5, wy = e.y - Math.sin(e.heading) * 1.5;
    g.position.set(wx, Number.isFinite(gz) ? gz : 0, -wy);
    g.lookAt(e.x, g.position.y, -e.y);
    ring.position.set(0, 0.05, 1.5);
    // the opening through the wall, and the passage in
    const o = built.opening, gy = g.position.y;
    this.openings.push({ x: wx, z: -wy, tx: -Math.sin(e.heading), tz: -Math.cos(e.heading), hw: o.hw, base: gy, top: gy + o.top, e, wx, wy, depth: o.depth, d: 0 });
    // the planted beds either side along the wall's foot (to the block's corner)
    const reach = Math.min(built.extent + 0.5 + 7.5, (e.span ?? 12) - 0.6);
    if (reach > built.extent + 1.6) {
      const cs = Math.cos(e.heading), sn = Math.sin(e.heading);
      const beds = buildBeds([{ x0: built.extent + 0.5, x1: reach }], 1.35, Math.round(wx * 7 + wy * 13), new Date().getMonth() + 1,
        x => { const h = this.world.surfaceAt(wx - sn * x + cs * 0.7, wy + cs * x + sn * 0.7); return Number.isFinite(h) ? THREE.MathUtils.clamp(h - gy, -0.4, 0.4) : 0; });
      beds.mesh.material.userData.entranceShared = true;
      g.add(beds.mesh); this.entranceParts.push(beds);
    }
    g.traverse(o => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    this.markers.add(g);
  }

  /** the entrance's building's PNU (for its register rows) */
  pnuOf(e: Entrance): Promise<string | null> {
    const [lon, lat] = toLonLat(this.origin, e.cx ?? e.x, e.cy ?? e.y);
    return pnuAt(lon, lat, this.o.key, this.o.domain);
  }

  placeAt(e: Entrance, back = 2.2) {
    this.pos.set(e.x + Math.cos(e.heading) * back, e.y + Math.sin(e.heading) * back);
    if (this.world && this.traffic) {
      const hx = Math.cos(e.heading), hy = Math.sin(e.heading);
      let placed = false;
      for (const distance of [back, back + 1.5, back + 3]) {
        for (const side of [0, 1, -1, 2, -2, 3, -3]) {
          const x = e.x + hx * distance - hy * side, y = e.y + hy * distance + hx * side;
          const ground = this.world.surfaceAt(x, y);
          if (!Number.isFinite(ground) || this.world.wetAt(x, y) || this.blocked(x, y, 1, 0)) continue;
          this.pos.set(x, y); this.z = ground; placed = true; break;
        }
        if (placed) break;
      }
    }
    // facing the door
    this.yaw = Math.atan2(Math.cos(e.heading), -Math.sin(e.heading));
    this.camInit = false;
    this.vel.set(0, 0);
  }

  /** Returning from indoors recalls that dong's one bicycle to its entrance. */
  returnFromInterior(e: Entrance) {
    this.resume(e);
    this.pendingBicycle = e;
    this.provideBicycle(e);
    this.bicycles.sync(this.pos.x, this.pos.y);
    this.publishBicycle(true);
  }

  private provideBicycle(e: Entrance, notify = true) {
    const id = `${e.name}|${e.dong}`, hx = Math.cos(e.heading), hy = Math.sin(e.heading);
    if (!notify && this.bicycles.records.has(id)) return;
    for (const distance of [4, 5.5, 7, 9]) for (const side of [2.8, -2.8, 4, -4, 1.5, -1.5]) {
      const x = e.x + hx * distance - hy * side, y = e.y + hy * distance + hx * side;
      const z = this.surfaceAt(x, y, this.z);
      if (!Number.isFinite(z) || this.world.wetAt(x, y) || this.blocked(x, y, hx, hy, true, id)) continue;
      this.bicycles.provide({ id, name: e.name, dong: e.dong, x, y, z, heading: e.heading });
      if (notify) { this.pendingBicycle = null; this.bicycleMessage = "동 출입구 앞 자전거를 타고 이동해 보세요."; }
      return;
    }
    if (notify) this.bicycleMessage = "출입구 앞에 자전거를 놓을 공간을 찾고 있습니다.";
  }

  private provideGateBicycles() {
    if (this.gateBikesPlaced) return;
    const mine = this.entrances.filter(e => e.name && (this.o.complexName.includes(e.name) || e.name.includes(this.o.complexName)));
    const gates = bicycleGates(mine.length ? mine : this.entrances, this.world.roads.values());
    let placed = 0;
    for (const gate of gates) for (let slot = 0; slot < 3; slot++) {
      const id = `gate:${gate.id}:${slot}`;
      for (const side of [1, -1]) {
        const offset = gate.width / 2 + 2.2;
        const x = gate.x - gate.hy * offset * side + gate.hx * slot * 1.05;
        const y = gate.y + gate.hx * offset * side + gate.hy * slot * 1.05;
        const heading = Math.atan2(gate.hy, gate.hx) + Math.PI / 2, z = this.surfaceAt(x, y);
        if (!Number.isFinite(z) || this.world.wetAt(x, y) || this.blocked(x, y, Math.cos(heading), Math.sin(heading), true, id)) continue;
        this.bicycles.provide({ id, name: this.o.complexName, dong: "단지 출구 공용", x, y, z, heading }); placed++; break;
      }
    }
    if (placed) this.gateBikesPlaced = true;
  }

  /** Building, pole, vehicle and parked-bicycle checks for both movement and safe dismounts. */
  private blocked(x: number, y: number, hx: number, hy: number, bicycle = false, ignoreId?: string) {
    const body = this.collisionBody;
    Object.assign(body, { x, y, hx, hy, length: bicycle ? BICYCLE_LENGTH : 0.6, width: bicycle ? BICYCLE_WIDTH : 0.6 });
    const points = this.collisionPoints; points.length = 0;
    const halfLength = body.length / 2, halfWidth = body.width / 2;
    for (let length = -halfLength; length < halfLength + 0.001; length += body.length / 4) for (const width of [-halfWidth, 0, halfWidth]) {
      points.push(x + hx * length - hy * width, y + hy * length + hx * width);
    }
    // (an entrance's passage is open: the lobby behind the doors can be walked into)
    for (const op of this.openings) {
      if (op.d > 40) break;
      const tx = -Math.sin(op.e.heading), ty = Math.cos(op.e.heading), nx = Math.cos(op.e.heading), ny = Math.sin(op.e.heading);
      for (let i = 0; i < points.length; i += 2) {
        const dx = points[i] - op.wx, dy = points[i + 1] - op.wy, along = dx * tx + dy * ty, out = dx * nx + dy * ny;
        if (Math.abs(along) < op.hw - 0.3 && out > -(op.depth - 0.35) && out < 2) { points[i] = op.e.x; points[i + 1] = op.e.y; }
      }
    }
    if (this.world.buildingAt(points) > 0 || this.world.poleIn(x, y, hx, hy, halfLength, halfWidth) || this.nightLighting?.blocks(x,y,hx,hy,halfLength,halfWidth) || this.ground?.blocks(body)||this.parkedCars.blocks(body)) return true;
    for (const car of this.traffic.near(x, y, 10)) if (boxesOverlap(body, car, 0.06)) return true;
    for (const bike of this.bicycles.records.values()) {
      if (bike === this.bicycles.active || bike.id === ignoreId || Math.hypot(bike.x - x, bike.y - y) > 3) continue;
      if (boxesOverlap(body, { ...bike, hx: Math.cos(bike.heading), hy: Math.sin(bike.heading), length: BICYCLE_LENGTH, width: BICYCLE_WIDTH, speed: 0 }, 0.04)) return true;
    }
    return false;
  }

  private clearBicycle = (x: number, y: number, hx: number, hy: number) => {
    if (!this.world.ready(x, y) || this.world.wetAt(x, y)) return false;
    const height = this.surfaceAt(x, y, this.z);
    return Number.isFinite(height) && Math.abs(height - this.z) < 1 && !this.blocked(x, y, hx, hy, true);
  };

  /** E/button toggles a nearby bike. A failed dismount stops and keeps the rider safely mounted. */
  interactBicycle(): boolean {
    if(this.driving)return false;
    if (this.cycling) {
      const bike = this.bicycles.active!, hx = Math.cos(bike.heading), hy = Math.sin(bike.heading);
      this.bicycleMotion.stop();
      for (const [side, along] of [[1.05, 0], [-1.05, 0], [1.3, -1], [-1.3, -1], [0, -1.8], [0, 1.8]]) {
        const x = bike.x - hy * side + hx * along, y = bike.y + hx * side + hy * along;
        const z = this.surfaceAt(x, y, this.z);
        if (!Number.isFinite(z) || Math.abs(z - this.z) > 0.7 || this.world.wetAt(x, y) || this.blocked(x, y, hx, hy)) continue;
        this.pos.set(x, y); this.z = z; this.vel.set(0, 0);
        this.bicycles.ride(null); this.avatar.pose = "stand"; this.avatar.root.rotation.z = 0;
        this.body.length = this.body.width = 0.7;
        this.clearControls(); this.bicycleMessage = "자전거에서 내렸습니다. 가까이에서 다시 탈 수 있습니다.";
        this.avatar.update(0, 0); this.avatar.root.position.set(x, z, -y);
        this.camInit = false; this.placeCamera(0, true);
        this.o.sound.bicycleLatch(); this.bicycles.sync(x, y); this.publishBicycle(true);
        return true;
      }
      this.clearControls(); this.bicycleMessage = "내릴 공간이 없습니다. 조금 이동한 뒤 다시 내려 주세요.";
      this.publishBicycle(true); return true;
    }
    const bike = this.bicycles.nearest(this.pos.x, this.pos.y);
    if (!bike) return false;
    const hx = Math.cos(bike.heading), hy = Math.sin(bike.heading);
    if (this.blocked(bike.x, bike.y, hx, hy, true, bike.id)) {
      this.bicycleMessage = "자전거 주변이 막혀 있습니다. 차량이 지나간 뒤 다시 타 주세요."; this.publishBicycle(true); return true;
    }
    this.clearControls(); this.bicycles.ride(bike);
    this.o.sound.resume(); this.o.sound.bicycleLatch();
    this.bicycleMotion.place(bike.x, bike.y, bike.heading);
    this.pos.set(bike.x, bike.y); this.z = bike.z;
    this.yaw = Math.atan2(-hx, hy); this.pitch = -0.12; this.camInit = false;
    this.body.length = BICYCLE_LENGTH; this.body.width = BICYCLE_WIDTH;
    this.avatar.pedal(0, 0); this.bicycles.update(0, 0, 0);
    this.avatar.update(0, 0); this.avatar.root.position.set(bike.x, bike.z, -bike.y);
    this.avatar.root.rotation.set(0, Math.atan2(hx, -hy), 0); this.placeCamera(0, true);
    this.near = null; this.o.onNear?.(null); this.bicycleMessage = "";
    this.bicycles.sync(bike.x, bike.y); this.publishBicycle(true);
    return true;
  }

  /** What a foot or a wheel stands on: the surface drawn there (the ground patch's paving or the
   * carriageway's asphalt), unless a deck or an underpass puts the drive world's level elsewhere. */
  private surfaceAt(x: number, y: number, near?: number) {
    const s = this.world.surfaceAt(x, y, near), g = this.ground?.surfaceAt(x, y) ?? NaN;
    return Number.isFinite(g) && (!Number.isFinite(s) || Math.abs(g - s) < 1) ? g : s;
  }
  setBicycleBrake(on: boolean) { if (on) this.keys.add("Space"); else this.keys.delete("Space"); }
  private clearControls() { this.keys.clear(); this.stick.set(0, 0); this.runStick = false; this.vel.set(0, 0); this.bicycleMotion.stop(); this.o.sound.stopBicycle();this.drivenCars?.stop(); }
  private publishBicycle(force = false) {
    const now = performance.now(); if (!force && now - this.bicycleHudAt < 100) return;
    this.bicycleHudAt = now;
    const near = this.cycling||this.driving ? null : this.bicycles.nearest(this.pos.x, this.pos.y);
    const hud: BicycleHud = { riding: this.cycling, speedKmh: Math.round(Math.abs(this.bicycleMotion.speed) * 3.6), nearby: near ? `${near.name} ${near.dong}` : null, message: this.bicycleMessage };
    const key = JSON.stringify(hud);
    if (force || key !== this.bicycleHudKey) { this.bicycleHudKey = key; this.o.onBicycle?.(hud); }
  }

  /** F enters a parked car; E/F exits into a checked clear space. */
  interactCar():boolean{
    if(!this.drivenCars||this.cycling)return false;
    const active=this.drivenCars.active;
    if(active){
      const b=active.vehicle.body;this.clearControls();
      for(const [side,along]of [[1,0],[-1,0],[1,-1.2],[-1,-1.2],[1,1.4],[-1,1.4]]){
        const offset=(active.record.width/2+.85)*side,x=b.x-b.hy*offset+b.hx*along,y=b.y+b.hx*offset+b.hy*along,z=this.world.surfaceAt(x,y,this.z);
        if(!Number.isFinite(z)||Math.abs(z-this.z)>.9||this.world.wetAt(x,y)||this.blocked(x,y,1,0))continue;
        this.parkedCars.position(active.record,b.x,b.y,active.record.z,active.vehicle.theta);this.drivenCars.dismount();
        this.pos.set(x,y);this.z=z;this.avatar.pose="stand";this.avatar.update(0,0);this.avatar.root.position.set(x,z,-y);this.avatar.root.rotation.z=0;
        this.body.length=this.body.width=.7;this.view=this.footView;this.yaw=Math.atan2(-b.hx,b.hy);this.pitch=-.12;this.camera.up.set(0,1,0);this.camera.fov=62;this.camera.updateProjectionMatrix();this.camInit=false;this.placeCamera(0,true);this.carMessage="차량에서 내렸습니다.";this.publishCar(true);return true;
      }
      this.carMessage="내릴 공간이 없습니다. 조금 이동한 뒤 내려 주세요.";this.publishCar(true);return true;
    }
    const car=this.parkedCars.nearest(this.pos.x,this.pos.y);if(!car)return false;
    this.footView=this.view;
    this.clearControls();
    this.drivenCars.mount(car,{
      others:(x,y,r)=>[...this.traffic.near(x,y,r),...this.parkedCars.near(x,y,r),...[...this.bicycles.records.values()].filter(b=>Math.hypot(b.x-x,b.y-y)<r+2).map(b=>({x:b.x,y:b.y,hx:Math.cos(b.heading),hy:Math.sin(b.heading),length:BICYCLE_LENGTH,width:BICYCLE_WIDTH,speed:0}))],
      building:points=>this.world.buildingAt(points)>0,
      pole:(x,y,hx,hy,hl,hw)=>this.world.readiness(x,y,18)<.9||this.world.wetAt(x,y)||this.world.poleIn(x,y,hx,hy,hl,hw)||!!this.nightLighting?.blocks(x,y,hx,hy,hl,hw)||!!this.ground?.blocks({x,y,hx,hy,length:hl*2,width:hw*2,speed:0}),
    });
    this.pos.set(car.x,car.y);this.z=car.z;this.yaw=Math.atan2(-Math.cos(car.heading),Math.sin(car.heading));this.pitch=-.06;
    this.body.length=car.length;this.body.width=car.width;this.near=null;this.o.onNear?.(null);this.carMessage="";this.publishBicycle(true);this.publishCar(true);return true;
  }
  private publishCar(force=false){
    const now=performance.now();if(!force&&now-this.carHudAt<100)return;this.carHudAt=now;
    const a=this.drivenCars?.active,near=!a&&!this.cycling?this.parkedCars.nearest(this.pos.x,this.pos.y):null,p=a?.profile??(near?carProfile(near):null);
    const hud:CarHud={driving:!!a,nearby:near?.label??null,label:a?.record.label??near?.label??"",speedKmh:Math.round((a?.vehicle.body.speed??0)*3.6),topKmh:Math.round(p?.topKmh??0),gear:a?.vehicle.gearLabel??"P",message:this.carMessage,view:this.view==="first"?"front":"third"};
    const key=JSON.stringify(hud);if(force||key!==this.carHudKey){this.carHudKey=key;this.o.onCar?.(hud);}
  }
  private moveCar(dt:number,steer:number,pedal:number){
    this.drivenCars!.update(dt,steer,pedal,this.keys.has("Space"),(x,y)=>this.world.surfaceAt(x,y,this.z));
    const a=this.drivenCars!.active!,b=a.vehicle.body;this.pos.set(b.x,b.y);this.z=a.record.z;Object.assign(this.body,b,{z:this.z});
    this.avatar.pose="sit";this.avatar.update(dt,0);const seat=new THREE.Vector3(a.profile.eye[0],a.profile.eye[1]-1.28,a.profile.eye[2]).applyMatrix4(a.visual.root.matrixWorld);
    this.avatar.root.position.copy(seat);this.avatar.root.rotation.set(0,Math.atan2(b.hx,-b.hy),0);
    const target=Math.atan2(-b.hx,b.hy),delta=Math.atan2(Math.sin(target-this.yaw),Math.cos(target-this.yaw));
    if(Math.abs(b.speed)>.1)this.yaw+=delta*Math.min(1,dt*(Math.abs(steer)>.03?4:1.2));
  }

  // ---------------------------------------------------------------- input
  private down = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.code === "KeyV") { if (!e.repeat) this.toggleView(); return; }
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right))$/.test(e.code) || ((this.cycling || this.driving) && e.code === "Space")) { e.preventDefault(); this.keys.add(e.code); }
  };
  private up = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private blur = () => { this.clearControls(); this.publishBicycle(true); };
  private visibility = () => { if (document.hidden) this.blur(); };
  setStick(x: number, y: number, run: boolean) { this.stick.set(x, y); this.runStick = run; }
  look(dx: number, dy: number) { if(this.driving)return;this.yaw -= dx; this.pitch = Math.max(-1.2, Math.min(.9, this.pitch - dy)); }
  toggleView() { this.view = this.view === "first" ? "third" : "first";if(this.driving&&this.view==="first"){const b=this.drivenCars!.active!.vehicle.body;this.yaw=Math.atan2(-b.hx,b.hy);this.pitch=-.025;}
    // (into first person on foot or on the bike: looking straight ahead, the way the body faces)
    else if(this.view==="first"){const h=this.cycling?this.bicycleMotion.heading:Math.atan2(this.body.hy,this.body.hx);if(Number.isFinite(h)){this.yaw=Math.atan2(-Math.cos(h),Math.sin(h));this.pitch=this.cycling?-.06:-.04;}}
    this.camInit=false; }

  pause() { this.window(false); cancelAnimationFrame(this.raf); this.running = false; this.clearControls(); }
  resume(at?: Entrance) {
    cancelAnimationFrame(this.raf); this.window(false); this.clearControls();
    this.settings();
    if (at) this.placeAt(at, 3);
    this.near = null;
    this.window(true); this.running = true; this.last = performance.now(); this.raf = requestAnimationFrame(this.loop);
  }
  private window(on: boolean) {
    if (on) { window.addEventListener("keydown", this.down, true); window.addEventListener("keyup", this.up, true); window.addEventListener("blur", this.blur); document.addEventListener("visibilitychange", this.visibility); }
    else { window.removeEventListener("keydown", this.down, true); window.removeEventListener("keyup", this.up, true); window.removeEventListener("blur", this.blur); document.removeEventListener("visibilitychange", this.visibility); }
  }

  // ---------------------------------------------------------------- the frame
  private loop = (now: number) => {
    if (this.disposed || !this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const raw = now - this.last; this.last = now;
    const dt = Math.min(0.1, raw / 1000);
    if (this.perf.frames++ > 2 && this.perf.intervals.length < 36000) { this.perf.intervals.push(+raw.toFixed(2)); this.perf.worst = Math.max(this.perf.worst, raw); }
    this.move(dt);
    // (new cars only where the eye is not looking: a car never appears from nothing in view)
    this.camera.updateMatrixWorld();
    this.viewFrustum.setFromProjectionMatrix(this.viewPV.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    this.traffic.update(dt, this.pos.x, this.pos.y, this.inView);
    this.signals?.update(dt, this.pos.x, this.pos.y);
    this.apartmentSurface?.tick(now / 1000);
    this.waterTime.value = (now / 1000) % 10000;
    if (now - this.worldAt > 250) {
      this.worldAt = now;
      const heading = this.drivenCars?.active?.vehicle.theta??(this.cycling ? this.bicycleMotion.heading : Math.atan2(Math.cos(this.yaw), -Math.sin(this.yaw)));
      this.world.update(this.pos.x, this.pos.y, Math.cos(heading), Math.sin(heading), Math.abs(this.drivenCars?.active?.vehicle.body.speed??(this.cycling ? this.bicycleMotion.speed : this.vel.length())));
      this.ground?.tick(this.pos.x, this.pos.y, Math.cos(heading), Math.sin(heading));
      this.bicycles.sync(this.pos.x, this.pos.y);
      this.apartmentDetails?.update(this.pos.x, this.pos.y, this.camera);
      this.rooftops?.update(this.pos.x, this.pos.y);
      // (the entrances drawn within 170 m: their small parts are lost further off)
      for (const m of this.markers.children) m.visible = Math.hypot(m.position.x - this.pos.x, -m.position.z - this.pos.y) < 170;
      { const near = this.beacons.map(b => ({ b, d: Math.hypot(b.e.x - this.pos.x, b.e.y - this.pos.y) })).sort((a, b) => a.d - b.d);
        near.forEach(({ b, d }, n) => { b.sprite.visible = n < 8 && d < 160 && d > 3.5; }); }
      // (the 16 nearest entrances' openings cut through their walls)
      for (const op of this.openings) op.d = Math.hypot(op.wx - this.pos.x, op.wy - this.pos.y);
      this.openings.sort((a, b) => a.d - b.d); setOpenings(this.openings.slice(0, 16).filter(op => op.d < 170));
      this.provideGateBicycles();
      const [i, j] = tileOf(this.origin, this.pos.x, this.pos.y);
      if (!this.scanned.has(`${i}_${j}`)) void this.scanEntrances();
      for (const entrance of this.entrances) if (Math.hypot(entrance.x - this.pos.x, entrance.y - this.pos.y) < 180) this.provideBicycle(entrance, false);
    }
    this.world.frame(2);
    this.placeCamera(dt, false);
    this.ground?.update(dt, this.camera);
    this.followSun();
    this.markerMat.opacity = 0.35 + 0.25 * Math.sin(now / 300);
    if (this.pendingBicycle && now - this.bicycleRetryAt > 1000) { this.bicycleRetryAt = now; this.provideBicycle(this.pendingBicycle); }
    this.publishBicycle();
    this.publishCar();this.drivenCars?.visibleFrom(this.pos.x,this.pos.y);
    this.carBatches?.update(this.camera);
    this.nightLighting?.update(now,this.camera,this.entrances,this.traffic,this.drivenCars);
    // the nearest entrance within 3 m
    let near: Entrance | null = null, nd = 3;
    if (!this.cycling&&!this.driving) for (const e of this.entrances) { const d = Math.hypot(e.x - this.pos.x, e.y - this.pos.y); if (d < nd) { nd = d; near = e; } }
    // (or in its lobby, past the doors)
    if (!near && !this.cycling && !this.driving) for (const op of this.openings) {
      if (op.d > 12) break;
      const dx = this.pos.x - op.wx, dy = this.pos.y - op.wy, along = -dx * Math.sin(op.e.heading) + dy * Math.cos(op.e.heading), out = dx * Math.cos(op.e.heading) + dy * Math.sin(op.e.heading);
      if (Math.abs(along) < op.hw && out < 0.5 && out > -op.depth) { near = op.e; break; }
    }
    if (near !== this.near) { this.near = near; this.o.onNear?.(near); }
    this.renderer.render(this.scene, this.camera);
  };

  private move(dt: number) {
    const k = this.keys;
    let fx = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) + this.stick.x;
    let fz = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) + this.stick.y;
    const l = Math.hypot(fx, fz); if (l > 1) { fx /= l; fz /= l; }
    if(this.driving){this.moveCar(dt,fx,fz);return;}
    if (this.cycling) { this.moveBicycle(dt, fx, fz); return; }
    const run = k.has("ShiftLeft") || k.has("ShiftRight") || this.runStick, speed = run ? 10.5 : 1.4;
    // the frame: x east, y north; the camera's forward is −z in three = +y in the frame
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = (fx * cy - fz * sy) * speed, wy = (fx * sy + fz * cy) * speed;
    const a = 1 - Math.exp(-dt * 8);
    this.vel.x += (wx - this.vel.x) * a; this.vel.y += (wy - this.vel.y) * a;
    let nx = this.pos.x + this.vel.x * dt, ny = this.pos.y + this.vel.y * dt;
    // buildings, poles and cars stop the walker (slide along)
    // (and the edge of what's loaded: the world streams round the walker, so another complex is
    // reached on foot — a wall once stood 500 m round the start)
    const blocked = (x: number, y: number) => !this.world.ready(x, y) || this.blocked(x, y, 1, 0);
    if (blocked(nx, ny)) { if (!blocked(nx, this.pos.y)) ny = this.pos.y; else if (!blocked(this.pos.x, ny)) nx = this.pos.x; else { nx = this.pos.x; ny = this.pos.y; } }
    const moved = Math.hypot(nx - this.pos.x, ny - this.pos.y);
    this.pos.set(nx, ny);
    const s = this.surfaceAt(nx, ny, this.z);
    if (Number.isFinite(s)) this.z += (s - this.z) * Math.min(1, dt * 12);
    const vl = Math.hypot(this.vel.x, this.vel.y) || 1;
    Object.assign(this.body, { x: nx, y: ny, hx: this.vel.x / vl, hy: this.vel.y / vl, speed: moved / Math.max(dt, 1e-4), z: this.z });
    this.avatar.update(dt, moved / Math.max(dt, 1e-4));
    this.avatar.root.position.set(nx, this.z, -ny);
    if (moved > 1e-4) this.avatar.root.rotation.y = Math.atan2(this.vel.x, -this.vel.y);
    this.stepAcc += moved;
    if (this.stepAcc > (run ? 3.4 : 0.7)) { this.stepAcc = 0; this.o.sound.step("stone", run); }
  }

  private moveBicycle(dt: number, steer: number, pedal: number) {
    const motion = this.bicycleMotion;
    // (S brakes, and held at a stand rolls the bike back: out of a corner it rode into)
    const space = this.keys.has("Space"), back = Math.max(0, -pedal);
    const brake = space ? 1 : motion.speed > 0.05 ? back : 0, reverse = space ? 0 : motion.speed <= 0.05 ? back : 0;
    const distance = motion.step(dt, { throttle: Math.max(0, pedal), brake, steer, reverse }, this.clearBicycle);
    this.o.sound.bicycle({ speed: Math.abs(motion.speed), pedal: Math.max(0, pedal), brake });
    this.pos.set(motion.x, motion.y);
    // (stood on the higher of its two wheels' contacts, risen to it at once and eased down only: a
    // bike sank into the paving — its height was the drive world's coarser one, under what is drawn)
    const hx = Math.cos(motion.heading), hy = Math.sin(motion.heading);
    const height = Math.max(this.surfaceAt(motion.x + hx * 0.57, motion.y + hy * 0.57, this.z), this.surfaceAt(motion.x - hx * 0.56, motion.y - hy * 0.56, this.z));
    if (Number.isFinite(height)) this.z = height > this.z ? height : this.z + (height - this.z) * Math.min(1, dt * 14);
    const bike = this.bicycles.active!;
    Object.assign(bike, { x: motion.x, y: motion.y, z: this.z, heading: motion.heading });
    Object.assign(this.body, { x: motion.x, y: motion.y, hx: Math.cos(motion.heading), hy: Math.sin(motion.heading), speed: Math.abs(motion.speed), z: this.z });
    this.bicycles.update(distance, motion.steer, motion.speed);
    this.avatar.pedal(distance, motion.steer); this.avatar.update(dt, 0);
    this.avatar.root.position.set(motion.x, this.z, -motion.y);
    this.avatar.root.rotation.set(0, Math.atan2(this.body.hx, -this.body.hy), -motion.steer * Math.min(Math.abs(motion.speed) / 10, 1) * 0.45);
    // Follow turns without preventing the mouse/touch camera from looking around.
    if (Math.abs(steer) > 0.03 && motion.speed > 0.1) {
      const target = Math.atan2(-this.body.hx, this.body.hy), delta = Math.atan2(Math.sin(target - this.yaw), Math.cos(target - this.yaw));
      this.yaw += delta * Math.min(1, dt * 3.5);
    }
  }

  private placeCamera(dt: number, snap: boolean) {
    if(this.driving){this.avatar.root.visible=this.view==="third";this.drivenCars!.camera(this.camera,this.view==="first",this.yaw,this.pitch,dt,(x,y)=>this.world.buildingAt([x,y]));const a=this.drivenCars!.active!,b=a.vehicle.body;this.rearCameraOcclusion.update(this.camera,this.view==="third"?{x:b.x,y:b.y,z:a.record.z,height:a.record.height,width:a.record.width}:null);return;}
    this.rearCameraOcclusion?.update(this.camera,null);
    const cam = this.camera;
    const look = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const head = new THREE.Vector3(this.pos.x, this.z + (this.cycling ? 1.78 : 1.6), -this.pos.y);
    this.avatar.root.visible = this.view === "third";
    if (this.view === "first") { cam.position.copy(head); cam.lookAt(head.clone().add(look)); return; }
    const want = head.clone().addScaledVector(look, this.cycling ? -4.6 : -3.6).add(new THREE.Vector3(0, 0.5, 0));
    // A wall used to shrink the boom below 1.1 m and hide the whole avatar. After
    // repeated dismounts that state could persist. Keep third person visible and
    // find a clear side/overhead view instead of changing avatar visibility.
    const probe = new THREE.Vector3();
    const shorten = (target: THREE.Vector3) => {
      const samples = Math.ceil(target.distanceTo(head) / 0.15);
      for (let i = 1; i <= samples; i++) {
        probe.copy(head).lerp(target, i / samples);
        if (this.world?.buildingAt([probe.x, -probe.z]) > probe.y - 0.2 || (this.nightLighting?.cameraHeight(probe.x,-probe.z)??0)>probe.y-.2 || this.parkedCars?.cameraBlocked(probe.x,-probe.z,probe.y)) {
          target.lerpVectors(head, target, Math.max(0, (i - 2) / samples)); break;
        }
      }
      return target.distanceTo(head);
    };
    let clearance = shorten(want), fallback = clearance < 2.4;
    if (fallback) {
      const boom = new THREE.Vector3(-look.x, 0, -look.z).normalize().multiplyScalar(this.cycling ? 4.6 : 3.6);
      for (const angle of [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI * 0.75, -Math.PI * 0.75, Math.PI]) {
        const candidate = boom.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle).add(head); candidate.y += 0.8;
        const distance = shorten(candidate);
        if (distance > clearance) { clearance = distance; want.copy(candidate); }
        if (clearance >= 3) break;
      }
      if (clearance < 2.4) { const overhead = head.clone().add(new THREE.Vector3(0.1, 3.2, 0.1)); if (shorten(overhead) > clearance) want.copy(overhead); }
    }
    const g = this.world?.surfaceAt(want.x, -want.z, this.z);
    if (Number.isFinite(g)) want.y = Math.max(want.y, g + 0.4);
    if (snap || fallback || !this.camInit || this.parkedCars?.cameraBlocked(this.camEye.x,-this.camEye.z,this.camEye.y) || want.distanceTo(head) < this.camEye.distanceTo(head)) { this.camEye.copy(want); this.camInit = true; } else this.camEye.lerp(want, 1 - Math.exp(-dt * 10));
    this.avatar.root.visible = true;
    cam.position.copy(this.camEye);
    cam.lookAt(fallback ? new THREE.Vector3(this.pos.x, this.z + 1.05, -this.pos.y) : head.clone().add(new THREE.Vector3(0, 0.1, 0)).addScaledVector(look, 2));
  }
  private preparedTextures=new WeakSet<THREE.Texture>();
  /** Compile new streamed surfaces and upload shared textures before revealing
   * them. Original world surfaces stay visible until GroundStream marks ready. */
  private async prepareGround(group:THREE.Group){
    if(this.disposed)return;this.nightLighting?.prepare(group);
    const textures=new Set<THREE.Texture>();group.traverse(o=>{const mesh=o as THREE.Mesh;if(!mesh.isMesh)return;for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])for(const value of Object.values(material))if(value instanceof THREE.Texture&&!this.preparedTextures.has(value)&&value.image)textures.add(value);});
    for(const texture of textures){if(this.disposed)return;this.renderer.initTexture(texture);this.preparedTextures.add(texture);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));}
    if(!this.disposed)await this.renderer.compileAsync(group,this.camera,this.scene);
  }
  private followSun() {
    const texel = 140 / this.sun.shadow.mapSize.x, cx = Math.round(this.pos.x / texel) * texel, cz = Math.round(-this.pos.y / texel) * texel;
    this.sun.target.position.set(cx, this.z, cz);
    this.sun.position.set(cx + this.sunDir.x * 300, this.z + this.sunDir.y * 300, cz + this.sunDir.z * 300);
  }

  /** The street as seen from a flat: six views from `height` metres over the door (for its windows). */
  private captureCarReflections() {
    // One local probe prepared behind the loading screen. Cars reflect the actual
    // surrounding buildings/trees, with no six extra scene renders on riding frames.
    const cube = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType });
    const camera = new THREE.CubeCamera(0.5, 550, cube);
    camera.position.set(this.pos.x, this.z + 1.6, -this.pos.y);
    const avatarVisible = this.avatar.root.visible, markersVisible = this.markers.visible;
    this.avatar.root.visible = false; this.markers.visible = false;
    const pm = new THREE.PMREMGenerator(this.renderer);
    try {
      camera.update(this.renderer, this.scene);
      this.carReflectionRT?.dispose(); this.carReflectionRT = pm.fromCubemap(cube.texture);
      this.scene.traverse(object => {
        const material = (object as THREE.Mesh).material;
        if (!material) return;
        for (const m of Array.isArray(material) ? material : [material]) if (m.userData.carModel) {
          (m as THREE.MeshStandardMaterial).envMap = this.carReflectionRT!.texture; m.needsUpdate = true;
        }
      });
    } finally { this.avatar.root.visible = avatarVisible; this.markers.visible = markersVisible; cube.dispose(); pm.dispose(); }
  }

  /** The street as seen from a flat: six views from `height` metres over the door (for its windows). */
  captureView(e: Entrance, height: number): THREE.CubeTexture {
    this.viewRT?.dispose();
    const rt = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const cam = new THREE.CubeCamera(1, 3000, rt);
    // (from the façade, a little out: not from inside the building's own walls)
    cam.position.set(e.x + Math.cos(e.heading) * 0.5, this.z + height, -(e.y + Math.sin(e.heading) * 0.5));
    const vis = this.avatar.root.visible; this.avatar.root.visible = false; this.markers.visible = false;
    cam.update(this.renderer, this.scene);
    this.avatar.root.visible = vis; this.markers.visible = true;
    this.viewRT = rt;
    return rt.texture;
  }

  resize(w: number, h: number) { this.renderer.setSize(w, h, false); this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix(); }

  dispose() {
    this.disposed = true; this.running = false;
    this.o.sound.stopBicycle();
    cancelAnimationFrame(this.raf); this.window(false);
    this.rooftops?.dispose(); this.ground?.dispose(); this.world?.dispose(); this.traffic?.dispose(); this.signals?.dispose(); this.mats?.dispose();
    this.carMaterial?.emissiveMap?.dispose(); this.carMaterial?.dispose(); this.carReflectionRT?.dispose();
    this.carBatches?.dispose();this.nightLighting?.dispose();
    this.drivenCars?.dispose();this.parkedCars.dispose();
    this.carGlazingMeshes.forEach(m => m.dispose()); this.carGlass?.dispose(); this.loadedCars?.dispose();
    this.markers.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); const mt = m.material as THREE.Material; if (mt !== this.markerMat && !mt.userData.entranceShared) mt.dispose(); } });
    this.entranceParts.forEach(p => p.dispose()); this.entranceParts = []; disposeEntranceShared(); this.openings = []; setOpenings([]);
    this.markerMat.dispose(); this.viewRT?.dispose();
    this.envRT?.dispose();
    this.sky.geometry.dispose(); this.sky.material.dispose(); this.avatar.dispose(); this.bicycles.dispose();
    this.apartmentSurface?.dispose(); this.apartmentDetails?.dispose();
    this.sun.shadow.map?.dispose();
  }
}
