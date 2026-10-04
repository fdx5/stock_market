import { safeCompileAsync } from "./safeCompile";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMediaQuery } from "../useMediaQuery";
import { captionedShot, saveImage3d, shareLink3d, view3dUrl, type ShareStage } from "./share3d";
import { OnScreen } from "./mapExport";
import KakaoIcon from "./KakaoIcon";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { fastMergeVertices } from "./fastMerge";
import { api, RealEstateBuilding, RealEstateBuildingsResponse, RealEstateNearbyComplex, RealEstateParcel, RealEstateRoad, type DriveBoard } from "../api/client";
import { vworldBuildingNames, vworldBuildings, vworldPointArea, vworldNearbyParcels, vworldParcels, vworldRoads, vworldRoadsAround, vworldRoadFootprints, withoutDemolished, withoutStrays, parcelBox } from "./vworldBuildings";
import {
  CONTEXT_FLOOR_M, ContextStyle, contextStyle, landmarkLabel, sharedContextMaterial, sharpenNeighbourhood, seasonGround, warmMaterials, dirFrom, FinishShader, BAY_M, FLOOR_M, GROUND_M, inRing, Look, atmosphereLook,
  moonInSky, paintGroundSteps, waterCovered, type Ring, Planting, runSliced, facadeSteps, plinthSteps, sharedContextTexturesSliced, paletteFor, patchMaterial, patchSky, precipField, rng, shared, Tod, Weather, WEATHER_ORDER, WEATHER_LABEL, WEATHER_ICON, hourNow, hourForTod, sunAt, phaseLabel, formatHour,
} from "./complexScene";
import { paintAhead, paintStats, paintTextures, plinthTone, prefetchPaint } from "./paintClient";
import "../desk2/realestate-hologram.css";
import type { ComplexRenderer, Quality } from "./tidewater/ComplexRenderer";
import { endWalls, facadeRelief } from "./tidewater/facadeRelief";
import { textureBudgetEnabled } from './textureBudget';
import {plantingSnapshot,samePlanting} from './plantingSnapshot';
import { loadBuildings, saveBuildings } from "./buildingStore";
import { buildPlants, preloadPlants } from "./scenePlants";
import { vehicleShapes } from "./vehicleClient";
import { buildLamps, buildRoadMarkings, buildRoadSurface, buildTraffic, stitchedRoads,preloadTraffic,type TrafficArms } from "./sceneStreet";
import { FLAT, gradeRoads, gridNormals, loadTerrain, preconnectTerrain, Terrain } from "./sceneTerrain";
import { buildSidewalks, carriageway, ringIndex, sidewalkRuns, streetTrees } from "./sceneSidewalk";
import { buildWalkers, cutPaths, ringPaths, sidewalkPaths, WalkPath } from "./sceneWalkers";
import { buildWater } from "./sceneWater";
import { buildBoats, noBoatsReason, prepareWakes } from "./sceneBoats";
import { buildKids, schoolBorders } from "./sceneKids";
import type { Palette } from "./complexScene";
import { convexHull, photoBuildings, photoBuildingsNear, photoColours, photoRhythm, photoWallPaint, surveyedShape, type PhotoBuilding, type WallPaint } from "./vworld3d";
import { aerialColours } from "./aerial";
import { buildBalloon, type Balloon } from "./sceneBalloon";
import { disposeControls, releaseRenderer } from "../threeCleanup";
import { frameSlice } from "./frameSlice";
import { SceneResources } from "./sceneResources";
import { makeGroundGeometry } from "./groundGeometry";
import { drapeRoadSurface,raiseRoadPaint,roadSurfaceHeight } from "./roadDrape";
import { drapeRoadOffThread } from './roadDrapeClient';
import {constrainRoadCorridors}from'./roadCorridors';
import {modelBlocksRoad}from'./roadModelConflict';
import {roadFootprints}from'./roadJunctions';
import {splitRoadJunctions}from'./roadTrafficNetwork';
import {excludeSurface}from'./surfaceExclusion';
import { sceneWork } from "./sceneWorkerClient";
import type { SceneOps } from "./sceneWorker";
import { neighbourArrays, neighbourGeometry } from "./neighbourGeometry";
import { retainSceneMemory } from "./sceneMemory";
import { ringBuildings } from "./ringBuildings";
import { farGround } from "./farGround";
import { coverPage } from "./pageCover";
import type { HeroName } from "./heroVehicles";
import { cockpit, DRIVE_SPECS, DriveSim, EngineSound, PoleGrid, solidGrid, type Keys, type SolidGrid } from "./driveSim";
import { damageSfx, vehicleFx } from "./driveFx";
import { feelSfx, fuelCans, navVoice, pickupPlan, screech, sparks, type PickupKind } from "./driveFeel";
import { beacon, cutFrom, drawMinimap, goldFor, lengthOf, nextTurn, progressOn, routeRibbon, sfx, type Pt, type TurnKind } from "./driveGame";

/** health a repair kit gives back */
const REPAIR_HP = 35;

interface DriveState {
  /** the view re-centring under it (the new model building): no re-routing, no water test */
  hopping?: boolean;
  name: HeroName;
  sim: DriveSim;
  /** taken over from the traffic (a driving key pressed) */
  manual: boolean;
  keys: Keys;
  view: "chase" | "cockpit";
  sound: EngineSound;
  cab: ReturnType<typeof cockpit> | null;
  solids: SolidGrid | null;
  /** looking round (a drag): yaw, pitch; eased back in the chase view */
  look: { yaw: number; pitch: number; held: boolean };
  /** the gauges (DOM, written directly each frame) */
  hud: { speed: HTMLElement | null; gear: HTMLElement | null; revs: HTMLElement | null; hint: HTMLElement | null; fuel: HTMLElement | null };
  lastSpeed: number;
  baseFov: number;
  /** a knock's shake of the camera, dying away */
  shake: number;
  /** the delivery under way (driveGame) */
  game: DeliveryGame | null;
  /** the vehicle's health (100 new, 0 exploded), its smoke, fire and explosion, its wreck */
  hp: number; dead: boolean; fx: ReturnType<typeof vehicleFx>; wreck: THREE.Mesh | null;
  fireStop: ((secs?: number) => void) | null; warnAt: number; hitAt: number;
  hurt: (n: number) => void;
  blowUp: (why: "fuel" | "water") => void; onDry: () => void; onWarn: () => void; onPickup: (kind: PickupKind) => void;
  /** health back (a repair kit), up to 100 */
  heal: (n: number) => void;
  /** Fuel (metres of driving left) and the tank for this delivery (its way's length, with some
   * to spare); when it ran dry (ms; 0 while there is some). */
  fuel: number; fuelCap: number; dryAt: number;
  /** where the drive began (the vehicle comes back there after going into the water) */
  home: { x: number; y: number; hx: number; hy: number };
  /** this drive's score: the gold earned in it */
  earned: number; delivered: number;
  /** where the trees' detail was last centred on the vehicle */
  focusAt: [number, number];
  /** the feel (driveFeel): squeal, sparks, the brake lamps, fuel cans, the voice; the acceleration
   * felt (m/s², smoothed), the warnings given (0 none, 1 low, 2 critical) */
  feel: {
    squeal: ReturnType<typeof screech>; sparks: ReturnType<typeof sparks>; cans: ReturnType<typeof fuelCans>; voice: ReturnType<typeof navVoice>;
    lamps: THREE.Group; prevV: number; acc: number; fuelWarn: number; hpWarn: number; boostOn: boolean; paint: { mat: THREE.MeshStandardMaterial; color: THREE.Color; rough: number } | null;
    fx: HTMLElement | null; fuelText: HTMLElement | null;
  };
}
/** Brake lamps' place on each vehicle (its frame: x across, y up, z forward): centre height, rear z, half spread. */
/** The tail lamps that light as brake lamps (the vehicle's frame: x across, y up, z forward; w x h). */
const BRAKE_LAMPS: Record<HeroName, { x: number; y: number; z: number; w: number; h: number }[]> = {
  coupang: [-1, 1].map(s => ({ x: s * 0.72, y: 0.72, z: -2.665, w: 0.29, h: 0.17 })),
  cyber: [{ x: 0, y: 1.26, z: -2.925, w: 1.97, h: 0.062 }, ...[-1, 1].map(s => ({ x: s * 0.95, y: 1.19, z: -2.925, w: 0.07, h: 0.14 }))],
};
/** The driven vehicle's brake lamps: two red glows at its tail (shown while braking). */
function brakeLamps(name: HeroName) {
  const g = new THREE.Group(); g.name = "brake lamps"; g.matrixAutoUpdate = false; g.visible = false;
  // (lit lenses the size of the tail lamps, just proud of them: a large soft glow plane over
  // them had read as a smeared, blocky patch)
  const mat = new THREE.MeshBasicMaterial({ color: "#ff2010", toneMapped: false });
  for (const p of BRAKE_LAMPS[name]) { const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, 0.02), mat); m.position.set(p.x, p.y, p.z); g.add(m); }
  return g;
}
const SCORCH = new THREE.Color("#3b3330");
/** The body's own surface by its health: darker, duller, scorched toward nothing left. */
function paintDamage(dv: DriveState) {
  const p = dv.feel.paint;
  if (!p) return;
  const k = 1 - Math.max(0, Math.min(100, dv.hp)) / 100;
  p.mat.color.copy(p.color).lerp(SCORCH, k * 0.62);
  p.mat.roughness = Math.min(1, p.rough + k * 0.45);
}
/** The tank for a way of `wayM` metres: the way half again, and 250 m to spare. */
const tankFor = (wayM: number) => Math.round(wayM * 1.5 + 250);
const DEAD_KEYS: Keys = { up: false, down: false, left: false, right: false, hand: true };
/** Out of fuel: steering and the brakes only. */
const dryKeys = (k: Keys): Keys => ({ up: false, down: false, left: k.left, right: k.right, hand: k.hand || k.down });

interface DeliveryGame {
  dest: { id: string; name: string; x: number; y: number };
  /** the way there (road polyline) and its length when the delivery began */
  way: Pt[]; wayLen0: number;
  started: number; knocks: number; knockAt: number;
  routedAt: number; mapAt: number; pinged: string; said: string;
  /** the turns already announced (where they are), and when re-routing was last said */
  spoken: { kind: TurnKind; x: number; y: number }[]; rerouteSaidAt: number;
  ribbon: ReturnType<typeof routeRibbon>; beacon: ReturnType<typeof beacon>;
  done: boolean;
  hud: { name: HTMLElement | null; dist: HTMLElement | null; gold: HTMLElement | null; time: HTMLElement | null; turn: HTMLElement | null; turnDist: HTMLElement | null; map: HTMLCanvasElement | null };
  onArrive: (r: DeliveryResult) => void;
}
interface DeliveryResult { name: string; wayM: number; secs: number; knocks: number; gold: ReturnType<typeof goldFor>; total: number; stars: number }
const TURN_LABEL: Record<TurnKind, [string, string]> = {
  left: ["↰", "좌회전"], right: ["↱", "우회전"], uturn: ["↶", "유턴"], straight: ["↑", "직진"], arrive: ["◎", "목적지 부근"],
};
const GOLD_KEY = "kospimap.drive.gold";
const GAME_KEY = "kospimap.devgame";
/** The driving game shown? Only to whoever opened the view with ?devgame=1 (remembered here). */
function gameUnlocked() {
  try {
    const q = new URLSearchParams(location.search).get("devgame");
    if (q === "1") localStorage.setItem(GAME_KEY, "1");
    else if (q === "0") localStorage.removeItem(GAME_KEY);
    return localStorage.getItem(GAME_KEY) === "1";
  } catch { return new URLSearchParams(location.search).get("devgame") === "1"; }
}
/** The player on the score board: an anonymous id made once in this browser, and a nickname. */
const PLAYER_KEY = "kospimap.drive.player", NAME_KEY = "kospimap.drive.name";
function playerId() {
  try {
    let id = localStorage.getItem(PLAYER_KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(PLAYER_KEY, id); }
    return id;
  } catch { return null; }
}
function playerName() { try { return localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; } }
function setPlayerName(n: string) { try { localStorage.setItem(NAME_KEY, n); } catch { /* private window */ } }
function goldTotal() { try { return Number(localStorage.getItem(GOLD_KEY)) || 0; } catch { return 0; } }
function addGold(n: number) { const t = goldTotal() + n; try { localStorage.setItem(GOLD_KEY, String(t)); } catch { /* private window */ } return t; }

/** One frame of the delivery: the way re-found now and then from where the vehicle is (so a
 * wrong turn is put right), the green line and the directions, the minimap; arrival. */
function deliveryTick(st: Stage, dv: DriveState, g: DeliveryGame, sec: number, _terrain: Terrain) {
  const tr = st.traffic, c = tr?.hero(dv.name);
  if (!tr || !c || g.done) return;
  const now = performance.now();
  { const e = g.way[g.way.length - 1]; g.ribbon.update(sec); g.beacon.update(sec, Math.hypot(c.x - e[0], c.y - e[1])); }
  let p = progressOn(g.way, c.x, c.y);
  // (off the way by more than a lane: found again at once, and said so)
  const offWay = p.off > 7;
  if (!dv.hopping && now - g.routedAt > (offWay ? 350 : 1200)) {
    g.routedAt = now;
    const r = tr.route(c.x, c.y, g.dest.x, g.dest.y);
    if (offWay && dv.manual && now - g.rerouteSaidAt > 15000) { g.rerouteSaidAt = now; dv.feel.voice.say("경로를 재탐색합니다"); }
    if (r && r.line.length > 1) {
      // (the line starts from the vehicle itself)
      g.way = [[c.x, c.y], ...r.line];
      p = progressOn(g.way, c.x, c.y);
      g.ribbon.set(cutFrom(g.way, p.along + 3));
      const end = g.way[g.way.length - 1];
      g.beacon.place(end[0], end[1], tr.groundAt(end[0], end[1]));
    }
  }
  const rest = cutFrom(g.way, p.along), left = Math.max(0, p.total - p.along);
  const turn = nextTurn(rest), secs = (now - g.started) / 1000;
  const h = g.hud, m = left >= 1000 ? `${(left / 1000).toFixed(1)} km` : `${Math.round(left)} m`;
  if (h.dist && h.dist.textContent !== m) h.dist.textContent = m;
  const tt = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
  if (h.time && h.time.textContent !== tt) h.time.textContent = tt;
  const est = String(goldFor(g.wayLen0, secs, g.knocks).total);
  if (h.gold && h.gold.textContent !== est) h.gold.textContent = est;
  const [icon, word] = TURN_LABEL[turn.kind];
  if (h.turn && h.turn.textContent !== icon) h.turn.textContent = icon;
  const td = turn.kind === "arrive" ? word : turn.kind === "straight" ? `${word} ${Math.round(turn.dist)} m` : `${Math.round(Math.max(0, turn.dist) / 5) * 5} m 앞 ${word}`;
  if (h.turnDist && h.turnDist.textContent !== td) h.turnDist.textContent = td;
  // a ping as a turn comes up (once each)
  const key = `${turn.kind}:${Math.round((p.along + turn.dist) / 10)}`;
  if (turn.kind !== "straight" && turn.dist < 60 && g.pinged !== key) { g.pinged = key; sfx.ping(dv.sound.ctx, dv.sound.master); }
  // spoken once a turn: by where the turn is (the way is found again from the vehicle now and
  // then, and a turn counted from its start came round as a new one, said over and over)
  if (dv.manual && turn.kind !== "straight" && turn.dist < 130) {
    const [tx, ty] = cutFrom(g.way, p.along + Math.max(0, turn.dist))[0];
    if (!g.spoken.some(s => s.kind === turn.kind && Math.hypot(s.x - tx, s.y - ty) < 30)) {
      g.spoken.push({ kind: turn.kind, x: tx, y: ty });
      const phrase = turn.kind === "arrive" ? "목적지 부근입니다" : word;
      dv.feel.voice.say(turn.kind === "arrive" || turn.dist < 40 ? phrase : `${Math.round(turn.dist / 10) * 10}미터 앞, ${phrase}`);
    }
  }
  if (h.map && now - g.mapAt > 50) {
    g.mapAt = now;
    drawMinimap(h.map, tr.arms.roads as { line: Pt[]; width: number }[], rest, c, g.way[g.way.length - 1]);
  }
  // Arrived: at the end of the way, slowed down.
  const end = g.way[g.way.length - 1];
  if ((left < 14 || Math.hypot(c.x - end[0], c.y - end[1]) < 12) && Math.abs(c.speed) < 9 && secs > 2) {
    g.done = true;
    const gold = goldFor(g.wayLen0, secs, g.knocks), total = addGold(gold.total);
    // (the mission done: the tank filled)
    dv.fuel = dv.fuelCap; dv.dryAt = 0; dv.earned += gold.total; dv.delivered++;
    const par = g.wayLen0 / 8, stars = g.knocks === 0 && secs < par ? 3 : secs < par * 1.4 && g.knocks <= 2 ? 2 : 1;
    sfx.chime(dv.sound.ctx, dv.sound.master); sfx.coins(dv.sound.ctx, gold.total, dv.sound.master);
    dv.feel.voice.say("목적지에 도착했습니다. 배송 완료!", true);
    g.ribbon.mesh.visible = false; g.beacon.group.visible = false;
    g.onArrive({ name: g.dest.name, wayM: g.wayLen0, secs, knocks: g.knocks, gold, total, stars });
  }
}
import { bridgeHeight, buildBridges, findBridges } from "./sceneBridges";
import { groundPlan } from "./groundClient";

/* 부동산 맵 — one complex in natural light. Footprints, heights and the parcel are the
 * real ones (backend app/services/realestate_buildings.py: 국토부 GIS건물통합정보 via
 * VWorld, else OpenStreetMap), standing on the real relief (sceneTerrain.ts: SRTM with
 * roofs filtered out); every registered neighbour within the radius is drawn. Facade
 * paint and glazing are drawn (complexScene.ts); on the surveyed roads come sidewalks,
 * street trees, lamps, traffic and people (sceneSidewalk / sceneStreet / sceneWalkers).
 * Blue sky with clouds, haze, damp ground reflecting on level sites, day / dusk / night.
 *
 * Draw calls: every tower of a complex shares one mesh per material (the merged
 * geometry is what renders); the per-building meshes are kept only for picking. */

function shapeOf(b: RealEstateBuilding): THREE.Shape {
  const [outer, ...holes] = b.rings;
  const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
  holes.forEach(h => shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y)))));
  return shape;
}

/** How far a building is sunk below its lowest ground point: on a slope no side shows a gap. */
const SINK = 3;

/** A footprint extruded from its ground (`ground`, the terrain under it) to its
 * registered height above that ground. Wall uv.y counts storeys from the ground, fitted
 * to the registered floor count at `floorM` per drawn storey. */
function extrude(b: RealEstateBuilding, ground = 0, floorM = FLOOR_M): THREE.ExtrudeGeometry {
  const depth = Math.max(2, b.height - b.base);
  const below = b.base > 0 ? 0 : SINK;
  const geo = new THREE.ExtrudeGeometry(shapeOf(b), { depth: depth + below, bevelEnabled: false, steps: 1 });
  geo.translate(0, 0, ground + b.base - below);
  const uv = geo.getAttribute('uv'), pos = geo.getAttribute('position');
  const k = THREE.MathUtils.clamp(floorM / (depth / Math.max(1, b.floors)), 0.5, 2);
  for (const group of geo.groups) if (group.materialIndex === 1) {
    for (let i = group.start; i < group.start + group.count; i++) uv.setY(i, (1 - (pos.getZ(i) - ground)) * k);
  }
  return geo;
}

/** A neighbour as drawn, compactly: a quad per wall (indexed) and the roof — no floor (it is sunk
 * below the ground anyway) — the same outline, height, wall uv (storeys from the ground, as extrude)
 * and roof uv as ExtrudeGeometry's, in about half its vertex memory (which paid for the 1 km ring:
 * ringBuildings.ts makes those the same way, in its worker). */

/** The ground as one grid over ±G: fine (≈T/100) inside the surveyed square ±T, growing
 * outward to the horizon; heights from the terrain, uv spanning the painted square. */
async function groundGeometry(T: number, G: number, terrain: Terrain, segs: number, pace: () => Promise<boolean>, prepared?: Promise<SceneOps["terrainGround"]["result"] | null> | null): Promise<THREE.BufferGeometry | null> {
  const result = await (prepared === undefined ? sceneWork('terrainGround', {T,G,segs,grid:terrain.grid ?? null}) : prepared)?.catch(() => null);
  if (!await pace()) return null;
  if (!result) return makeGroundGeometry(T,G,terrain,segs,pace);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(result.position,3));
  geo.setAttribute('normal',new THREE.BufferAttribute(result.normal,3));
  geo.setAttribute('uv',new THREE.BufferAttribute(result.uv,2));
  geo.setIndex(new THREE.BufferAttribute(result.index,1));
  geo.userData.grid=result.grid;
  geo.boundingSphere=new THREE.Sphere(new THREE.Vector3(...result.sphere.center),result.sphere.radius);
  return geo;
}

/** The faces of a non-indexed geometry's material groups, one geometry per material index. */
function splitGroups(geo: THREE.BufferGeometry): (THREE.BufferGeometry | undefined)[] {
  const ranges: [number, number][][] = [];
  for (const g of geo.groups) (ranges[g.materialIndex ?? 0] ??= []).push([g.start, g.count]);
  return Array.from(ranges, list => {
    if (!list) return undefined;
    const out = new THREE.BufferGeometry();
    const n = list.reduce((sum, [, c]) => sum + c, 0);
    for (const [name, attr] of Object.entries(geo.attributes) as [string, THREE.BufferAttribute][]) {
      const size = attr.itemSize, arr = new Float32Array(n * size);
      let o = 0;
      for (const [start, count] of list) { arr.set((attr.array as Float32Array).subarray(start * size, (start + count) * size), o); o += count * size; }
      out.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    return out;
  });
}

type Stage = {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  controls: OrbitControls; composer: EffectComposer | null; bloom: UnrealBloomPass | null; finish: ShaderPass | null;
  sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; sky: Sky;
  reflector: Reflector | null; reflStrength: { value: number };
  /** Planar reflection only on level ground (the mirror is one plane). */
  reflectOn: boolean;
  refreshEnv: () => void;
  look: Look;
  /** The clock hour on the slider and the weather: rain and snow ease toward want*
   * (0 … 1) over a second or two; env: when to re-render the WebGL reflections. */
  atmos: { hour: number; rain: number; snow: number; wantRain: number; wantSnow: number; dirty: boolean; envAt: number; lat?: number; lon?: number };
  lit: { windows: THREE.MeshStandardMaterial[]; crowns: THREE.MeshStandardMaterial[]; ground: THREE.MeshStandardMaterial[] };
  /** Per-frame work of the current model (traffic), and what follows the look (lamps). */
  tick: ((dt: number) => void)[]; onLook: ((l: Look) => void)[];
  ground: THREE.Mesh | null; model: THREE.Group | null;
  pickables: THREE.Mesh[];
  intro: { from: THREE.Vector3; to: THREE.Vector3; t0: number } | null;
  /** A smooth camera move (buttons, keys, a double-click on a building): camera and
   * orbit target eased from where they were to where they go. */
  fly: { fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t0: number; dur: number } | null;
  now: number; top: number; dist: number; center: THREE.Vector3;
  /** Lowest ground under the complex (the orbit target never goes below it). */
  floor: number;
  /** Near plane when zoomed out (it shrinks as the camera closes in). */
  nearMax: number;
  hq: boolean; disposeModel: () => void; resume: () => void;
  /** Stop the current model's late extras (the 1 km ring's fetching and building): another
   * complex was chosen, and its loading comes first. */
  stopExtras: () => void;
  /** The model on screen, to keep in view while the next one is built (a move to a neighbouring
   * complex): stop its late additions, and later take it out of the scene and free it. */
  current: { stop: () => void; release: () => void; parts: () => THREE.Object3D[] } | null;
  /** Free a model's materials now that it is off the scene (the WebGPU view keeps unused ones 20 s). */
  forget?: (materials: Set<THREE.Material>) => void;
  /** A new model is built but has not reached the screen yet. */
  unshown: boolean;
  /** One-off work under way after the first frame (the photo pass): its hitches are not the
   * device being slow, so the resolution and quality steps don't judge them. */
  busy: number;
  /** A model being built: its warm-up meshes (pipelines, textures) are already in the scene. */
  building: boolean;
  /** Run once the new model's first frame is on screen (decoration waits for it). */
  onShown: (() => void)[];
  /** Move the live canvases into another stage element (the 크게 보기 layer). */
  attach: (next: HTMLDivElement) => void;
  /** Add decoration; on WebGL its programs compile in parallel before it joins the scene. */
  addWarm: (parent: THREE.Object3D, obj: THREE.Object3D) => void;
  drawReady: (obj: THREE.Object3D) => boolean;
  frame: () => void;
  /** A picture of the next frame drawn, for sharing (null: none wanted). */
  snap: ((frame: Blob | null) => void) | null;
  /** The hot-air balloon circling the complex, and the view from its basket while on
   * (yaw/pitch of the look in radians, fov the zoom; baseFov restored on leaving). */
  balloon: Balloon | null;
  balloonView: { yaw: number; pitch: number; fov: number; baseFov: number;
    /** Moving to another complex: the look turns toward it (a drag hands it back). */
    aim?: THREE.Vector3 } | null;
  /** Place the complexes' name signs (a canvas over the view) for this frame's camera. */
  signs: ((camera: THREE.PerspectiveCamera, w: number, h: number) => void) | null;
  /** The traffic (once made), and the vehicle the camera follows (쿠팡 트럭, 사이버트럭), if any. */
  traffic: Awaited<ReturnType<typeof buildTraffic>> | null;
  follow: HeroName | null;
  /** Driving the followed vehicle: the traffic drives it until a driving key is pressed, then
   * the simulation (driveSim) does; behind it (chase) or from the driver's seat (cockpit). */
  drive: DriveState | null;
  /** the road surface's finer asphalt while driving */
  roadDetail?: (on: boolean) => void;
  /** The trees' full-detail band centred on (x, y) (the driven vehicle); null: the complex again. */
  plantsFocus?: ((x: number, y: number) => void) & ((x: null) => void);
  /** A drive carried across a re-centring (driving on past the drawn area): the vehicle and its
   * old traffic (still ticking, still drawn) until the new traffic takes it; the offset between
   * the two frames; the old model's release, put off until then. */
  carry?: { dv: DriveState; tr: NonNullable<Stage["traffic"]>; tick: ((dt: number) => void)[]; ox: number; oy: number; dz: number; letGo: (() => void) | null; at: number } | null;
  /** The street trees and lamp posts of the model whose traffic is driven (a vehicle runs into them). */
  poles?: { grid: PoleGrid | null } | null;
  /** Open water off the bridges (a driven vehicle that goes in is lost). */
  wetAt?: ((x: number, y: number) => boolean) | null;
  /** The people walking (a driven vehicle can knock them down). */
  crowds: { near(x: number, y: number, r: number): { x: number; y: number }[]; knock(w: { x: number; y: number }, vx: number, vy: number): void }[];
  /** The view's height in CSS pixels. */
  viewH: number;
  /** The route given before the balloon was made (it is made in idle time). */
  balloonRoute?: [THREE.Vector3, number, number] | null;
};

const heightLabel = (b: RealEstateBuilding) =>
  `${b.floors}층 · 높이 ${Math.round(b.height)}m${b.height_source === "measured" ? " (실측)" : b.height_source === "floors" ? " (층수 기준)" : " (추정)"}${b.approved ? ` · ${b.approved}년 사용승인` : ""}`;

/** When the register's buildings are likely not yet the complex's current ones:
 * a complex completed after every tower on its parcel was approved is a rebuild the
 * national data hasn't caught up with; a recent or pre-completion complex may be too. */
function staleNotice(data: RealEstateBuildingsResponse, complexId: string): string | null {
  const towers = data.buildings.filter(b => b.floors >= 5);
  const approved = towers.map(b => b.approved).filter((y): y is number => !!y);
  const latest = approved.length ? Math.max(...approved) : null;
  const built = data.built;
  if (built && latest && latest < built - 1)
    return `자료 갱신 전일 수 있음 · ${built}년 준공 단지인데 건물 자료는 ${latest}년 사용승인 건물입니다(재건축 전 모습일 수 있습니다).`;
  if (complexId.includes(":rights:"))
    return "자료 갱신 전일 수 있음 · 분양·입주권 거래 단지로 준공 전이거나 건물 자료에 아직 반영되지 않았을 수 있습니다.";
  if (built && built >= new Date().getFullYear() - 2 && !latest)
    return "자료 갱신 전일 수 있음 · 최근 준공 단지는 국가 건물 자료에 늦게 반영됩니다.";
  return null;
}

const buildingCache = new Map<string, { at: number; data: RealEstateBuildingsResponse }>();

/** A complex's shapes as the view will use them, started ahead — as soon as the page
 * knows the complex (the pointer resting on its tile, a click, the region's #1): this
 * browser's copy and the server's kept shapes asked together; a server result from
 * OpenStreetMap (its rough outlines: the server abroad can't reach VWorld's registry) given
 * way to the surveyed buildings (GIS건물통합정보) the browser asks VWorld for itself when
 * they come within a few seconds; then the roads and the relief under them. Null when the
 * complex has no kept shapes yet (the view then asks the slower way). */
const prefetched = new Map<string, Promise<RealEstateBuildingsResponse | null>>();
const roadsOf = new Map<string, Promise<RealEstateBuildingsResponse>>();
const terrainOf = new Map<string, Promise<Terrain>>();
const remember = <T,>(m: Map<string, T>, id: string, v: T) => { m.set(id, v); if (m.size > 6) m.delete(m.keys().next().value!); return v; };
export function prefetchComplex(id: string): void { void firstLook(id); }
/** A complex's shapes as the view would load them — the server's, else the surveyed ones the
 * browser asks VWorld for by the parcel — kept for the view to take at once (driving on toward
 * it: re-centring only where there is something to show). */
async function lookAhead(id: string): Promise<RealEstateBuildingsResponse | null> {
  const cached = buildingCache.get(id);
  if (cached && Date.now() - cached.at < 300000) return cached.data;
  const early = await firstLook(id).catch(() => null);
  let res: RealEstateBuildingsResponse | null = early?.found ? early : null;
  if (!res) {
    const peek = await api.realEstateBuildings(id, undefined, true).catch(() => null);
    if (peek?.found) res = peek;
    else if (peek?.vworld_key && peek.query?.parcel) {
      const v = await vworldBuildings(id, peek.query, peek.vworld_key, peek.vworld_domain).catch(() => null);
      if (v?.found) res = { ...v, built: peek.built ?? null, vworld_key: peek.vworld_key, vworld_domain: peek.vworld_domain };
    }
  }
  if (!res?.found || !res.buildings.length) return null;
  buildingCache.set(id, { at: Date.now(), data: res });
  void withRoads(id, res); void terrainOnce(id, res);
  return res;
}
function firstLook(id: string): Promise<RealEstateBuildingsResponse | null> {
  const had = prefetched.get(id);
  if (had) return had;
  const job = (async () => {
    const peekJob = api.realEstateBuildings(id, undefined, true).catch(() => null);
    const kept = await loadBuildings(id).catch(() => null);
    const peek = kept ?? await peekJob;
    if (!peek?.found) return null;
    let res = peek;
    if (!kept && peek.source === "osm" && peek.vworld_key && peek.query?.parcel) {
      const surveyed = await Promise.race([
        vworldBuildings(id, peek.query, peek.vworld_key, peek.vworld_domain).catch(() => null),
        new Promise<null>(r => window.setTimeout(() => r(null), 4000)),
      ]);
      if (surveyed?.found && surveyed.buildings.length >= Math.min(2, peek.buildings.length))
        res = { ...surveyed, built: peek.built ?? surveyed.built ?? null, vworld_key: peek.vworld_key, vworld_domain: peek.vworld_domain };
    }
    // (the roads and the relief start now too: the view finds them under way, or done)
    void withRoads(id, res); void terrainOnce(id, res);
    return res;
  })();
  job.catch(() => prefetched.delete(id));
  return remember(prefetched, id, job);
}
/** The surveyed roads for a result that lacks them (once per complex). */
async function cutSceneSurface(geometry:THREE.BufferGeometry,rings:[number,number][][],pace:()=>Promise<boolean>){
  const result=await sceneWork('surfaceCut',{attributes:Object.entries(geometry.attributes).map(([name,a])=>({name,size:a.itemSize,array:a.array as Float32Array})),index:geometry.index?.array as Uint16Array|Uint32Array??null,rings})?.catch(()=>null);
  if(!await pace())return;
  if(result){geometry.setIndex(result.index?new THREE.BufferAttribute(result.index,1):null);for(const a of result.attributes)geometry.setAttribute(a.name,new THREE.BufferAttribute(a.array,a.size));geometry.computeBoundingSphere();}
  else await excludeSurface(geometry,rings,pace);
}
function withRoads(id: string, res: RealEstateBuildingsResponse): Promise<RealEstateBuildingsResponse> {
  const footprintJob=res.vworld_key&&res.center?vworldRoadFootprints(res,res.vworld_key,res.vworld_domain,RING_M).catch(()=>[]):Promise.resolve([]);
  const correct=async(roads:RealEstateRoad[])=>{
    const footprints=[...await footprintJob,...[...res.buildings,...res.context].filter(b=>b.height>=2.5||b.floors>0).map(b=>b.rings[0])];
    const fixed=await sceneWork('roads',{roads,footprints})?.catch(()=>null)??constrainRoadCorridors(roads,footprints);
    return {...res,roads:fixed,road_building_footprints:footprints};
  };
  if (!res.vworld_key || !res.center) return res.roads?.length?correct(res.roads):Promise.resolve(res);
  const had = roadsOf.get(id);
  if (had) return had;
  // The roads of the whole neighbourhood drawn (RING_M), not the parcel's 150 m the result carries:
  // the traffic, its signals, kerbs and lamps reach as far as the buildings. (The parcel's own,
  // or the result's, where the wider ask is late.)
  const near = res.roads ? Promise.resolve(res.roads) : vworldRoads(res, res.vworld_key, res.vworld_domain).catch(() => null);
  const job = Promise.race([
    vworldRoadsAround(res, res.vworld_key, res.vworld_domain, RING_M).then(r => (r.length ? r : near)).catch(() => near),
    new Promise<RealEstateRoad[] | null>(r => window.setTimeout(() => void near.then(r), 4000)),
  ]).then(roads => roads?.length?correct(stitchedRoads(roads)):res);
  return remember(roadsOf, id, job);
}
function terrainOnce(id: string, res: RealEstateBuildingsResponse): Promise<Terrain> {
  return terrainOf.get(id) ?? remember(terrainOf, id, terrainFor(res));
}

/** The WebGPU device, made ahead of the first view (adapter and device requests take a
 * few hundred ms); only where the view would use WebGPU. */
export function warmGpu(): void {
  const gpu = (navigator as Navigator & { gpu?: { wgslLanguageFeatures?: { has(name: string): boolean } } }).gpu;
  if (!gpu || new URLSearchParams(location.search).get("renderer") === "webgl") return;
  void import("./tidewater/ComplexRenderer").then(m => m.warmDevice()).catch(() => {});
}

/** The real relief under a result, in at most 2.5 s (tiles are cached after the first
 * complex); level ground when it can't be had. Covers the painted ground square. */
async function terrainFor(res: RealEstateBuildingsResponse): Promise<Terrain> {
  if (!res.center) return FLAT;
  const ext = res.buildings.flatMap(b => b.rings[0]).reduce((m, [x, y]) => Math.max(m, Math.hypot(x, y)), 0);
  const radius = Math.min(1400, (ext + 300) * 1.3 + 80);
  return Promise.race([
    loadTerrain(res.center, radius, res.vworld_key).catch(() => FLAT),
    new Promise<Terrain>(r => window.setTimeout(() => r(FLAT), 2500)),
  ]);
}

/** The complexes round a complex (주변 단지 selector), once per complex: where they stand
 * as latitude and longitude, so any complex's view can place them. */
type Nearby = RealEstateNearbyComplex & { lat: number; lon: number };
const nearbyOf = new Map<string, Promise<Nearby[]>>();
function nearbyFor(id: string, res: RealEstateBuildingsResponse): Promise<Nearby[]> {
  const had = nearbyOf.get(id);
  if (had) return had;
  const { lat, lon } = res.center!;
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320, ky = 110_540;
  const job = vworldNearbyParcels(res, res.vworld_key!, res.vworld_domain)
    .then(parcels => (parcels.length ? api.realEstateNearby(id, parcels) : { id, items: [] }))
    .then(r => r.items.map(i => ({ ...i, lat: lat + i.y / ky, lon: lon + i.x / kx })));
  job.catch(() => nearbyOf.delete(id));
  return remember(nearbyOf, id, job);
}
/** Where a latitude and longitude lie from a result's centre: x east, y north (m). */
function metresFrom(center: { lat: number; lon: number }, lat: number, lon: number): [number, number] {
  return [(lon - center.lon) * Math.cos((center.lat * Math.PI) / 180) * 111_320, (lat - center.lat) * 110_540];
}
const BEARINGS = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
const bearing = (x: number, y: number) => BEARINGS[Math.round(((Math.atan2(x, y) * 180) / Math.PI + 360) % 360 / 45) % 8];

/** The land use's square (half its side, metres) and the blank it starts from (farGround.ts:
 * the ground's shader takes the picture from the first frame, so its arrival swaps a texture,
 * never the shader). */
/** The neighbourhood drawn round a complex: buildings and land use out to 600 m (1 km until 10-02 —
 * trimmed for loading and frame rate on modest machines), the far ground a little past it. */
const RING_M = 600, FAR_HALF = 680;
// Start independent geography while buildings/terrain load, and share it across
// the rail and expanded view. Failed requests remain retryable.
const geography = new Map<string, { at: number; promise: Promise<unknown> }>();
function geographyOnce<T>(kind: string, lat: number, lon: number, load: () => Promise<T>): Promise<T> {
  const key = `${kind}:${lat.toFixed(4)}:${lon.toFixed(4)}`;
  const old = geography.get(key);
  if (old && Date.now() - old.at < 300000) return old.promise as Promise<T>;
  const promise = load();
  const entry = { at: Date.now(), promise };
  geography.set(key, entry);
  while (geography.size > 16) geography.delete(geography.keys().next().value!);
  void promise.catch(() => { if (geography.get(key) === entry) geography.delete(key); });
  return promise;
}
const nearbyWater = (lat: number, lon: number) => geographyOnce("water", lat, lon, () => api.realEstateWater(+lat.toFixed(4), +lon.toFixed(4), FAR_HALF));
const nearbyCrossings = (lat: number, lon: number) => geographyOnce("crossings", lat, lon, () => api.realEstateCrossings(+lat.toFixed(4), +lon.toFixed(4), FAR_HALF));
/** Every face a facade (surveyedShape's window map, for buildings whose photograph isn't read). */
const ALL_FACES = { get: () => true } as unknown as Map<string, boolean>;
/** Landmarks drawn as surveyed (VWorld's 3D models: their real height and shape, in the view's own
 * materials) together with everything within `radius` of them,  wherever a view reaches it —
 * not only the ~220 m round the complex. Their registered extrusions are only a footprint raised
 * (롯데월드타워: a 358 m prism for a tapering 555 m tower). */
const LANDMARKS = [{
  name: "롯데월드타워", lat: 37.5125, lon: 127.1027, radius: 500,
  // (official: 123 floors, 555 m; the register's entry spans the tower and the mall, its height 358 m)
  floors: 123, height: 555, minHeight: 300,
  register: "롯데월드타워앤드롯데월드몰", rest: "롯데월드몰",
}];
let farBlank: THREE.Texture | null = null;
const blankFar = () => {
  if (farBlank) return farBlank;
  const c = document.createElement("canvas"); c.width = c.height = 4;
  // (drawn on: WebGPU cannot copy a canvas that has no context)
  const x = c.getContext("2d")!; x.fillStyle = "#000"; x.fillRect(0, 0, 4, 4);
  farBlank = new THREE.CanvasTexture(c);
  farBlank.colorSpace = THREE.SRGBColorSpace; farBlank.flipY = false;
  return farBlank;
};

const WHEEL_ZOOM = 4.8;

/** Yield the main thread: the next task, or (when the view is covered) the next idle
 * period, so input and scrolling elsewhere on the page come first. */
function nextSlice(idle: boolean): Promise<void> {
  return frameSlice(idle ? 7 : 9);
}

/** Like nextSlice, but past the next frame: the browser hands a canvas's recorded drawing
 * to the GPU at the end of a frame, so painting a big canvas in frame-sized pieces gives
 * the GPU its work in pieces too (one 2048 px ground was a single ~170 ms GPU task, and the
 * pointer and the whole page's drawing waited behind it). A hidden page has no frames. */
function nextFrame(idle: boolean): Promise<void> {
  if (idle || document.hidden) return nextSlice(idle);
  return new Promise(resolve => {
    requestAnimationFrame(() => void nextSlice(false).then(resolve));
  });
}

/** The time slider's track: the sky's colour at each hour of today (night, dawn,
 * day, dusk), so the track itself shows where the light is. */
function dayGradient(lat?: number, lon?: number): string {
  const stops: string[] = [];
  for (let h = 0; h <= 24; h += 0.5) {
    const e = sunAt(h, undefined, lat, lon).elev;
    const c = e < -10 ? "#1a2238" : e < -3 ? "#3b3f6e" : e < 3 ? "#d9855a" : e < 12 ? "#f2c07a" : "#8cc8ee";
    stops.push(`${c} ${(h / 24 * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

/** Stands in for the WebGL renderer where the browser gives no WebGL context: the view
 * draws with WebGPU, and this only carries the input canvas and the settings the
 * WebGL-only code writes (it is never asked to draw). */
function inputOnlyRenderer(): THREE.WebGLRenderer {
  const canvas = document.createElement("canvas");
  let ratio = 1, target: THREE.WebGLRenderTarget | null = null;
  return {
    domElement: canvas, shadowMap: { enabled: false, type: THREE.PCFShadowMap }, info: { render: { calls: 0 } },
    outputColorSpace: THREE.SRGBColorSpace, toneMapping: THREE.NoToneMapping, toneMappingExposure: 1,
    setPixelRatio(v: number) { ratio = v; }, getPixelRatio: () => ratio,
    getSize: (t: THREE.Vector2) => t.set(canvas.width, canvas.height), setSize() {},
    getRenderTarget: () => target, setRenderTarget(t: THREE.WebGLRenderTarget | null) { target = t; },
    compileAsync: () => Promise.resolve(), dispose() {},
  } as unknown as THREE.WebGLRenderer;
}

export default function ComplexHologram({ complexId: homeId, complexName: homeName, caption: homeCaption, wide = false, initialTod, paused = false, openFull = 0, onFullChange }: {
  complexId: string | null; complexName?: string; caption?: string;
  /** Each increase opens this view full screen (the map's detail card on a desktop
   * shows its complex here rather than in a second renderer). */
  openFull?: number;
  onFullChange?: (open: boolean) => void;
  /** Covered by something the reader is using (the detail popup): stop drawing, and do
   * any loading only in the browser's idle time. */
  paused?: boolean;
  /** Already the full-screen layer: no "전체화면" button of its own. */
  wide?: boolean; initialTod?: Tod;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  // 주변 단지: a neighbouring complex chosen in the selector is built in full detail and
  // the view centres on it; the page's complex (home) comes back from the same selector.
  // (tied to the home it was chosen from: another complex on the map ends it)
  const [hopState, setHop] = useState<{ id: string; name: string; home: string | null } | null>(null);
  const hop = hopState && hopState.home === homeId ? hopState : null;
  const complexId = hop?.id ?? homeId;
  const complexName = hop?.name ?? homeName;
  const caption = hop ? "주변 단지 · 3D" : homeCaption;
  /** A move under way to another complex: where the view's centre was (to carry the
   * camera and the balloon across when the new model's origin replaces it). */
  const hopRef = useRef<{ id: string; from: { lat: number; lon: number }; terrain: Terrain; drive?: boolean } | null>(null);
  // (the loaded result, for the drive's own checks outside the render)
  const dataRef = useRef<RealEstateBuildingsResponse | null>(null);
  // Driving on past the drawn area: the complexes known round every one passed (their nearby
  // lists), the next to re-centre the view on chosen among them.
  const drivePool = useRef(new Map<string, Nearby>());
  const [nearby, setNearby] = useState<{ home: string; name: string; lat: number; lon: number; items: Nearby[] } | null>(null);
  const hourRef = useRef(0);
  /** Build the current model again (its textures painted afresh). */
  const rebuildRef = useRef<(() => void) | null>(null);
  const weatherRef = useRef<Weather>("clear");
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [data, setData] = useState<RealEstateBuildingsResponse | null>(null);
  dataRef.current = data;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [slowData, setSlowData] = useState(false);
  // Waiting on the building shapes: which attempt (a stalled request is retried), and a
  // manual retry after the last one fails.
  const [dataTry, setDataTry] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  // Controls follow the pointer in use: a touch laptop starts with the mouse set (its
  // primary pointer is fine) and switches when the screen is actually touched.
  const [touchMode, setTouchMode] = useState(() => !!window.matchMedia?.("(pointer: coarse)").matches
    || (navigator.maxTouchPoints > 0 && !!window.matchMedia?.("(hover: none)").matches));
  // Auto-rotation on from the first load (a press on the view or its buttons stops it).
  const [spin, setSpin] = useState(true);
  // The hour on the time slider (?hour= or ?tod= to open elsewhere), and the weather.
  const [hour, setHour] = useState<number>(() => {
    const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
    const h = Number(q?.get("hour"));
    const t = q?.get("tod");
    if (initialTod) return hourForTod(initialTod);
    if (q?.has("hour") && Number.isFinite(h)) return ((h % 24) + 24) % 24;
    return t === "day" || t === "dusk" || t === "night" ? hourForTod(t) : Math.round(hourNow() * 4) / 4;
  });
  const [weather, setWeather] = useState<Weather>(() => {
    const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("weather") : null;
    return q === "rain" || q === "snow" ? q : "clear";
  });
  hourRef.current = hour;
  weatherRef.current = weather;
  // 전체화면: the panel fills the window, as the card's 3D 건물뷰 does on a phone. The
  // rail keeps a slot of the panel's height so the page underneath does not jump.
  const [bigBase, setBigBase] = useState<{ w: number; h: number } | null>(null);
  const [bigSize, setBigSize] = useState<{ w: number; h: number } | null>(null);
  const resizeDrag = useRef<{ id: number; x: number; y: number; w: number; h: number } | null>(null);
  const fitBigSize = (w: number, h: number) => ({
    w: Math.round(Math.min(window.innerWidth, Math.max(760, w))),
    h: Math.round(Math.min(window.innerHeight, Math.max(480, h))),
  });
  const big = !!bigBase;
  const openBig = () => {
    const r = sectionRef.current?.getBoundingClientRect();
    if (!r) return;
    setBigSize(null);
    // (0 × 0 under a page not drawn while a view opens over it — pageCover.ts — the slot left
    // in the rail is then empty)
    setBigBase({ w: r.width, h: r.height });
  };
  const closeBig = useCallback(() => {
    resizeDrag.current = null;
    setBigSize(null);
    setBigBase(null);
  }, []);
  // 카카오톡 공유, as the map pages share: a picture of this view and a link that opens it
  // full screen at this hour and weather (share3d.ts).
  const [shareStage, setShareStage] = useState<ShareStage>("idle");
  const [sharing, setSharing] = useState(false);
  const shareUrl = useRef("");
  const onShare = async () => {
    if (!complexId || sharing) return;
    const name = data?.name ?? complexName ?? "단지";
    shareUrl.current = view3dUrl(complexId, hour, weather);
    setShareStage(await shareLink3d({ url: shareUrl.current, title: `${name} 3D 단지뷰`, text: `${name} 3D 단지뷰 · ${phaseCaption()}` }));
  };
  // 이미지 저장: the next frame drawn, with its caption band.
  const onSaveImage = async () => {
    const st = stageRef.current;
    if (!st || sharing) return;
    setSharing(true);
    try {
      const name = data?.name ?? complexName ?? "단지";
      const frame = await new Promise<Blob | null>(resolve => {
        const timer = window.setTimeout(() => { if (st.snap) { st.snap = null; resolve(null); } }, 1500);
        st.snap = b => { window.clearTimeout(timer); resolve(b); };
        st.resume();
      });
      const image = frame ? await captionedShot(frame, name, phaseCaption()) : null;
      if (image) await saveImage3d(image, name);
    } finally { setSharing(false); }
  };
  const [tip, setTip] = useState<{ x: number; y: number; text: string; pinned: boolean; w: number } | null>(null);
  const [failed3d, setFailed3d] = useState(false);
  // WebGPU-capable browsers start without a WebGL renderer at all (a WebGL context costs
  // ~250 ms of the main thread at start and a share of the GPU): the view is built again in
  // "webgl" mode only if WebGPU fails.
  const [renderMode, setRenderMode] = useState<"auto" | "webgl">("auto");
  const [terrainSource, setTerrainSource] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  // ?hud=1: the view's own numbers on screen (frame rate, frames dropped, GPU time, resolution,
  // quality, renderer), for a reader's device to tell what it does. Written straight into a
  // <pre> twice a second; the frames counted by their own requestAnimationFrame.
  const hudRef = useRef<HTMLPreElement>(null);
  const hudOn = useMemo(() => new URLSearchParams(location.search).get("hud") === "1", []);
  useEffect(() => {
    if (!hudOn) return;
    let raf = 0, last = performance.now(), n = 0, slow = 0, worst = 0, at = last, totalSlow = 0;
    const tick = (t: number) => {
      const dt = t - last; last = t; n++;
      if (dt > 25) { slow++; totalSlow++; } worst = Math.max(worst, dt);
      if (t - at > 500) {
        const d = (document.querySelector<HTMLElement>(".re-holo--expanded .re-holo-stage") ?? hostRef.current)?.dataset ?? {};
        if (hudRef.current) hudRef.current.textContent =
          `fps ${(n * 1000 / (t - at)).toFixed(0)}  drop>25ms ${slow}/0.5s (total ${totalSlow})  worst ${worst.toFixed(0)}ms
` +
          `gpu ${d.gpuMs ?? "-"}ms  ratio ${d.pixelRatio ?? "-"} x dpr ${devicePixelRatio}  quality ${d.quality ?? "-"}  ${d.renderer ?? ""}
` +
          `draws ${d.draws ?? "-"}  ${innerWidth}x${innerHeight}  ${d.trial ?? ""}`;
        n = 0; slow = 0; worst = 0; at = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hudOn]);
  // Button set follows the page layout (the desktop rail from 981 px, as the map page
  // decides), not the pointer: an iPad in the desktop layout gets the desktop controls.
  const narrow = useMediaQuery("(max-width: 980px)");

  useEffect(() => {
    if (!big || narrow) { resizeDrag.current = null; return; }
    const fit = () => setBigSize(size => size ? fitBigSize(size.w, size.h) : null);
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [big, narrow]);

  // One renderer for the panel's lifetime; each complex only swaps the model.
  useEffect(() => {
    if (!hostRef.current) return;
    let host: HTMLDivElement = hostRef.current;
    // Phones and small tablets: no planar reflection or AO, fewer trees, lighter shadows.
    const hq = !window.matchMedia?.("(pointer: coarse)").matches && Math.min(screen.width, screen.height) >= 700;
    // Try the actual WebGPU API. Optional WGSL feature markers are not a
    // capability check; adapter/pipeline failures take the compatibility path.
    const gpu = (navigator as Navigator & { gpu?: { wgslLanguageFeatures?: { has(name: string): boolean } } }).gpu;
    const forceWebgl = renderMode === "webgl" || new URLSearchParams(location.search).get("renderer") === "webgl";
    const nativeCapable = !forceWebgl && !!gpu;
    // WebGL with whichever GPU the browser will give (a blocklisted discrete GPU on a
    // laptop can still leave the integrated one). Where WebGPU will draw, none is made: a
    // stand-in carries the input, and WebGL is set up (renderMode "webgl") only if WebGPU
    // fails.
    let made: THREE.WebGLRenderer | null = null;
    if (!nativeCapable) for (const powerPreference of ["high-performance", "default", "low-power"] as const) {
      try { made = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference }); break; } catch { /* next */ }
    }
    const glMissing = !made;
    if (glMissing && !nativeCapable) { setFailed3d(true); return; }
    const renderer = made ?? inputOnlyRenderer();
    const releaseMemory = retainSceneMemory();
    // Start at the display's ratio; with frame time to spare, supersample a desktop
    // panel toward 2x (sharper facades; the native path has no MSAA). Never climb
    // back past a level that already dropped frames.
    const dpr = window.devicePixelRatio || 1;
    // (a phone at its own pixels, up to 3x: it started at 1.6x and could never climb, so a 3x
    // screen showed a soft picture from the first frame)
    let ratio = Math.min(dpr, hq ? 2 : 3);
    // (a desktop supersamples up to 2x where its GPU has the time: the native view has no MSAA,
    // and at the display's own 1x its window grids and edges shimmered)
    let maxRatio = hq ? 2 : ratio;
    // Desktop: the first ratio from a pixel budget (a panel or a normal window starts well above
    // 1x, a 5K full screen at its own pixels), never above ~14 MP of drawing in all (the render
    // targets of a 5120x1440 screen at 2x would be gigabytes). Measured GPU time climbs from there.
    const PIX_START = 4.5e6, PIX_CAP = 14e6;
    let lastArea = 0;
    // (?pr=1.5: a fixed ratio, for comparing sharpness and GPU time)
    const fixedRatio = Number(new URLSearchParams(location.search).get("pr")) || 0;
    if (fixedRatio) ratio = maxRatio = fixedRatio;
    // High resolution on every device is the rule: never below the display's own pixels
    // (a phone's 3x may step down, never under 1 CSS pixel a pixel).
    const minRatio = Math.min(1, dpr);
    // The last pointer, wheel or key on the view (the loop draws at full rate for 3 s after).
    const touched = () => {};
    renderer.setPixelRatio(ratio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(renderer.domElement);
    let native: ComplexRenderer | null = null;
    let disposed = false;
    let nativePending = nativeCapable || glMissing;
    let wasPreparing = nativePending;
    setPreparing(nativePending);
    // Do not compile both renderers on first load: warm native pipelines behind
    // the loading state, and initialize WebGL lighting only if native fails.
    // Native quality from the device: high quality everywhere is the rule — desktops
    // (panel or full screen) and current phones start high, small-memory or 4-core devices
    // medium; only a tiny-memory device starts low. The GPU time measured once the scene
    // settles steps a genuinely weak GPU down from there.
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    // (a current phone — 8 GB, 8 cores — starts at full quality like a desktop: a small touch
    // screen alone was taken for a weak device; the view still steps down where its GPU proves slow)
    const tier: Quality["name"] = mem <= 2 ? "low" : mem <= 4 || navigator.hardwareConcurrency <= 4 ? "medium" : "high";
    if (nativePending) {
      import("./tidewater/ComplexRenderer").then(m => m.ComplexRenderer.create(host, m.QUALITY[tier])).then(view => {
        if (disposed) { view.dispose(); return; }
        if (view.canvas.parentElement !== host) host.appendChild(view.canvas);
        native = view;
        stage.forget = mats => view.forget(mats);
        if (import.meta.env.DEV) Object.assign(window, { __holoNative: view, __holoGL: renderer, __holoStageAny: stageRef });
        nativePending = false;
        resize();
      }).catch(err => {
        if (disposed) return;
        nativePending = false;
        host.dataset.gpuFallback = String(err).slice(0,240);
        if (glMissing) { console.info("[3D] WebGPU failed, using WebGL:", err); setRenderMode("webgl"); return; }
        refreshEnv();
        resize();
        console.info("[3D] Using WebGL compatibility renderer:", err);
      });
    }

    const scene = new THREE.Scene();
    scene.matrixAutoUpdate = false; // The scene root never moves; dirty children still propagate.
    scene.fog = new THREE.FogExp2("#b9cadb", 0.001);
    const camera = new THREE.PerspectiveCamera(36, 1, 1, 8000);
    camera.position.set(260, 160, 260);
    // Every listener this view puts on its canvas goes when it closes: the canvas stays
    // reachable from materials shared between views (three's dispose listeners), and
    // through these closures it would keep the closed view's scene alive.
    const listening = new AbortController();
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.rotateSpeed = 0.65;
    controls.panSpeed = 0.85;
    // A wheel notch moves ~22 % of the distance (0.95^4.8): overview to a person on the
    // sidewalk in about twenty notches. Pinch uses zoomSpeed as an exponent, so touch
    // keeps a gentle 1 (set per input below).
    controls.zoomSpeed = WHEEL_ZOOM;
    renderer.domElement.addEventListener("wheel", () => { controls.zoomSpeed = WHEEL_ZOOM; }, { capture: true, passive: true, signal: listening.signal });
    renderer.domElement.addEventListener("pointerdown", e => { controls.zoomSpeed = e.pointerType === "touch" ? 1 : WHEEL_ZOOM; }, { capture: true, signal: listening.signal });
    // The usual 3D-viewer gestures, no mode button: one finger turns, two fingers move
    // and pinch together; a mouse turns with the left button and moves with the right.
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    // Pinch zooms toward the point between the two fingers. OrbitControls takes that
    // midpoint in page coordinates (scroll included) but maps it with the element's
    // viewport rectangle, so on a scrolled page the zoom went toward a point off by the
    // scroll: convert to viewport coordinates for that one call.
    {
      type ZoomInternals = { _updateZoomParameters(x: number, y: number): void; _handleTouchMoveDolly(e: PointerEvent): void };
      const c = controls as unknown as ZoomInternals;
      const dolly = c._handleTouchMoveDolly, update = c._updateZoomParameters;
      c._handleTouchMoveDolly = function (this: ZoomInternals, e: PointerEvent) {
        this._updateZoomParameters = (x, y) => update.call(this, x - window.scrollX, y - window.scrollY);
        try { dolly.call(this, e); } finally { this._updateZoomParameters = update; }
      };
    }
    controls.autoRotate = spinRef.current;
    // (by time, not per drawn frame — controls.update(dt) in the loop: per frame, the turn slowed
    // with every late frame while loading, and halved when the view went to its idle rate. This
    // is the speed the idle view turned at, the one seen longest.)
    controls.autoRotateSpeed = 0.275;
    controls.minPolarAngle = 0.12;
    controls.maxPolarAngle = Math.PI / 2 - 0.035;
    // Zoom toward whatever is under the cursor (or between the pinching fingers),
    // anywhere in view, down to a person on the sidewalk; pan freely.
    controls.zoomToCursor = true;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    // Zoom and pan scale with the distance to the orbit target, and zooming to the cursor
    // re-places the target that far in front of the camera. After some panning and
    // turning that distance no longer matches what is on screen: shrunk to the minimum
    // in mid-air, zoom stops and panning crawls; too short, each wheel notch moves only
    // centimetres. So every gesture starts from the surface actually at the centre of
    // the view (a building or the ground), moving the target only along the line of
    // sight: the picture does not jump.
    const aim = new THREE.Raycaster(), ahead = new THREE.Vector3();
    const reanchor = () => {
      const st = stageRef.current;
      if (!st) return;
      camera.getWorldDirection(ahead);
      aim.set(camera.position, ahead);
      aim.far = st.dist * 8;
      let d = aim.intersectObjects(st.pickables, false)[0]?.distance ?? Infinity;
      if (ahead.y < -1e-3) { const g = (st.floor - camera.position.y) / ahead.y; if (g > 0) d = Math.min(d, g); }
      const r = camera.position.distanceTo(controls.target);
      // Looking at the sky: keep a sensible radius rather than the collapsed one.
      const next = Number.isFinite(d) ? d : Math.max(r, st.dist * 0.4);
      if (Math.abs(next - r) < r * 0.02) return;
      controls.target.copy(camera.position).addScaledVector(ahead, Math.max(next, controls.minDistance * 1.5));
    };
    controls.addEventListener("start", reanchor);
    // While zooming, the target follows the cursor; the scene bounds below apply to
    // panning only (pulling the camera back mid-zoom cancelled the zoom).
    // (through the damped frames after it; then the target returns to the surface on
    // the line of sight, which keeps the picture still and the target within bounds)
    let zooming = false, zoomEnd = 0;
    const zoomNow = () => {
      zooming = true;
      clearTimeout(zoomEnd);
      zoomEnd = window.setTimeout(() => { zooming = false; reanchor(); }, 300);
    };
    renderer.domElement.addEventListener("wheel", zoomNow, { capture: true, passive: true, signal: listening.signal });
    const touches = new Set<number>();
    renderer.domElement.addEventListener("pointerdown", e => { if (e.pointerType === "touch") touches.add(e.pointerId); }, { capture: true, signal: listening.signal });
    renderer.domElement.addEventListener("pointermove", e => { if (touches.size > 1 && touches.has(e.pointerId)) zoomNow(); }, { capture: true, signal: listening.signal });
    for (const type of ["pointerup", "pointercancel"] as const) renderer.domElement.addEventListener(type, e => { touches.delete(e.pointerId); }, { capture: true, signal: listening.signal });
    controls.addEventListener("change", () => {
      const t = controls.target, st = stageRef.current;
      if (!st || zooming) return;
      const before = t.clone();
      t.y = Math.min(Math.max(t.y, st.floor), Math.max(st.top, st.dist * 0.5));
      const dx = t.x - st.center.x, dz = t.z - st.center.z, r = Math.hypot(dx, dz), limit = st.dist * 2.5;
      if (r > limit) { t.x = st.center.x + dx / r * limit; t.z = st.center.z + dz / r * limit; }
      // Keep the viewing direction stable when a pan reaches the scene boundary.
      camera.position.add(t.clone().sub(before));
    });

    const sky = new Sky();
    sky.scale.setScalar(40000);
    patchSky(sky.material, (scene.fog as THREE.FogExp2).color);
    scene.add(sky);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(sky.geometry, sky.material));
    const pmrem = made ? new THREE.PMREMGenerator(renderer) : null;
    let envRT: THREE.WebGLRenderTarget | null = null;
    const refreshEnv = () => {
      if (native || nativePending || !pmrem) return;
      const next = pmrem.fromScene(envScene, 0, 0.1, 1000);
      scene.environment = next.texture;
      envRT?.dispose();
      envRT = next;
    };
    preconnectTerrain();
    // The neighbourhood's shared materials start compiling now, behind the data fetch.
    const warm = new THREE.Group();
    scene.add(warm);
    // (WebGL: each warmed style joins the scene once its programs are linked.)
    const warmAdd = warm.add.bind(warm);
    warm.add = (...objs: THREE.Object3D[]) => {
      for (const o of objs) { if (native || nativePending) warmAdd(o); else void glCompile(o).then(() => warmAdd(o)); }
      return warm;
    };
    // (in short task slices, not idle time: during page load idle time hardly comes, and the
    // neighbourhood textures then held up the first complex's build by half a second)
    void warmMaterials(warm, () => nextSlice(false), () => !disposed);
    const moon = moonInSky();
    const precip = precipField();
    scene.add(precip.group);
    scene.add(moon.group);
    // The balloon is made in idle slices once the view is up (it shows only over a complex);
    // a route given before it is ready waits for it (stage.balloonRoute).
    let balloon: Balloon | null = null;

    const hemi = new THREE.HemisphereLight("#c4dcf6", "#6f6552", 0.45);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight("#fff3e0", 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(hq ? 4096 : 2048, hq ? 4096 : 2048);
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.5;
    sun.shadow.radius = 3;
    scene.add(sun, sun.target);

    // Rain-damp ground mirrors the towers: a planar reflection sampled by the ground shader.
    const reflStrength = { value: 0.85 };
    const reflector = made && hq ? new Reflector(new THREE.PlaneGeometry(1, 1), { clipBias: 0.002, textureWidth: 512, textureHeight: 512, multisample: 0 }) : null;
    if (reflector) { reflector.rotation.x = -Math.PI / 2; reflector.updateMatrixWorld(); }

    const target = made ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }) : null;
    /** WebGL programs for `obj` (with this scene's lights and fog), linked in parallel
     * (KHR_parallel_shader_compile) instead of stalling its first draw in turn. Compiled
     * as the composer draws them: into its HDR target (linear, no tone mapping). */
    const glCompile = (obj: THREE.Object3D) => {
      if (!target) return Promise.resolve();
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      const done = safeCompileAsync(renderer, obj, camera, scene);
      renderer.setRenderTarget(prev);
      return done;
    };
    // Native has its own full AO/bloom/reflection passes. Building a second,
    // unused WebGL compositor also generated noise and shaders on the input thread.
    const composer = target ? new EffectComposer(renderer, target) : null;
    composer?.addPass(new RenderPass(scene, camera));
    const gtao = made && hq ? new GTAOPass(scene, camera, 1, 1) : null;
    if (gtao) {
      gtao.updateGtaoMaterial({ radius: 5, distanceExponent: 1.5, thickness: 6, scale: 1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      gtao.blendIntensity = 0.75;
      composer?.addPass(gtao);
    }
    const bloom = made ? new UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.55, 1.15) : null;
    if (bloom) composer?.addPass(bloom);
    if (composer) composer.addPass(new OutputPass());
    const finish = made ? new ShaderPass(FinishShader) : null;
    if (finish) composer?.addPass(finish);

    const stage: Stage = {
      renderer, scene, camera, controls, composer, bloom, finish, sun, hemi, sky, reflector, reflStrength, reflectOn: false, refreshEnv,
      look: atmosphereLook(hourRef.current, 0, 0),
      atmos: { hour: hourRef.current, rain: +(weatherRef.current === "rain"), snow: +(weatherRef.current === "snow"),
        wantRain: +(weatherRef.current === "rain"), wantSnow: +(weatherRef.current === "snow"), dirty: true, envAt: 0 },
      lit: { windows: [], crowns: [], ground: [] }, tick: [], onLook: [],
      ground: null, model: null, pickables: [], intro: null, fly: null,
      now: 0, top: 50, dist: 300, center: new THREE.Vector3(), floor: 0, nearMax: 0.5, hq, disposeModel: () => {}, resume: () => {}, stopExtras: () => {}, current: null, unshown: false, busy: 0, building: false, onShown: [], attach: () => {}, frame: () => {}, snap: null, balloon: null, balloonView: null, signs: null, traffic: null, follow: null, drive: null, crowds: [], viewH: 600,
      addWarm: (parent, obj) => { if (native || nativePending) parent.add(obj); else void glCompile(obj).then(() => parent.add(obj)); },
      drawReady: obj => native ? native.objectsReady(obj) : !nativePending && !!obj.parent,
    };
    stageRef.current = stage;
    if (import.meta.env.DEV) Object.assign(window, { __holoStage: stage });
    const idleBuild = (f: () => void) => { if (typeof requestIdleCallback === "function") requestIdleCallback(f, { timeout: 2500 }); else window.setTimeout(f, 300); };
    idleBuild(() => void buildBalloon(() => frameSlice()).then(b => {
      if (disposed) { b.dispose(); return; }
      balloon = b; stage.balloon = b;
      b.group.visible = false;   // until a complex gives it a route
      b.setLook(stage.look);
      scene.add(b.group);
      const r = stage.balloonRoute;
      if (r) { b.setRoute(r[0], r[1], r[2]); b.group.visible = true; stage.balloonRoute = null; }
    }));
    // Dev only: lets the render checks place the camera (never in a production build).
    if (import.meta.env.DEV || import.meta.env.VITE_FILM === "1") (window as unknown as { __complexStage?: Stage }).__complexStage = stage;

    let W = 1, H = 1;
    // (sizes from the ResizeObserver: reading clientWidth made the browser lay out the page there
    // and then — ~40 ms twice as the view opened, while the page was still being built)
    const resize = (w = W, h = H) => {
      W = Math.round(w); H = Math.round(h);
      if (!W || !H) return;
      stage.viewH = H;
      if (hq && !fixedRatio) {
        const area = W * H, cap = Math.max(minRatio, Math.min(maxRatio, Math.sqrt(PIX_CAP / area)));
        // First size, or a much larger one (full screen): the ratio this GPU should hold at about
        // 10 ms a frame, from its time measured at the size before (all of it taken as growing with
        // the pixels: on the safe side); unmeasured, the pixel budget.
        if (area > lastArea * 1.3) {
          const gpu = native?.timer.enabled ? native.timer.ms.total ?? 0 : 0, drawn = lastArea * ratio * ratio;
          const want = gpu > 0.5 && drawn > 0 ? Math.sqrt((10 / gpu) * drawn / area) : Math.sqrt(PIX_START / area);
          ratio = Math.max(Math.min(dpr, 2), minRatio, Math.min(cap, Math.floor(want * 4) / 4));
        }
        ratio = Math.min(ratio, cap);
        lastArea = area;
      }
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      native?.setSize(W, H, ratio);
      // The WebGL buffers (MSAA HDR target, AO, bloom, reflection) only while WebGL draws:
      // reallocating them on every native resolution step cost frames for nothing.
      if (native || nativePending) return;
      renderer.setPixelRatio(ratio);
      renderer.setSize(W, H, false);
      composer?.setPixelRatio(ratio);
      composer?.setSize(W, H);
      bloom?.setSize(W * ratio / 2, H * ratio / 2);
      reflector?.getRenderTarget().setSize(Math.round(W * ratio * 0.5), Math.round(H * ratio * 0.5));
      if (finish) finish.uniforms.uAspect.value = W / H;
    };
    // (a new canvas size clears it: drawn again at once, before the page paints, not a blank
    // frame first — the loop may be skipping this frame at the idle rate)
    const ro = new ResizeObserver(entries => {
      const box = entries[entries.length - 1].contentRect, w = W, h = H;
      resize(box.width, box.height);
      if ((W !== w || H !== h) && raf) stage.resume();
    });
    ro.observe(host);

    // Exploring a building is deliberate: never restart rotation behind the user.
    const onStart = () => {
      controls.autoRotate = false; spinRef.current = false; setSpin(false);
      stage.intro = null; stage.fly = null; setTip(null);
    };
    controls.addEventListener("start", onStart);
    // (a drag's start and end, not "change": auto-rotation fires that every frame)
    controls.addEventListener("start", touched);
    controls.addEventListener("end", touched);
    for (const type of ["pointerdown", "pointermove", "wheel", "keydown"] as const) renderer.domElement.addEventListener(type, touched, { passive: true, signal: listening.signal });

    const keyDir = new THREE.Vector3(), sunDir = new THREE.Vector3();
    const bvAt = new THREE.Vector3(), bvLook = new THREE.Vector3();
    const chaseAt = new THREE.Vector3(), chaseEye = new THREE.Vector3();
    const trOff = new THREE.Vector3();
    const driveM = new THREE.Matrix4(), driveLook = new THREE.Vector3(), driveV = new THREE.Vector3(), fxAt = new THREE.Vector3();
    let envFrame = 0, nativeWaitSince = 0;
    let glCompiled: THREE.Object3D | null = null, glCompiling = false;
    // Keep visual quality fixed; only raise supersampling when GPU time permits.
    let gpuCool = 0, last = performance.now(), settleUntil = 0;
    let inView = true, sampleStart = last, sampleFrames = 0;
    const t0 = performance.now();
    let raf = 0;
    // Covered/off-screen views do not render or compile in the background.
    // Their build resumes when visible, without competing with the active view.
    // Render every visible display frame, including animated traffic and pedestrians.
    let renderMax = 0;
    const loop = () => {
      if (document.hidden || !inView || pausedRef.current) { native?.suspendTargets(); return; }
      raf = requestAnimationFrame(loop);
      const nowMs = performance.now();
      const dt = nowMs - last;
      last = nowMs;
      if (stage.busy) settleUntil = Math.max(settleUntil, nowMs + 1500);
      // Quality and resolution never step down during interaction or GPU pressure.
      if (native?.timer.enabled && !fixedRatio) {
        const top = Math.min(maxRatio, Math.sqrt(PIX_CAP / (W * H))), next = Math.min(top, ratio + 0.25);
        const room = !stage.unshown && nowMs > settleUntil && next > ratio && (native.timer.ms.total ?? 99) * (next / ratio) ** 2 < 12;
        if (!room) gpuCool = 0;
        else if (++gpuCool > 60) { ratio = next; gpuCool = 0; settleUntil = nowMs + 500; resize(); }
      }

      const t = (nowMs - t0) / 1000;
      stage.now = t;
      shared.uTime.value = t;
      sky.material.uniforms.time.value = t;
      if (stage.fly) {
        // (orbit target and camera together: the view glides, the shot stays composed)
        const f = stage.fly, k = ease((t - f.t0) / f.dur);
        controls.target.lerpVectors(f.fromTarget, f.toTarget, k);
        camera.position.lerpVectors(f.fromPos, f.toPos, k);
        if (k >= 1) stage.fly = null;
      }
      if (stage.intro) {
        const k = ease((t - stage.intro.t0) / 3.2);
        camera.position.lerpVectors(stage.intro.from, stage.intro.to, k);
        if (k >= 1) stage.intro = null;
      }
      {
        // The slider moves the sun at once; the weather sets in over about 1.6 s.
        const a = stage.atmos, step = Math.min(dt, 100) / 1600;
        const toward = (x: number, y: number) => x + THREE.MathUtils.clamp(y - x, -step, step);
        const moving = a.rain !== a.wantRain || a.snow !== a.wantSnow;
        if (moving) { a.rain = toward(a.rain, a.wantRain); a.snow = toward(a.snow, a.wantSnow); }
        if (moving || a.dirty) {
          const smooth = (x: number) => x * x * (3 - 2 * x);
          const settled = a.rain === a.wantRain && a.snow === a.wantSnow;
          applyLook(atmosphereLook(a.hour, smooth(a.rain), smooth(a.snow), undefined, a.lat, a.lon), false);
          // Reflections (WebGL): now and then while the weather changes, and once the
          // slider rests.
          if (moving && (settled || ++envFrame % 8 === 0)) refreshEnv();
          else if (a.dirty) a.envAt = t + 0.25;
          a.dirty = false;
        }
        if (a.envAt && t >= a.envAt) { a.envAt = 0; refreshEnv(); }
      }
      for (const f of stage.tick) f(dt / 1000);
      if (stage.carry && stage.carry.tick !== stage.tick) for (const f of stage.carry.tick) f(dt / 1000);
      if (balloon?.group.visible) balloon.update(dt / 1000);
      const bv = stage.balloonView;
      if (bv) {
        // Standing at the basket's rim on the side the look faces, leaning out a little:
        // the rim along the bottom of the view, the complex below, the envelope overhead.
        balloon?.basket(bvAt);
        if (bv.aim) {
          // (eased: about half the way in a third of a second)
          const k = Math.min(1, (dt / 1000) * 2.2);
          const yaw = Math.atan2(bv.aim.z - bvAt.z, bv.aim.x - bvAt.x);
          const pitch = THREE.MathUtils.clamp(-Math.atan2(bvAt.y - bv.aim.y, Math.hypot(bv.aim.x - bvAt.x, bv.aim.z - bvAt.z)), -1.45, -0.15);
          const dYaw = Math.atan2(Math.sin(yaw - bv.yaw), Math.cos(yaw - bv.yaw));
          bv.yaw += dYaw * k; bv.pitch += (pitch - bv.pitch) * k;
          if (!balloon?.travelling && Math.abs(dYaw) < 0.003 && Math.abs(pitch - bv.pitch) < 0.003) bv.aim = undefined;
        }
        const fx = Math.cos(bv.yaw), fz = Math.sin(bv.yaw);
        camera.position.set(bvAt.x + fx * 1.02, bvAt.y + 1.62, bvAt.z + fz * 1.02);
        bvLook.set(fx * Math.cos(bv.pitch), Math.sin(bv.pitch), fz * Math.cos(bv.pitch)).add(camera.position);
        camera.lookAt(bvLook);
        if (camera.fov !== bv.fov || camera.near !== 0.08) { camera.fov = bv.fov; camera.near = 0.08; camera.updateProjectionMatrix(); }
      } else if (stage.follow && stage.traffic?.hero(stage.follow)) {
        // Following a vehicle: behind and above it, eased toward its heading.
        const c = stage.traffic.hero(stage.follow)!, sec = Math.min(dt, 100) / 1000;
        const dv = stage.drive;
        if (dv) {
          // The driven vehicle: the simulation (once taken over) or the traffic moving it; the
          // gauges, the engine's sound and the front wheels following.
          // (driven by hand, the simulation steps within the traffic's own step, before the
          // vehicle is placed: this frame's pose drawn, not the last)
          if (!dv.manual) dv.sim.observe(sec, c.speed > dv.lastSpeed + 0.002);
          dv.lastSpeed = c.speed;
          {
            // the acceleration felt (the camera leans on it), the squeal, sparks, brake lamps
            const fe = dv.feel, a = sec > 0 ? (c.speed - fe.prevV) / sec : 0;
            fe.prevV = c.speed;
            fe.acc += (THREE.MathUtils.clamp(a, -12, 12) - fe.acc) * Math.min(1, sec * 5);
            fe.squeal.set(dv.manual && !dv.dead ? dv.sim.slip * Math.min(1, Math.abs(c.speed) / 4) : 0);
            fe.sparks.update(sec, camera);
            stage.traffic.group.updateWorldMatrix(true, false);
            const lm = stage.traffic.heroMatrix(dv.name, driveM);
            if (lm) { fe.lamps.matrix.copy(lm).premultiply(stage.traffic.group.matrixWorld); fe.lamps.matrixWorldNeedsUpdate = true; }
            fe.lamps.visible = !dv.dead && dv.view === "chase" && (dv.sim.braking || (dv.manual && dv.keys.down && c.speed > 0.3));
            // pickups on the way, driven through: a fuel can a quarter of the tank, a repair kit 35 hp
            const got = fe.cans.update(sec, c.x, c.y, 2.6);
            if (got.fuel && !dv.dead) {
              dv.fuel = Math.min(dv.fuelCap, dv.fuel + dv.fuelCap * 0.25 * got.fuel); dv.dryAt = 0;
              feelSfx.pickup(dv.sound.ctx, dv.sound.master); dv.onPickup("fuel");
            }
            if (got.repair && !dv.dead) {
              dv.heal(REPAIR_HP * got.repair);
              feelSfx.repair(dv.sound.ctx, dv.sound.master); dv.onPickup("repair");
            }
            // speed lines: past ~60 km/h, and all the more on the boost
            if (fe.fx) {
              const o = dv.dead ? 0 : Math.min(1, Math.max(0, (Math.abs(c.speed) - 16) / 22) + (dv.sim.boosting ? 0.55 : 0));
              const ov = o.toFixed(2);
              if (fe.fx.style.opacity !== ov) fe.fx.style.opacity = ov;
              fe.fx.classList.toggle("is-boost", dv.sim.boosting);
            }
          }
          if (dv.dead) dv.sound.mute(); else dv.sound.set(dv.sim.revs, dv.sim.throttle, Math.abs(c.speed));
          const kmh = String(Math.round(Math.abs(c.speed) * 3.6)), gear = dv.sim.gearLabel;
          if (dv.hud.speed && dv.hud.speed.textContent !== kmh) dv.hud.speed.textContent = kmh;
          if (dv.hud.gear && dv.hud.gear.textContent !== gear) dv.hud.gear.textContent = gear;
          if (dv.hud.revs) dv.hud.revs.style.transform = `scaleX(${dv.sim.revs.toFixed(3)})`;
          if (!dv.look.held) { const e = Math.min(1, sec * (dv.view === "chase" ? 1.6 : 0.8)); dv.look.yaw -= dv.look.yaw * e; dv.look.pitch -= dv.look.pitch * e; }
          if (dv.game) deliveryTick(stage, dv, dv.game, sec, terrainRef.current);
          // Fuel: by the distance driven (more with the throttle down), a little idling. Dry, it
          // coasts to a stop and explodes. Into open water (off a bridge): lost, back to the start.
          if (dv.manual && !dv.dead) {
            dv.fuel = Math.max(0, dv.fuel - (Math.abs(c.speed) * sec * (0.8 + 0.5 * dv.sim.throttle) + sec * 0.4) * DRIVE_SPECS[dv.name].fuelUse * (dv.sim.boosting ? 3 : 1));
            // warnings as it runs down: a quarter left, a tenth left (said once each, beeped)
            const ff = dv.fuelCap > 0 ? dv.fuel / dv.fuelCap : 0, fw = ff < 0.1 ? 2 : ff < 0.25 ? 1 : 0;
            if (fw > dv.feel.fuelWarn) {
              feelSfx.alarm(dv.sound.ctx, "fuel", dv.sound.master);
              const ev = dv.name === "cyber";
              dv.feel.voice.say(fw === 2 ? (ev ? "배터리가 거의 바닥났습니다" : "연료가 거의 바닥났습니다") : (ev ? "배터리가 부족합니다" : "연료가 부족합니다"), true);
            }
            if (fw !== dv.feel.fuelWarn) { dv.feel.fuelWarn = fw; dv.onWarn(); }
            if (dv.fuel <= 0) {
              if (!dv.dryAt) { dv.dryAt = nowMs; dv.onDry(); }
              if (Math.abs(c.speed) < 0.6 || nowMs - dv.dryAt > 6000) dv.blowUp("fuel");
            }
            if (!dv.dead && !dv.hopping && stage.wetAt?.(c.x, c.y)) dv.blowUp("water");
          }
          // the trees' full detail round the vehicle, not the complex (re-dealt every 40 m)
          if (stage.plantsFocus && Math.hypot(c.x - dv.focusAt[0], c.y - dv.focusAt[1]) > 40) { dv.focusAt = [c.x, c.y]; stage.plantsFocus(c.x, c.y); }
          if (dv.feel.fuelText) {
            const left = dv.fuel / DRIVE_SPECS[dv.name].fuelUse, t = `${Math.round((dv.fuelCap > 0 ? dv.fuel / dv.fuelCap : 0) * 100)}% · ${left >= 1000 ? `${(left / 1000).toFixed(1)}km` : `${Math.round(left)}m`}`;
            if (dv.feel.fuelText.textContent !== t) dv.feel.fuelText.textContent = t;
          }
          if (dv.hud.fuel) {
            const f = dv.fuelCap > 0 ? dv.fuel / dv.fuelCap : 0, cls = f < 0.1 ? "is-critical" : f < 0.25 ? "is-low" : "";
            dv.hud.fuel.style.transform = `scaleX(${f.toFixed(3)})`;
            const box = dv.hud.fuel.parentElement?.parentElement;
            if (box && box.dataset.level !== cls) { box.dataset.level = cls; box.className = `re-drive-fuel ${cls}`; }
          }
          dv.shake *= Math.exp(-sec * 7);
          // smoke and fire from the engine bay as it weakens; the wreck burning
          {
            const gz0 = c.z ?? terrainRef.current.at(c.x, c.y), fwd = dv.dead ? 0 : c.length * 0.32;
            fxAt.set(c.x + c.hx * fwd, gz0 + (dv.name === "coupang" ? 1.35 : 0.95), -(c.y + c.hy * fwd));
            dv.fx.update(sec, camera, dv.hp < 45 || dv.dead ? fxAt : null, dv.dead ? 0 : dv.hp);
            if (!dv.dead && dv.hp < 20 && nowMs - dv.warnAt > 1600) { dv.warnAt = nowMs; damageSfx.warn(dv.sound.ctx, dv.sound.master); }
          }
        }
        const gz = c.z ?? terrainRef.current.at(c.x, c.y), big = stage.follow === "coupang";
        if (dv?.view === "cockpit" && dv.cab) {
          // From the driver's seat: the cockpit placed with the vehicle, the eye in it, looking
          // out along the vehicle (turned by a drag).
          const m = stage.traffic.heroMatrix(stage.follow, driveM);
          if (m) {
            driveM.premultiply(stage.traffic.group.matrixWorld);
            dv.cab.group.matrix.copy(driveM); dv.cab.group.matrixWorldNeedsUpdate = true;
            dv.cab.setSteer(dv.sim.steer);
            const [ex, ey, ez] = DRIVE_SPECS[dv.name].eye;
            camera.position.set(ex, ey, ez).applyMatrix4(driveM);
            const yaw = dv.look.yaw, pitch = dv.look.pitch - 0.06;
            driveLook.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).add(driveV.set(ex, ey, ez)).applyMatrix4(driveM);
            camera.lookAt(driveLook);
            if (dv.shake > 0.01) camera.rotateZ((Math.random() - 0.5) * dv.shake * 0.01);
            controls.target.copy(driveLook);
          }
          if (camera.near !== 0.05 || camera.fov !== 72) { camera.near = 0.05; camera.fov = 72; camera.updateProjectionMatrix(); }
        } else {
          // (under the street trees' crowns, as a driving game's camera; aimed a little ahead)
          // Driving: a little closer and quicker to follow, swung round by a drag.
          const k = 1 - Math.exp(-sec * (dv?.manual ? 6 : 4));
          // (pulling away the camera falls behind, braking it closes in and the nose dips)
          const acc = dv?.feel.acc ?? 0;
          const back = (big ? 11 : 9) + THREE.MathUtils.clamp(acc * 0.32, -1.6, 2.4), high = big ? 4.2 : 3.2, ahead = 6;
          const yaw = dv?.look.yaw ?? 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
          // (the heading turned by the look: + round to the left)
          const bx = c.hx * cy - c.hy * sy, by = c.hx * sy + c.hy * cy;
          chaseAt.set(c.x + c.hx * ahead, gz + 1.2 - THREE.MathUtils.clamp(-acc * 0.05, 0, 0.45), -(c.y + c.hy * ahead));
          chaseEye.set(c.x - bx * back, gz + high + (dv ? dv.look.pitch * -6 : 0), -(c.y - by * back));
          // (in the traffic's frame: shifted while the view re-centres under the vehicle)
          // (its world matrix brought up to date first: the frame the scene shifts it is otherwise a
          // frame behind, and the camera swung hundreds of metres for a moment)
          stage.traffic.group.updateWorldMatrix(true, false);
          trOff.setFromMatrixPosition(stage.traffic.group.matrixWorld);
          chaseAt.add(trOff); chaseEye.add(trOff);
          controls.target.lerp(chaseAt, k);
          camera.position.lerp(chaseEye, k);
          camera.lookAt(controls.target);
          if (dv && dv.shake > 0.01) { const s = dv.shake * 0.05; camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; }
          // (the view widens with speed: the sense of it)
          const fov = dv ? dv.baseFov + Math.min(16, Math.abs(c.speed) * 0.4) + THREE.MathUtils.clamp(acc * 0.6, 0, 4) + (dv.sim.boosting ? 9 : 0) : camera.fov;
          if (camera.near !== 0.1 || Math.abs(camera.fov - fov) > 0.05) { camera.near = 0.1; camera.fov += (fov - camera.fov) * Math.min(1, sec * 3); camera.updateProjectionMatrix(); }
        }
      } else {
        controls.update(Math.min(dt, 100) / 1000);
        // Near plane follows the zoom: close enough to stand beside a person, and no
        // deeper than needed from afar (depth precision on distant roofs).
        const near = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.04, 0.05, stage.nearMax);
        if (Math.abs(near - camera.near) > camera.near * 0.15) { camera.near = near; camera.updateProjectionMatrix(); }
      }
      // The camera's world matrices, every frame: three only refreshes them while it
      // draws, and on the WebGPU path it doesn't, so view-dependent work (which people
      // to draw, and how) would go on judging from a stale camera.
      camera.updateMatrixWorld();
      moon.update(camera);
      precip.update(camera, t, H);   // (H from the resize observer: reading clientHeight here forced a page layout every frame)
      stage.signs?.(camera, W, H);


      if (native) {
        try {
          const r0 = performance.now();
          native.render(scene, camera, stage.look, t);
          renderMax = Math.max(renderMax, performance.now() - r0);
        }
        catch (err) { host.dataset.gpuFallback = String(err).slice(0,240); console.warn("[3D] WebGPU fallback:", err); native.failed = true; }
        // Watchdog for a device that neither finishes compilation nor reports a failure.
        if (!native.shown && stage.model) {
          nativeWaitSince ||= nowMs;
          // (a slow GPU may take a while to build its pipelines; with no WebGL, keep waiting)
          // (generous: a slow GPU compiling its pipelines is not a failure, and WebGL on top
          // of the WebGPU memory already held is what stalls a weak machine)
          if (nowMs - nativeWaitSince > 15000) { host.dataset.gpuFallback = "first-frame-timeout"; console.info("[3D] WebGPU never showed the scene; using WebGL"); native.failed = true; }
        } else nativeWaitSince = 0;
        if (native.failed) {
          const released = native.released ?? 0;
          native.dispose(); native = null;
          // The view is set up again with WebGL (and its model built again: canvases emptied
          // after upload can't feed it); with no WebGL there either, it says so.
          if (glMissing) { console.info("[3D] WebGPU lost, using WebGL"); setRenderMode("webgl"); return; }
          if (released) rebuildRef.current?.();
          refreshEnv(); resize();
        }
      }
      const isPreparing = nativePending || (!!native && !native.shown);
      if (wasPreparing !== isPreparing) { setPreparing(isPreparing); wasPreparing = isPreparing; }
      const rendererName = native?.shown ? "tidewater-webgpu" : isPreparing ? "preparing" : "webgl";
      if (host.dataset.renderer !== rendererName) host.dataset.renderer = rendererName;   // (a write each frame dirtied the page's style)
      if (++sampleFrames >= 60 || (sampleFrames >= 2 && nowMs - sampleStart > 1000)) {
        host.dataset.fps = (sampleFrames * 1000 / (nowMs - sampleStart)).toFixed(1);
        host.dataset.draws = String(native?.ready ? native.stats.draws : renderer.info.render.calls);
        host.dataset.pixelRatio = ratio.toFixed(2);
        host.dataset.renderMaxMs = renderMax.toFixed(0); renderMax = 0;
        if (native) {
          host.dataset.quality = native.quality.name; host.dataset.gpuMs = (native.timer.ms.total ?? 0).toFixed(2); host.dataset.pipelines = String((native as unknown as { renderer: { pipelines: Map<string, unknown> } }).renderer.pipelines.size);
          host.dataset.sceneReady = String(native.ready && !native.pending && !native.compiling && !native.failed);
          host.dataset.nativeDraws = String(native.stats.draws);
        }
        sampleFrames = 0; sampleStart = nowMs;
      }
      // WebGL: a new model's programs compile in parallel (KHR_parallel_shader_compile)
      // before it is drawn; a first draw would wait on each link in turn (seconds).
      const gl = !native && !nativePending;
      // (and once at the start: sky, stars, moon)
      const pending = stage.unshown && stage.model ? stage.model : glCompiled ? null : scene;
      if (gl && pending && glCompiled !== pending && !glCompiling) {
        glCompiling = true;
        void glCompile(scene).then(() => { glCompiling = false; glCompiled = pending; });
      }
      const glWait = gl && !!pending && glCompiled !== pending;
      if (gl && !glWait && reflector && stage.ground && stage.reflectOn) {
        stage.ground.visible = false;
        (reflector.onBeforeRender as (r: THREE.WebGLRenderer, s: THREE.Scene, c: THREE.Camera) => void)(renderer, scene, camera);
        stage.ground.visible = true;
      }
      if (gl && !glWait) composer?.render();
      // A picture for sharing: read in the task that drew the frame (neither canvas keeps
      // its drawing after it is shown).
      if (stage.snap) {
        const done = stage.snap; stage.snap = null;
        (native?.shown ? native.canvas : renderer.domElement).toBlob(b => done(b), "image/png");
      }
      if (stage.unshown && stage.model && (native?.ready || (gl && !glWait))) {
        stage.unshown = false;
        settleUntil = nowMs + 4000;
        host.dataset.shownAt = performance.now().toFixed(0);
        const jobs = stage.onShown.splice(0);
        const model = stage.model;
        void (async () => {
          for (const f of jobs) {
            await frameSlice();
            if (disposed || stage.model !== model) return;
            f();
          }
        })();
      }
    };

    /** Sun, sky, haze and every light-dependent material for one look. */
    const applyLook = (l: Look, env: boolean) => {
      stage.look = l;
      const u = sky.material.uniforms;
      u.turbidity.value = l.turbidity;
      u.rayleigh.value = l.rayleigh;
      u.mieCoefficient.value = l.mie;
      u.mieDirectionalG.value = l.mieG;
      u.cloudCoverage.value = l.clouds;
      u.cloudDensity.value = 0.45;
      u.cloudElevation.value = 0.55;
      u.cloudScale.value = 0.00022;
      u.cloudSpeed.value = 0.00006;
      dirFrom(l.sunElev, l.sunAz, sunDir);
      u.sunPosition.value.copy(sunDir);
      u.uSunColor.value.copy(l.key).multiplyScalar(l.keyI);
      u.uNight.value = l.stars;
      u.uWeather.value.set(l.overcast, l.rain, l.snow);
      dirFrom(l.keyElev, l.keyAz, keyDir);
      const reach = stage.dist * 2 + stage.top * 2;
      sun.position.copy(stage.center).addScaledVector(keyDir, reach);
      sun.target.position.copy(stage.center);
      sun.color.copy(l.key);
      sun.intensity = l.keyI;
      hemi.color.copy(l.hemiSky);
      hemi.groundColor.copy(l.hemiGround);
      hemi.intensity = l.hemiI;
      const fog = scene.fog as THREE.FogExp2;
      fog.color.copy(l.fog);
      fog.density = l.fogK / stage.dist;
      renderer.toneMappingExposure = l.exposure;
      scene.environmentIntensity = l.env;
      shared.uGlass.value = 0.7 / Math.max(0.05, l.env);
      stage.lit.windows.forEach(m => { m.emissiveIntensity = l.windows; });
      stage.lit.crowns.forEach(m => { m.emissiveIntensity = l.windows * 0.5; });
      stage.lit.ground.forEach(m => { m.emissiveIntensity = l.lamps * 0.9; });
      stage.onLook.forEach(f => f(l));
      // Behind an overcast no stars or moon.
      u.uStarVis.value = l.stars * (1 - l.overcast);
      u.uStarTurn.value = l.starTurn;
      moon.setPosition(l.moonElev, l.moonAz, l.moonLit);
      balloon?.setLook(l);
      moon.setLevel(l.stars * (1 - l.overcast));
      shared.uCloud.value = l.cloudShade;
      shared.uWet.value = l.rain;
      shared.uSnow.value = l.snow;
      precip.setLook(l);
      reflStrength.value = l.reflect;
      if (bloom) { bloom.strength = l.bloom; bloom.threshold = l.bloomAt; }
      if (env) refreshEnv();
    };
    stage.refreshEnv = () => applyLook(stage.look, true);
    applyLookRef.current = applyLook;
    applyLook(stage.look, true);

    // Paused while off screen: a model below the fold should cost nothing.
    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      cancelAnimationFrame(raf);
      if (entry.isIntersecting && !pausedRef.current) { last = performance.now(); loop(); }
      else native?.suspendTargets();
    });
    io.observe(host);
    stage.attach = next => {
      if (next === host) return;
      ro.unobserve(host); io.unobserve(host);
      Object.assign(next.dataset, host.dataset);
      next.appendChild(renderer.domElement);
      if (native) next.appendChild(native.canvas);
      host = next;
      // (its size comes with the observer's first report on it: drawn again then)
      ro.observe(host); io.observe(host);
      stage.resume();
    };
    stage.resume = () => { cancelAnimationFrame(raf); touched(); last = performance.now(); loop(); };
    const visibility = () => {
      cancelAnimationFrame(raf);
      last = performance.now(); sampleStart = last; sampleFrames = 0;
      if (!document.hidden) loop();
      else native?.suspendTargets();
    };
    document.addEventListener("visibilitychange", visibility);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visibility);
      cancelAnimationFrame(raf);
      native?.dispose();
      io.disconnect();
      ro.disconnect();

      stage.disposeModel();
      disposeControls(controls);
      listening.abort();
      composer?.dispose();
      target?.dispose();
      gtao?.dispose();
      reflector?.dispose();
      envRT?.dispose();
      pmrem?.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
      moon.dispose();
      balloon?.dispose();
      precip.dispose();
      releaseRenderer(renderer);
      releaseMemory();
      stageRef.current = null;
      applyLookRef.current = null;
    };
  }, [renderMode]);

  // Full screen, the view draws even when its owner would pause it (the card is under it).
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused && !big;
    if (!pausedRef.current) stageRef.current?.resume();
  }, [paused, big]);
  const openedFull = useRef(0);
  useEffect(() => {
    if (!openFull || openFull === openedFull.current) return;
    openedFull.current = openFull;
    openBig();
  }, [openFull]);
  const fullChange = useRef(onFullChange);
  fullChange.current = onFullChange;
  // (only changes: the first report, not open yet, told a page opened on a complex that its
  // view was closed while it was opening — and the page began its region map underneath)
  const reportedBig = useRef(big);
  useEffect(() => {
    if (big === reportedBig.current) return;
    reportedBig.current = big;
    fullChange.current?.(big);
  }, [big]);
  // Covering the whole window (not the resized window over a dimmed page): the page under it
  // is not drawn at all (pageCover.ts).
  const coversPage = big && (narrow || !bigSize);
  useEffect(() => coversPage ? coverPage() : undefined, [coversPage]);

  const spinRef = useRef(spin);
  useEffect(() => {
    spinRef.current = spin;
    if (stageRef.current) stageRef.current.controls.autoRotate = spin;
  }, [spin]);

  const navigateView = (action: "in" | "out" | "left" | "right" | "up" | "down" | "home" | "top") => {
    const st = stageRef.current;
    if (!st) return;
    if (st.follow) stopFollow();
    if (st.balloonView) {
      const bv = st.balloonView;
      bv.aim = undefined;
      if (action === "home") leaveBalloon();
      else if (action === "in" || action === "out") zoomBalloon(action === "in" ? 0.7 : 1.4);
      else if (action === "left" || action === "right") bv.yaw += (action === "left" ? -1 : 1) * Math.PI / 8;
      else if (action === "up" || action === "down") bv.pitch = THREE.MathUtils.clamp(bv.pitch + (action === "up" ? 0.15 : -0.15), -1.5, 0.9);
      else bv.pitch = -1.45;
      st.resume();
      return;
    }
    st.controls.autoRotate = false; spinRef.current = false; setSpin(false); setTip(null);
    st.intro = null;
    // Consume residual drag inertia before applying an exact button command.
    st.controls.enableDamping = false; st.controls.update(); st.controls.enableDamping = true;
    // From where a flight in progress is heading (a second press adds to the first).
    const fromPos = st.fly ? st.fly.toPos.clone() : st.camera.position.clone();
    const fromTarget = st.fly ? st.fly.toTarget.clone() : st.controls.target.clone();
    let toPos: THREE.Vector3, toTarget = fromTarget.clone();
    if (action === "home") {
      // Where the opening shot puts the camera, then glide there.
      const pos = st.camera.position.clone(), target = st.controls.target.clone();
      st.frame();
      toPos = st.camera.position.clone(); toTarget = st.controls.target.clone();
      st.camera.position.copy(pos); st.controls.target.copy(target); st.controls.update();
    } else {
      const offset = fromPos.clone().sub(fromTarget);
      if (action === "in" || action === "out") {
        offset.setLength(THREE.MathUtils.clamp(offset.length() * (action === "in" ? 0.55 : 1.8), st.controls.minDistance, st.controls.maxDistance));
      } else {
        const sphere = new THREE.Spherical().setFromVector3(offset);
        if (action === "top") sphere.phi = 0.18;
        else if (action === "up" || action === "down") sphere.phi = THREE.MathUtils.clamp(sphere.phi + (action === "up" ? -1 : 1) * 0.16, 0.12, Math.PI / 2 - 0.035);
        else sphere.theta += (action === "left" ? -1 : 1) * Math.PI / 8;
        offset.setFromSpherical(sphere);
      }
      toPos = fromTarget.clone().add(offset);
    }
    st.fly = { fromPos: st.camera.position.clone(), toPos, fromTarget: st.controls.target.clone(), toTarget, t0: st.now, dur: 0.6 };
    st.resume();
  };
  /** Glide to a point (a double-clicked building): the orbit target there, the camera
   * keeping its bearing at a distance that frames it. */
  const flyTo = (point: THREE.Vector3, distance: number, dur = 0.9) => {
    const st = stageRef.current;
    if (!st || st.balloonView) return;
    st.controls.autoRotate = false; spinRef.current = false; setSpin(false); st.intro = null;
    const dir = st.camera.position.clone().sub(st.controls.target).normalize();
    // (not flatter than 20°: a building seen from its own ground level reads badly)
    if (dir.y < 0.34) { dir.y = 0.34; dir.normalize(); }
    const d = THREE.MathUtils.clamp(distance, st.controls.minDistance * 4, st.controls.maxDistance);
    st.fly = { fromPos: st.camera.position.clone(), toPos: point.clone().addScaledVector(dir, d), fromTarget: st.controls.target.clone(), toTarget: point.clone(), t0: st.now, dur };
    st.resume();
  };

  // The layer is portaled to <body> (a transformed ancestor would otherwise pin a
  // fixed layer to itself, off screen); the running renderer moves with it.
  useLayoutEffect(() => {
    if (hostRef.current) stageRef.current?.attach(hostRef.current);
  }, [big]);

  useEffect(() => {
    stageRef.current?.resume();
    if (!big) return;
    const previous = document.activeElement as HTMLElement | null;
    const section = sectionRef.current!;
    section.querySelector<HTMLButtonElement>('.re-holo-wide-close')?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // No `inert` on the page behind: the layer already covers it (pointer), Tab is kept
    // inside below and the section is aria-modal. Toggling inert on the page root restyled
    // and rebuilt the accessibility tree of the whole page on open and on close (~60 ms here,
    // far more with accessibility clients running): the pointer stuck right after closing,
    // on its way to the detail card's ×.
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeBig(); }
      if (event.key === 'Tab') {
        const items = Array.from(section.querySelectorAll<HTMLElement>('button,a[href]'));
        const i = items.indexOf(document.activeElement as HTMLElement);
        event.preventDefault(); items[(i + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', key, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [big, closeBig]);

  const terrainRef = useRef<Terrain>(FLAT);
  rebuildRef.current = () => setData(d => (d ? { ...d } : d));
  const applyLookRef = useRef<((l: Look, env: boolean) => void) | null>(null);
  useEffect(() => {
    hourRef.current = hour;
    const st = stageRef.current;
    if (!st) return;
    st.atmos.hour = hour; st.atmos.dirty = true;
    st.resume();
  }, [hour]);
  useEffect(() => {
    weatherRef.current = weather;
    const st = stageRef.current;
    if (!st) return;
    st.atmos.wantRain = +(weather === "rain"); st.atmos.wantSnow = +(weather === "snow");
    st.resume();
  }, [weather]);
  // The sun over the complex itself (its latitude and longitude, when known).
  const center = data?.center;
  useEffect(() => {
    const st = stageRef.current;
    if (!st || !center) return;
    st.atmos.lat = center.lat; st.atmos.lon = center.lon; st.atmos.dirty = true;
  }, [center?.lat, center?.lon]);

  /** A result without surveyed roads (kept by the server, or from OpenStreetMap) gets
   * them from VWorld, in at most 2.5 s; without them it still draws, just roadless. */


  // Every selection: this browser's copy, else kept shapes from the server, else
  // VWorld from this browser (VWorld refuses the server abroad) raced against the
  // server's OpenStreetMap fallback.
  useEffect(() => {
    setTip(null);
    if (!complexId) { setData(null); return; }
    // (the model on screen stops its late extras: this one's loading comes first)
    stageRef.current?.stopExtras();
    const ctl = new AbortController();
    let live = true;
    setLoading(true);
    setSlowData(false);
    const started = performance.now();
    // Its facades start painting now, alongside the network.
    if (!pausedRef.current) { prefetchPaint(complexId, complexName); preloadPlants(); }
    if (hostRef.current) {
      for(const key of ['shownAt','plantsStartedAt','plantsPhase','plantsReadyAt','plantsTiming','roadsReadyAt','lampsReadyAt','trafficReadyAt','trafficArmedAt','sceneReady','ringAt','ring','ringSurveyed','ringStart','ringGot','photoBuildings','farGround','farPlants','farGroves','farPlantsReadyAt','waterReadyAt','waterDataReadyAt','boatsReadyAt','walkersReadyAt','parcelActorsReadyAt','boats','kids','sharp'])delete hostRef.current.dataset[key];
      hostRef.current.dataset.selectAt = started.toFixed(0);
    }
    const slowTimer = window.setTimeout(() => { if (live) setSlowData(true); }, 3000);
    setError("");
    setDataTry(0);
    // One attempt at the shapes. The server's first look-up of a complex asks outside
    // sources (OpenStreetMap, several tries each) and can take minutes, or stall; a
    // request left waiting only ended with a page reload. Each attempt now has a time
    // limit and the next one starts over (by then the server has usually kept the
    // result, and answers at once).
    const attempt = async (signal: AbortSignal): Promise<RealEstateBuildingsResponse> => {
      const cached = buildingCache.get(complexId);
      if (cached && Date.now() - cached.at < 300000) return cached.data;
      // (the look started ahead — on the tile's hover, or just now — when it found shapes)
      const early = await firstLook(complexId).catch(() => null);
      prefetched.delete(complexId);
      if (early?.found) return early;
      const peek = await api.realEstateBuildings(complexId, signal, true);
      // Roads and terrain only need these footprints/centre. The common stage below
      // loads them together; awaiting roads here serialized the two network waits.
      // Accuracy first: a server result from OpenStreetMap (its rough outlines; the server
      // can't reach VWorld's registry) gives way to the surveyed buildings (GIS건물통합정보)
      // the browser can ask VWorld for itself, when they come within a few seconds.
      if (peek.found && peek.source === "osm" && peek.vworld_key && peek.query?.parcel) {
        const surveyed = await Promise.race([
          vworldBuildings(complexId, peek.query, peek.vworld_key, peek.vworld_domain).catch(() => null),
          new Promise<null>(res => window.setTimeout(() => res(null), 4000)),
        ]);
        if (surveyed?.found && surveyed.buildings.length >= Math.min(2, peek.buildings.length))
          return { ...surveyed, built: peek.built ?? surveyed.built ?? null, vworld_key: peek.vworld_key, vworld_domain: peek.vworld_domain };
        return peek;
      }
      if (peek.found) return peek;
      // Start independent suppliers together: a slow JSONP endpoint must not
      // delay a server result that is already available (and vice versa).
      const fallback = api.realEstateBuildings(complexId, signal);
      if (!peek.vworld_key || !peek.query?.parcel) return fallback;
      const direct = vworldBuildings(complexId, peek.query, peek.vworld_key, peek.vworld_domain)
        .then(value => value ? { ...value, built: peek.built ?? null, vworld_key: peek.vworld_key, vworld_domain: peek.vworld_domain } : null);
      return new Promise<RealEstateBuildingsResponse>((resolve, reject) => {
        let remaining = 2;
        let empty: RealEstateBuildingsResponse | null = null;
        let failure: unknown;
        for (const request of [fallback, direct]) request.then(result => {
          if (result?.found) resolve(result);
          else if (result) empty = result;
        }).catch(err => { failure = err; }).finally(() => {
          if (--remaining === 0) { if (empty) resolve(empty); else reject(failure ?? new Error("건물 자료를 찾지 못했습니다.")); }
        });
      });
    };
    const LIMITS = [20000, 30000, 45000];
    (async () => {
      for (let n = 0; ; n++) {
        const one = new AbortController();
        const stop = () => one.abort();
        ctl.signal.addEventListener("abort", stop);
        const limit = window.setTimeout(stop, LIMITS[n]);
        try {
          return await Promise.race([
            attempt(one.signal),
            new Promise<never>((_, reject) => one.signal.addEventListener("abort", () => reject(new Error("건물 자료 응답이 늦어지고 있습니다.")))),
          ]);
        } catch (err) {
          if (ctl.signal.aborted || n === LIMITS.length - 1) throw err;
          if (live) setDataTry(n + 1);
        } finally {
          window.clearTimeout(limit);
          ctl.signal.removeEventListener("abort", stop);
        }
      }
    })()
      // Roads and relief together: both only need the result's centre.
      .then(async res => {
        if (!live) return res;
        if (res.found && res.center) {
          if(textureBudgetEnabled()){preloadPlants();preloadTraffic();if(!res.parcels&&res.vworld_key)void vworldParcels(res,res.vworld_key,res.vworld_domain).catch(()=>{});}
          void nearbyWater(res.center.lat, res.center.lon).catch(() => {});
          void nearbyCrossings(res.center.lat, res.center.lon).catch(() => {});
        }
        const t0 = performance.now();
        const [full, surveyed] = await Promise.all([res.found ? withRoads(complexId, res) : res,
          res.found ? terrainOnce(complexId, res).then(t => { if (hostRef.current) hostRef.current.dataset.terrainMs = (performance.now() - t0).toFixed(0); return t; }) : FLAT]);
        // (the roads level across and smooth along, at the ground's own grade: gradeRoads)
        const ground = live && full.roads?.length ? await gradeRoads(surveyed, full.roads).catch(() => surveyed) : surveyed;
        if (live) {
          if (hostRef.current) hostRef.current.dataset.dataMs = (t0 - started).toFixed(0);
          terrainRef.current = ground;
          setTerrainSource(ground.source);
        }
        return full;
      })
      .then(found => {
        const res = withoutStrays(withoutDemolished(found));
        if (live && res.found && !pausedRef.current) prefetchPaint(res.id, res.name);
        if (res.found) {
          if (!buildingCache.has(complexId)) void saveBuildings(complexId, res);
          buildingCache.set(complexId, { at: Date.now(), data: res });
          if (buildingCache.size > 8) buildingCache.delete(buildingCache.keys().next().value!);
        }
        if (!live) return;
        if (hostRef.current) hostRef.current.dataset.fetchMs = (performance.now() - started).toFixed(0);
        setData(res); if (!res.found) setError(res.error || "건물 윤곽 자료를 찾지 못했습니다."); })
      .catch(err => { if (live && !ctl.signal.aborted) { setData(null); setError(err instanceof Error ? err.message : "불러오지 못했습니다."); } })
      .finally(() => { window.clearTimeout(slowTimer); if (live) setLoading(false); });
    return () => { live = false; window.clearTimeout(slowTimer); ctl.abort(); };
  }, [complexId, reloadKey]);

  // Build the model for the loaded complex.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // Arriving from another complex (the 주변 단지 selector): this model's origin is its own
    // centre, so everything in the scene moves by the offset between the two centres and stays
    // where it was in the world — the camera, the orbit, the balloon, and the complex left
    // behind, which stays in view (no empty sky) until this one's first frame is up.
    const came = hopRef.current?.id === complexId && data?.found && data.center && data.buildings.length ? hopRef.current : null;
    hopRef.current = null;
    let shift: THREE.Vector3 | null = null;
    if (came && data?.center) {
      const [ox, oy] = metresFrom(came.from, data.center.lat, data.center.lon);
      shift = new THREE.Vector3(-ox, -came.terrain.at(ox, oy), oy);
      if (shift.length() > 3000) shift = null;
      if (shift && came.drive && stage.carry) { stage.carry.ox = ox; stage.carry.oy = oy; stage.carry.dz = shift.y; }
    }
    let behind = shift && stage.model && !stage.unshown ? stage.current : null;
    if (behind) {
      behind.stop();
      for (const o of behind.parts()) o.position.add(shift!);
      // (its traffic and people keep moving meanwhile: tick stays until this model's replaces it)
      stage.current = null; stage.model = null; stage.ground = null; stage.pickables = []; stage.onShown = [];
    } else stage.disposeModel();
    if (shift && import.meta.env.DEV) console.info("[drive] shift", shift.x.toFixed(1), shift.y.toFixed(1), shift.z.toFixed(1), performance.now().toFixed(0));
    if (shift) {
      stage.camera.position.add(shift); stage.controls.target.add(shift);
      if (stage.fly) for (const v of [stage.fly.fromPos, stage.fly.toPos, stage.fly.fromTarget, stage.fly.toTarget]) v.add(shift);
      stage.balloon?.shift(shift);
      stage.balloonView?.aim?.add(shift);
    }
    const letGo = () => { behind?.release(); behind = null; };
    if (!data?.found || !data.buildings.length) { letGo(); return; }
    // (idle time, once a session: a river complex's boats need them the moment its water is in)
    prepareWakes();
    const modelStarted = performance.now();
    const terrain = terrainRef.current;
    // Buildings first: plants, lamps and traffic join once this model is on screen,
    // so their shaders never hold back the first frame.
    stage.unshown = true;
    const afterShown = (f: () => void) => { if (stage.unshown) stage.onShown.push(f); else f(); };
    const palette = paletteFor(data.name);
    const disposables = new SceneResources();
    const keep = <T extends { dispose: () => void }>(x: T) => disposables.keep(x);
    const group = new THREE.Group();
    group.rotation.x = -Math.PI / 2; // footprints are x east / y north, extruded up z
    group.updateMatrixWorld();
    const lit: Stage["lit"] = { windows: [], crowns: [], ground: [] };
    let alive = true;
    let ground: THREE.Mesh | null = null;
    const decor = new THREE.Group();
    // (its street trees and lamp posts, for a driven vehicle to run into: set as they are planted)
    const poleHolder: { grid: PoleGrid | null } = { grid: null };
    // Set before any work: a newer selection disposes a half-built model cleanly.
    stage.building = true;
    stage.resume();
    // (its materials handed to the view to free at once: see ComplexRenderer.forget)
    const forgetAll = () => {
      const mats = new Set<THREE.Material>();
      for (const root of [group, decor, ground]) root?.traverse(o => { const m = (o as THREE.Mesh).material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => mats.add(x)); });
      stage.forget?.(mats);
    };
    const release = () => {
      forgetAll();
      stage.scene.remove(group, decor);
      if (ground) stage.scene.remove(ground);
      disposables.forEach(d => d.dispose());
    };
    stage.current = { stop: () => { alive = false; }, release, parts: () => (ground ? [group, decor, ground] : [group, decor]) };
    stage.disposeModel = () => {
      alive = false;
      letGo();
      stage.current = null;
      stage.building = false;
      stage.onShown = [];
      forgetAll();
      stage.scene.remove(group, decor);
      if (ground) stage.scene.remove(ground);
      disposables.forEach(d => d.dispose());
      stage.model = null; stage.ground = null; stage.pickables = [];
      stage.lit = { windows: [], crowns: [], ground: [] };
      stage.tick = []; stage.onLook = [];
    };
    // The build runs in slices so the page (the detail popup above all) stays
    // responsive; behind an open popup, only in the browser's idle time.
    let sliceStart = performance.now();
    const pace = async (force = false) => {
      // Keep builders within 2 ms before yielding to the view's next frame.
      if (force || performance.now() - sliceStart > 2) {
        cpu += performance.now() - sliceStart;
        await nextSlice(pausedRef.current);
        sliceStart = performance.now();
      }
      return alive;
    };
    // Where the build's time goes (dataset.buildSteps: step=wall ms/main-thread ms).
    const steps: string[] = [];
    let stepAt = performance.now(), cpu = 0, cpuAt = 0;
    const step = (name: string) => {
      const now = performance.now(), used = cpu + (now - sliceStart);
      steps.push(`${name}=${(now - stepAt).toFixed(0)}/${(used - cpuAt).toFixed(0)}`);
      console.timeStamp(`3d:${name}`);
      stepAt = now; cpuAt = used;
    };
    void (async () => {
    while (alive && pausedRef.current) await new Promise<void>(resolve => setTimeout(resolve,100));
    if (!alive) return;

    let seed = 0;
    for (const ch of data.id) seed = (seed * 33 + ch.charCodeAt(0)) % 2147483647;
    const rnd = rng(seed);

    // Ground painting only needs the footprints, not their finished meshes. Match
    // the float32 extrusion bounds so its extent and pixels are exactly unchanged.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, footprintRadius = 0;
    for (const b of data.buildings) {
      const included = !(b.height_source === "estimated" && footArea(b.rings[0]) < 300);
      for (const [x, y] of b.rings[0]) {
        footprintRadius = Math.max(footprintRadius, Math.hypot(x, y));
        if (included) { const fx = Math.fround(x), fy = Math.fround(y); minX = Math.min(minX, fx); maxX = Math.max(maxX, fx); minY = Math.min(minY, fy); maxY = Math.max(maxY, fy); }
      }
    }
    const T = Math.max((footprintRadius + 300) * 1.15, Math.max(maxX - minX, maxY - minY, 60) * 0.9 + 120);
    const reach = footprintRadius + 300;
    const tints = ["#f1ede4", "#e4e1da", "#d9d4ca", "#c9b8a4", "#b88f78", "#a9b3bb", "#e8e3d3", "#cfc9bd"];
    const neighbours = data.context.filter(b => b.rings[0].some(([x, y]) => Math.hypot(x, y) <= reach));
    const groundJob = groundPlan(data, T, stage.hq ? 2048 : 1024, seed, pace, terrain.grid).then(plan => {
      if (!plan) return null;
      if (!alive) { plan.color.dispose(); plan.rough.dispose(); plan.glow.dispose(); return null; }
      [plan.color, plan.rough, plan.glow].forEach(keep);
      return plan;
    });

    // Two facade variants so neighbouring towers don't light the same windows.
    if (!await pace(true)) return;
    const walls: THREE.MeshPhysicalMaterial[] = [];
    /** The complex's facade in a palette (the brand's to start with; the real colours read
     * from the survey photographs later). */
    const facadeMaterial = async (pal: Palette, s: number, bay = BAY_M, storey = FLOOR_M, scale = 1) => {
      // Started when the complex was chosen (alongside its network wait), or kept from
      // an earlier visit.
      const architecture = textureBudgetEnabled();
      const tex = await paintTextures(architecture ? {kind:'facade',palette:pal,seed:s,appearance:'architecture'}
        : scale === 1 ? { kind: "facade", palette: pal, seed: s } : { kind: "facade", palette: pal, seed: s, scale }, pace);
      if (!tex) return null;
      if (!alive) { Object.values(tex).forEach(t => t.dispose()); return null; }
      // Painted for this complex only and never repainted: the WebGPU view empties the
      // canvas once the texture is on the GPU (ComplexRenderer.release).
      Object.values(tex).forEach(t => { t.userData.releaseAfterUpload = true; });
      Object.values(tex).forEach(keep);
      // (the tile is 8 bays by 8 storeys: fitted to the measured window pitch and storey)
      const cells = architecture ? 4 : 8;
      if (bay !== BAY_M || storey !== FLOOR_M) Object.values(tex).forEach(t => { t.repeat.set(1 / (cells * bay), 1 / (cells * storey)); t.offset.set(0, (1 - GROUND_M) / (cells * storey)); });
      const m = keep(new THREE.MeshPhysicalMaterial({
        map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.9, 0.9),
        roughnessMap: tex.rmMap, metalnessMap: tex.rmMap, roughness: 1, metalness: 1,
        emissiveMap: tex.emissiveMap, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0,
        clearcoat: 0.08, clearcoatRoughness: 0.6,
      }));
      patchMaterial(m, { glass: true });
      // (WebGPU: rooms behind the clear glass — interior mapping, ComplexRenderer)
      m.userData.interior = architecture ? {grid:[4,4],bay,storey,ceil:.1,floor:.84,recess:true} : true;
      m.userData.detail = "paint";
      lit.windows.push(m);
      return m;
    };
    // Independent paints share neither canvases nor random generators. Start all
    // three before waiting, so normal-map generation and worker delivery overlap.
    const stoneJob = paintTextures({ kind: "plinth", seed: seed + 13, tone: plinthTone(palette) }, pace);
    const facades = await Promise.all([seed, seed + 7919].map(s => facadeMaterial(palette, s)));
    if (facades.some(m => !m)) { void stoneJob.then(t => t && Object.values(t).forEach(x => x.dispose())); return; }
    walls.push(...facades as THREE.MeshPhysicalMaterial[]);
    step("facades");
    if (!await pace(true)) return;
    const roof = keep(new THREE.MeshStandardMaterial({ color: "#6f8174", roughness: 0.93 }));
    roof.userData.roofDetail = true;
    roof.userData.detail = "roof";
    const crown = keep(new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.4, metalness: 0.45, emissive: palette.accent, emissiveIntensity: 0 }));
    lit.crowns.push(crown);
    const low = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.wall).lerp(new THREE.Color(palette.wall2), 0.45), roughness: 0.75 }));
    low.userData.weathered = true;
    low.userData.detail = "paint";
    // Low-rise facilities (community centre, shops): the shop facade in the complex's
    // colour, drawn with the neighbourhood's shop material (one pipeline fewer).
    const lowTint = new THREE.Color(palette.wall).lerp(new THREE.Color("#ffffff"), 0.2);
    // The towers' own finish, a step above the neighbourhood: a honed granite base
    // (1–2층), end walls (측벽) in the complex's second colour with its accent stripe.
    const stoneTex = await stoneJob;
    if (!stoneTex) return;
    if (!alive) { Object.values(stoneTex).forEach(t => t.dispose()); return; }
    Object.values(stoneTex).forEach(keep);
    Object.values(stoneTex).forEach(t => { t.userData.releaseAfterUpload = true; });
    const stone = keep(new THREE.MeshPhysicalMaterial({
      map: stoneTex.map, normalMap: stoneTex.normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: stoneTex.rmMap, roughness: 1, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.35,
    }));
    stone.userData.detail = "granite";
    // Plain painted trim (end walls, their accent stripe, the roof core): one material,
    // colour per vertex.
    const trim = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }));
    trim.userData.weathered = true;
    trim.userData.detail = "paint";
    const gableC = new THREE.Color(palette.wall2).lerp(new THREE.Color(palette.wall), 0.25), stripeC = new THREE.Color(palette.accent);
    const plantC = new THREE.Color(palette.wall2).lerp(new THREE.Color("#9a9a96"), 0.5);
    const tinted = (g: THREE.BufferGeometry, c: THREE.Color) => {
      const n = g.getAttribute("position").count, col = new Float32Array(n * 3);
      for (let j = 0; j < n; j++) { col[j * 3] = c.r; col[j * 3 + 1] = c.g; col[j * 3 + 2] = c.b; }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      return g;
    };
    step("stone");
    [roof, crown, low, stone, trim].forEach(m => patchMaterial(m));
    // The complex's own materials start compiling now, while its buildings are laid out
    // (their pipelines used to wait for the finished model: ~1 s after it, on a first
    // visit). One invisible triangle each — zero area, never culled, shadow-casting so the
    // shadow passes compile too — with the attributes their meshes will have; gone once
    // the model is on screen.
    {
      const tri = (color: boolean) => {
        const g = keep(new THREE.BufferGeometry());
        g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9), 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(6), 2));
        if (color) g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(9), 3));
        return g;
      };
      const plainTri = tri(false), tintedTri = tri(true);
      const warmBox = new THREE.Group();
      stage.scene.add(warmBox);
      for (const m of [...walls, roof, crown, low, stone, trim]) {
        const mesh = new THREE.Mesh(m.vertexColors ? tintedTri : plainTri, m);
        mesh.frustumCulled = false; mesh.castShadow = true;
        stage.addWarm(warmBox, mesh);
      }
      stage.onShown.push(() => warmBox.removeFromParent());
      disposables.push({ dispose: () => warmBox.removeFromParent() });
    }
    // The neighbourhood's facades (and the complex's own low-rise) by style.
    const ctxGeos: Record<ContextStyle, THREE.BufferGeometry[]> = { villa: [], shop: [], office: [], apt: [] };

    if (!await pace(true)) return;
    // Geometry per material, merged once below: a few draws for the whole complex.
    const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
    // Every piece remembers its building ("b" + index, "c" + neighbour index): the photo
    // models (VWorld 3D) replace buildings one by one, after the first frame.
    let owner = "";
    const own = <G extends THREE.BufferGeometry>(geo: G) => { geo.userData.owner = owner; return geo; };
    const add = (mat: THREE.Material, geo: THREE.BufferGeometry | undefined) => {
      if (!geo) return;
      if (!parts.has(mat)) parts.set(mat, []);
      parts.get(mat)!.push(own(geo));
    };
    const relief: THREE.Matrix4[] = [], reliefOwner: string[] = [];
    const reliefLimit = stage.hq ? 40000 : 12000;
    const box = new THREE.Box3();
    const pickables: THREE.Mesh[] = [];
    // (a landmark area's surveyed pieces: the register's own extrusions are not picked there)
    const surveyedHulls: [number, number][][] = [];
    let top = 10, floor = Infinity;
    function footArea(r: [number, number][]) { return Math.abs(r.reduce((a, [x, y], j) => { const q = r[(j + 1) % r.length]; return a + x * q[1] - q[0] * y; }, 0) / 2); }
    const panel = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, out: number, thick: number, inset: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len;
      const g = new THREE.BoxGeometry(len * inset, thick, z1 - z0).toNonIndexed();
      g.rotateZ(Math.atan2(uy, ux));
      // Outward normal of a counter-clockwise ring is to the right of travel.
      g.translate((x0 + x1) / 2 + uy * out, (y0 + y1) / 2 - ux * out, (z0 + z1) / 2);
      return g;
    };
    for (const [i, b] of data.buildings.entries()) {
      owner = "b" + i;
      if (!await pace()) return;
      // Register entries with neither height nor floors and a small footprint are guard
      // posts and ramp covers: drawn as guessed blocks they read as stray objects.
      if (b.height_source === "estimated" && footArea(b.rings[0]) < 300) continue;
      // Seated on the real ground: its lowest point under the footprint.
      const g = terrain.base(b.rings[0]);
      const isTower = b.floors >= 5;
      const geo = extrude(b, g, isTower ? FLOOR_M : CONTEXT_FLOOR_M.shop);
      const [caps, sides] = splitGroups(geo);
      add(roof, caps);
      if (isTower) add(walls[i % 2], sides);
      else if (sides) ctxGeos.shop.push(own(tinted(sides, lowTint)));
      // Picking only: never rendered, shares the group's transform.
      geo.clearGroups();
      const pick = new THREE.Mesh(keep(geo));
      pick.userData.label = `${b.name ? b.name + " · " : ""}${heightLabel(b)}`;
      pick.matrixWorld.copy(group.matrixWorld);
      pickables.push(pick);
      const H = b.height + g, B = b.base + g;
      if (isTower) {
        facadeRelief({ ...b, base: B, height: H }, relief, reliefLimit);
        while (reliefOwner.length < relief.length) reliefOwner.push(owner);
        // Rooftop crown band in the complex's accent colour, and the lift / stair core.
        const cap = new THREE.ExtrudeGeometry(shapeOf(b), { depth: 1.6, bevelEnabled: false });
        cap.translate(0, 0, H);
        const [capTop, capSide] = splitGroups(cap);
        cap.dispose();
        add(roof, capTop);
        add(crown, capSide);
        const ring = b.rings[0];
        const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
        // Granite base: the footprint, 8 cm proud of the wall, up to the 2nd floor slab.
        const plinthTop = B + Math.min((b.height - b.base) * 0.3, GROUND_M + 2 * FLOOR_M);
        const span = Math.max(8, ...ring.map(([x, y]) => Math.hypot(x - cx, y - cy)));
        const k = 1 + 0.08 / span;
        const plinth = new THREE.ExtrudeGeometry(new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(cx + (x - cx) * k, cy + (y - cy) * k))),
          { depth: plinthTop - B + SINK, bevelEnabled: false });
        plinth.translate(0, 0, B - SINK);
        const [, plinthSide] = splitGroups(plinth);
        plinth.dispose();
        add(stone, plinthSide);
        // End walls (측벽): the faces square to the slab's long axis at its two extremes — not
        // the short segments of a stepped front. No invented stripes or blocks (every real end
        // wall is its own design): plain paint in the second colour, the number at the top;
        // where VWorld's survey covers the complex, its end walls are repainted from the
        // colours measured on them (the photo pass).
        const ends = endWalls(ring);
        ring.forEach((p, j) => {
          if (!ends.has(j)) return;
          const q = ring[(j + 1) % ring.length];
          add(trim, tinted(panel(p[0], p[1], q[0], q[1], plinthTop, H, 0.12, 0.22, 0.92), gableC));
        });
        if (inRing([cx, cy], ring)) {
          let ang = 0, best = 0;
          ring.forEach((p, j) => {
            const q = ring[(j + 1) % ring.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
            if (len > best) { best = len; ang = Math.atan2(q[1] - p[1], q[0] - p[0]); }
          });
          const core = new THREE.BoxGeometry(Math.min(9, best * 0.3), 5, 4.2).toNonIndexed();
          core.rotateZ(ang);
          core.translate(cx, cy, H + 1.6 + 2.1);
          add(trim, tinted(core, plantC));
        }
      }
      geo.computeBoundingBox();
      box.union(geo.boundingBox!);
      top = Math.max(top, H);
      floor = Math.min(floor, g);
    }
    const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, 60);
    const cx = (box.max.x + box.min.x) / 2, cy = (box.max.y + box.min.y) / 2;
    const dist = Math.max(span, top * 1.4) * 1.1 + 40;
    const groundGridJob = sceneWork('terrainGround', {T, G: dist * 12, segs: terrain.source === null ? 64 : stage.hq ? 320 : 200, grid: terrain.grid ?? null})?.catch(() => null);
    step("towers");
    if (!Number.isFinite(floor)) floor = 0;
    // The neighbourhood: every registered building within the surveyed radius, on its
    // own ground, in one of three facades chosen by its registered use, tinted per
    // building, windows fitted to its registered floors, a parapet round its roof.
    const styles: ContextStyle[] = ["villa", "shop", "office", "apt"];
    const parapets: THREE.Matrix4[] = [], parapetOwner: string[] = [];
    const pm = new THREE.Object3D();
    step("merge");
    if (!await pace(true)) return;
    // The landmarks round the complex answer the hover with their names (picking only).
    // (an OpenStreetMap result names its buildings in `name`)
    if (hostRef.current) { delete hostRef.current.dataset.landmarks; delete hostRef.current.dataset.landmarkNames; hostRef.current.dataset.titled = String(neighbours.filter(b => b.title).length); }
    const landmark = (b: RealEstateBuilding) => {
      // (where a surveyed piece of a landmark area stands, it answers for itself)
      { const r = b.rings[0], mx = r.reduce((t, q) => t + q[0], 0) / r.length, my = r.reduce((t, q) => t + q[1], 0) / r.length;
        if (surveyedHulls.some(h => inRing([mx, my], h))) return; }
      const known = landmarkLabel(b.title === undefined && data.source === "osm" && /[가-힣A-Za-z]/.test(b.name ?? "") ? { ...b, title: b.name } : b);
      if (!known) return;
      const pick = new THREE.Mesh(keep(extrude(b, terrain.base(b.rings[0]), FLOOR_M)));
      pick.geometry.clearGroups();
      pick.userData.label = known;
      pick.matrixWorld.copy(group.matrixWorld);
      pickables.push(pick);
      if (hostRef.current) hostRef.current.dataset.landmarks = String(+(hostRef.current.dataset.landmarks ?? 0) + 1);
    };
    // Consume the same two random draws per neighbour, in the original order.
    // Only typed arrays cross back; abandoned builds own no GPU objects.
    const neighbourJobs = neighbours.map(b => {
      const ground = terrain.base(b.rings[0]);
      const style = contextStyle(b.use, b.height, rnd());
      const c = new THREE.Color(tints[Math.floor(rnd() * tints.length)]);
      if (style === "office") c.lerp(new THREE.Color("#ffffff"), 0.4);
      if (style === "apt") c.lerp(new THREE.Color("#ffffff"), 0.65);
      return { building: b, ground, style, floorM: CONTEXT_FLOOR_M[style], color: [c.r, c.g, c.b] as [number, number, number] };
    });
    const neighbourJob = sceneWork('neighbours', { jobs: neighbourJobs })?.catch(() => null);

    const neighbourResult = await neighbourJob;
    if (!alive) return;
    sliceStart = performance.now();
    for (const [j, b] of neighbours.entries()) {
      owner = "c" + j;
      if (!await pace()) return;
      const job = neighbourJobs[j], g = job.ground, style = job.style;
      const geo = neighbourGeometry(neighbourResult?.[j] ?? neighbourArrays(job));
      ctxGeos[style].push(own(geo));
      landmark(b);
      // Parapet: a 0.9 m upstand, 0.2 m thick, along every roof edge longer than 2 m.
      const ring = b.rings[0], H = b.height + g;
      if (b.height >= 5 && parapets.length < (stage.hq ? 24000 : 8000)) ring.forEach((p, j) => {
        const q = ring[(j + 1) % ring.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (len < 2) return;
        const ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len;
        pm.position.set((p[0] + q[0]) / 2 - uy * 0.1, (p[1] + q[1]) / 2 + ux * 0.1, H + 0.45);
        pm.rotation.set(0, 0, Math.atan2(uy, ux));
        pm.scale.set(len + 0.2, 0.2, 0.9);
        pm.updateMatrix();
        parapets.push(pm.matrix.clone()); parapetOwner.push(owner);
      });
    }
    step("neighbours");
    // The buildings as merged meshes, leaving out any in `skip` (replaced by photo models).
    // The pieces are kept until the photo pass is done (they are needed to merge again).
    // (?survey=0: the modelled buildings only, for comparison)
    const photoPending = !!(data.vworld_key && data.center) && new URLSearchParams(location.search).get("survey") !== "0";
    let assembled: THREE.Object3D[] = [];
    const assemble = async (skip: Set<string>, first: boolean) => {
      const out: THREE.Object3D[] = [];
      const kept = (g: THREE.BufferGeometry) => !skip.has(g.userData.owner);
      // (in slices, the photo pass's second assembly too: one task of it stalled the page)
      for (const [mat, geos] of parts) {
        if (!await pace()) return null;
        const list = geos.filter(kept);
        if (!list.length) continue;
        const mesh = new THREE.Mesh(keep(mergeGeometries(list, false)!), mat);
        mesh.castShadow = mesh.receiveShadow = true;
        out.push(mesh);
      }
      const reliefKept = relief.filter((_, j) => !skip.has(reliefOwner[j] ?? ""));
      if (reliefKept.length) {
        const unit = keep(new THREE.BoxGeometry(1, 1, 1));
        const ledges = new THREE.InstancedMesh(unit, low, reliefKept.length);
        reliefKept.forEach((m, j) => ledges.setMatrixAt(j, m));
        ledges.castShadow = ledges.receiveShadow = true;
        ledges.computeBoundingSphere();
        out.push(ledges);
        disposables.push(ledges);
      }
      for (const style of styles) {
        if (!await pace()) return null;
        const list = ctxGeos[style].filter(kept);
        if (!list.length) continue;
        // (the complex's own low sides join the shop facade unindexed: indexed as they are, to merge)
        for (const g of list) if (!g.index) g.setIndex(Array.from({ length: g.getAttribute("position").count }, (_, i) => i));
        const merged = keep(mergeGeometries(list, false)!);
        // Apartment neighbours get the apartment facade (neutral colours, one variant, no
        // base, end walls or crown: those stay the complex's own). Shared by every complex,
        // compiled while the first one loads.
        if (!await sharedContextTexturesSliced(style, pace)) return null;
        const ctxMat = sharedContextMaterial(style);
        if (first) lit.windows.push(ctxMat);
        const ctxMesh = new THREE.Mesh(merged, ctxMat);
        ctxMesh.castShadow = ctxMesh.receiveShadow = true;
        out.push(ctxMesh);
      }
      const parKept = parapets.filter((_, j) => !skip.has(parapetOwner[j] ?? ""));
      if (parKept.length) {
        // Same material and instanced pipeline as the towers' floor ledges.
        const unit = keep(new THREE.BoxGeometry(1, 1, 1));
        const im = new THREE.InstancedMesh(unit, low, parKept.length);
        parKept.forEach((m, j) => im.setMatrixAt(j, m));
        im.castShadow = im.receiveShadow = true;
        im.computeBoundingSphere();
        out.push(im);
        disposables.push(im);
      }
      return out;
    };
    const releasePieces = () => {
      for (const geos of parts.values()) geos.forEach(g => g.dispose());
      for (const style of styles) ctxGeos[style].forEach(g => g.dispose());
      parts.clear();
      for (const style of styles) ctxGeos[style].length = 0;
      relief.length = reliefOwner.length = parapets.length = parapetOwner.length = 0;
    };
    {
      const out = await assemble(new Set(), true);
      if (!out) return;
      assembled = out;
      group.add(...assembled);
      if (!photoPending) releasePieces();
    }
    // Building numbers painted on end walls: one texture per number, dark grey on clear.
    const numberMats = new Map<string, THREE.MeshStandardMaterial>();
    const numberMaterial = (label: string) => {
      let m = numberMats.get(label);
      if (m) return m;
      const cv = document.createElement("canvas"); cv.width = 512; cv.height = 256;
      const g2 = cv.getContext("2d", { willReadFrequently: true })!;
      g2.font = `bold 220px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      g2.textAlign = "center"; g2.textBaseline = "middle"; g2.fillStyle = "#3a3d42";
      const tw = Math.min(500, g2.measureText(label).width + 30);
      g2.fillText(label, 256, 136, 500);
      const tex = keep(new THREE.CanvasTexture(cv));
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.flipY = false;
      // (the quad covers only the digits: uv x cropped to them)
      tex.repeat.set(tw / 512, 1); tex.offset.set((256 - tw / 2) / 512, 0);
      m = keep(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.userData.aspect = tw / 256;
      numberMats.set(label, m);
      return m;
    };
    // The real buildings: VWorld's photo-textured 3D models (their facades photographed),
    // fetched after the first frame and swapped in for the modelled buildings they match.
    // Accuracy first: a model is used only over a registered footprint (the survey can
    // predate a rebuild) and at a height within 35 % of the registered one; the rest keep
    // their modelled buildings. A constant survey offset between the two sources is taken
    // out first (the median shift between matched centres).
    // Results kept before building names were: the names asked of VWorld once the view is
    // up, matched to the neighbours by position (within 4 m of the footprint's middle).
    if (data.vworld_key && data.center && data.source !== "osm" && !neighbours.some(b => b.title !== undefined)) afterShown(() => void (async () => {
      const names = await vworldBuildingNames(data, data.vworld_key!, data.vworld_domain, reach + 30).catch(() => []);
      if (!alive || !names.length) return;
      const mid = (r: [number, number][]) => [r.reduce((t, q) => t + q[0], 0) / r.length, r.reduce((t, q) => t + q[1], 0) / r.length];
      let n = 0;
      for (const b of neighbours) {
        const [x, y] = mid(b.rings[0]);
        let best: (typeof names)[number] | null = null, bd = 16;
        for (const c of names) { const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bd) { bd = d; best = c; } }
        if (!best) continue;
        const before = pickables.length;
        landmark({ ...b, title: best.title, use: b.use ?? best.use, floors: b.floors || best.floors, name: b.name ?? best.dong });
        n += pickables.length - before;
      }
      if (hostRef.current) hostRef.current.dataset.landmarkNames = `${names.length} names, ${n} matched`;
    })());
    // (what the landmarks' areas add, for the ring to leave out: x, y pairs)
    const surveyedNear: number[] = [];
    const landmarksNear = data.center ? LANDMARKS.filter(lm => Math.hypot(...metresFrom(data.center!, lm.lat, lm.lon)) < RING_M + lm.radius) : [];
    let surveyPass: Promise<unknown> = Promise.resolve();
    if (photoPending) (textureBudgetEnabled()?(f:()=>void)=>f():afterShown)(() => { stage.busy++; surveyPass = (async () => {
      let photos: PhotoBuilding[] = [];
      const extra = new Set<PhotoBuilding>();
      try {
        // (the complex and the blocks round it: ~220 m, 130 on phones — beyond, the modelled ones)
        photos = await photoBuildings(data.vworld_key!, data.center!.lat, data.center!.lon, Math.min(reach, stage.hq ? 220 : 130), { photo: false });
        // A landmark's area: every surveyed building within its radius (shapes only).
        for (const lm of landmarksNear) {
          const got = await photoBuildings(data.vworld_key!, data.center!.lat, data.center!.lon, lm.radius, { photo: false, at: lm }).catch(() => [] as PhotoBuilding[]);
          const have = new Set(photos.map(ph => ph.key));
          for (const ph of got) { if (have.has(ph.key)) { ph.geometry.dispose(); continue; } photos.push(ph); extra.add(ph); }
        }
        if (hostRef.current && landmarksNear.length) hostRef.current.dataset.landmarkArea = `${extra.size} surveyed`;
      } catch (err) { console.info("[3D] photo buildings unavailable:", err); }
      // (the landmark area's buildings answer a click with their registered names: the register
      // asked once out to the area's far side)
      const areaNames = landmarksNear.length
        ? await vworldBuildingNames(data, data.vworld_key!, data.vworld_domain, Math.max(...landmarksNear.map(lm => Math.hypot(...metresFrom(data.center!, lm.lat, lm.lon)) + lm.radius))).catch(() => [])
        : [];
      const drop = () => photos.forEach(ph => ph.geometry.dispose());
      if (!alive) { drop(); return; }
      const centre = (r: [number, number][]) => [r.reduce((t, q) => t + q[0], 0) / r.length, r.reduce((t, q) => t + q[1], 0) / r.length] as const;
      const feet = [
        ...data.buildings.map((b, i) => ({ owner: "b" + i, ring: b.rings[0], height: b.height, estimated: b.height_source === "estimated" })),
        ...neighbours.map((b, j) => ({ owner: "c" + j, ring: b.rings[0], height: b.height, estimated: b.height_source === "estimated" })),
      ].map(f => ({ ...f, c: centre(f.ring) }));
      const deltas: [number, number][] = [];
      for (const ph of photos) {
        let best: (typeof feet)[number] | null = null, bd = 15;
        for (const f of feet) { const d = Math.hypot(f.c[0] - ph.cx, f.c[1] - ph.cy); if (d < bd) { bd = d; best = f; } }
        if (best) deltas.push([best.c[0] - ph.cx, best.c[1] - ph.cy]);
      }
      const median = (v: number[]) => { const a = [...v].sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };
      const [dx, dy] = deltas.length >= 3 ? [median(deltas.map(d => d[0])), median(deltas.map(d => d[1]))] : [0, 0];
      const surveyRoads=ringIndex(roadFootprints(splitRoadJunctions(stitchedRoads(data.roads??[]),true)));
      const surveyBuildings=ringIndex([...data.road_building_footprints??[],...[...data.buildings,...data.context].map(b=>b.rings[0])]);
      let roadRejected=0;
      const skip = new Set<string>();
      const used: THREE.Mesh[] = [];
      // The surveyed shapes in the view's own materials (lit, shadowed, reflecting, lit at
      // night like the rest): the complex's facade and roof, the neighbours' facade by use.
      const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
      const put = (m: THREE.Material, g: THREE.BufferGeometry | null) => { if (g) byMat.set(m, [...(byMat.get(m) ?? []), g]); };
      const paint = (g: THREE.BufferGeometry | null, c: THREE.Color) => {
        if (!g) return g;
        const n = g.getAttribute("position").count, col = new Float32Array(n * 3);
        for (let j = 0; j < n; j++) col.set([c.r, c.g, c.b], j * 3);
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
        return g;
      };
      // The real colours: the complex's own buildings' photographs read (not drawn) —
      // the paint of the walls, the band under the roof edge, the roof — and the facade
      // painted again in them. Brand colours stay where the photographs say little.
      // (every photograph read at once, a few at a time by the browser)
      // (not a landmark area's hundreds: their photographs are never read — shapes only)
      const own = photos.filter(ph => feet.some(f => f.owner.startsWith("b") && Math.hypot(f.c[0] - (ph.cx + dx), f.c[1] - (ph.cy + dy)) < 12));
      // Analyse the selected complex's photographs, not every surrounding wall.
      // Neighbours already have surveyed geometry and their existing materials.
      const rhythmOf = new Map(own.filter(ph => !extra.has(ph)).map(ph => [ph, photoRhythm(data.vworld_key!, ph).catch(() => null)] as const));
      await Promise.all(rhythmOf.values());
      if (!alive) { drop(); releasePieces(); return; }
      // (a photograph whose walls read near black — deep shade, an empty patch of the image — says
      // nothing of the paint: left out, as in photoAnalysis.wallPaintFrom)
      const lumOf = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      const colours = (await Promise.all(own.slice(0, 8).map(ph => photoColours(data.vworld_key!, ph).catch(() => null)))).filter(c => c && c.samples > 40 && lumOf(c.wall) >= 0.2) as NonNullable<Awaited<ReturnType<typeof photoColours>>>[];
      if (!alive) { drop(); releasePieces(); return; }
      let measured = { bay: BAY_M, storey: FLOOR_M };
      let ownWalls = walls, coreMat: THREE.Material = low, gableMat: THREE.Material = low, bandMat: THREE.Material = crown;
      // (the neighbours' end walls: plain paint in each building's own tint)
      const plainMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
      plainMat.userData.weathered = true; plainMat.userData.detail = "paint";
      if (colours.length) {
        const avg = (pick: (c: (typeof colours)[number]) => number[]) => [0, 1, 2].map(k => colours.map(c => pick(c)[k]).sort((a, b) => a - b)[colours.length >> 1]);
        const hex = (c: number[], lift = 1) => "#" + c.map(v => Math.round(Math.min(1, v * lift) * 255).toString(16).padStart(2, "0")).join("");
        const sat = (c: number[]) => (Math.max(...c) - Math.min(...c)) / Math.max(Math.max(...c), 1e-3);
        const wall = avg(c => c.wall), band = avg(c => c.band), roofC = avg(c => c.roof);
        // (the photographs are shaded: the paint a little brighter than they show it)
        const lift = Math.min(1.35, 0.9 / Math.max(...wall, 0.05));
        const real: Palette = {
          ...palette,
          wall: hex(wall, lift),
          wall2: hex(wall.map(v => v * 0.86), lift),
          // (the stripe as painted: the photograph greys and darkens it — saturation restored)
          // (a blue or cyan "stripe" is glass mirroring the sky in the photograph, not paint)
          accent: (() => {
            const c = new THREE.Color().setRGB(band[0], band[1], band[2]); const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl);
            const sky = hsl.h > 0.5 && hsl.h < 0.7;
            if (sat(band) <= 0.25 || sky) return hex(wall.map(v => v * 0.7), lift);
            c.setHSL(hsl.h, Math.min(0.6, hsl.s * 1.3), Math.min(0.5, Math.max(0.36, hsl.l)));
            return "#" + c.getHexString();
          })(),
          roof: hex(roofC, 1.1),
        };
        // the window pitch and storey measured on the complex's own faces
        const med = (v: number[]) => { const q = [...v].sort((a, b) => a - b); return q.length ? q[q.length >> 1] : null; };
        const rh = await Promise.all(own.map(ph => rhythmOf.get(ph)));
        const bay = med(rh.map(r => r?.bay).filter((v): v is number => !!v)) ?? BAY_M;
        const storey = med(rh.map(r => r?.storey).filter((v): v is number => !!v)) ?? FLOOR_M;
        // (the complex being viewed at twice the texture resolution: 80 texels a metre; phones 1x)
        const sharp = stage.hq ? 2 : 1;
        const fresh = await Promise.all([facadeMaterial(real, seed, bay, storey, sharp), facadeMaterial(real, seed + 7919, bay, storey, sharp)]);
        if (hostRef.current) hostRef.current.dataset.rhythm = `bay ${bay.toFixed(2)} storey ${storey.toFixed(2)}`;
        measured = { bay, storey };
        if (!alive) { drop(); releasePieces(); return; }
        if (fresh[0] && fresh[1]) ownWalls = fresh as THREE.MeshPhysicalMaterial[];
        roof.color.set(real.roof);
        bandMat = keep(new THREE.MeshStandardMaterial({ color: real.accent, roughness: 0.45, metalness: 0.1 }));
        coreMat = keep(new THREE.MeshStandardMaterial({ color: real.wall, roughness: 0.8 }));
        gableMat = keep(new THREE.MeshStandardMaterial({ color: real.wall2, roughness: 0.8 }));
        for (const m of [coreMat, gableMat]) { m.userData.weathered = true; m.userData.detail = "paint"; }
        if (hostRef.current) hostRef.current.dataset.realColours = `${real.wall} ${real.accent} ${real.roof} (${colours.length})`;
      }
      // (B) relief on the complex's window faces, as instanced boxes
      const ledges: THREE.Matrix4[] = [], rails: THREE.Matrix4[] = [], fins: THREE.Matrix4[] = [];
      const ob = new THREE.Object3D();
      const reliefBox = (list: THREE.Matrix4[], x: number, y: number, z: number, sx: number, sy: number, sz: number, ang: number) => {
        ob.position.set(x, y, z); ob.rotation.set(0, 0, ang); ob.scale.set(sx, sy, sz); ob.updateMatrix(); list.push(ob.matrix.clone());
      };
      const relBay = measured.bay, relStorey = measured.storey;
      // The complex's end walls repainted from the paint measured on them (their real bands,
      // blocks and colours; never the photograph itself): one atlas, 7 px a cell, packed in
      // shelves as the walls ask for it; drawn once every wall is placed.
      const ATLAS = 2048, CELL = 7;
      const atlasCv = document.createElement("canvas"); atlasCv.width = atlasCv.height = ATLAS;
      atlasCv.getContext("2d", { willReadFrequently: true });   // (drawn by the CPU: see complexScene canvas)
      const atlasTex = keep(new THREE.CanvasTexture(atlasCv));
      atlasTex.colorSpace = THREE.SRGBColorSpace; atlasTex.anisotropy = 8; atlasTex.flipY = false;
      const paintMat = keep(new THREE.MeshStandardMaterial({ map: atlasTex, roughness: 0.85 }));
      paintMat.userData.weathered = true; paintMat.userData.detail = "paint";
      const slots = new Map<WallPaint, { x: number; y: number }>();
      let shelfX = 0, shelfY = 0, shelfH = 0;
      const slotOf = (w: WallPaint) => {
        let at = slots.get(w);
        if (at) return at;
        const pw = w.cols * CELL + 2, ph2 = w.rows * CELL + 2;
        if (shelfX + pw > ATLAS) { shelfX = 0; shelfY += shelfH; shelfH = 0; }
        if (shelfY + ph2 > ATLAS || pw > ATLAS) return null;
        at = { x: shelfX + 1, y: shelfY + 1 }; slots.set(w, at);
        shelfX += pw; shelfH = Math.max(shelfH, ph2);
        return at;
      };
      // Spend photograph analysis on the selected buildings. Distant neighbours
      // already have shared facade materials; analysing every wall costs hundreds
      // of image requests without adding detail visible in the overview.
      const paintPhotos = textureBudgetEnabled() ? own.slice(0,8) : photos;
      const paintsOf = new Map(await Promise.all(paintPhotos.filter(ph => !extra.has(ph)).map(async ph => [ph, await photoWallPaint(data.vworld_key!, ph).catch(() => [] as WallPaint[])] as const)));
      // In a landmark's area (by where it stands, whichever fetch brought it).
      const lmAt = landmarksNear.map(lm => [...metresFrom(data.center!, lm.lat, lm.lon), lm.radius] as const);
      const inArea = (ph: PhotoBuilding) => extra.has(ph) || lmAt.some(([x, y, r]) => Math.hypot(ph.cx - x, ph.cy - y) <= r);
      // (homes keep the photograph's say on their faces: an apartment's end walls are blank)
      const homeUse = (use: string | null | undefined, title?: string | null) => (use ?? "").startsWith("02") || /^(apartments|residential)$/.test(use ?? "") || /아파트/.test(title ?? "");
      const residential = (ph: PhotoBuilding, fits: { owner: string }[]) => {
        if (fits.some(f => f.owner.startsWith("b"))) return true;
        const nb = fits[0] ? neighbours[Number(fits[0].owner.slice(1))] : null;
        if (nb) return homeUse(nb.use, nb.title);
        const near = areaNames.find(c => inRing([c.x, c.y], ph.hull));
        return near ? homeUse(near.use, near.title) : false;
      };
      // A surveyed building of a landmark area made clickable: its own shape, its register name.
      // The registered footprints (the complex's and its neighbours'), for naming a point of a surveyed model.
      const footprintsAt = (x: number, y: number) => {
        for (const b of [...data.buildings, ...neighbours]) { const r = b.rings[0]; if (inRing([x, y], r)) return { ring: r, title: b.title ?? b.name ?? null, floors: b.floors }; }
        return null;
      };
      const pickSurveyed = (shape: ReturnType<typeof surveyedShape>, _cx: number, _cy: number, _height: number, _hull: [number, number][]) => {
        const parts = [shape.walls, shape.roofs, shape.ends, shape.cores].filter((g): g is THREE.BufferGeometry => !!g);
        if (!parts.length) return;
        const n = parts.reduce((t, g) => t + g.getAttribute("position").count, 0), all = new Float32Array(n * 3);
        let o = 0;
        for (const g of parts) { all.set(g.getAttribute("position").array as Float32Array, o); o += g.getAttribute("position").count * 3; }
        // One surveyed model can hold several buildings (롯데월드타워 and part of 롯데월드몰 are one):
        // its connected pieces, each picked and named for itself.
        const tris = n / 3, parent = new Int32Array(tris).map((_, i) => i);
        const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
        const seen = new Map<string, number>();
        for (let t = 0; t < tris; t++) for (let v = 0; v < 3; v++) {
          const q = (t * 3 + v) * 3, key = `${Math.round(all[q] * 4)},${Math.round(all[q + 1] * 4)},${Math.round(all[q + 2] * 4)}`;
          const had = seen.get(key);
          if (had === undefined) seen.set(key, t); else { const ra = find(had), rb = find(t); if (ra !== rb) parent[ra] = rb; }
        }
        const groups = new Map<number, number[]>();
        for (let t = 0; t < tris; t++) { const r = find(t); const g = groups.get(r); if (g) g.push(t); else groups.set(r, [t]); }
        // (small pieces — a canopy, a stair — join the piece nearest them)
        const pieces = [...groups.values()].map(ts => {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, top = -Infinity, bottom = Infinity;
          const pts: [number, number][] = [];
          for (const t of ts) for (let v = 0; v < 3; v++) { const q = (t * 3 + v) * 3; const x = all[q], y = all[q + 1]; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); top = Math.max(top, all[q + 2]); bottom = Math.min(bottom, all[q + 2]); pts.push([x, y]); }
          return { ts, box: [x0, y0, x1, y1], top, bottom, pts, area: (x1 - x0) * (y1 - y0) };
        });
        const big = pieces.filter(pc => pc.area >= 150 || pc.ts.length >= 60);
        const keepers = big.length ? big : [pieces.sort((p1, p2) => p2.ts.length - p1.ts.length)[0]];
        for (const pc of pieces) if (!keepers.includes(pc)) {
          const cxp = (pc.box[0] + pc.box[2]) / 2, cyp = (pc.box[1] + pc.box[3]) / 2;
          let best = keepers[0], bd2 = Infinity;
          for (const k2 of keepers) { const d = Math.hypot((k2.box[0] + k2.box[2]) / 2 - cxp, (k2.box[1] + k2.box[3]) / 2 - cyp); if (d < bd2) { bd2 = d; best = k2; } }
          for (const t of pc.ts) best.ts.push(t);
          for (const q of pc.pts) best.pts.push(q);
          best.top = Math.max(best.top, pc.top); best.bottom = Math.min(best.bottom, pc.bottom);
        }
        for (const pc of keepers) {
          const arr = new Float32Array(pc.ts.length * 9);
          pc.ts.forEach((t, i) => arr.set(all.subarray(t * 9, t * 9 + 9), i * 9));
          const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(arr, 3)); geo.computeBoundingSphere();
          const ring = convexHull(pc.pts);
          const cx = (pc.box[0] + pc.box[2]) / 2, cy = (pc.box[1] + pc.box[3]) / 2, height = pc.top - pc.bottom;
          // The register's entry standing in this piece (the tallest by floors when several do);
          // else the nearest within 30 m.
          const inside = areaNames.filter(c => inRing([c.x, c.y], ring));
          let name = inside.sort((c1, c2) => c2.floors - c1.floors)[0] ?? null;
          if (!name) { let bd = 30 * 30; for (const c of areaNames) { const d = (c.x - cx) ** 2 + (c.y - cy) ** 2; if (d < bd) { bd = d; name = c; } } }
          // A landmark by its own name and height; the rest of its register entry (롯데월드타워앤드롯데월드몰)
          // by the landmark's companion name.
          const lm = landmarksNear.find(l => { const [lx, ly] = metresFrom(data.center!, l.lat, l.lon); return Math.hypot(lx - cx, ly - cy) < 80 && height > l.minHeight; });
          const sibling = !lm ? landmarksNear.find(l => name && l.register && name.title === l.register) : null;
          const title = lm ? lm.name : sibling ? `${sibling.rest}${name?.dong ? ` ${name.dong}` : ""}` : name ? `${name.title}${name.dong && !name.title.includes(name.dong) ? ` ${name.dong}` : ""}` : null;
          const floors = lm ? lm.floors : name?.floors;
          const h = `높이 ${lm ? lm.height : Math.round(height)} m`;
          const pick = new THREE.Mesh(keep(geo));
          pick.userData.label = title ? `${title}${floors ? ` · ${floors}층` : ""} · ${h}` : h;
          pick.userData.surveyed = true;
          // Under a point: the registered footprint there, its register entry and the surveyed
          // height within it (a mall wing its own, the tower's footprint its 555 m).
          const tops = new Map<[number, number][], number>();
          pick.userData.labelAt = (x: number, y: number) => {
            const f = footprintsAt(x, y);
            if (!f) {
              // (no registered footprint here: the surveyed height round the point, the nearest name)
              let near = -Infinity;
              for (let i = 2; i < arr.length; i += 3) if ((arr[i - 2] - x) ** 2 + (arr[i - 1] - y) ** 2 < 144) near = Math.max(near, arr[i]);
              if (!Number.isFinite(near)) return null;
              let nm: (typeof areaNames)[number] | null = null, bd = 30 * 30;
              for (const c of areaNames) { const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bd) { bd = d; nm = c; } }
              const sib0 = nm && landmarksNear.find(l => l.register === nm!.title);
              const t0 = nm ? (sib0 ? `${sib0.rest}${nm.dong ? ` ${nm.dong}` : ""}` : nm.title) : null;
              return `${t0 ? `${t0}${nm!.floors ? ` · ${nm!.floors}층` : ""} · ` : ""}높이 ${Math.round(near - pc.bottom)} m`;
            }
            let topZ = tops.get(f.ring);
            if (topZ === undefined) {
              topZ = -Infinity;
              for (let i = 2; i < arr.length; i += 3) if (inRing([arr[i - 2], arr[i - 1]], f.ring)) topZ = Math.max(topZ, arr[i]);
              tops.set(f.ring, topZ);
            }
            if (!Number.isFinite(topZ)) return null;
            const ht = topZ - pc.bottom;
            const lmHere = landmarksNear.find(l => ht > l.minHeight && Math.hypot(...((([lx, ly]) => [lx - x, ly - y])(metresFrom(data.center!, l.lat, l.lon)) as [number, number])) < 120);
            if (lmHere) return `${lmHere.name} · ${lmHere.floors}층 · 높이 ${lmHere.height} m`;
            const inside2 = areaNames.filter(c => inRing([c.x, c.y], f.ring)).sort((c1, c2) => c2.floors - c1.floors)[0];
            const sib = inside2 && landmarksNear.find(l => l.register === inside2.title);
            const t2 = inside2 ? (sib ? `${sib.rest}${inside2.dong ? ` ${inside2.dong}` : ""}` : `${inside2.title}${inside2.dong && !inside2.title.includes(inside2.dong) ? ` ${inside2.dong}` : ""}`) : (f.title ?? null);
            const fl = inside2?.floors || f.floors;
            return `${t2 ? `${t2}${fl ? ` · ${fl}층` : ""} · ` : ""}높이 ${Math.round(ht)} m`;
          };
          pick.matrixWorld.copy(group.matrixWorld);
          pickables.push(pick);
          surveyedHulls.push(ring);
        }
      };
      let k = 0, matched = 0;
      for (const ph of photos) {
        if (!await pace()) { drop(); releasePieces(); return; }
        if(modelBlocksRoad(ph.geometry.getAttribute('position').array,ph.geometry.index?.array??null,dx,dy,surveyRoads,surveyBuildings)){
          ph.geometry.dispose();roadRejected++;continue;
        }
        ph.geometry.computeBoundingBox();
        const height = ph.geometry.boundingBox!.max.z;
        const hull = ph.hull.map(([x, y]) => [x + dx, y + dy] as [number, number]);
        const cx = ph.cx + dx, cy = ph.cy + dy;
        const hits = feet.filter(f => inRing([f.c[0], f.c[1]], hull) || Math.hypot(f.c[0] - cx, f.c[1] - cy) < 6);
        // (a landmark's area: the survey trusted over the register's height — the tower's 358 m)
        const fits = inArea(ph) ? hits : hits.filter(f => f.estimated || f.height <= 0 || Math.abs(height - f.height) / f.height < 0.35);
        if (!fits.length && extra.has(ph)) {
          // (past this view's own data: the surveyed shape alone, the ring told to leave it out)
          const home = residential(ph, []);
          const shape = surveyedShape(ph, terrain.base(hull) - 0.25, home ? undefined : ALL_FACES, 1.0, undefined, home);
          for (const g of [shape.walls, shape.roofs, shape.cores, shape.ends, shape.bands, shape.painted]) g?.translate(dx, dy, 0);
          ph.geometry.dispose();
          const style = contextStyle(null, height, rnd());
          const c = new THREE.Color(tints[Math.floor(rnd() * tints.length)]);
          if (style === "office") c.lerp(new THREE.Color("#ffffff"), 0.4);
          if (style === "apt") c.lerp(new THREE.Color("#ffffff"), 0.65);
          const m = sharedContextMaterial(style);
          put(m, paint(shape.walls, c)); put(m, paint(shape.roofs, c));
          put(plainMat, paint(shape.cores, c)); put(plainMat, paint(shape.bands, c)); put(plainMat, paint(shape.ends, c.clone().multiplyScalar(0.86)));
          pickSurveyed(shape, cx, cy, height, hull);
          surveyedNear.push(cx, cy);
          matched++;
          continue;
        }
        if (!fits.length) { ph.geometry.dispose(); continue; }
        fits.forEach(f => skip.add(f.owner));
        matched++;
        // (which faces have windows: from the photograph, before the model moves — the plane
        // keys are taken in its own frame)
        // (a landmark area's buildings: no photograph read — every face a facade, its windows or
        // curtain wall; a tower's facets are narrow and would read as blank end walls)
        const landmarkFace = inArea(ph) && !residential(ph, fits);
        const windows = landmarkFace ? ALL_FACES : (await rhythmOf.get(ph))?.planes;
        // (the complex's own end walls only, by plane key — a face split across buckets finds
        // its paint in the neighbouring ones)
        const own = fits.some(f => f.owner.startsWith("b")), paints = own ? paintsOf.get(ph) ?? [] : [];
        const byKey = new Map(paints.map(w => [w.key, w] as const));
        const paintUv = (key: string, u: number, z: number): [number, number] | null => {
          let w = byKey.get(key);
          if (!w) { const [a0, o0] = key.split(":").map(Number); for (let da = -1; da <= 1 && !w; da++) for (let d0 = -1; d0 <= 1 && !w; d0++) w = byKey.get(`${a0 + da}:${o0 + d0}`); }
          if (!w || u < w.u0 - 0.5 || u > w.u1 + 0.5) return null;
          const at = slotOf(w);
          if (!at) return null;
          const fu = THREE.MathUtils.clamp((u - w.u0) / (w.u1 - w.u0), 0, 1), fz = THREE.MathUtils.clamp((z - w.z0) / (w.z1 - w.z0), 0, 1);
          return [(at.x + fu * w.cols * CELL) / ATLAS, (at.y + (1 - fz) * w.rows * CELL) / ATLAS];
        };
        const shape = surveyedShape(ph, terrain.base(fits[0].ring) - 0.25, windows, 1.0, own ? paintUv : undefined, !landmarkFace);
        if(import.meta.env.DEV || import.meta.env.VITE_FILM === '1'){
          const names=fits.map(f=>f.owner.startsWith('b')?data.buildings[Number(f.owner.slice(1))]?.name:neighbours[Number(f.owner.slice(1))]?.title);
          const area=(g:THREE.BufferGeometry|null)=>{if(!g)return 0;const p=g.getAttribute('position');let total=0;const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();for(let i=0;i<p.count;i+=3){a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);total+=b.sub(a).cross(c.sub(a)).length()/2;}return Math.round(total);};
          const audit={key:ph.key,names,height,roof:shape.roofZ===null?null:shape.roofZ-shape.z0,walls:area(shape.walls),cores:area(shape.cores),ends:area(shape.ends),bands:area(shape.bands),source:names.some(n=>/(^|\D)(107|108|813|814)(동|$)/.test(String(n??'')))?{position:Array.from(ph.geometry.getAttribute('position').array),index:ph.geometry.index&&Array.from(ph.geometry.index.array)}:undefined};
          const debug=window as unknown as {__holoFacadeAudit?:unknown[]};(debug.__holoFacadeAudit??=[]).push(audit);
        }
        for (const g of [shape.walls, shape.roofs, shape.cores, shape.ends, shape.bands, shape.painted]) g?.translate(dx, dy, 0);
        ph.geometry.dispose();
        if (inArea(ph)) pickSurveyed(shape, cx, cy, height, hull);
        const main = fits.some(f => f.owner.startsWith("b"));
        if (main) {
          put(ownWalls[k++ % 2], shape.walls);
          put(roof, shape.roofs);
          put(coreMat, shape.cores);
          put(gableMat, shape.ends);
          put(paintMat, shape.painted);
          put(bandMat, shape.bands);
          // (no boxed relief over the surveyed faces: ledges, rails and fins laid over the
          // measured shapes read as scaffolding and formwork — an unfinished building — at
          // corners and on stepped fronts; the facade paint carries the balconies)
          // The building's number on its end walls, as painted there (43동 → 43).
          const nb = data.buildings[Number(fits.find(f => f.owner.startsWith("b"))!.owner.slice(1))];
          const label = (nb?.name ?? "").match(/\d+/)?.[0];
          if (label && shape.roofZ !== null) for (const e of shape.endPlanes) {
            const m = numberMaterial(label);
            const h = Math.min(4.2, e.width * 0.3), w = h * (m.userData.aspect as number);
            const cx = e.x + dx + e.nx * 0.08, cy = e.y + dy + e.ny * 0.08, z = shape.roofZ - 2.6 - h / 2;
            const rx = -e.ny * w / 2, ry = e.nx * w / 2;
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.Float32BufferAttribute([
              cx - rx, cy - ry, z - h / 2, cx + rx, cy + ry, z - h / 2, cx + rx, cy + ry, z + h / 2, cx - rx, cy - ry, z + h / 2], 3));
            g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
            g.setAttribute("normal", new THREE.Float32BufferAttribute([e.nx, e.ny, 0, e.nx, e.ny, 0, e.nx, e.ny, 0, e.nx, e.ny, 0], 3));
            g.setIndex([0, 1, 2, 0, 2, 3]);
            put(m, keep(g));
          }
        } else {
          const nb = neighbours[Number(fits[0].owner.slice(1))];
          const style = contextStyle(nb?.use, height, rnd());
          const c = new THREE.Color(tints[Math.floor(rnd() * tints.length)]);
          if (style === "office") c.lerp(new THREE.Color("#ffffff"), 0.4);
          if (style === "apt") c.lerp(new THREE.Color("#ffffff"), 0.65);
          const m = sharedContextMaterial(style);
          put(m, paint(shape.walls, c));
          put(m, paint(shape.roofs, c));   // (the context material paints its roofs itself)
          // (the lift and stair rooms on the roof, and the parapet band: plain paint, no
          // windows — as the complex's own, and as they are)
          put(plainMat, paint(shape.cores, c));
          put(plainMat, paint(shape.bands, c));
          put(plainMat, paint(shape.ends, c.clone().multiplyScalar(0.86)));
        }
      }
      // (the register's extrusions answered for the surveyed pieces over them — the tower's 358 m prism)
      if (surveyedHulls.length) for (let i = pickables.length - 1; i >= 0; i--) {
        const pk = pickables[i];
        if (pk.userData.surveyed) continue;
        pk.geometry.computeBoundingSphere();
        const c = pk.geometry.boundingSphere!.center;
        if (surveyedHulls.some(h => inRing([c.x, c.y], h))) pickables.splice(i, 1);
      }
      {
        const unit = keep(new THREE.BoxGeometry(1, 1, 1));
        const wallC = (gableMat as THREE.MeshStandardMaterial).color ?? new THREE.Color("#dcd8cc");
        const slabMat = keep(new THREE.MeshStandardMaterial({ color: wallC.clone().multiplyScalar(0.95), roughness: 0.75 }));
        slabMat.userData.detail = "paint";
        const railMat = keep(new THREE.MeshStandardMaterial({ color: "#e8eaea", roughness: 0.35, metalness: 0.6 }));
        for (const [list, mat] of [[ledges, slabMat], [rails, railMat], [fins, slabMat]] as const) {
          if (!list.length) continue;
          const im = new THREE.InstancedMesh(unit, mat, list.length);
          list.forEach((mm, j) => im.setMatrixAt(j, mm));
          im.castShadow = im.receiveShadow = true;
          im.computeBoundingSphere();
          used.push(im as unknown as THREE.Mesh);
          disposables.push(im);
        }
        if (hostRef.current) hostRef.current.dataset.relief = `${ledges.length}/${rails.length}/${fins.length}`;
      }
      // The measured end-wall paint into the atlas: each cell its paint, a little brighter
      // than the shaded photograph shows it (as the walls' own colour).
      if (slots.size) {
        const g2 = atlasCv.getContext("2d")!;
        for (const [w, at] of slots) {
          let top = 0;
          for (let i = 0; i < w.rgb.length; i += 3) top = Math.max(top, (w.rgb[i] + w.rgb[i + 1] + w.rgb[i + 2]) / 3);
          const lift = Math.min(1.3, 0.85 / Math.max(top, 0.05));
          for (let r = 0; r < w.rows; r++) for (let c = 0; c < w.cols; c++) {
            const o = (r * w.cols + c) * 3, v = (x: number) => Math.round(Math.min(1, x * lift) * 255);
            g2.fillStyle = `rgb(${v(w.rgb[o])},${v(w.rgb[o + 1])},${v(w.rgb[o + 2])})`;
            // (row 0 is the bottom of the wall; each cell spills a pixel so no seams show)
            g2.fillRect(at.x + c * CELL - 1, at.y + (w.rows - 1 - r) * CELL - 1, CELL + 2, CELL + 2);
          }
        }
        atlasTex.needsUpdate = true;
        if (hostRef.current) hostRef.current.dataset.wallPaint = String(slots.size);
      }
      for (const [m, list] of byMat) {
        if (!await pace()) { drop(); releasePieces(); return; }
        const mesh = new THREE.Mesh(keep(mergeGeometries(list, false)!), m);
        list.forEach(g => g.dispose());
        mesh.castShadow = mesh.receiveShadow = true;
        used.push(mesh);
      }
      if (!used.length) {
        // No surveyed shapes here (outside VWorld's 3D coverage): the modelled buildings stay,
        // in the colours the aerial photographs show (roof, its rim, the leaning facade) —
        // or else every complex would look alike — their facade at twice the resolution, and
        // a gable of tiles where the roofs are tiled.
        releasePieces();
        const towers = data.buildings.filter(b => b.floors >= 5);
        const aerial = await aerialColours(data.vworld_key!, data.center!.lat, data.center!.lon, towers.map(b => b.rings[0])).catch(() => [] as never[]);
        if (!alive) return;
        const got = aerial.filter(Boolean) as NonNullable<(typeof aerial)[number]>[];
        const med3 = (list: number[][]) => [0, 1, 2].map(k => list.map(c => c[k]).sort((x, y) => x - y)[list.length >> 1]);
        const hex = (c: number[], lift = 1) => "#" + c.map(v => Math.round(Math.min(1, Math.max(0, v * lift)) * 255).toString(16).padStart(2, "0")).join("");
        let pal: Palette = palette;
        let roofMat: THREE.Material | null = null, rimMat: THREE.Material | null = null;
        if (got.length) {
          const roofC = med3(got.map(g2 => g2.roof));
          const rims = got.map(g2 => g2.rim).filter(Boolean) as number[][];
          const facades = got.map(g2 => g2.facade).filter(Boolean) as number[][];
          const wallC = facades.length ? med3(facades) : null;
          pal = {
            ...palette,
            ...(wallC ? { wall: hex(wallC, Math.min(1.25, 0.92 / Math.max(...wallC, 0.05))), wall2: hex(wallC.map(v => v * 0.85), Math.min(1.25, 0.92 / Math.max(...wallC, 0.05))) } : {}),
            ...(rims.length ? { accent: hex(med3(rims), 1.1) } : {}),
            roof: hex(roofC, 1.1),
          };
          roofMat = keep(new THREE.MeshStandardMaterial({ color: pal.roof, roughness: 0.9 }));
          roofMat.userData.roofDetail = true; roofMat.userData.detail = "roof";
          rimMat = keep(new THREE.MeshStandardMaterial({ color: pal.accent, roughness: 0.45, metalness: 0.2 }));
          if (hostRef.current) hostRef.current.dataset.realColours = `aerial ${pal.wall} ${pal.accent} ${pal.roof} (${got.length}/${towers.length})`;
        }
        const sharp = await Promise.all([facadeMaterial(pal, seed, BAY_M, FLOOR_M, stage.hq ? 2 : 1), facadeMaterial(pal, seed + 7919, BAY_M, FLOOR_M, stage.hq ? 2 : 1)]);
        if (!alive || !sharp[0] || !sharp[1]) return;
        // (new meshes rather than a material swapped under a drawn one: the WebGPU view keeps
        // each mesh's pipeline by its first material)
        // (the ledges and fins in the facade's second colour)
        const reliefMat = got.length ? keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(pal.wall2).lerp(new THREE.Color(pal.wall), 0.4), roughness: 0.75 })) : null;
        assembled = assembled.map(o => {
          if (o instanceof THREE.InstancedMesh) {
            if (!reliefMat || o.material !== low) return o;
            const fresh = new THREE.InstancedMesh(o.geometry, reliefMat, o.count);
            fresh.instanceMatrix.copy(o.instanceMatrix);
            fresh.castShadow = o.castShadow; fresh.receiveShadow = o.receiveShadow;
            fresh.computeBoundingSphere();
            group.remove(o); group.add(fresh); disposables.push(fresh);
            return fresh;
          }
          if (!(o instanceof THREE.Mesh)) return o;
          const j = walls.indexOf(o.material as THREE.MeshPhysicalMaterial);
          if (o.material === trim && got.length) {
            // the end walls, their stripe and the roof cores repainted in the aerial colours
            const g2 = keep(o.geometry.clone()), col = g2.getAttribute("color");
            const nGable = new THREE.Color(pal.wall2).lerp(new THREE.Color(pal.wall), 0.25), nStripe = new THREE.Color(pal.accent);
            const nPlant = new THREE.Color(pal.wall2).lerp(new THREE.Color("#9a9a96"), 0.5);
            const c = new THREE.Color();
            for (let v = 0; v < col.count; v++) {
              c.fromBufferAttribute(col as THREE.BufferAttribute, v);
              const d = (x: THREE.Color) => Math.abs(x.r - c.r) + Math.abs(x.g - c.g) + Math.abs(x.b - c.b);
              const pick = [[gableC, nGable], [stripeC, nStripe], [plantC, nPlant]].sort((p1, p2) => d(p1[0]) - d(p2[0]))[0];
              if (d(pick[0]) < 0.05) col.setXYZ(v, pick[1].r, pick[1].g, pick[1].b);
            }
            const fresh = new THREE.Mesh(g2, trim);
            fresh.castShadow = o.castShadow; fresh.receiveShadow = o.receiveShadow;
            group.remove(o); group.add(fresh);
            return fresh;
          }
          const next = j >= 0 ? sharp[j] : roofMat && o.material === roof ? roofMat : rimMat && o.material === crown ? rimMat : null;
          if (!next) return o;
          const fresh = new THREE.Mesh(o.geometry, next);
          fresh.castShadow = o.castShadow; fresh.receiveShadow = o.receiveShadow;
          group.remove(o); group.add(fresh);
          return fresh;
        });
        // The building numbers on the modelled towers' end walls (their short faces).
        const numbers = new Map<THREE.Material, THREE.BufferGeometry[]>();
        for (const b of towers) {
          const label = (b.name ?? "").match(/\d+/)?.[0];
          if (!label) continue;
          const r0 = b.rings[0], H = b.height + terrain.base(r0);
          const signed = r0.reduce((a2, [x, y], j) => { const q = r0[(j + 1) % r0.length]; return a2 + x * q[1] - q[0] * y; }, 0);
          let longest = 0;
          r0.forEach((p, j) => { const q = r0[(j + 1) % r0.length]; longest = Math.max(longest, Math.hypot(q[0] - p[0], q[1] - p[1])); });
          // (the two ends only: on each side along the long axis, the widest short face)
          let lx = 1, ly = 0;
          r0.forEach((p, j) => { const q = r0[(j + 1) % r0.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]); if (len === longest) { lx = (q[0] - p[0]) / len; ly = (q[1] - p[1]) / len; } });
          const ends = new Map<number, number>();
          r0.forEach((p, j) => {
            const q = r0[(j + 1) % r0.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
            if (len < 8 || len > 24 || len > longest * 0.6) return;
            const ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len;
            const [nx, ny] = signed > 0 ? [uy, -ux] : [-uy, ux];
            const along = nx * lx + ny * ly;
            if (Math.abs(along) < 0.9) return;
            const side = along > 0 ? 1 : -1, cur = ends.get(side);
            if (cur === undefined || len > Math.hypot(r0[(cur + 1) % r0.length][0] - r0[cur][0], r0[(cur + 1) % r0.length][1] - r0[cur][1])) ends.set(side, j);
          });
          r0.forEach((p, j) => {
            if (![...ends.values()].includes(j)) return;
            const q = r0[(j + 1) % r0.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
            const ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len;
            const [nx, ny] = signed > 0 ? [uy, -ux] : [-uy, ux];
            const m = numberMaterial(label);
            const h = Math.min(4.2, len * 0.3), w = h * (m.userData.aspect as number);
            // (on the end-wall panel, 0.12 m proud of the wall, plus a hair)
            const cx = (p[0] + q[0]) / 2 + nx * 0.26, cy = (p[1] + q[1]) / 2 + ny * 0.26, z = H - 2.6 - h / 2;
            const rx = -ny * w / 2, ry = nx * w / 2;
            const g2 = new THREE.BufferGeometry();
            g2.setAttribute("position", new THREE.Float32BufferAttribute([cx - rx, cy - ry, z - h / 2, cx + rx, cy + ry, z - h / 2, cx + rx, cy + ry, z + h / 2, cx - rx, cy - ry, z + h / 2], 3));
            g2.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
            g2.setAttribute("normal", new THREE.Float32BufferAttribute([nx, ny, 0, nx, ny, 0, nx, ny, 0, nx, ny, 0], 3));
            g2.setIndex([0, 1, 2, 0, 2, 3]);
            numbers.set(m, [...(numbers.get(m) ?? []), g2]);
          });
        }
        for (const [m, list] of numbers) {
          const mesh = new THREE.Mesh(keep(mergeGeometries(list, false)!), m);
          list.forEach(g2 => g2.dispose());
          group.add(mesh);
        }
        // Gables of tiles over the towers whose roofs show them.
        const gables: THREE.BufferGeometry[] = [];
        towers.forEach((b, i) => {
          if (!aerial[i]?.pitched) return;
          const r0 = b.rings[0];
          let best = 0, ux = 1, uy = 0;
          r0.forEach((p, j) => { const q = r0[(j + 1) % r0.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]); if (len > best) { best = len; ux = (q[0] - p[0]) / len; uy = (q[1] - p[1]) / len; } });
          // the oriented box: along the longest edge, across it
          let a0 = Infinity, a1 = -Infinity, c0 = Infinity, c1 = -Infinity;
          for (const [x, y] of r0) { const a2 = x * ux + y * uy, c2 = -x * uy + y * ux; a0 = Math.min(a0, a2); a1 = Math.max(a1, a2); c0 = Math.min(c0, c2); c1 = Math.max(c1, c2); }
          const w = c1 - c0, rise = Math.min(4, w * 0.3), z = b.height + terrain.base(r0) + 1.6, cm = (c0 + c1) / 2, eave = 0.4;
          const P = (a2: number, c2: number, zz: number) => [a2 * ux - c2 * uy, a2 * uy + c2 * ux, zz];
          const A = P(a0 - eave, c0 - eave, z), B2 = P(a1 + eave, c0 - eave, z), C = P(a1 + eave, c1 + eave, z), D = P(a0 - eave, c1 + eave, z);
          const R0 = P(a0 - eave, cm, z + rise), R1 = P(a1 + eave, cm, z + rise);
          const tri = (...v: number[][]) => v.flat();
          const pos = [
            ...tri(A, B2, R1), ...tri(A, R1, R0),     // slope on the c0 side
            ...tri(C, D, R0), ...tri(C, R0, R1),      // slope on the c1 side
            ...tri(D, A, R0), ...tri(B2, C, R1),      // gable ends
          ];
          const g2 = new THREE.BufferGeometry();
          g2.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
          g2.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2));
          g2.computeVertexNormals();
          gables.push(g2);
        });
        if (gables.length && roofMat) {
          const tile = keep(new THREE.MeshStandardMaterial({ color: pal.roof, roughness: 0.75, side: THREE.DoubleSide }));
          tile.userData.roofDetail = true;
          const mesh = new THREE.Mesh(keep(mergeGeometries(gables, false)!), tile);
          gables.forEach(g2 => g2.dispose());
          mesh.castShadow = mesh.receiveShadow = true;
          group.add(mesh);
        }
        if (hostRef.current) hostRef.current.dataset.photoBuildings = `0/${photos.length} (aerial${gables.length ? `, ${gables.length} gables` : ""})`;
        stage.resume();
        return;
      }
      const out = await assemble(skip, false);
      if (!out || !alive) { releasePieces(); return; }
      group.remove(...assembled);
      group.add(...out, ...used);
      assembled = out;
      releasePieces();
      if (hostRef.current) {
        hostRef.current.dataset.photoBuildings = `${matched}/${photos.length}`;
        hostRef.current.dataset.photoOffset = `${dx.toFixed(1)},${dy.toFixed(1)}`;
        hostRef.current.dataset.photoRoadRejected=String(roadRejected);
      }
      stage.resume();
    })().finally(() => { stage.busy--; }); });


    // The ground: the surveyed parcel landscaped (flat paint only), laid over the real
    // relief; damp paving reflects the towers where the ground is level.
    if (import.meta.env.DEV || import.meta.env.VITE_FILM === "1") Object.assign(window, { __holoData: data });
    step("ctxMaterials");
    if (!await pace(true)) return;
    const plan = await groundJob;
    if (!plan) return;
    step("groundPaint");
    if (!await pace(true)) return;
    [plan.color, plan.rough].forEach(keep);
    const G = dist * 12;
    // No elevation data (level ground): no relief for a fine grid to follow.
    const groundGrid = await groundGeometry(T, G, terrain, terrain.source === null ? 64 : stage.hq ? 320 : 200, pace, groundGridJob ?? null);
    if (!groundGrid) return;
    const groundGeo = keep(groundGrid);
    if (!await pace(true)) return;
    [plan.glow].forEach(keep);
    const groundMat = keep(new THREE.MeshStandardMaterial({
      map: plan.color, roughnessMap: plan.rough, roughness: 1, metalness: 0,
      emissiveMap: plan.glow, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0,
    }));
    lit.ground.push(groundMat);
    // Beyond the surveyed area the ground is featureless: it fades into the horizon haze — until
    // the land use round it is in (farGround.ts), then past that.
    groundMat.userData.edgeFade = true;
    groundMat.userData.farGround = { map: blankFar(), half: FAR_HALF, on: false };
    // (WebGPU: grass, asphalt and paving detail in world space)
    groundMat.userData.groundDetail = true;
    if(textureBudgetEnabled())groundMat.userData.naturalGround=T;
    const level = terrain.relief < 1.2;
    patchMaterial(groundMat, {
      detail: true,
      naturalGround:textureBudgetEnabled()?T:undefined,
      reflect: stage.reflector && level ? {
        tex: { value: stage.reflector.getRenderTarget().texture },
        matrix: (stage.reflector.material as THREE.ShaderMaterial).uniforms.textureMatrix,
        strength: stage.reflStrength,
        far: { value: dist * 2.2 },
      } : undefined,
    });
    step("groundGeo");
    ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    // The model and its ground reach the scene together, in one frame. The complex left behind
    // stays until this one is fully drawn (its pipelines and ground ready: before that it would
    // stand on bare sky), a little lower meanwhile so this one's roofs and ground win where the
    // two coincide; then it is freed.
    stage.scene.add(group, ground);
    if (behind) {
      for (const o of behind.parts()) o.position.y -= 0.25;
      // (driving on: released once the new traffic has taken the vehicle over — carryDrive)
      if (came?.drive && stage.carry) stage.carry.letGo = letGo; else stage.onShown.push(letGo);
    }
    stage.unshown = true;

    // Street furniture on the surveyed roads: raised sidewalks with kerbs, street trees
    // in pits, lamps, traffic and people walking. All of it after the first frame.
    stage.scene.add(decor);
    const roads = stitchedRoads(data.roads ?? []);
    // Bridges where a road crosses open water (sceneBridges.ts), once the water parcels are known:
    // the traffic, kerbs, people and lamps there stand on the deck (roadTerrain), not on the
    // river's surface.
    let deckAt: ((x: number, y: number) => number | null) | null = null;
    let asphaltAt:ReturnType<typeof roadSurfaceHeight>|null=null;
    const roadTerrain: Terrain = { ...terrain, at: (x, y) => deckAt?.(x, y) ?? terrain.at(x, y) };
    const trafficTerrain:Terrain={...roadTerrain,at:(x,y)=>asphaltAt?.(x,y)??roadTerrain.at(x,y)};
    const physicalFootprints=[...data.road_building_footprints??[],...[...data.buildings,...data.context].map(b=>b.rings[0])];
    const pavementExclusions=[...roadFootprints(splitRoadJunctions(roads,true)),...physicalFootprints];
    const cutPavements=async(g:THREE.Group)=>{await Promise.all((g.children as THREE.Mesh[]).map(m=>cutSceneSurface(m.geometry,pavementExclusions,later)));};
    // Open water the parcels don't register as such (석촌호수 is a 공원) or don't reach (a river
    // past them): OpenStreetMap's lakes and river areas, asked once the view is up (kept a day).
    let lakes: RealEstateParcel[] = [];
    // Keep the actual answer: timing out this promise used to discard lakes that
    // arrived late. Registered planting is shown independently below.
    const beginGeography=textureBudgetEnabled()?(f:()=>void)=>f():afterShown;
    const lakesFetched: Promise<void> = new Promise<void>(resolve => beginGeography(() => {
      if (!data.center) { resolve(); return; }
      const { lat, lon } = data.center, la = +lat.toFixed(4), lo = +lon.toFixed(4);
      // (asked about the rounded point, for the server's cache: moved back onto the centre)
      const ox = (lo - lon) * 111320 * Math.cos((lat * Math.PI) / 180), oy = (la - lat) * 110540;
      void nearbyWater(la, lo).then(r => {
          if (!alive) return;
          lakes = r.rings.map(w => ({ kind: "유", ring: w.ring.map(([x, y]) => [x + ox, y + oy] as [number, number]) }));
          if (hostRef.current) hostRef.current.dataset.lakes = r.rings.map(w => w.name ?? w.kind).join(",");
        }).catch(() => {}).then(() => resolve());
    }));
    const lakesReady = Promise.race([lakesFetched, new Promise<void>(r => window.setTimeout(r, 2500))]);
    // The mapped crosswalks (OpenStreetMap): the junctions' crossings and stop lines stand on them.
    // (the traffic waits for them a few seconds at most)
    let crossLines: { line: [number, number][] }[] = [];
    // (driving on into this area: nothing waits — the vehicle is coming)
    const driveIn = !!came?.drive;
    const crossingsReady: Promise<void> = driveIn ? Promise.resolve() : new Promise<void>(resolve => beginGeography(() => {
      if (!data.center) { resolve(); return; }
      const { lat, lon } = data.center, la = +lat.toFixed(4), lo = +lon.toFixed(4);
      const ox = (lo - lon) * 111320 * Math.cos((lat * Math.PI) / 180), oy = (la - lat) * 110540;
      void Promise.race([
        nearbyCrossings(la, lo).then(r => {
          if (!alive) return;
          crossLines = r.crossings.map(c => ({ line: c.line.map(([x, y]) => [x + ox, y + oy] as [number, number]) }));
          if (hostRef.current) hostRef.current.dataset.crossings = `${r.crossings.length} mapped, ${r.signals.length} signals`;
        }).catch(() => {}),
        new Promise(r => window.setTimeout(r, 3500)),
      ]).then(() => resolve());
    }));
    /** The water parcels and OpenStreetMap's water together, each with its covered-stream flag. */
    const waterParcels = () => ({ parcels: [...(data.parcels ?? []), ...lakes], covered: [...waterCovered(data), ...lakes.map(() => false)] });
    let bridgesTried = false;
    const placeBridges = async () => {
      if (bridgesTried || !data.parcels?.length) return false;
      bridgesTried = true;
      const w = waterParcels();
      const found = await sceneWork("bridges", {roads, parcels:w.parcels, covered:w.covered, grid:terrain.grid ?? null})?.catch(() => null)
        ?? (alive ? timed("bridges", () => findBridges(roads, w.parcels, w.covered, terrain)) : []);
      if (!alive) return false;
      if (hostRef.current) hostRef.current.dataset.bridges = String(found.length);
      if (!found.length) return false;
      deckAt = bridgeHeight(found);
      const made = buildBridges(found);
      stage.addWarm(decor, made.group);
      disposables.push(made);
      return true;
    };
    // (the plant kit — meshes, twig and bark textures, ~3 MB — after the first frame: fetched and
    // decoded alongside it, it held the first frame back by a few hundred ms)
    afterShown(() => { preloadPlants(); void vehicleShapes().catch(() => {}); });
    const landUse = async (): Promise<Planting> => {
      if (data.parcels || !data.vworld_key) return plan.planting;
      const got = await Promise.race([
        vworldParcels(data, data.vworld_key, data.vworld_domain).catch(() => null),
        new Promise<null>(r => window.setTimeout(() => r(null), 12000)),
      ]);
      const parcels = got?.parcels;
      if (!parcels?.length || !alive) return plan.planting;
      await nextSlice(pausedRef.current);
      if (!alive) return plan.planting;
      data.parcels = parcels;
      data.streets = got!.streets;
      void saveBuildings(data.id, data);
      let sliceAt = performance.now();
      const next = await groundPlan(data, T, stage.hq ? 2048 : 1024, seed, async () => {
        if (performance.now() - sliceAt > 6) { await nextFrame(pausedRef.current); sliceAt = performance.now(); }
        return alive;
      }, terrain.grid);
      if (!next) return plan.planting;
      for (const k of ["color", "rough", "glow"] as const) {
        // The new paint swapped in (the texture takes the new canvas and uploads it again):
        // drawn over the old one, three 2048 px copies by the CPU held a frame ~90 ms.
        plan[k].image = next[k].image;
        plan[k].flipY = next[k].flipY;   // (a canvas, or a bitmap from the worker already upright)
        plan[k].userData.released = false;   // (the new canvas emptied in its turn once uploaded)
        plan[k].needsUpdate = true;
        next[k].dispose();
      }
      if (hostRef.current) hostRef.current.dataset.parcels = String(parcels.length);
      return next.planting;
    };
    const tick: Stage["tick"] = [];
    // Sidewalks, street trees, planting and people: laid out once the buildings are on
    // screen (none of it may hold back the first frame).
    // (each stage is its own task, and the long ones slice themselves: what runs after the
    // first frame must never hold the pointer; dataset.longChunks names any piece over 12 ms)
    const chunks: string[] = [];
    const timed = <R,>(name: string, fn: () => R): R => {
      const t = performance.now();
      try { return fn(); } finally {
        const d = performance.now() - t;
        if (d > 12 && hostRef.current) { chunks.push(`${name}=${d.toFixed(0)}`); hostRef.current.dataset.longChunks = chunks.join(" "); }
      }
    };
    const later = async () => { await nextSlice(pausedRef.current); return alive; };
    // Parcel trees already known to the ground plan belong immediately after the
    // buildings, independently of water, walkers and boats. The complete surveyed
    // planting replaces them later, using the same seed, meshes and detail levels.
    let plantsRevision = 0;
    let visiblePlanting:Planting|null=null;
    const plantTimings:{phase:string;start:number;ready?:number;reused?:boolean}[]=[];
    let visiblePlants: { plants: NonNullable<Awaited<ReturnType<typeof buildPlants>>>; root: THREE.Group } | null = null;
    const showPlants = async (planting: Planting, phase: "initial" | "surveyed" | "complete") => {
      const revision = ++plantsRevision;
      const timing={phase,start:Math.round(performance.now()),ready:undefined as number|undefined,reused:false};plantTimings.push(timing);
      if(visiblePlants&&visiblePlanting&&samePlanting(visiblePlanting,planting)){
        timing.ready=Math.round(performance.now());timing.reused=true;
        if(hostRef.current){hostRef.current.dataset.plantsPhase=phase;hostRef.current.dataset.plantsReadyAt=String(timing.ready);hostRef.current.dataset.plantsTiming=JSON.stringify(plantTimings);}return;
      }
      const snapshot=plantingSnapshot(planting);
      const plants = await timed("buildPlants", () => buildPlants(planting, seed, terrain, stage.hq));
      if (!plants) return;
      if (!alive || revision !== plantsRevision) { plants.dispose(); return; }
      plants.update?.();
      // A detached wrapper also prevents a late WebGL compile from reattaching
      // an obsolete forest after replacement or model disposal.
      const root = new THREE.Group();
      decor.add(root); stage.addWarm(root, plants.mesh);
      const previous = visiblePlants;
      visiblePlants = { plants, root };
      visiblePlanting=snapshot;timing.ready=Math.round(performance.now());
      previous?.root.removeFromParent(); previous?.plants.dispose();
      stage.plantsFocus = plants.focus as Stage["plantsFocus"];
      if (hostRef.current) {
        hostRef.current.dataset.plantsPhase = phase;
        hostRef.current.dataset.plantsReadyAt = String(Math.round(performance.now()));
        hostRef.current.dataset.plantsTiming=JSON.stringify(plantTimings);
      }
    };
    disposables.push({ dispose: () => {
      ++plantsRevision;
      if (visiblePlants) {
        if (stage.plantsFocus === visiblePlants.plants.focus) stage.plantsFocus = undefined;
        visiblePlants.root.removeFromParent(); visiblePlants.plants.dispose(); visiblePlants = null;
      }
    } });
    (textureBudgetEnabled()?(f:()=>void)=>f():afterShown)(() => {
      // Copy the lists: the detailed pass later adds street trees and filters water.
      const initial = { ...plan.planting, trees: [...plan.planting.trees], shrubs: [...plan.planting.shrubs],
        flowers: [...plan.planting.flowers], grass: plan.planting.grass && [...plan.planting.grass], street: [...plan.planting.street], border: plan.planting.border && [...plan.planting.border] };
      if (hostRef.current) hostRef.current.dataset.plantsStartedAt = String(Math.round(performance.now()));
      void showPlants(initial, "initial").catch(err => console.info("[3D] Initial plants unavailable:", err));
    });
    (textureBudgetEnabled()?(f:()=>void)=>f():afterShown)(() => void (async () => {
      if (!await later()) return;
      const plantingJob=landUse().catch(err=>{console.info('[3D] Land use unavailable:',err);return plan.planting;});
      if(!textureBudgetEnabled())await lakesReady;
      if (!await later()) return;
      const footprints = [...data.buildings, ...neighbours].map(b => b.rings[0]);
      const runsJob=sceneWork("sidewalks", {roads, footprints})?.catch(() => null);
      if(textureBudgetEnabled())await plantingJob;
      await placeBridges();
      if (!alive) return;
      const runs = await runsJob
        ?? (alive ? timed("sidewalkRuns", () => sidewalkRuns(roads, footprints)) : []);
      if (!alive) return;
      if (import.meta.env.DEV) (stage as unknown as { runs: unknown }).runs = runs;
      if (import.meta.env.DEV) (stage as unknown as { data: unknown }).data = data;
      // (no street trees in pits on a bridge's walkway)
      const streetOf = () => streetTrees(runs, plan.lamps).filter(([x, y]) => deckAt?.(x, y) == null);
      let street = streetOf();
      const inFootprint = ringIndex(footprints);
      const onCarriageway = carriageway(roads, 0.8);
      const blocked = (x: number, y: number) => Math.abs(x) > T || Math.abs(y) > T || inFootprint(x, y) || onCarriageway(x, y);
      // Water and final vegetation run alongside sidewalk mesh/actor creation.
      // They use the same surveyed street roots and water field as the later pass.
      const finalPlantsJob=textureBudgetEnabled()?(async()=>{
        const planting=plantingSnapshot(await plantingJob);planting.street=street.slice();
        planting.border=[...(planting.border??[]),...schoolBorders(data.parcels??[],blocked,T)];
        await lakesFetched;if(!alive)return null;
        const wp=waterParcels(),water=await buildWater(wp.parcels,wp.covered,terrain,pace);
        if(!alive){water?.dispose();return null;}
        if(water)disposables.push(water);
        if(water){const dry=(p:readonly number[])=>!water.field.wet(p[0],p[1]);
          planting.trees=planting.trees.filter(dry);planting.shrubs=planting.shrubs.filter(dry);planting.flowers=planting.flowers.filter(dry);planting.street=planting.street.filter(dry);
          if(planting.grass)planting.grass=planting.grass.filter(dry);if(planting.border)planting.border=planting.border.filter(dry);
          if(planting.groves)planting.groves=planting.groves.map(g=>({...g,points:g.points.filter(dry)}));
          if(planting.woodlandFlowers)planting.woodlandFlowers=planting.woodlandFlowers.map(b=>({...b,points:b.points.filter(dry)}));
        }
        await showPlants(planting,"complete");return water;
      })():null;
      void finalPlantsJob?.catch(err=>console.info('[3D] Final plants unavailable:',err));
      const setPoles = () => { poleHolder.grid = new PoleGrid([...plan.lamps.map(l => ({ x: l.x, y: l.y, r: 0.2 })), ...street.map(([x, y]) => ({ x, y, r: 0.32 }))]); };
      setPoles();
      if (!await later()) return;
      let walks = await buildSidewalks(runs, roadTerrain, street.map(([x, y]) => [x, y] as [number, number]));
      await cutPavements(walks.group);
      if (!alive) { walks.dispose(); return; }
      stage.addWarm(decor, walks.group);
      disposables.push(walks);
      if (!await later()) return;

      // Land use (연속지적도 지목) arrives after the first frame: the ground is repainted in
      // place, parks and forest get their trees, and the parcels are kept with the complex.
      // People: on the sidewalks, the complex's perimeter walk and round its towers
      // now; on the alleys (도로 parcels) and park edges once the parcels are in.
      // Nobody walks on a carriageway: paths (parcel edges cross roads where a road's
      // parcels meet) are cut wherever they enter the surveyed road width.
      const crowd = async (paths: WalkPath[], salt: number, spacing: number, cap: number, cut = true) => {
        // Keep every original path sample; clipping is pure geometry work.
        let open = paths;
        if (cut) {
          const prepared = await sceneWork('walkPaths',{paths,roads,footprints,T})?.catch(() => null);
          if (!alive) return;
          if (prepared) open = prepared;
          else {
            open = [];
            for (let i = 0; i < paths.length; i += 4) {
              if (i && !await later()) return;
              open.push(...timed("cutPaths", () => cutPaths(paths.slice(i, i + 4), blocked)));
            }
          }
        }
        const walkers = await buildWalkers(open, roadTerrain, seed + salt, spacing, cap);
        if (!walkers) return;
        if (!alive) { walkers.dispose(); return; }
        stage.addWarm(decor, walkers.group);
        if (import.meta.env.DEV) {
          ((stage as unknown as { walkers: unknown[] }).walkers ??= []).push(...walkers.group.userData.walkers);
          (stage as unknown as { terrainAt: (x: number, y: number) => number }).terrainAt = (x, y) => terrain.at(x, y);
        }
        disposables.push(walkers);
        tick.push(dt => walkers.update(dt, stage.camera));
        stage.crowds.push(walkers);
        disposables.push({ dispose: () => { stage.crowds = stage.crowds.filter(c => c !== walkers); } });
      };
      const walkersReady = crowd([...sidewalkPaths(runs), ...ringPaths(data.site, 2.4, blocked, 0.5), ...ringPaths(data.buildings.filter(b => b.floors >= 5).map(b => b.rings[0]), -3.2, blocked, 0.45)],
        0, 6, stage.hq ? 650 : 200);
      void walkersReady.catch(err=>console.info('[3D] Walkers unavailable:',err));
      void walkersReady.then(()=>{if(alive&&hostRef.current)hostRef.current.dataset.walkersReadyAt=String(Math.round(performance.now()));},()=>{});
      // Land use (연속지적도 지목) arrives after the first frame: the ground is repainted in
      // place, parks and forest get their trees, water its surface, alleys their people;
      // the parcels are kept with the complex.
      try {
        const planting = await plantingJob;
        // The ground's last paint is done (land use in, or none to come): its canvases
        // may go once uploaded again.
        for (const t of [plan.color, plan.rough, plan.glow]) { t.userData.releaseAfterUpload = true; t.needsUpdate = true; }
        if (!await later()) return;
        // The water parcels came with the land use: bridges now, and the kerbs, street trees and
        // lamps made before them laid again on the decks (the traffic and people follow by themselves).
        if (await placeBridges()) {
          street = streetOf(); setPoles();
          const fresh = await buildSidewalks(runs, roadTerrain, street.map(([x, y]) => [x, y] as [number, number]));
          await cutPavements(fresh.group);
          if (!alive) { fresh.dispose(); return; }
          decor.remove(walks.group); walks.dispose();
          walks = fresh; stage.addWarm(decor, walks.group); disposables.push(walks);
          void layMarks();
          relayLamps();
          if (!await later()) return;
        }
        planting.street = street;
        const parcels = data.parcels ?? [];
        planting.border = [...(planting.border ?? []), ...schoolBorders(parcels, blocked, T)];
        // Registered landscaping does not depend on the external lake query or
        // on boats/people finishing. Water masking is applied when that data arrives.
        if(!textureBudgetEnabled())await showPlants(planting, "surveyed");
        if(!alive)return;
        // Children at play on the school grounds, by day in dry weather.
        const kids = timed("buildKids", () => buildKids(parcels, terrain, blocked, T, seed));
        if (kids) {
          stage.addWarm(decor, kids.group);
          disposables.push(kids);
          tick.push(dt => kids.update(dt));
          onLook.push(l => kids.setLook(l));
          kids.setLook(stage.look);
          if (hostRef.current) hostRef.current.dataset.kids = String(kids.group.children[0] ? (kids.group.children[0] as THREE.InstancedMesh).count : 0);
          if (import.meta.env.DEV) Object.assign(window, { __holoKids: kids, __holoStage: stage });
          if (!await later()) return;
        }
        // Thousands of parcel edges, each tested every 2 m against buildings and
        // carriageways: laid out 20 parcels per slice (60 were ~30 ms), in idle time.
        void (async () => {
          const edges: [Ring, number, number, number][] = [
            ...parcels.filter(p => p.kind === "도").map(p => [p.ring, 1.1, 0.4, 12] as [Ring, number, number, number]),
            ...parcels.filter(p => p.kind === "공" || p.kind === "원" || p.kind === "체").map(p => [p.ring, 2.2, 0.5, 20] as [Ring, number, number, number]),
          ].filter(([ring]) => ring.some(([x, y]) => Math.abs(x) < T && Math.abs(y) < T));
          const paths: WalkPath[] = [];
          for (let i = 0; i < edges.length; i += 20) {
            await nextSlice(pausedRef.current);
            if (!alive) return;
            timed("parcelEdges", () => { for (const [ring, off, lateral, minLen] of edges.slice(i, i + 20)) paths.push(...cutPaths(ringPaths([ring], off, blocked, lateral, minLen), blocked)); });
          }
          await nextSlice(pausedRef.current);
          if (alive) await crowd(paths, 1, 9, stage.hq ? 700 : 220, false);
          if(alive&&hostRef.current)hostRef.current.dataset.parcelActorsReadyAt=String(Math.round(performance.now()));
        })();
        await lakesFetched;
        if(hostRef.current)hostRef.current.dataset.waterDataReadyAt=String(Math.round(performance.now()));
        if (!await later()) return;
        const wp = waterParcels();
        const water = finalPlantsJob?await finalPlantsJob:await buildWater(wp.parcels, wp.covered, terrain, pace);
        if (!alive) { if(!finalPlantsJob)water?.dispose(); return; }
        const finishPlanting=async()=>{
          if(water){
            const dry=(p:[number,number]|[number,number,number])=>!water.field.wet(p[0],p[1]);
            planting.trees=planting.trees.filter(dry);planting.shrubs=planting.shrubs.filter(dry);planting.flowers=planting.flowers.filter(dry);
            if(planting.grass)planting.grass=planting.grass.filter(dry);
            if(planting.groves)planting.groves=planting.groves.map(g=>({...g,points:g.points.filter(dry)}));
            if(planting.woodlandFlowers)planting.woodlandFlowers=planting.woodlandFlowers.map(b=>({...b,points:b.points.filter(dry)}));
            planting.street=planting.street.filter(dry);if(planting.border)planting.border=planting.border.filter(dry);
          }
          await showPlants(planting,"complete");
        };
        // Final planting needs the water mask, not boats, walkers or a second
        // complete copy of the same forest while those optional actors load.
        if(textureBudgetEnabled())await finishPlanting();
        if(!alive){water?.dispose();return;}
        if (water) {
          stage.addWarm(decor, water.mesh); if(!finalPlantsJob)disposables.push(water);
          stage.wetAt = (x, y) => water.field.wet(x, y) && deckAt?.(x, y) == null;
          disposables.push({ dispose: () => { stage.wetAt = null; } });
          await water.sink(groundGeo);
          if(hostRef.current)hostRef.current.dataset.waterReadyAt=String(Math.round(performance.now()));
          if (!await later()) return;
          // A big river: boats in clear weather by day (none on streams and ponds).
          const boats = await buildBoats(water.field, cx, cy, seed);
          if (!alive) { boats?.dispose(); return; }
          if (!boats && hostRef.current) hostRef.current.dataset.boats = `none: ${noBoatsReason}`;
          if (boats) {
            stage.addWarm(decor, boats.group);
            disposables.push(boats);
            tick.push(dt => boats.update(dt, stage.camera));
            onLook.push(l => boats.setLook(l));
            boats.setLook(stage.look);
            if (hostRef.current) hostRef.current.dataset.boats = String(boats.group.children.length);
            // (development: tests aim the camera at a boat)
            if (import.meta.env.DEV) {
              Object.assign(window, { __holoStage: stage, __holoBoats: boats });
              disposables.push({ dispose: () => { const w = window as unknown as Record<string, unknown>; if (w.__holoBoats === boats) { delete w.__holoBoats; delete w.__holoStage; } } });
            }
            if (!await later()) return;
          }
        }
        if(!water&&hostRef.current)hostRef.current.dataset.waterReadyAt=String(Math.round(performance.now()));
        if(hostRef.current)hostRef.current.dataset.boatsReadyAt=String(Math.round(performance.now()));
        // Nothing planted in the water: a lake the register calls a park (석촌호수) has its park's
        // trees dealt over it. (By the water itself, not the outline: an island keeps its trees.)
        if(!textureBudgetEnabled())await finishPlanting();
      } catch (err) { console.info("[3D] Plants unavailable:", err); }
    })());
    // Street lamps on the surveyed roads (lit from dusk), and traffic both ways.
    // (made in slices after the first frame; the look applied to them once they are in)
    let lamps: Awaited<ReturnType<typeof buildLamps>> | null = null;
    // The centre and lane lines, crossings and stop lines, on the road's ground (decks included):
    // from the traffic's own roads and junction arms, so a line, its signal and where the traffic
    // stops agree. (again on the bridges' decks once they are found)
    // With them the asphalt itself, as geometry at the roads' surveyed widths (the ground's paint
    // gave the road's edge against the paving in half-metre steps).
    let marks: Awaited<ReturnType<typeof buildRoadMarkings>> | null = null, marksGen = 0;
    let surface: Awaited<ReturnType<typeof buildRoadSurface>> | null = null;
    let preparedRoadArms:TrafficArms|null=null;
    const layMarks = async () => {
      const arms = stage.traffic?.arms??preparedRoadArms;
      if (!arms) return;
      const gen = ++marksGen;
      let roadSlice = performance.now();
      const roadPace = async () => {
        if (performance.now() - roadSlice > 2) {
          if (!await later()) return false;
          roadSlice = performance.now();
        }
        return alive;
      };
      const f = await buildRoadSurface(arms.roads, roadTerrain);
      await cutSceneSurface(f.group.geometry,physicalFootprints,roadPace);
      const drape = textureBudgetEnabled() ? drapeRoadOffThread : drapeRoadSurface;
      await drape(f.group.geometry, groundGeo, roadPace);
      const m = await buildRoadMarkings(arms.roads, roadTerrain, arms.at, arms.inside);
      await Promise.all((m.group.children as THREE.Mesh[]).map(async mesh=>{
        await cutSceneSurface(mesh.geometry,physicalFootprints,roadPace);
        if(textureBudgetEnabled())await drapeRoadOffThread(mesh.geometry,groundGeo,roadPace,.05,f.group.geometry);
        else{await drapeRoadSurface(mesh.geometry,groundGeo,roadPace,.05);await raiseRoadPaint(mesh.geometry,f.group.geometry,roadPace);}
      }));
      if (!alive || gen !== marksGen) { f.dispose(); m.dispose(); return; }
      if (surface) { decor.remove(surface.group); surface.dispose(); }
      if (marks) { decor.remove(marks.group); marks.dispose(); }
      surface = f; marks = m;
      asphaltAt=roadSurfaceHeight(f.group.geometry);
      if (stage.drive) void f.setDetail(true);
      stage.addWarm(decor, f.group); stage.addWarm(decor, m.group);
      if(hostRef.current)hostRef.current.dataset.roadsReadyAt=String(Math.round(performance.now()));
    };
    stage.roadDetail = on => { void surface?.setDetail(on); };
    disposables.push({ dispose: () => { marks?.dispose(); surface?.dispose(); stage.roadDetail = undefined; } });
    let lampsGen = 0;
    const placeLamps = () => { const gen = ++lampsGen; return buildLamps(plan.lamps, roadTerrain).then(l => {
      // (only the latest: one made before the bridges, finishing after them, is dropped)
      if (!alive || gen !== lampsGen) { l.dispose(); return; }
      if (lamps) { decor.remove(lamps.group); lamps.dispose(); }
      lamps = l; stage.addWarm(decor, l.group); l.setLevel(stage.look.lamps);
      if(hostRef.current)hostRef.current.dataset.lampsReadyAt=String(Math.round(performance.now()));
    }); };
    afterShown(() => void placeLamps());
    // (again on the bridges' decks, once they are found)
    function relayLamps() { void placeLamps(); }
    // A desktop's neighbourhood painted again at twice the texels, in idle time once all this is
    // in (complexScene.sharpenNeighbourhood: once a session, kept between visits).
    // The neighbourhood out to RING_M (ringBuildings.ts): every registered building past this
    // view's own data, made in a worker after the first frame (the JSONP, the footprints, the
    // extrusion on the relief all off the page) and drawn in the same shared facades — a mesh per
    // style. (OpenStreetMap results have no key: no ring.) Once the near decoration is in (4 s
    // after the first frame, then idle time): alongside it, the worker's network and the GPU's
    // uploads made that loading stutter more; a model left before then fetches nothing.
    const ringStop = new AbortController();
    disposables.push({ dispose: () => ringStop.abort() });
    stage.stopExtras = () => ringStop.abort();
    const whenIdle = (f: () => void) => { if(textureBudgetEnabled()){void later().then(ok=>{if(ok)f();});}else if (typeof requestIdleCallback === "function") requestIdleCallback(f, { timeout: 3000 }); else window.setTimeout(f, 200); };
    (textureBudgetEnabled()?(f:()=>void)=>f():afterShown)(() => { window.setTimeout(() => whenIdle(() => {
      if (!alive || ringStop.signal.aborted || !data.center || !data.vworld_key || new URLSearchParams(location.search).get("ring") === "0") return;
      // (round a landmark the surveyed pass draws more than this view's data: the ring waits for it)
      void (landmarksNear.length ? surveyPass : Promise.resolve()).then(() => {
      if (!alive || ringStop.signal.aborted) return;
      const near = new Float32Array([...data.buildings, ...data.context].flatMap(b => {
        const r = b.rings[0]; let x = 0, y = 0;
        for (const [px, py] of r) { x += px; y += py; }
        return [x / r.length, y / r.length];
      }).concat(surveyedNear));
      if (hostRef.current) hostRef.current.dataset.ringStart = performance.now().toFixed(0);
      void ringBuildings(data, near, terrain, { outer: RING_M, floorM: CONTEXT_FLOOR_M, seed, signal: ringStop.signal }).then(async ring => {
        if (!ring || !alive || ringStop.signal.aborted) return;
        if (hostRef.current) hostRef.current.dataset.ringGot = performance.now().toFixed(0);
        let aptGeo: THREE.BufferGeometry | null = null;
        for (const [style, a] of Object.entries(ring.styles) as [ContextStyle, NonNullable<typeof ring.styles.apt>][]) {
          if (!await pace(true)) return;
          const geo = keep(new THREE.BufferGeometry());
          geo.setAttribute("position", new THREE.BufferAttribute(a.position, 3));
          geo.setAttribute("normal", new THREE.BufferAttribute(a.normal, 3));
          geo.setAttribute("uv", new THREE.BufferAttribute(a.uv, 2));
          geo.setAttribute("color", new THREE.BufferAttribute(a.color, 3));
          geo.setIndex(new THREE.BufferAttribute(a.index, 1));
          geo.computeBoundingSphere();
          if (!await sharedContextTexturesSliced(style, pace)) return;
          const mesh = new THREE.Mesh(geo, sharedContextMaterial(style));
          mesh.castShadow = mesh.receiveShadow = true;
          mesh.userData.solid = true;   // (a driven vehicle runs into these)
          stage.addWarm(group, mesh);
          if (style === "apt") aptGeo = geo;
        }
        // The ground under the ring in its land use (farGround.ts): parcels by 지목, roads, channels.
        whenIdle(() => {
          if (!alive || ringStop.signal.aborted || new URLSearchParams(location.search).get("far") === "0") return;
          const { lawn, paddy } = seasonGround(undefined,textureBudgetEnabled());
          void farGround(data, terrain, { half: FAR_HALF, size: 1024, lawn, paddy, landscape:textureBudgetEnabled(),nearHalf:T,footprints:[...ring.footprints,...data.buildings.map(b=>b.rings[0]),...data.context.map(b=>b.rings[0])],signal: ringStop.signal }).then(async fg => {
            if (!fg) return;
            if (!alive || ringStop.signal.aborted) { fg.bitmap.close(); return; }
            const tex = keep(new THREE.Texture(fg.bitmap as unknown as HTMLImageElement));
            tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 8; tex.needsUpdate = true;
            tex.userData.releaseAfterUpload = true;
            // (the near land use reaches only the parcels' square: the picture past it, inside the
           // painted square too; without parcels, everywhere past the painted square)
           const pb = data.parcels?.length ? parcelBox(data) : null;
           groundMat.userData.farGround = { map: tex, half: FAR_HALF, on: true, box: pb ? [pb[0], -pb[3], pb[2], -pb[1]] : null };
            groundMat.needsUpdate = true;
            if (hostRef.current) hostRef.current.dataset.farGround = `${fg.parcels} parcels in ${Math.round(fg.ms)} ms`;
            if(textureBudgetEnabled() && (fg.planting.trees.length || fg.planting.groves?.length || fg.planting.grass?.length || fg.planting.flowers.length || fg.planting.woodlandFlowers?.length)){
              const plants=await buildPlants(fg.planting,seed+887,terrain,stage.hq);
              if(!alive||ringStop.signal.aborted){plants?.dispose();return;}
              if(plants){stage.addWarm(decor,plants.mesh);disposables.push(plants);if(hostRef.current){hostRef.current.dataset.farPlants=String(fg.planting.trees.length);hostRef.current.dataset.farGroves=String(fg.planting.groves?.length??0);hostRef.current.dataset.farPlantsReadyAt=String(Math.round(performance.now()));}}
            }
            if(textureBudgetEnabled()&&alive&&hostRef.current){hostRef.current.dataset.farPlants=String(fg.planting.trees.length);hostRef.current.dataset.farGroves=String(fg.planting.groves?.length??0);hostRef.current.dataset.farPlantsReadyAt=String(Math.round(performance.now()));}
          }).catch(err=>console.info('[3D] Far landscaping unavailable:',err));
        });
        // The ring's apartment blocks in their surveyed shapes (VWorld 3D), as the near ones: shapes
        // only — no photographs (hundreds of them) — the long fronts windowed, the end walls and short
        // returns plain, roof rooms and parapet bands as painted. Each replaces its block in the ring
        // mesh (its triangles emptied). Re-indexed after: vertices shared, as compact as the ring.
        if (aptGeo && ring.apts.length) {
          const geoA = aptGeo as THREE.BufferGeometry, A = ring.apts;
          const blocks = Array.from({ length: A.length / 6 }, (_, i) => ({ x: A[i * 6], y: A[i * 6 + 1], h: A[i * 6 + 2], g: A[i * 6 + 3], s: A[i * 6 + 4], n: A[i * 6 + 5], used: false }));
          await new Promise<void>(r => whenIdle(r));
          if (!alive || ringStop.signal.aborted) return;
          const photos = await photoBuildingsNear(data.vworld_key!, data.center!.lat, data.center!.lon, blocks, { signal: ringStop.signal }).catch(() => [] as PhotoBuilding[]);
          if (!alive) { photos.forEach(ph => ph.geometry.dispose()); return; }
          const pairs: [number, number][] = [];
          for (const ph of photos) {
            let bd = 15, best: (typeof blocks)[number] | null = null;
            for (const bl of blocks) { const d = Math.hypot(bl.x - ph.cx, bl.y - ph.cy); if (d < bd) { bd = d; best = bl; } }
            if (best) pairs.push([best.x - ph.cx, best.y - ph.cy]);
          }
          const mid = (v: number[]) => { const q = [...v].sort((a, b) => a - b); return q.length ? q[q.length >> 1] : 0; };
          const [ox, oy] = pairs.length >= 3 ? [mid(pairs.map(p => p[0])), mid(pairs.map(p => p[1]))] : [0, 0];
          const ringRoads=ringIndex(roadFootprints(splitRoadJunctions(roads,true)));
          const ringBuildingsAt=ringIndex(physicalFootprints);
          const aptMat = sharedContextMaterial("apt");
          const plain = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
          const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
          const put = (m: THREE.Material, g: THREE.BufferGeometry | null, c: THREE.Color) => {
            if (!g) return;
            const n = g.getAttribute("position").count, col = new Float32Array(n * 3);
            for (let j = 0; j < n; j++) { col[j * 3] = c.r; col[j * 3 + 1] = c.g; col[j * 3 + 2] = c.b; }
            g.setAttribute("color", new THREE.BufferAttribute(col, 3));
            // (vertices shared building by building, a few ms each between slices: the whole ring
            // at once was a 120 ms stall)
            const shared = fastMergeVertices(g);
            if (shared !== g) g.dispose();
            byMat.set(m, [...(byMat.get(m) ?? []), shared]);
          };
          const idx = geoA.index!, colA = geoA.getAttribute("color");
          let replaced = 0;
          const hide: [number, number][] = [];
          for (const ph of photos) {
            if (!await pace() || ringStop.signal.aborted) { photos.forEach(q => q.geometry.dispose()); return; }
            if(modelBlocksRoad(ph.geometry.getAttribute('position').array,ph.geometry.index?.array??null,ox,oy,ringRoads,ringBuildingsAt)){
              ph.geometry.dispose();continue;
            }
            const px = ph.cx + ox, py = ph.cy + oy;
            let bd = 12, best: (typeof blocks)[number] | null = null;
            for (const bl of blocks) { if (bl.used) continue; const d = Math.hypot(bl.x - px, bl.y - py); if (d < bd) { bd = d; best = bl; } }
            ph.geometry.computeBoundingBox();
            const top = ph.geometry.boundingBox!.max.z;
            if (!best || top < best.h * 0.65 || top > best.h * 1.35) { ph.geometry.dispose(); continue; }
            best.used = true; replaced++;
            const shape = surveyedShape(ph, best.g - 0.25, undefined, 1.0);
            for (const gg of [shape.walls, shape.roofs, shape.cores, shape.ends, shape.bands, shape.painted]) gg?.translate(ox, oy, 0);
            ph.geometry.dispose();
            const vi = idx.getX(best.s), c = new THREE.Color(colA.getX(vi), colA.getY(vi), colA.getZ(vi));
            // (a pause between the parts: one building's shape and its five merges together were
            // 20-50 ms of a frame)
            for (const [m, g, cc] of [[aptMat, shape.walls, c], [aptMat, shape.roofs, c], [plain, shape.cores, c], [plain, shape.bands, c], [plain, shape.ends, c.clone().multiplyScalar(0.86)]] as const) {
              if (!await pace() || ringStop.signal.aborted) { photos.forEach(q => q.geometry.dispose()); return; }
              put(m, g, cc);
            }
            hide.push([best.s, best.n]);
          }
          if (!replaced) return;
          for (const [m, geos] of byMat) {
            if (!await pace(true)) return;
            const compact = mergeGeometries(geos, false);
            geos.forEach(g => g.dispose());
            if (!compact) continue;
            keep(compact);
            compact.computeBoundingSphere();
            const mesh = new THREE.Mesh(compact, m);
            mesh.castShadow = mesh.receiveShadow = true;
            mesh.userData.solid = true;
            stage.addWarm(group, mesh);
          }
          // (the blocks' boxes go only once their surveyed shapes are in: a stop halfway leaves none
          // missing)
          for (const [st, n] of hide) (idx.array as Uint32Array).fill(0, st, st + n);
          idx.needsUpdate = true;
          if (hostRef.current) hostRef.current.dataset.ringSurveyed = `${replaced}/${blocks.length}`;
        }
        if (hostRef.current) { hostRef.current.dataset.ring = `${ring.buildings} in ${Math.round(ring.ms)} ms`; hostRef.current.dataset.ringAt = performance.now().toFixed(0); }
      });
      });
    }), textureBudgetEnabled()?0:4000); });
    if (stage.hq && !textureBudgetEnabled()) afterShown(() => { window.setTimeout(() => { if (!alive) return; void sharpenNeighbourhood(async () => { await nextSlice(true); return alive; }).then(() => { if (alive && hostRef.current) hostRef.current.dataset.sharp = "2x"; }); }, 4000); });
    disposables.push({ dispose: () => lamps?.dispose() });
    const onLook = [(l: Look) => lamps?.setLevel(l.lamps)];
    // Traffic (its vehicle kit decodes on first use) waits for the first frame and idle time.
    (driveIn || textureBudgetEnabled() ? (f: () => void) => f() : afterShown)(() => void nextSlice(pausedRef.current).then(() => (alive ? crossingsReady.then(() => (alive ? buildTraffic(roads, seed, stage.hq, trafficTerrain, crossLines,arms=>{preparedRoadArms=arms;void layMarks();}) : null)) : null)).then(traffic => {
      if (!traffic) return;
      if (!alive) { traffic.dispose(); return; }
      stage.addWarm(decor, traffic.group);
      disposables.push(traffic);
      let trafficArmed=false;
      tick.push(dt => {
        if(!trafficArmed){
          trafficArmed=!!surface&&!!marks&&stage.drawReady(surface.group)&&stage.drawReady(marks.group)&&stage.drawReady(traffic.group);
          if(trafficArmed&&hostRef.current)hostRef.current.dataset.trafficArmedAt=String(Math.round(performance.now()));
        }
        if(trafficArmed)traffic.update(dt,stage.camera.position);
      });
      onLook.push(l => traffic.setLamps(l.lamps));
      traffic.setLamps(stage.look.lamps);
      // (the drive taken over only once this area is on screen: the old one stays drawn till then)
      const adopt = () => {
        if (!alive) return;
        stage.traffic = traffic;
        stage.poles = poleHolder;
        if (stage.carry) carryRef.current?.(stage, traffic);
      };
      if (stage.carry && stage.unshown) stage.onShown.push(adopt); else adopt();
      setHeroesReady(true);
      if(hostRef.current)hostRef.current.dataset.trafficReadyAt=String(Math.round(performance.now()));
      if(marksGen===0)void layMarks();
      disposables.push({ dispose: () => { if (stage.traffic === traffic) {
        const dv = stage.drive;
        if (dv && import.meta.env.DEV) console.info("[drive] ended: its traffic was released", new Error().stack?.split("\n").slice(1, 6).join(" | "));
        if (dv) { stage.drive = null; if (dv.game) { dv.game.ribbon.dispose(); dv.game.beacon.dispose(); dv.game = null; } dv.sound.dispose(); if (dv.cab) { dv.cab.group.removeFromParent(); dv.cab.dispose(); } stage.camera.fov = dv.baseFov; stage.camera.updateProjectionMatrix(); setDriving(null); }
        stage.traffic = null; stage.follow = null; setFollow(null); setHeroesReady(false);
      } } });
    }).catch(err => console.info("[3D] Traffic unavailable:", err)));

    // Camera, sun and shadows framed on the complex, not the neighbourhood.
    const center = new THREE.Vector3(cx, floor + (top - floor) * 0.45, -cy);
    stage.center.copy(center);
    stage.dist = dist;
    stage.top = top;
    stage.floor = Math.min(0, floor, terrain.at(cx, cy));
    stage.frame = () => {
      stage.controls.target.copy(center);
      // Fit all eight corners to both frustum axes; tall towers used to lose their
      // crowns in the narrow map rail. Keep the sky above the roofs where the hot-air
      // balloon circles (its envelope up to ~55 m over the tallest roof).
      const viewDir = new THREE.Vector3(0.74, 0.22, 0.74).normalize();
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), viewDir).normalize();
      const up = new THREE.Vector3().crossVectors(viewDir, right);
      const tanV = Math.tan(THREE.MathUtils.degToRad(stage.camera.fov / 2));
      const tanH = tanV * stage.camera.aspect;
      let fitDistance = 60;
      for (const x of [box.min.x, box.max.x]) for (const y of [floor, top + 50]) for (const z of [-box.max.y, -box.min.y]) {
        const v = new THREE.Vector3(x, y, z).sub(center);
        fitDistance = Math.max(fitDistance, Math.max(Math.abs(v.dot(right)) / tanH, Math.abs(v.dot(up)) / tanV) + v.dot(viewDir));
      }
      fitDistance *= 1.16;
      // Close enough to see the people on the sidewalk (about 1.7 m tall).
      stage.controls.minDistance = 1.2;
      stage.controls.maxDistance = Math.max(dist, fitDistance) * 4;
      stage.camera.position.copy(center).addScaledVector(viewDir, fitDistance);
      stage.controls.update();
    };
    // (from another complex: the camera glides from where it was into this one's opening shot,
    // the look from the balloon turns to it, and the balloon flies on to its sky)
    if (shift && (stage.follow || came?.drive)) {
      // (following or driving a vehicle: the camera stays with it — no glide to the new complex)
      stage.fly = null;
    } else if (shift) {
      const cam = stage.camera.position.clone(), look = stage.controls.target.clone();
      stage.frame();
      const toPos = stage.camera.position.clone(), toTarget = stage.controls.target.clone();
      stage.camera.position.copy(cam); stage.controls.target.copy(look); stage.controls.update();
      stage.fly = stage.balloonView ? null : { fromPos: cam, toPos, fromTarget: look, toTarget, t0: stage.now, dur: 1.6 };
      if (stage.balloonView) stage.balloonView.aim = center.clone();
    } else {
      stage.frame();
      stage.fly = null;
    }
    stage.intro = null;
    stage.balloon?.setRoute(center, span, top, !!shift);
    if (stage.balloon) stage.balloon.group.visible = true;
    else stage.balloonRoute = [center.clone(), span, top];
    stage.camera.far = dist * 14 + 2000;
    stage.nearMax = Math.max(0.5, dist / 800);
    stage.camera.near = stage.nearMax;
    stage.camera.updateProjectionMatrix();
    const sc2 = stage.sun.shadow.camera;
    const half = span * 0.75 + (top - floor) * 0.9 + 40;
    sc2.left = -half; sc2.right = half; sc2.top = half; sc2.bottom = -half;
    sc2.near = 1; sc2.far = (dist * 2 + top * 2) * 2 + top * 2;
    sc2.updateProjectionMatrix();

    if (hostRef.current) {
      hostRef.current.dataset.modelBuildMs = (performance.now() - modelStarted).toFixed(0);
      step("rest");
      hostRef.current.dataset.buildSteps = steps.join(" ");
      hostRef.current.dataset.paint = `kept ${paintStats.kept} / painted ${paintStats.painted}`;
      hostRef.current.dataset.builtAt = performance.now().toFixed(0);
      hostRef.current.dataset.terrain = terrain.source ? `${terrain.relief.toFixed(1)}m` : "flat";
      hostRef.current.dataset.neighbours = String(neighbours.length);
    }
    stage.model = group;
    stage.ground = ground;
    stage.reflectOn = level;
    stage.lit = lit;
    stage.tick = tick;
    stage.onLook = onLook;
    stage.pickables = pickables;
    stage.refreshEnv();
    stage.unshown = true;
    stage.building = false;
    stage.resume();
    })().catch(err => { stage.building = false; console.warn("[3D] Model build failed:", err); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, renderMode]);

  // Which 동, how many floors, whether that height is surveyed: on hover with a
  // mouse, and on a tap (a touch that didn't turn the model) on phones.
  const pick = (e: { clientX: number; clientY: number; currentTarget: HTMLDivElement }, pinned: boolean) => {
    const stage = stageRef.current;
    if (!stage || !stage.pickables.length) { setTip(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, stage.camera);
    const hit = ray.intersectObjects(stage.pickables, false)[0];
    // (a surveyed piece names the registered building under the point: one model can hold several)
    const text = hit ? (hit.object.userData.labelAt?.(hit.point.x, -hit.point.z) ?? hit.object.userData.label) : "";
    setTip(hit ? { x: e.clientX - rect.left, y: e.clientY - rect.top, text, pinned, w: rect.width } : null);
  };
  // 열기구: the view from the balloon's basket. Drag looks around, the wheel, a pinch or
  // −/+ zoom (the field of view, like binoculars); the button, 처음 or Esc steps out.
  const [balloonOn, setBalloonOn] = useState(false);
  // 쿠팡 트럭 · 사이버트럭: brought onto the road the view is looking at, then followed.
  const [follow, setFollow] = useState<HeroName | null>(null);
  const [heroesReady, setHeroesReady] = useState(false);
  // The driving game is not public yet: its buttons only with ?devgame=1 in the address (kept in
  // this browser after that; ?devgame=0 forgets it).
  const [gameOn] = useState(gameUnlocked);
  // Driving it: the camera comes down behind the vehicle as before, the gauges come up and the
  // engine is heard; the traffic keeps driving it until a driving key (or a touch pedal) takes
  // over. V the driver's seat and back, Esc (or the button again) hands it back.
  const [driving, setDriving] = useState<{ name: HeroName; view: "chase" | "cockpit"; manual: boolean } | null>(null);
  const hudSpeed = useRef<HTMLSpanElement>(null), hudGear = useRef<HTMLSpanElement>(null), hudRevs = useRef<HTMLElement>(null), hudFuel = useRef<HTMLElement>(null);
  const hudSpeedFx = useRef<HTMLDivElement>(null), hudFuelText = useRef<HTMLElement>(null);
  // 배송 게임: a complex round the view at random (not the one just reached, 150 m or more away
  // along the way), the way there, gold on arrival.
  const [delivery, setDelivery] = useState<{ name: string; n: number } | null>(null);
  const [result, setResult] = useState<DeliveryResult | null>(null);
  const [knocks, setKnocks] = useState(0);
  const [goldSum, setGoldSum] = useState(goldTotal);
  const signsRef = useRef<{ id: string; name: string; x: number; y: number; here: boolean }[]>([]);
  const gameHud = {
    name: useRef<HTMLElement>(null), dist: useRef<HTMLElement>(null), gold: useRef<HTMLElement>(null), time: useRef<HTMLElement>(null),
    turn: useRef<HTMLElement>(null), turnDist: useRef<HTMLElement>(null), map: useRef<HTMLCanvasElement>(null),
  };
  const lastDest = useRef<string | null>(null);
  const endDelivery = (dv: DriveState) => {
    if (!dv.game) return;
    dv.game.ribbon.dispose(); dv.game.beacon.dispose();
    dv.game = null;
  };
  const startDelivery = (st: Stage, dv: DriveState) => {
    endDelivery(dv);
    setResult(null); setKnocks(0);
    const tr = st.traffic, c = tr?.hero(dv.name);
    if (!tr || !c) { setDelivery(null); return; }
    // candidates: the complexes with a way to them of 150 m or more (the nearest few too short)
    const cands = signsRef.current.filter(s => s.id !== lastDest.current && Math.hypot(s.x - c.x, s.y - c.y) > 120);
    for (let tries = 0; tries < 12 && cands.length; tries++) {
      const pick = cands.splice(Math.floor(Math.random() * cands.length), 1)[0];
      const r = tr.route(c.x, c.y, pick.x, pick.y);
      if (!r || r.line.length < 2) continue;
      const way: Pt[] = [[c.x, c.y], ...r.line], len = lengthOf(way);
      if (len < 150) continue;
      lastDest.current = pick.id;
      const ribbon = routeRibbon(terrainRef.current, (x, y) => tr.groundAt(x, y)), bc = beacon();
      st.addWarm(tr.group, ribbon.mesh); st.addWarm(tr.group, bc.group);
      ribbon.set(way);
      // pickups along the way, every ~130 m: fuel cans and repair kits by turns
      const cans = pickupPlan(len, dv.hp).map(({ at, kind }) => {
        const [x, y] = cutFrom(way, at)[0];
        return { x, y, z: terrainRef.current.at(x, y), kind };
      });
      dv.feel.cans.place(cans);
      const end = way[way.length - 1];
      bc.place(end[0], end[1], tr.groundAt(end[0], end[1]));
      // the tank for this way (단지까지의 거리), full
      dv.fuelCap = tankFor(len); dv.fuel = dv.fuelCap; dv.dryAt = 0; setFuelOut(false);
      dv.game = {
        dest: { id: pick.id, name: pick.name, x: pick.x, y: pick.y }, way, wayLen0: len,
        started: performance.now(), knocks: 0, knockAt: 0, routedAt: performance.now(), mapAt: 0, pinged: "", said: "", spoken: [], rerouteSaidAt: 0,
        ribbon, beacon: bc, done: false,
        hud: { name: null, dist: null, gold: null, time: null, turn: null, turnDist: null, map: null },
        onArrive: r2 => { setResult(r2); setGoldSum(r2.total); },
      };
      setDelivery(d => ({ name: pick.name, n: (d?.n ?? 0) + 1 }));
      return;
    }
    setDelivery(null);
  };
  useEffect(() => {
    const g = stageRef.current?.drive?.game;
    if (g) g.hud = { name: gameHud.name.current, dist: gameHud.dist.current, gold: gameHud.gold.current, time: gameHud.time.current,
      turn: gameHud.turn.current, turnDist: gameHud.turnDist.current, map: gameHud.map.current };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delivery, result]);
  const nextDelivery = () => { const st = stageRef.current, dv = st?.drive; if (st && dv) startDelivery(st, dv); };
  // HP: the gauge's bar; a red edge on each hit; at nothing the vehicle explodes and burns.
  const [hp, setHp] = useState(100);
  const [hurtKey, setHurtKey] = useState(0);
  const [wrecked, setWrecked] = useState<null | "hp" | "fuel" | "water">(null);
  const [fuelOut, setFuelOut] = useState(false);
  // warnings shown (0 none, 1 low, 2 critical), a passing note (a pickup, a crash)
  const [fuelWarn, setFuelWarn] = useState(0), [hpWarn, setHpWarn] = useState(0);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 1600); return () => window.clearTimeout(t); }, [toast]);
  const destroyVehicle = (st: Stage, dv: DriveState, why: "hp" | "fuel" | "water" = "hp") => {
    const tr = st.traffic, car = tr?.hero(dv.name);
    if (!tr || !car || dv.dead) return;
    dv.dead = true;
    if (dv.view === "cockpit") toggleDriveView();
    const gz = car.z ?? terrainRef.current.at(car.x, car.y);
    dv.fx.explode(new THREE.Vector3(car.x, gz + 1.2, -car.y), gz);
    damageSfx.explosion(dv.sound.ctx, dv.sound.master);
    dv.fireStop = damageSfx.fire(dv.sound.ctx, dv.sound.master);
    dv.sound.mute();
    dv.shake = 9;
    // the wreck: the body burnt black, sat down on its axles, a little askew
    const shape = tr.heroShape(dv.name), m = tr.heroMatrix(dv.name, new THREE.Matrix4());
    if (shape && m) {
      const char = new THREE.MeshStandardMaterial({ color: "#1b1a19", roughness: 0.95, metalness: 0.25, emissive: "#3a1004", emissiveIntensity: 0.6 });
      const wreck = new THREE.Mesh(shape.geometry, [char, char]);
      wreck.matrixAutoUpdate = false;
      wreck.matrix.copy(m).premultiply(tr.group.matrixWorld)
        .multiply(new THREE.Matrix4().makeTranslation(0, -shape.radius * 0.7, 0))
        .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.04, 0.12, -0.06)));
      wreck.castShadow = wreck.receiveShadow = true;
      st.addWarm(st.scene, wreck);
      dv.wreck = wreck;
      car.hide = true;
    }
    const g = dv.game;
    if (g) { g.done = true; g.ribbon.mesh.visible = false; g.beacon.group.visible = false; }
    if (why === "water") {
      // gone under: back where the drive began, as new, a moment after
      setWrecked("water");
      setTimeout(() => { if (st.drive === dv && dv.dead) resetVehicle(true); }, 2600);
    } else setTimeout(() => { if (st.drive === dv && dv.dead) setWrecked(why); }, 1800);
  };
  /** Repaired (50 G): back on the nearest lane, full health, a full tank, a new delivery. After
   * the water: free, and back where the drive began. */
  const repairVehicle = () => resetVehicle(false);
  const resetVehicle = (home: boolean) => {
    const st = stageRef.current, dv = st?.drive, tr = st?.traffic;
    if (!st || !dv || !tr) return;
    dv.fireStop?.(1); dv.fireStop = null; dv.fx.clear();
    if (dv.wreck) { dv.wreck.removeFromParent(); (dv.wreck.material as THREE.Material[])[0].dispose(); dv.wreck = null; }
    const car = tr.hero(dv.name);
    if (car) { car.hide = false; car.speed = 0; }
    tr.drive(dv.name, false);
    if (home) tr.summon(dv.name, dv.home.x, dv.home.y, dv.home.hx, dv.home.hy);
    dv.manual = false; dv.dead = false; dv.hp = 100; dv.sim.steer = 0;
    // Refuel even when no new delivery route can be found after a wreck.
    dv.fuelCap = Math.max(dv.fuelCap, tankFor(0)); dv.fuel = dv.fuelCap; dv.dryAt = 0;
    setFuelOut(false);
    dv.feel.hpWarn = 0; dv.feel.fuelWarn = 0; setHpWarn(0); setFuelWarn(0); paintDamage(dv);
    setHp(100); setWrecked(null); setDriving(d => d && { ...d, manual: false });
    if (!home) setGoldSum(addGold(-Math.min(50, goldTotal())));
    startDelivery(st, dv);
  };
  // The score board: each finished drive recorded (its gold) under the player's id and nickname;
  // the board shows rank 1 down, and the player's own rank and score last.
  const [board, setBoard] = useState<null | { data: DriveBoard | null; error: string | null; last?: number }>(null);
  const [nickAsk, setNickAsk] = useState<null | { score: number; deliveries: number; vehicle: string }>(null);
  const [nick, setNick] = useState(playerName);
  const recordScore = (r: { score: number; deliveries: number; vehicle: string }, name: string) => {
    const id = playerId();
    if (!id) { setBoard({ data: null, error: "이 브라우저에서는 점수를 저장할 수 없습니다 (저장소 차단)" }); return; }
    setBoard({ data: null, error: null, last: r.score });
    api.driveScorePost({ player_id: id, name, ...r })
      .then(data => setBoard({ data, error: null, last: r.score }))
      .catch(() => setBoard({ data: null, error: "점수를 기록하지 못했습니다. 잠시 후 다시 시도해 주세요.", last: r.score }));
  };
  const showBoard = () => {
    setBoard({ data: null, error: null });
    api.driveScores(playerId() ?? undefined)
      .then(data => setBoard({ data, error: null }))
      .catch(() => setBoard({ data: null, error: "순위를 불러오지 못했습니다." }));
  };
  const endDrive = () => {
    const st = stageRef.current, dv = st?.drive;
    if (dv && import.meta.env.DEV) console.info("[drive] endDrive", new Error().stack?.split("\n").slice(1, 5).join(" | "));
    if (!st || !dv) return;
    // (a drive that earned something goes on the board; the nickname asked the first time)
    if (dv.earned > 0) {
      const r = { score: dv.earned, deliveries: dv.delivered, vehicle: dv.name };
      if (playerName()) recordScore(r, playerName()); else setNickAsk(r);
    }
    st.drive = null;
    endDelivery(dv);
    dv.feel.cans.dispose(); dv.feel.voice.dispose();
    setFuelWarn(0); setHpWarn(0);
    st.traffic?.setDetail(55, 40);
    st.roadDetail?.(false);
    st.plantsFocus?.(null);
    setResult(null); setWrecked(null); setFuelOut(false);
    releaseVehicle(st, dv);
    setDriving(null);
  };
  /** The driven vehicle handed back to the traffic: its sound, cockpit and effects gone. */
  const releaseVehicle = (st: Stage, dv: DriveState) => {
    dv.feel.squeal.dispose(); dv.feel.sparks.dispose(); dv.feel.lamps.removeFromParent();
    // (the body's own look back as new)
    const own = st.traffic?.heroShape(dv.name)?.material as THREE.MeshStandardMaterial | undefined;
    if (own && dv.feel.paint) { own.color.copy(dv.feel.paint.color); own.roughness = dv.feel.paint.rough; }
    dv.fireStop?.(0.3); dv.fx.dispose(); dv.wreck?.removeFromParent(); (dv.wreck?.material as THREE.Material | undefined)?.dispose();
    dv.sound.dispose();
    if (dv.cab) { dv.cab.group.removeFromParent(); dv.cab.dispose(); }
    const c = st.traffic?.hero(dv.name);
    if (c) { c.hide = false; c.steer = 0; }
    st.traffic?.drive(dv.name, false);
    st.camera.fov = dv.baseFov; st.camera.updateProjectionMatrix();
  };
  const stopFollow = () => {
    const st = stageRef.current;
    if (!st?.follow) return;
    endDrive();
    st.follow = null; setFollow(null); st.resume();
  };
  // ---- Driving on past the drawn area ----
  // Nearing the edge of what is drawn, the view re-centres on the known complex nearest the way
  // ahead: it builds there in the background while the drive goes on in the old scene (shifted
  // into the new frame, still ticking), and once the new traffic is up the vehicle, its delivery
  // and pickups move into it; then the old scene is released. On and on, from complex to complex.
  const carryRef = useRef<((st: Stage, tr: NonNullable<Stage["traffic"]>) => void) | null>(null);
  carryRef.current = (st, traffic) => {
    const k = st.carry;
    if (!k) return;
    st.carry = null;
    if (import.meta.env.DEV) console.info("[drive] handover", k.ox.toFixed(1), k.oy.toFixed(1), "old→new", performance.now().toFixed(0));
    const dv = k.dv, c0 = k.tr.hero(dv.name);
    if (!c0 || dv.dead || st.drive !== dv) { k.letGo?.(); return; }
    const nx = c0.x - k.ox, ny = c0.y - k.oy, v = c0.speed, hx = c0.hx, hy = c0.hy;
    traffic.summon(dv.name, nx, ny, hx, hy);
    const car = traffic.drive(dv.name, true);
    if (!car) { k.letGo?.(); endDrive(); return; }
    car.x = nx; car.y = ny; car.hx = hx; car.hy = hy; car.speed = v;
    // the old vehicle's own sound, cockpit and effects (it stays with the old traffic, released next)
    dv.feel.squeal.dispose(); dv.feel.sparks.dispose(); dv.feel.lamps.removeFromParent();
    dv.fx.dispose(); dv.sound.dispose();
    if (dv.cab) { dv.cab.group.removeFromParent(); dv.cab.dispose(); dv.cab = null; }
    // the delivery and the pickups into the new frame
    const g = dv.game;
    if (g) {
      g.dest = { ...g.dest, x: g.dest.x - k.ox, y: g.dest.y - k.oy };
      g.way = g.way.map(([x, y]) => [x - k.ox, y - k.oy] as Pt);
      g.ribbon.dispose();
      g.ribbon = routeRibbon(terrainRef.current, (x, y) => traffic.groundAt(x, y));
      st.addWarm(traffic.group, g.ribbon.mesh);
      g.ribbon.set(g.way);
      traffic.group.add(g.beacon.group);
      const end = g.way[g.way.length - 1];
      g.beacon.place(end[0], end[1], traffic.groundAt(end[0], end[1]));
      g.routedAt = 0;
    }
    dv.feel.cans.shift(k.ox, k.oy, k.dz);
    dv.hopping = false;
    const manual = dv.manual;
    st.drive = null;
    startDrive(st, dv.name, dv);
    if (manual) takeOver();
    k.letGo?.();
  };
  const hopPending = useRef(false), hopRefused = useRef(new Set<string>());
  // the point ahead the next area is preloaded round (the current view's frame), kept till it is due
  const heldPoint = useRef<{ from: string; x: number; y: number } | null>(null);
  // the next areas' data, asked ahead of need and kept (by complex id, or point cell)
  const areaJobs = useRef(new Map<string, Promise<{ res: RealEstateBuildingsResponse | null; key: string; name: string }>>());
  // the complexes known round each one reached while driving
  useEffect(() => {
    const d = data;
    if (!driving || !d?.found || !d.center || !d.vworld_key || !complexId || complexId.startsWith("pt:")) return;
    void nearbyFor(complexId, d).then(items => { for (const i of items) drivePool.current.set(i.id, i); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, driving?.name]);
  useEffect(() => {
    if (!driving) return;
    if (nearby?.items) for (const i of nearby.items) drivePool.current.set(i.id, i);
    type Area = { res: RealEstateBuildingsResponse | null; key: string; name: string };
    let lastPreload = 0;
    const timer = window.setInterval(() => {
      const st = stageRef.current, dv = st?.drive, cur = dataRef.current;
      if (!st || !dv || !cur?.center) return;
      // (a re-centring that never completed: let the drive end rather than hang)
      if (st.carry && performance.now() - st.carry.at > 90000) { const k = st.carry; st.carry = null; k.letGo?.(); endDrive(); return; }
      if (!dv.manual || dv.dead || st.carry || hopPending.current || hopRef.current) return;
      const c = st.traffic?.hero(dv.name);
      if (!c) return;
      const d0 = Math.hypot(c.x, c.y), v = Math.abs(c.speed);
      if (d0 < 30) return;
      // How far on the vehicle looks: about 8 s of driving and a margin. The next area is centred
      // that far ahead and asked for at once; it is built (in the background, the old one still
      // driven) as soon as that look reaches the edge of what is drawn — so it is all there before
      // the vehicle arrives.
      const look = v * 8 + 150;
      // The next area, chosen as it will be when the time comes: the known complex nearest the way
      // ahead (well nearer the vehicle than this one), else the area round a point ahead (no
      // complex that way: a river bank, a park, a district of houses — VWorld's buildings and roads).
      const lead = Math.max(260, 200 + v * 8), px = c.x + c.hx * lead, py = c.y + c.hy * lead;
      let best = null as Nearby | null, score = Infinity;
      for (const it of drivePool.current.values()) {
        if (it.id === cur.id || hopRefused.current.has(it.id)) continue;
        const [x, y] = metresFrom(cur.center, it.lat, it.lon), dc = Math.hypot(x - c.x, y - c.y);
        if (dc > lead + 250) continue;
        const sc = Math.hypot(x - px, y - py);
        if (sc < score) { score = sc; best = it; }
      }
      if (best && score > 250) best = null;
      // (at speed only the plain area ahead: a complex's own scene paints its facades and took
      // ~17 s to build at 178 km/h, the plain area ~3 s; its buildings still stand, as neighbours)
      if (v > 12) best = null;
      const key0 = cur.vworld_key, cos = Math.cos((cur.center.lat * Math.PI) / 180);
      const pointAt = (ahead: number) => {
        const ax = c.x + c.hx * ahead, ay = c.y + c.hy * ahead;
        return { lat: cur.center!.lat + ay / 110_540, lon: cur.center!.lon + ax / (cos * 111_320) };
      };
      // (a point ahead, once chosen, is kept while it is still ahead and not yet reached: chosen
      // afresh every tick, it moved on with the vehicle and its preloaded area never came due)
      const held = heldPoint.current;
      const keep = held && held.from === cur.id && (() => {
        const dx = held.x - c.x, dy = held.y - c.y, dd = Math.hypot(dx, dy);
        return dd > 120 && (dx * c.hx + dy * c.hy) > dd * 0.5;
      })();
      if (!keep) {
        const ahead = lead;
        heldPoint.current = { from: cur.id, x: c.x + c.hx * ahead, y: c.y + c.hy * ahead };
      }
      const hp = heldPoint.current!, aheadNow = Math.hypot(hp.x - c.x, hp.y - c.y);
      const p0 = pointAt(aheadNow), cell = `pt:${(cur.center.lat + hp.y / 110_540).toFixed(3)},${(cur.center.lon + hp.x / (cos * 111_320)).toFixed(3)}`;
      void p0;
      const jobKey = best ? best.id : cell;
      if (!best && (!key0 || hopRefused.current.has(cell))) return;
      // Asked once per area and kept: started well before it is needed (선로딩), so the move itself
      // waits on nothing but the building.
      let job = areaJobs.current.get(jobKey);
      const due = Math.hypot(c.x + c.hx * look, c.y + c.hy * look) > 420;
      if (!job) {
        // (points ahead change as the vehicle moves: one new one asked every 2.5 s at most)
        if (!best && !due && performance.now() - lastPreload < 2500) return;
        lastPreload = performance.now();
        const target = best;
        job = target
          ? lookAhead(target.id).then((res): Area => ({ res, key: target.id, name: target.name }))
          : (async (): Promise<Area> => {
              for (const extra of [0, 190]) {
                const ax = hp.x + c.hx * extra, ay = hp.y + c.hy * extra;
                const pt = { lat: cur.center!.lat + ay / 110_540, lon: cur.center!.lon + ax / (cos * 111_320) };
                const res = await vworldPointArea(pt.lat, pt.lon, key0!, cur.vworld_domain).catch(() => null);
                if (res?.found) {
                  buildingCache.set(res.id, { at: Date.now(), data: res });
                  void withRoads(res.id, res); void terrainOnce(res.id, res);
                  if (!pausedRef.current) prefetchPaint(res.id, res.name);
                  return { res, key: res.id, name: res.name };
                }
              }
              hopRefused.current.add(cell);
              return { res: null, key: "", name: "" };
            })();
        job.catch(() => areaJobs.current.delete(jobKey));
        areaJobs.current.set(jobKey, job);
        if (target && !pausedRef.current) prefetchPaint(target.id, target.name);
      }
      if (!due) return;
      hopPending.current = true;
      const chosen = best;
      void job.then(({ res, key: targetId, name: targetName }) => {
        hopPending.current = false;
        const st2 = stageRef.current, dv2 = st2?.drive, cur2 = dataRef.current;
        if (!res?.found || !res.buildings.length) { if (chosen) hopRefused.current.add(chosen.id); return; }
        if (!st2 || dv2 !== dv || !dv2.manual || dv2.dead || st2.carry || !st2.traffic || !cur2?.center || hopRef.current) return;
        // (by its own centre, not the list's point: re-centred there the vehicle must be well inside)
        const c2 = st2.traffic.hero(dv2.name);
        if (!c2 || !res.center) return;
        const [tx, ty] = metresFrom(cur2.center, res.center.lat, res.center.lon);
        // (it must lie on the way ahead, well past this view's centre, near enough to draw the vehicle)
        const along = (tx - c2.x) * c2.hx + (ty - c2.y) * c2.hy, here = -(c2.x * c2.hx + c2.y * c2.hy);
        if (Math.hypot(tx - c2.x, ty - c2.y) > 900 || along < here + 150) { hopRefused.current.add(targetId); return; }
        if (import.meta.env.DEV) console.info("[drive] re-centring on", targetName, targetId, performance.now().toFixed(0));
        hopRef.current = { id: targetId, from: { ...cur2.center }, terrain: terrainRef.current, drive: true };
        st2.carry = { dv: dv2, tr: st2.traffic, tick: st2.tick, ox: 0, oy: 0, dz: 0, letGo: null, at: performance.now() };
        dv2.hopping = true;
        setToast(t => ({ text: `🗺 ${targetName} 방면 지도를 불러옵니다`, n: (t?.n ?? 0) + 1 }));
        setHop(targetId === homeId ? null : { id: targetId, name: targetName, home: homeId });
      }).catch(() => { hopPending.current = false; if (chosen) hopRefused.current.add(chosen.id); });
    }, 700);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driving?.name, nearby]);
  /** `from`: the drive switched from the other vehicle — its delivery, fuel, gold and damage
   * carried over; only the vehicle changes. */
  const startDrive = (st: Stage, name: HeroName, from?: DriveState) => {
    const car = st.traffic?.hero(name);
    if (!car) return;
    const spec = DRIVE_SPECS[name];
    const sound = new EngineSound(spec);
    const dv: DriveState = {
      name, manual: false, view: "chase", cab: null, solids: null, lastSpeed: car.speed, baseFov: st.camera.fov,
      keys: { up: false, down: false, left: false, right: false, hand: false },
      sim: new DriveSim(car, spec, (x, y, r) => st.traffic?.near(x, y, r) ?? [], () => dv.solids, () => st.poles?.grid ?? null),
      sound,
      look: { yaw: 0, pitch: 0, held: false },
      hud: { speed: null, gear: null, revs: null, hint: null, fuel: null },
      shake: 0, game: null,
      hp: 100, dead: false, fx: vehicleFx(), wreck: null, fireStop: null, warnAt: 0, hitAt: 0,
      hurt: n => {
        if (dv.dead || n <= 0) return;
        dv.hp = Math.max(0, dv.hp - n);
        setHp(Math.round(dv.hp)); setHurtKey(k => k + 1);
        paintDamage(dv);
        // the driver told as it gets bad: damaged, then about to go
        const hw = dv.hp < 25 ? 2 : dv.hp < 50 ? 1 : 0;
        if (hw > dv.feel.hpWarn && dv.hp > 0) {
          feelSfx.alarm(dv.sound.ctx, "hp", dv.sound.master);
          dv.feel.voice.say(hw === 2 ? "경고! 차량 내구도가 매우 낮습니다. 폭발 위험!" : "차량이 손상되었습니다. 충돌에 주의하세요", true);
        }
        if (hw !== dv.feel.hpWarn) { dv.feel.hpWarn = hw; dv.onWarn(); }
        if (dv.hp <= 0) destroyVehicle(st, dv);
      },
      blowUp: why => destroyVehicle(st, dv, why), onDry: () => setFuelOut(true),
      onWarn: () => { setFuelWarn(dv.feel.fuelWarn); setHpWarn(dv.feel.hpWarn); },
      heal: n => {
        if (dv.dead || n <= 0) return;
        dv.hp = Math.min(100, dv.hp + n);
        setHp(Math.round(dv.hp)); paintDamage(dv);
        const hw = dv.hp < 25 ? 2 : dv.hp < 50 ? 1 : 0;
        if (hw !== dv.feel.hpWarn) { dv.feel.hpWarn = hw; dv.onWarn(); }
      },
      onPickup: kind => {
        if (kind === "fuel") setFuelOut(false);
        const text = kind === "repair" ? `🔧 내구도 +${REPAIR_HP}` : dv.name === "cyber" ? "⚡ 배터리 +25%" : "⛽ 연료 +25%";
        setToast(t => ({ text, n: (t?.n ?? 0) + 1 }));
      },
      feel: from ? { ...from.feel, squeal: screech(sound.ctx, sound.master), sparks: sparks(), lamps: brakeLamps(name), prevV: car.speed, paint: null } : {
        squeal: screech(sound.ctx, sound.master), sparks: sparks(), cans: fuelCans(), voice: navVoice(), lamps: brakeLamps(name),
        prevV: car.speed, acc: 0, fuelWarn: 0, hpWarn: 0, boostOn: false, paint: null, fx: hudSpeedFx.current, fuelText: hudFuelText.current,
      },
      fuel: 0, fuelCap: 0, dryAt: 0, home: { x: car.x, y: car.y, hx: car.hx, hy: car.hy }, earned: 0, delivered: 0, focusAt: [Infinity, Infinity],
    };
    st.drive = dv;
    // (effects, pickups in the traffic's own frame: they move with it when the view re-centres)
    const frame = st.traffic?.group ?? st.scene;
    st.addWarm(frame, dv.fx.group);
    st.addWarm(frame, dv.feel.sparks.mesh); st.addWarm(st.scene, dv.feel.lamps);
    if (from) frame.add(dv.feel.cans.group); else st.addWarm(frame, dv.feel.cans.group);
    // the damage seen on the body: its own surface darkened and dulled as health falls
    const own = st.traffic?.heroShape(name)?.material as THREE.MeshStandardMaterial | undefined;
    if (own?.color) dv.feel.paint = { mat: own, color: own.color.clone(), rough: own.roughness };
    paintDamage(dv);
    // Driving: the vehicles round it drawn from their modelled meshes, with plates, further out
    // (at speed the ones ahead come up fast: modelled well before they are close).
    st.traffic?.setDetail(st.hq ? 240 : 150, st.hq ? 100 : 65);
    st.roadDetail?.(true);
    if (from) {
      dv.game = from.game; dv.fuel = from.fuel; dv.fuelCap = from.fuelCap; dv.dryAt = from.dryAt;
      dv.earned = from.earned; dv.delivered = from.delivered; dv.home = from.home; dv.hp = from.hp;
      setHp(Math.round(dv.hp)); setWrecked(null);
    } else {
      setHp(100); setWrecked(null); setFuelOut(false);
      startDelivery(st, dv);
    }
    // The buildings to run into: their roofs gridded in idle slices (the drive starts at once).
    const solid: THREE.Mesh[] = [...st.pickables];
    st.scene.traverse(o => { if (o.userData.solid && (o as THREE.Mesh).isMesh) solid.push(o as THREE.Mesh); });
    void solidGrid(solid, terrainRef.current, FAR_HALF, frameSlice).then(g => { if (st.drive === dv) dv.solids = g; });
    setDriving({ name, view: "chase", manual: false });
  };
  /** A driving key: the vehicle taken from the traffic into the driver's hands. */
  const takeOver = () => {
    const st = stageRef.current, dv = st?.drive;
    if (!st || !dv) return;
    dv.sound.resume();
    if (dv.manual) return;
    const car = st.traffic?.drive(dv.name, true);
    if (!car) return;
    dv.manual = true;
    car.pilot = dt => {
      dv.sim.step(dt, dv.dead ? DEAD_KEYS : dv.fuel <= 0 ? dryKeys(dv.keys) : dv.keys); car.steer = dv.sim.steer;
      if (dv.dead) return;
      const now0 = performance.now();
      // People in the way: knocked down (they get up again), the vehicle damaged by it.
      const v = car.speed;
      if (Math.abs(v) > 1.2) for (const crowd of st.crowds) for (const w of crowd.near(car.x, car.y, 7)) {
        const dx = w.x - car.x, dy = w.y - car.y, al = dx * car.hx + dy * car.hy, side = dy * car.hx - dx * car.hy;
        if (Math.abs(al) > car.length / 2 + 0.35 || Math.abs(side) > car.width / 2 + 0.35) continue;
        const push = Math.sign(side || 1) * 1.5;
        crowd.knock(w, car.hx * v * 0.7 - car.hy * push, car.hy * v * 0.7 + car.hx * push);
        damageSfx.thud(dv.sound.ctx, dv.sound.master);
        feelSfx.scream(dv.sound.ctx, dv.sound.master);
        // (and someone nearby, a beat later)
        if (Math.random() < 0.6) setTimeout(() => feelSfx.scream(dv.sound.ctx, dv.sound.master), 250 + Math.random() * 400);
        dv.shake = Math.max(dv.shake, 2.5);
        dv.hurt(4 + Math.abs(v) * 0.9);
        const g = dv.game;
        if (g && !g.done) { g.knocks++; g.knockAt = now0; setKnocks(g.knocks); }
      }
      if (dv.sim.bump > 0.6) {
        dv.sound.knock(dv.sim.bump);
        // metal and glass, and sparks where it struck (the end it was going toward)
        if (dv.sim.bump > 2 && now0 - dv.hitAt > 250) {
          feelSfx.crash(dv.sound.ctx, dv.sim.bump, dv.sound.master);
          const end = car.speed <= 0 ? 1 : -1, gz = car.z ?? terrainRef.current.at(car.x, car.y);
          const at = new THREE.Vector3(car.x + car.hx * end * car.length / 2, gz + 0.7, -(car.y + car.hy * end * car.length / 2));
          dv.feel.sparks.burst(at, new THREE.Vector3(-car.hx * end, 0, car.hy * end), Math.min(70, 12 + dv.sim.bump * 6));
          setToast(t => ({ text: dv.sim.bumpHit === "solid" ? "💥 건물과 충돌!" : dv.sim.bumpHit === "pole" ? "💥 가로수·가로등과 충돌!" : "💥 차량과 충돌!", n: (t?.n ?? 0) + 1 }));
          // the other vehicle: it stops where it was struck (longer the harder), its driver leans
          // on the horn a moment later; smoke from its crumpled end on a hard one
          const other = dv.sim.bumpCar as (typeof car & { stunned?: number }) | null;
          if (other) {
            other.stunned = Math.max(other.stunned ?? 0, 3 + dv.sim.bump * 0.5);
            const ctx = dv.sound.ctx, out = dv.sound.master;
            window.setTimeout(() => sfx.horn(ctx, false, out), 500 + Math.random() * 400);
            if (dv.sim.bump > 6) { const oz = other.z ?? gz; dv.feel.sparks.burst(new THREE.Vector3(other.x, oz + 0.9, -other.y), new THREE.Vector3(other.hx, 0, -other.hy), 30); }
          }
        }
        dv.shake = Math.max(dv.shake, Math.min(6, dv.sim.bump));
        // damage by the speed of the knock (a scrape nothing; 36 km/h into a wall about a third)
        if (now0 - dv.hitAt > 250) { dv.hitAt = now0; dv.hurt(Math.max(0, dv.sim.bump - 1.2) * 3.4); }
        // (a knock counts against the delivery once per half second)
        const g = dv.game, now = performance.now();
        if (g && !g.done && dv.sim.bump > 1.5 && now - g.knockAt > 500) { g.knocks++; g.knockAt = now; setKnocks(g.knocks); }
      }
    };
    setDriving(d => d && { ...d, manual: true });
  };
  const toggleDriveView = () => {
    const st = stageRef.current, dv = st?.drive;
    if (!st || !dv) return;
    const car = st.traffic?.hero(dv.name);
    dv.view = dv.view === "chase" ? "cockpit" : "chase";
    dv.look.yaw = 0; dv.look.pitch = 0;
    if (dv.view === "cockpit") {
      if (!dv.cab) { dv.cab = cockpit(dv.name); dv.cab.group.matrixAutoUpdate = false; st.addWarm(st.scene, dv.cab.group); }
      dv.cab.group.visible = true;
      if (car) car.hide = true;
    } else {
      if (dv.cab) dv.cab.group.visible = false;
      if (car) car.hide = false;
    }
    setDriving(d => d && { ...d, view: dv.view });
    st.resume();
  };
  useEffect(() => {
    const dv = stageRef.current?.drive;
    if (dv) { dv.hud = { speed: hudSpeed.current, gear: hudGear.current, revs: hudRevs.current, hint: null, fuel: hudFuel.current }; dv.feel.fx = hudSpeedFx.current; dv.feel.fuelText = hudFuelText.current; }
  }, [driving]);
  useEffect(() => {
    if (!driving) return;
    // (by the key's place, not its letter: a Korean layout types ㅈ for W)
    const which = (code: string): keyof Keys | null =>
      code === "KeyW" || code === "ArrowUp" ? "up" : code === "KeyS" || code === "ArrowDown" ? "down"
        : code === "KeyA" || code === "ArrowLeft" ? "left" : code === "KeyD" || code === "ArrowRight" ? "right" : code === "Space" ? "hand"
        : code === "ShiftLeft" || code === "ShiftRight" ? "boost" : null;
    const typing = (e: KeyboardEvent) => { const el = e.target as HTMLElement | null; return !!el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable); };
    const down = (e: KeyboardEvent) => {
      const dv = stageRef.current?.drive;
      if (!dv || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); stopFollow(); return; }
      if (e.code === "KeyM") { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) { dv.feel.voice.on = !dv.feel.voice.on; setToast(t => ({ text: dv.feel.voice.on ? "🔊 음성 안내 켬" : "🔇 음성 안내 끔", n: (t?.n ?? 0) + 1 })); } return; }
      if (e.code === "KeyH") { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) sfx.horn(dv.sound.ctx, dv.name === "coupang", dv.sound.master); return; }
      if (e.code === "KeyV" || e.code === "KeyC") { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) toggleDriveView(); return; }
      const k = which(e.code);
      if (!k) return;
      e.preventDefault(); e.stopImmediatePropagation();
      dv.keys[k] = true;
      if (k === "boost" && !e.repeat && dv.fuel > 0 && !dv.dead) feelSfx.boost(dv.sound.ctx, dv.sound.master);
      if (k !== "hand" && k !== "boost") takeOver();
    };
    const up = (e: KeyboardEvent) => {
      const dv = stageRef.current?.drive, k = which(e.code);
      if (dv && k) { dv.keys[k] = false; e.preventDefault(); }
    };
    const blur = () => { const dv = stageRef.current?.drive; if (dv) for (const k of Object.keys(dv.keys) as (keyof Keys)[]) dv.keys[k] = false; };
    // (on the window, capturing: ahead of the view's own arrow keys and the full screen's Esc)
    window.addEventListener("keydown", down, true); window.addEventListener("keyup", up, true); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); window.removeEventListener("blur", blur); };
  }, [driving?.name]);
  /** A touch pedal or steering button held. */
  const pedal = (k: keyof Keys, on: boolean) => {
    const dv = stageRef.current?.drive;
    if (!dv) return;
    dv.keys[k] = on;
    if (on && k !== "hand") takeOver();
  };
  const followHero = (name: HeroName) => {
    const st = stageRef.current;
    if (!st?.traffic) return;
    if (st.follow === name) { stopFollow(); return; }
    if (st.balloonView) leaveBalloon();
    // 운전 중 차종 전환: the delivery, fuel, gold and damage carry over; only the vehicle changes
    // (brought onto the lane where the other one is). Not from a wreck: that is the repair's.
    const was = st.drive;
    if (was && !was.dead && st.follow) {
      const old = st.traffic.hero(was.name);
      if (!old) return;
      const [ox, oy, ohx, ohy] = [old.x, old.y, old.hx, old.hy];
      st.drive = null;
      releaseVehicle(st, was);
      if (!st.traffic.summon(name, ox, oy, ohx, ohy)) { st.drive = was; st.traffic.drive(was.name, was.manual); return; }
      st.follow = name; setFollow(name);
      startDrive(st, name, was);
      if (was.manual) takeOver();
      st.resume();
      return;
    }
    endDrive();
    const t = st.controls.target;
    if (st.follow !== name && !st.traffic.summon(name, t.x, -t.z)) return;
    st.follow = name;
    st.controls.autoRotate = false; spinRef.current = false; setSpin(false);
    st.intro = null; st.fly = null; setTip(null);
    setFollow(name);
    startDrive(st, name);
    st.resume();
  };
  const enterBalloon = () => {
    const st = stageRef.current;
    if (!st?.balloon || !st.balloon.group.visible || st.balloonView) return;
    const at = st.balloon.basket(new THREE.Vector3());
    // Facing the complex, looking down at it.
    const yaw = Math.atan2(st.center.z - at.z, st.center.x - at.x);
    const pitch = -Math.atan2(at.y - st.center.y, Math.hypot(st.center.x - at.x, st.center.z - at.z));
    st.balloonView = { yaw, pitch: Math.max(-1.45, Math.min(-0.15, pitch)), fov: 50, baseFov: st.camera.fov };
    st.controls.enabled = false; st.controls.autoRotate = false; spinRef.current = false; setSpin(false);
    st.intro = null; setTip(null); setBalloonOn(true); st.resume();
  };
  const leaveBalloon = () => {
    const st = stageRef.current;
    if (!st?.balloonView) return;
    st.camera.fov = st.balloonView.baseFov; st.camera.updateProjectionMatrix();
    st.balloonView = null;
    st.controls.enabled = true;
    st.frame();
    setBalloonOn(false); st.resume();
  };
  const zoomBalloon = (factor: number) => {
    const bv = stageRef.current?.balloonView;
    if (bv) bv.fov = THREE.MathUtils.clamp(bv.fov * factor, 6, 75);
  };
  const lookBalloon = (dx: number, dy: number) => {
    const bv = stageRef.current?.balloonView;
    if (!bv) return;
    // Drag moves the view like grabbing the scene; slower when zoomed in.
    const k = (bv.fov / 50) * 0.0045;
    bv.aim = undefined;
    bv.yaw += dx * k; bv.pitch = THREE.MathUtils.clamp(bv.pitch + dy * k, -1.5, 0.9);
  };
  useEffect(() => {
    if (!balloonOn) return;
    const host = hostRef.current;
    const wheel = (e: WheelEvent) => { e.preventDefault(); zoomBalloon(Math.exp(e.deltaY * 0.0012)); stageRef.current?.resume(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); leaveBalloon(); } };
    host?.addEventListener("wheel", wheel, { passive: false });
    // (on the window, capturing: ahead of the full-screen layer's Esc on the document)
    window.addEventListener("keydown", key, true);
    return () => { host?.removeEventListener("wheel", wheel); window.removeEventListener("keydown", key, true); };
  }, [balloonOn, big]);
  // A new complex, or the view going away: back on the ground.
  // (a move to a neighbouring complex keeps the ride: the balloon flies there)
  useEffect(() => { if (balloonOn) leaveBalloon(); }, [homeId]);
  const drag = useRef<{ x: number; y: number; pinch: number } | null>(null);
  // Keys, while the pointer is over the view or it is full screen: arrows turn and
  // tilt, +/- zoom, H back to the opening shot, T from above, R auto-rotation,
  // F full screen, B the balloon (not while typing, nor on the time slider).
  const hovering = useRef(false);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (!(hovering.current || big) || e.ctrlKey || e.metaKey || e.altKey || !data?.found) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    const k = e.key;
    const act = k === "ArrowLeft" ? "left" : k === "ArrowRight" ? "right" : k === "ArrowUp" ? "up" : k === "ArrowDown" ? "down"
      : k === "+" || k === "=" ? "in" : k === "-" || k === "_" ? "out" : k === "h" || k === "H" || k === "Home" ? "home" : k === "t" || k === "T" ? "top" : null;
    if (act) { e.preventDefault(); navigateView(act); return; }
    if (k === "r" || k === "R") { e.preventDefault(); setSpin(v => !v); stageRef.current?.resume(); return; }
    if ((k === "f" || k === "F") && !wide && !narrow) { e.preventDefault(); if (big) closeBig(); else openBig(); return; }
    if (k === "b" || k === "B") { e.preventDefault(); if (stageRef.current?.balloonView) leaveBalloon(); else enterBalloon(); }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const press = useRef<{ id: number; x: number; y: number; t: number; moved: boolean } | null>(null);
  const pointers = useRef(new Set<number>());
  const pinchSpan = () => { const ps = [...touchPoints.current.values()]; return ps.length >= 2 ? Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1]) : 0; };
  const touchPoints = useRef(new Map<number, [number, number]>());
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // (a 단지 팻말 under a resting mouse: highlighted, the pointer a hand)
    if (e.pointerType === "mouse" && !e.buttons && signRects.current.length) {
      const hit = signAt(e.clientX, e.clientY), id = hit && !hit.here ? hit.id : null;
      if (id !== signHover.current) {
        signHover.current = id;
        if (hostRef.current) hostRef.current.style.cursor = id ? "pointer" : "";
        stageRef.current?.resume();
      }
    }
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) {
      p.moved = true;
      // (a drag takes the view back from the followed vehicle; driving it, it looks round)
      const st = stageRef.current, dv = st?.drive;
      if (dv) {
        const d = drag.current ?? (drag.current = { x: p.x, y: p.y, pinch: 0 });
        dv.look.held = true;
        dv.look.yaw = THREE.MathUtils.clamp(dv.look.yaw - (e.clientX - d.x) * 0.006, -Math.PI, Math.PI);
        dv.look.pitch = THREE.MathUtils.clamp(dv.look.pitch - (e.clientY - d.y) * 0.004, -0.6, 0.5);
        d.x = e.clientX; d.y = e.clientY;
        st!.resume();
        return;
      }
      if (st?.follow) stopFollow();
    }
    if (stageRef.current?.balloonView) {
      if (touchPoints.current.has(e.pointerId)) touchPoints.current.set(e.pointerId, [e.clientX, e.clientY]);
      const d = drag.current;
      if (d && touchPoints.current.size >= 2) {
        const span = pinchSpan();
        if (d.pinch && span) zoomBalloon(d.pinch / span);
        d.pinch = span;
      } else if (d && (e.buttons || e.pointerType !== "mouse")) { lookBalloon(e.clientX - d.x, e.clientY - d.y); d.x = e.clientX; d.y = e.clientY; }
      stageRef.current.resume();
      return;
    }
    if (e.pointerType !== "mouse") return;
    if (e.buttons) { setTip(null); return; }
    // (no building names popping up while driving)
    if (stageRef.current?.drive) return;
    if (!tip?.pinned) pick(e, false);
  };
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!(e.target instanceof HTMLCanvasElement)) return;
    pointers.current.add(e.pointerId);
    if (stageRef.current?.balloonView) {
      touchPoints.current.set(e.pointerId, [e.clientX, e.clientY]);
      drag.current = { x: e.clientX, y: e.clientY, pinch: pinchSpan() };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    const touch = e.pointerType !== "mouse";
    if (touch !== touchMode) setTouchMode(touch);
    press.current = pointers.current.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false } : null;
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    pointers.current.delete(e.pointerId);
    touchPoints.current.delete(e.pointerId);
    press.current = null;
    if (stageRef.current?.balloonView) { if (touchPoints.current.size === 0) drag.current = null; else if (drag.current) drag.current.pinch = pinchSpan(); return; }
    const dv = stageRef.current?.drive;
    if (dv) { dv.look.held = false; drag.current = null; return; }
    if (!p || p.id !== e.pointerId || pointers.current.size > 0 || p.moved) return;
    // A drag turned the model: whatever was pinned no longer points at its building.
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8 || performance.now() - p.t > 450) { setTip(null); return; }
    // A tap on a 단지 팻말: off to that complex.
    const sign = signAt(e.clientX, e.clientY);
    if (sign) { if (!sign.here) goTo(sign.id); return; }
    // A tap on the balloon: into its basket.
    const st = stageRef.current;
    if (st?.balloon?.group.visible) {
      const rect = e.currentTarget.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), st.camera);
      if (ray.intersectObjects(st.balloon.pickables, true).length) { enterBalloon(); return; }
    }
    // A second tap on the same spot soon after: fly to that building.
    const last = lastTap.current;
    lastTap.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    // (touch only: a mouse has its own double-click)
    if (e.pointerType !== "mouse" && last && performance.now() - last.t < 350 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 24) { lastTap.current = null; focusAt(e); return; }
    pick(e, true);
  };
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null);
  /** Fly to the building under a point (double-click or double-tap). */
  const focusAt = (e: { clientX: number; clientY: number; currentTarget: HTMLDivElement }) => {
    const st = stageRef.current;
    if (!st || !st.pickables.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), st.camera);
    const hit = ray.intersectObjects(st.pickables, false)[0];
    if (!hit) return;
    // Framed whole: the orbit on its middle, about three of its heights away.
    const box = new THREE.Box3().setFromObject(hit.object);
    const mid = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const tall = Math.min(size.y, 160), wide = Math.min(Math.max(size.x, size.z), 120);
    setTip(null);
    flyTo(new THREE.Vector3(hit.point.x, box.min.y + tall * 0.5, hit.point.z).lerp(mid.setY(box.min.y + tall * 0.5), 0.5), Math.max(tall, wide) * 2.4 + 20);
  };

  // 주변 단지: the apartment complexes round the page's complex (VWorld's 공동주택 and the
  // parcels they stand on, matched to the trades' 지번 by the server), once its view is up.
  useEffect(() => {
    if (!homeId || complexId !== homeId || !data?.found || !data.center || !data.vworld_key || nearby?.home === homeId) return;
    let live = true;
    const st = stageRef.current, res = data, home = homeId;
    const go = () => void nearbyFor(home, res)
      .then(items => {
        if (!live) return;
        setNearby({ home, name: res.name, lat: res.center!.lat, lon: res.center!.lon, items });
        // The nearest few are fetched ahead (shapes, roads, relief), in idle time: most choices
        // are among them, and the view then has them at once.
        // (their facades too, one complex after another, kept in the paint store)
        const ahead = () => {
          items.slice(0, 3).forEach(i => prefetchComplex(i.id));
          void items.slice(0, 3).reduce((done, i) => done.then(() => (live ? paintAhead(i.id) : undefined)), Promise.resolve());
        };
        if (typeof requestIdleCallback === "function") requestIdleCallback(ahead, { timeout: 4000 }); else window.setTimeout(ahead, 2000);
      })
      .catch(err => console.info("[3D] Nearby complexes unavailable:", err));
    // (after the first frame and the neighbourhood's own requests: none of it may slow the view)
    const timer = window.setTimeout(() => { if (st?.unshown) st.onShown.push(go); else go(); }, 1200);
    return () => { live = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, homeId]);
  const near = nearby && nearby.home === homeId ? nearby : null;
  /** 단지 팻말: a name sign over the shown complex and over each complex within 500 m of it,
   * floating above its tallest roof; a click goes there (as the 주변 단지 list does). An HTML
   * layer moved each frame by transform alone: nothing drawn on the GPU, nothing laid out. */
  const signs = useMemo(() => {
    if (!data?.found || !data.center || !complexId || new URLSearchParams(location.search).get("signs") === "0") return [];
    const t = terrainRef.current;
    const towers = data.buildings.filter(b => b.rings[0]?.length);
    const mid = towers.flatMap(b => b.rings[0]).reduce((m, [x, y], _, a) => [m[0] + x / a.length, m[1] + y / a.length], [0, 0]);
    const top = towers.reduce((m, b) => Math.max(m, b.height + t.base(b.rings[0])), 0);
    const out = [{ id: complexId, name: data.name, x: mid[0], y: mid[1], z: top || t.at(0, 0) + 40, here: true }];
    if (near) {
      const others = [...near.items.map(i => ({ id: i.id, name: i.name, lat: i.lat, lon: i.lon, floors: i.floors ?? 15 })),
        { id: homeId!, name: near.name, lat: near.lat, lon: near.lon, floors: 20 }];
      for (const o of others) {
        if (o.id === complexId) continue;
        const [x, y] = metresFrom(data.center, o.lat, o.lon);
        if (Math.hypot(x, y) > 520) continue;
        out.push({ id: o.id, name: o.name, x, y, z: t.at(x, y) + o.floors * FLOOR_M + GROUND_M, here: false });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, near, complexId, homeId, loading]);
  signsRef.current = signs;
  // 단지 팻말 drawn on one canvas over the view (the signs moved as buttons each frame cost the page a
  // restyle, repaint, re-composite and accessibility update every frame — ~6 fps of a slow machine's
  // 35 while the camera turned). Hit-tested here for hover and click; a static list of buttons
  // (visually hidden) keeps them reachable by keyboard and screen readers.
  const signCanvas = useRef<HTMLCanvasElement>(null);
  const signRects = useRef<{ id: string; here: boolean; x0: number; y0: number; x1: number; y1: number }[]>([]);
  const signHover = useRef<string | null>(null);
  const signAt = (clientX: number, clientY: number) => {
    const host = hostRef.current;
    if (!host) return null;
    const r = host.getBoundingClientRect(), x = clientX - r.left, y = clientY - r.top;
    // (the nearest drawn last: tested from the end)
    for (let i = signRects.current.length - 1; i >= 0; i--) { const q = signRects.current[i]; if (x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1) return q; }
    return null;
  };
  useEffect(() => {
    const st = stageRef.current, cv = signCanvas.current;
    if (!st || !cv || !signs.length) return;
    const g = cv.getContext("2d");
    if (!g) return;
    const font = getComputedStyle(cv).fontFamily || "Pretendard, sans-serif";
    // Each sign pre-drawn once per look (plain / hovered), at the screen's pixel ratio.
    const sprites = new Map<string, { img: HTMLCanvasElement; w: number; h: number }>();
    const spriteOf = (sgn: (typeof signs)[number], hover: boolean) => {
      const key = sgn.id + (hover ? ":h" : "");
      let sp = sprites.get(key);
      if (sp) return sp;
      const dpr = Math.min(3, window.devicePixelRatio || 1), size = sgn.here ? 13 : 12;
      const m = document.createElement("canvas").getContext("2d")!;
      m.font = `600 ${size}px ${font}`;
      const tw = Math.ceil(m.measureText(sgn.name).width), bw = tw + 20, bh = Math.round(size * 1.2) + 11, pad = 8, line = 9;
      const w = bw + pad * 2, h = bh + line + pad;
      const c = document.createElement("canvas"); c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
      const x = c.getContext("2d")!; x.scale(dpr, dpr);
      x.shadowColor = "rgba(0,0,0,0.28)"; x.shadowBlur = 10; x.shadowOffsetY = 2;
      x.fillStyle = sgn.here ? "rgba(196,60,40,0.9)" : hover ? "rgba(28,76,140,0.92)" : "rgba(16,28,44,0.86)";
      x.beginPath(); x.roundRect(pad + 0.5, pad + 0.5, bw - 1, bh - 1, 6); x.fill();
      x.shadowColor = "transparent";
      x.strokeStyle = sgn.here ? "rgba(255,255,255,0.8)" : hover ? "#ffffff" : "rgba(255,255,255,0.55)"; x.lineWidth = 1; x.stroke();
      x.fillStyle = "rgba(255,255,255,0.7)"; x.fillRect(pad + bw / 2 - 0.5, pad + bh, 1, line);
      x.fillStyle = "#f2f6fb"; x.font = `600 ${size}px ${font}`; x.textBaseline = "middle"; x.textAlign = "center";
      x.fillText(sgn.name, pad + bw / 2, pad + bh / 2 + 0.5);
      sp = { img: c, w, h };
      sprites.set(key, sp);
      return sp;
    };
    const v = new THREE.Vector3(), dist = new Map<string, number>();
    let last = "";
    st.signs = (camera, w, h) => {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); last = ""; }
      for (const sgn of signs) { v.set(sgn.x, sgn.z + 14, -sgn.y); dist.set(sgn.id, v.distanceTo(camera.position)); }
      // nearer over farther
      const order = [...signs].sort((a, b) => dist.get(b.id)! - dist.get(a.id)!);
      const rects: typeof signRects.current = [], draws: [ReturnType<typeof spriteOf>, number, number, number][] = [];
      let sig = signHover.current ?? "";
      for (const sgn of order) {
        // (14 m over the roof: clear of the crown and the rooftop signs)
        v.set(sgn.x, sgn.z + 14, -sgn.y);
        const d = dist.get(sgn.id)!;
        v.project(camera);
        if (!(v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15 && !st.balloonView?.aim)) continue;
        const k = THREE.MathUtils.clamp(520 / d, 0.62, 1), sx = (v.x + 1) * 0.5 * w, sy = (1 - v.y) * 0.5 * h;
        const sp = spriteOf(sgn, !sgn.here && signHover.current === sgn.id);
        draws.push([sp, sx, sy, k]);
        rects.push({ id: sgn.id, here: sgn.here, x0: sx - (sp.w / 2 - 8) * k, x1: sx + (sp.w / 2 - 8) * k, y0: sy - (sp.h - 8) * k, y1: sy - 9 * k });
        sig += `${sgn.id}${sx.toFixed(1)},${sy.toFixed(1)},${k.toFixed(3)};`;
      }
      signRects.current = rects;
      // (redrawn only when a sign moved: the camera still, the canvas untouched)
      if (sig === last) return;
      last = sig;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      for (const [sp, sx, sy, k] of draws) g.drawImage(sp.img, (sx - (sp.w / 2) * k) * dpr, (sy - sp.h * k) * dpr, sp.w * k * dpr, sp.h * k * dpr);
    };
    return () => { if (st.signs) st.signs = null; g.clearRect(0, 0, cv.width, cv.height); signRects.current = []; };
  }, [signs]);
  /** Show another complex in detail: the camera (or, riding it, the balloon) sets off
   * toward it at once over the current scene while its shapes load; the new model then
   * takes over centred on it, and the balloon circles its sky. */
  const goTo = (id: string) => {
    if (!near || !homeId || id === complexId) return;
    const home = id === homeId;
    const item = home ? null : near.items.find(i => i.id === id);
    if (!home && !item) return;
    const st = stageRef.current, cur = data;
    setTip(null);
    if (st && cur?.found && cur.center) {
      const [x, y] = metresFrom(cur.center, item?.lat ?? near.lat, item?.lon ?? near.lon);
      const ground = terrainRef.current.at(x, y);
      const roof = ground + (item?.floors ?? 20) * FLOOR_M + GROUND_M;
      hopRef.current = { id, from: { ...cur.center }, terrain: terrainRef.current };
      const spot = new THREE.Vector3(x, ground, -y);
      // (the balloon over the taller of the two: it never passes through a tower)
      st.balloon?.setRoute(spot, 160, Math.max(st.top, roof), true);
      const mid = spot.clone().setY(ground + (roof - ground) * 0.45);
      if (st.balloonView) st.balloonView.aim = mid;
      else flyTo(mid, Math.max(260, (roof - ground) * 3), THREE.MathUtils.clamp(Math.hypot(x, y) / 300, 1.2, 2.4));
      st.resume();
    } else hopRef.current = null;
    setHop(home ? null : { id, name: item!.name, home: homeId });
  };

  const notice = data?.found && complexId ? staleNotice(data, complexId) : null;
  const measured = data?.coverage ? data.coverage.with_height : 0;
  const total = data?.coverage ? data.coverage.buildings : 0;
  const phase = phaseLabel(sunAt(hour, undefined, center?.lat, center?.lon).elev, hour);
  function phaseCaption() { return `${formatHour(hour)} ${phase}${weather === "clear" ? "" : ` · ${weather === "rain" ? "비" : "눈"}`}`; }
  const sceneTitle = weather === "rain" ? `비 오는 ${phase}` : weather === "snow" ? `눈 내리는 ${phase}` : `${phase}의 단지 풍경`;
  const portal = (node: JSX.Element) => bigBase ? createPortal(node, document.body) : node;
  const dayTrack = useMemo(() => dayGradient(center?.lat, center?.lon), [center?.lat, center?.lon]);
  return (
    <>
    {bigBase && <div className="re-holo-slot" style={{ height: bigBase.h }} aria-hidden="true" />}
    {big && !narrow && createPortal(<div className="re-holo-resize-backdrop" aria-hidden="true" />, document.body)}
    {portal(<section ref={sectionRef} className={`re-holo${big ? " re-holo--expanded" : ""}${big && !narrow && bigSize ? " re-holo--resized" : ""}`}
      data-covers-page={coversPage || undefined}
      style={big && !narrow && bigSize ? { width: bigSize.w, height: bigSize.h } : undefined}
      role={big ? "dialog" : undefined} aria-modal={big || undefined} aria-label={big ? "단지 3D 뷰 전체화면" : "단지 3D 뷰"}>
      <header className="re-holo-head">
        <div>
          <small>{caption ?? "3D 단지뷰"}</small>
          <strong>{(hop && loading ? hop.name : data?.name) ?? complexName ?? "단지를 선택하세요"}</strong>
        </div>
        <div className="re-holo-tools">
          {big && !narrow && <button type="button" onClick={() => { resizeDrag.current = null; setBigSize(null); }}
            title="3D 뷰를 화면 전체 크기로 되돌리기">⤢ 화면 채우기</button>}
          <button type="button" aria-pressed={spin} onClick={() => setSpin(v => !v)} aria-label="자동 회전" title="360° 자동 회전">{spin ? "자동 ■" : "자동 ▶"}</button>
          {complexId && data?.found && (
            <button type="button" className="re-holo-save" onClick={() => void onSaveImage()} disabled={sharing} title="지금 3D 화면을 이미지(PNG)로 저장" aria-label="이미지 저장">
              <span aria-hidden="true">⤓</span><span className="re-holo-share-long">{sharing ? "저장 중…" : "이미지 저장"}</span>
            </button>
          )}
          {complexId && data?.found && (
            <button type="button" className="re-holo-share" onClick={() => void onShare()} title="이 3D 화면 링크를 카카오톡으로 공유 (지금 시간대·날씨 그대로)">
              <KakaoIcon /><span className="re-holo-share-long">카카오톡 공유</span><span className="re-holo-share-short">공유</span>
            </button>
          )}
          {!wide && !narrow && complexId && !big && (
            <button type="button" className="re-holo-big" onClick={openBig} title="전체화면으로 보기 (Esc로 닫기)">⤢ 전체화면</button>
          )}
        </div>
        {/* 주변 단지: a row of its own under the name and the tools (inside the name's block it
         * widened it into the tools in the narrow rail) */}
          {near && near.items.length > 0 && (
            <select className="re-holo-nearby" value={hop?.id ?? ""} onChange={e => goTo(e.currentTarget.value || homeId!)}
              // (opening the list: the first few are fetched while the reader chooses)
              onFocus={() => near.items.slice(0, 6).forEach(i => prefetchComplex(i.id))}
              aria-label="주변 아파트 단지 자세히 보기" title="주변 아파트 단지를 고르면 그 단지를 자세히 그리고, 열기구가 그 위로 옮겨 갑니다">
              <option value="">{hop ? `↩ 내 단지로 · ${near.name}` : `주변 단지 ${near.items.length}곳 보기`}</option>
              {near.items.map(i => {
                const d = Math.hypot(i.x, i.y);
                return <option key={i.id} value={i.id}>{`${i.name} · ${bearing(i.x, i.y)} ${d < 950 ? `${Math.round(d / 10) * 10}m` : `${(d / 1000).toFixed(1)}km`}`}</option>;
              })}
            </select>
          )}
      </header>
      <div className="re-holo-stage" ref={hostRef} onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp}
        onPointerCancel={e => { pointers.current.delete(e.pointerId); press.current = null; }}
        onPointerEnter={() => { hovering.current = true; }}
        onDoubleClick={e => { if (!stageRef.current?.balloonView && e.target instanceof HTMLCanvasElement) focusAt(e); }}
        onPointerLeave={e => { hovering.current = false; if (e.pointerType === "mouse" && !tip?.pinned) setTip(null); }}>
        {data?.found && !loading && !notice && <div className="re-holo-scene-label" aria-hidden="true"><span>ARCHITECTURAL VIEW</span><strong>{sceneTitle}</strong></div>}
        {hudOn && <pre ref={hudRef} style={{ position: "fixed", right: 8, bottom: 8, zIndex: 2147483647, margin: 0, padding: "6px 8px", background: "rgba(0,0,0,.65)", color: "#9f9", font: "11px/1.35 ui-monospace, monospace", pointerEvents: "none", whiteSpace: "pre" }} />}
        {notice && <p className="re-holo-stale" role="note">{notice}</p>}
        <canvas ref={signCanvas} className="re-holo-signs" aria-hidden="true" style={{ display: !loading && signs.length ? undefined : "none" }} />
        {!loading && signs.length > 0 && (
          <div className="sr-only">
            {signs.filter(sg => !sg.here).map(sg => (
              <button key={sg.id} type="button" onClick={() => goTo(sg.id)}>{`${sg.name}(으)로 이동`}</button>
            ))}
          </div>
        )}
        {failed3d && <p className="re-holo-msg">3D 화면을 불러오지 못했습니다. 브라우저 설정에서 하드웨어 가속이 켜져 있는지 확인해 주세요.{" "}
          <button type="button" className="re-holo-retry" onClick={() => location.reload()}>다시 시도</button></p>}
        {loading && <div className="re-holo-scan" role="status"><span />{dataTry ? `응답이 늦어 다시 요청하는 중입니다 (${dataTry + 1}/3)…` : slowData ? "외부 건물 자료 응답을 기다리고 있습니다. 첫 조회는 더 걸릴 수 있습니다." : "건물 윤곽 불러오는 중…"}</div>}
        {!loading && preparing && <div className="re-holo-scan" role="status"><span />장면의 조명과 재질을 준비하고 있습니다…</div>}
        {!loading && error && <p className="re-holo-msg" role="status">{error}{" "}
          <button type="button" className="re-holo-retry" onClick={() => setReloadKey(k => k + 1)}>다시 시도</button></p>}
        {balloonOn && <div className="re-holo-balloon-hint" role="status"><b>🎈 열기구에서 내려다보는 중</b><span>{touchMode ? "드래그로 둘러보기 · 두 손가락으로 확대·축소" : "드래그로 둘러보기 · 휠로 확대·축소 · Esc로 내리기"}</span></div>}
        {driving && <div className={`re-drive${driving.view === "cockpit" ? " is-cockpit" : ""}`}>
          <div ref={hudSpeedFx} className="re-drive-speedfx" aria-hidden="true" style={{ opacity: 0 }} />
          {hpWarn > 0 && !wrecked && <div className={`re-drive-vignette${hpWarn === 2 ? " is-critical" : ""}`} aria-hidden="true" />}
          {hurtKey > 0 && <div key={`hit-${hurtKey}`} className={`re-drive-hit${hp < 20 ? " is-critical" : ""}`} aria-hidden="true" />}
          {!wrecked && (hpWarn > 0 || fuelWarn > 0) && <div className="re-drive-alerts" role="alert">
            {hpWarn > 0 && <span className={hpWarn === 2 ? "is-critical" : undefined}>{hpWarn === 2 ? "⚠ 내구도 위험 — 곧 폭발합니다!" : "🔧 차량 손상 — 충돌에 주의하세요"}</span>}
            {fuelWarn > 0 && !fuelOut && <span className={fuelWarn === 2 ? "is-critical" : undefined}>{driving.name === "cyber" ? "⚡ 배터리" : "⛽ 연료"} {fuelWarn === 2 ? "거의 바닥!" : "부족"}{delivery ? " — 연료통을 찾거나 서둘러 배송하세요" : ""}</span>}
          </div>}
          {toast && <div key={`toast-${toast.n}`} className="re-drive-toast" role="status">{toast.text}</div>}
          {wrecked === "water" && <div className="re-drive-done is-wreck" role="status" aria-label="차량 침수">
            <strong>물에 빠졌습니다!</strong>
            <span className="re-drive-dest">차량이 폭발했습니다 · 출발 지점에서 다시 시작합니다</span>
          </div>}
          {wrecked && wrecked !== "water" && <div className="re-drive-done is-wreck" role="dialog" aria-label="차량 폭발">
            <strong>차량 폭발!</strong>
            <span className="re-drive-dest">{wrecked === "fuel" ? (driving.name === "cyber" ? "배터리가 바닥나 차량이 폭발했습니다" : "연료가 바닥나 차량이 폭발했습니다") : "내구도가 0이 되어 차량이 폭발했습니다"}{delivery ? ` · ${delivery.name} 배송 실패` : ""}</span>
            <dl><dt>충돌</dt><dd>{knocks}회</dd><dt>수리비</dt><dd>−{Math.min(50, goldSum)} G</dd></dl>
            <button type="button" onClick={repairVehicle}>수리·주유하고 다시 출발</button>
          </div>}
          {fuelOut && !wrecked && <div className="re-drive-dry" role="alert">{driving.name === "cyber" ? "⚡ 배터리가 바닥났습니다" : "⛽ 연료가 바닥났습니다"}</div>}
          <div className="re-drive-gauge" aria-live="off">
            <span className="re-drive-name">{driving.name === "coupang" ? "쿠팡 로켓배송 트럭" : "사이버트럭"}</span>
            <span className="re-drive-read"><span ref={hudSpeed} className="re-drive-speed">0</span><small>km/h</small></span>
            <span className="re-drive-rpm"><i ref={hudRevs} /></span>
            <span className={`re-drive-hp${hp < 20 ? " is-critical" : hp < 45 ? " is-low" : ""}`} title={`차량 내구도 ${hp}`}><em>HP</em><span><i style={{ transform: `scaleX(${hp / 100})` }} /></span><b>{hp}</b></span>
            <span className="re-drive-fuel" title={`${driving.name === "cyber" ? "배터리 (사이버트럭: 빠른 대신 더 빨리 닳습니다)" : "연료"}: 목적지 단지까지의 거리만큼 채워지고, 배송을 마치면 가득 찹니다`}><em>{driving.name === "cyber" ? "⚡" : "⛽"}</em><span><i ref={hudFuel} /></span><b ref={hudFuelText as React.RefObject<HTMLElement>} className="re-drive-fueltxt">–</b></span>
            <span className="re-drive-gear" ref={hudGear}>{driving.name === "coupang" ? "N" : "P"}</span>
          </div>
          {delivery && !result && <>
            <div className="re-drive-mission">
              <span className="re-drive-tag">배송 #{delivery.n}</span>
              <b ref={gameHud.name as React.RefObject<HTMLElement & HTMLElement>}>{delivery.name}</b>
              <span className="re-drive-row"><i>남은 거리</i><b ref={gameHud.dist as React.RefObject<HTMLElement>}>–</b></span>
              <span className="re-drive-row"><i>시간</i><b ref={gameHud.time as React.RefObject<HTMLElement>}>0:00</b></span>
              <span className="re-drive-row"><i>예상 보상</i><b className="re-drive-goldtxt"><span ref={gameHud.gold as React.RefObject<HTMLElement>}>–</span> G</b></span>
              {knocks > 0 && <span className="re-drive-row is-warn"><i>충돌</i><b>{knocks}회</b></span>}
              <button type="button" onClick={nextDelivery}>다른 배송지</button>
            </div>
            <div className="re-drive-turn"><span className="re-drive-turn-icon" ref={gameHud.turn as React.RefObject<HTMLElement>}>↑</span><span ref={gameHud.turnDist as React.RefObject<HTMLElement>}>경로 안내</span></div>
            <canvas className="re-drive-map" ref={gameHud.map} aria-label="미니맵" />
          </>}
          <div className="re-drive-wallet" title="누적 수익">🪙 <b>{goldSum.toLocaleString()}</b> G</div>
          {result && <div className="re-drive-done" role="dialog" aria-label="배송 성공">
            <div className="re-drive-coins" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ ["--i" as string]: i } as React.CSSProperties}>🪙</i>)}</div>
            <strong>배송 성공!</strong>
            <span className="re-drive-stars" aria-label={`별 ${result.stars}개`}>{"★".repeat(result.stars)}<em>{"★".repeat(3 - result.stars)}</em></span>
            <span className="re-drive-dest">{result.name} 도착</span>
            <dl>
              <dt>운행 거리</dt><dd>{result.wayM >= 1000 ? `${(result.wayM / 1000).toFixed(2)} km` : `${Math.round(result.wayM)} m`} · {Math.floor(result.secs / 60)}분 {Math.round(result.secs % 60)}초</dd>
              <dt>거리 보상</dt><dd>+{result.gold.base} G</dd>
              {result.gold.time > 0 && <><dt>시간 보너스</dt><dd>+{result.gold.time} G</dd></>}
              {result.gold.clean > 0 && <><dt>무사고 보너스</dt><dd>+{result.gold.clean} G</dd></>}
              {result.gold.penalty > 0 && <><dt>충돌 {result.knocks}회</dt><dd>−{result.gold.penalty} G</dd></>}
            </dl>
            <span className="re-drive-earned">+{result.gold.total} G</span>
            <span className="re-drive-sum">누적 {result.total.toLocaleString()} G</span>
            <button type="button" onClick={nextDelivery}>다음 배송 시작</button>
          </div>}
          <p className="re-drive-hint" role="status">
            {driving.manual
              ? (touchMode ? "◀ ▶ 조향 · 가속 / 브레이크 · 드래그로 둘러보기" : "W·↑ 가속 · Shift 부스트(연료 3배) · S·↓ 브레이크/후진 · A D·← → 조향 · Space 핸드브레이크 · H 경적 · V 시점 · M 음성안내 · Esc 끝내기")
              : (touchMode ? "가속 페달을 누르면 직접 운전합니다" : "W 또는 ↑ 를 누르면 직접 운전합니다 · V 운전석 시점")}
          </p>
          <div className="re-drive-tools">
            <button type="button" onClick={toggleDriveView}>{driving.view === "chase" ? "1인칭 운전석" : "3인칭 시점"}</button>
            <button type="button" onClick={stopFollow}>운전 끝내기</button>
          </div>
          {touchMode && <div className="re-drive-pads">
            {([["left", "◀"], ["right", "▶"]] as const).map(([k, t]) => (
              <button key={k} type="button" className={`re-drive-pad is-${k}`} aria-label={k === "left" ? "왼쪽" : "오른쪽"}
                onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pedal(k, true); }} onPointerUp={() => pedal(k, false)} onPointerCancel={() => pedal(k, false)}>{t}</button>
            ))}
            {([["down", "브레이크"], ["up", "가속"]] as const).map(([k, t]) => (
              <button key={k} type="button" className={`re-drive-pad is-${k}`}
                onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pedal(k, true); }} onPointerUp={() => pedal(k, false)} onPointerCancel={() => pedal(k, false)}>{t}</button>
            ))}
          </div>}
        </div>}
        {nickAsk && <form className="re-drive-board" role="dialog" aria-label="닉네임 입력"
          onSubmit={e => { e.preventDefault(); const n = nick.trim().slice(0, 16); if (!n) return; setPlayerName(n); recordScore(nickAsk, n); setNickAsk(null); }}>
          <strong>🏆 스코어 기록</strong>
          <span className="re-drive-board-sub">이번 운전 점수 <b>{nickAsk.score.toLocaleString()}</b>점 · 배송 {nickAsk.deliveries}건</span>
          <label>순위표에 표시할 닉네임<input autoFocus maxLength={16} value={nick} onChange={e => setNick(e.currentTarget.value)} placeholder="닉네임 (16자 이내)" /></label>
          <div className="re-drive-board-btns">
            <button type="submit" disabled={!nick.trim()}>기록하기</button>
            <button type="button" onClick={() => setNickAsk(null)}>기록하지 않기</button>
          </div>
        </form>}
        {board && !nickAsk && <div className="re-drive-board" role="dialog" aria-label="배송 게임 순위">
          <strong>🏆 배송 게임 순위</strong>
          {board.last !== undefined && <span className="re-drive-board-sub">이번 운전 <b>+{board.last.toLocaleString()}</b>점 기록</span>}
          {board.error && <p className="re-drive-board-msg">{board.error}</p>}
          {!board.data && !board.error && <p className="re-drive-board-msg">불러오는 중…</p>}
          {board.data && <>
            {board.data.top.length === 0 ? <p className="re-drive-board-msg">아직 기록이 없습니다. 첫 기록의 주인공이 되어 보세요!</p> : (
              <ol className="re-drive-board-list">
                {board.data.top.map((r, i) => (
                  <li key={i} className={r.me ? "is-me" : undefined}>
                    <span className="re-drive-board-rank">{r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</span>
                    <span className="re-drive-board-name">{r.name}</span>
                    <span className="re-drive-board-n">{r.deliveries}건</span>
                    <b>{r.score.toLocaleString()}</b>
                  </li>
                ))}
              </ol>
            )}
            <div className={`re-drive-board-me${board.data.me ? "" : " is-none"}`}>
              {board.data.me ? <>
                <span className="re-drive-board-rank">{board.data.me.rank}위</span>
                <span className="re-drive-board-name">나 · {board.data.me.name}</span>
                <span className="re-drive-board-n">{board.data.players}명 중</span>
                <b>{board.data.me.score.toLocaleString()}</b>
              </> : <span>내 기록 없음 · 배송을 마치고 운전을 끝내면 점수가 기록됩니다</span>}
            </div>
          </>}
          <div className="re-drive-board-btns"><button type="button" onClick={() => setBoard(null)}>닫기</button></div>
        </div>}
        {tip && <div className={`re-holo-tip${tip.x > tip.w * 0.55 ? " is-left" : ""}${tip.pinned ? " is-pinned" : ""}`} style={{ left: tip.x, top: tip.y }}
          role="status">{tip.text}</div>}
      </div>
      {data?.found && !failed3d && <div className="re-holo-env">
        <label className="re-holo-time">
          <span className="re-holo-time-read"><b>{formatHour(hour)}</b>{phase}
            <button type="button" className="re-holo-now" onClick={e => { e.preventDefault(); setHour(Math.round(hourNow() * 4) / 4); }} title="지금 시각으로">지금</button></span>
          <input type="range" min={0} max={24} step={0.25} value={hour} aria-label="시간대"
            aria-valuetext={`${formatHour(hour)} ${phase}`} style={{ background: dayTrack }}
            onChange={e => setHour(Number(e.currentTarget.value))} />
          <span className="re-holo-ticks" aria-hidden="true"><i>0</i><i>6</i><i>12</i><i>18</i><i>24</i></span>
        </label>
        <div className="re-holo-weather" role="radiogroup" aria-label="날씨">
          {WEATHER_ORDER.map(w => (
            <button key={w} type="button" role="radio" aria-checked={weather === w} onClick={() => setWeather(w)} title={WEATHER_LABEL[w]}>
              <i aria-hidden="true">{WEATHER_ICON[w]}</i><span>{WEATHER_LABEL[w]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="re-holo-balloon-btn" aria-pressed={balloonOn} onClick={() => (balloonOn ? leaveBalloon() : enterBalloon())}
          title={balloonOn ? "열기구에서 내려 원래 시점으로" : "열기구에 타고 단지를 내려다보기 (열기구를 눌러도 됩니다)"}>
          <i aria-hidden="true">🎈</i><span>{balloonOn ? "내리기" : "열기구"}</span>
        </button>
        {gameOn && <>
          <button type="button" className="re-holo-balloon-btn" aria-pressed={follow === "coupang"} disabled={!heroesReady} onClick={() => followHero("coupang")}
            title={follow === "coupang" ? "쿠팡 트럭 운전 끝내기" : "쿠팡 로켓배송 트럭을 지금 보는 도로로 불러와 운전하기 (W·↑ 가속, V 운전석)"}>
            <i aria-hidden="true">🚚</i><span>쿠팡트럭</span>
          </button>
          <button type="button" className="re-holo-balloon-btn" aria-pressed={follow === "cyber"} disabled={!heroesReady} onClick={() => followHero("cyber")}
            title={follow === "cyber" ? "사이버트럭 운전 끝내기" : "테슬라 사이버트럭을 지금 보는 도로로 불러와 운전하기 (W·↑ 가속, V 운전석)"}>
            <i aria-hidden="true">⚡</i><span>사이버트럭</span>
          </button>
          <button type="button" className="re-holo-balloon-btn" onClick={showBoard} title="배송 게임 순위 (모든 사용자)">
            <i aria-hidden="true">🏆</i><span>스코어</span>
          </button>
        </>}
      </div>}
      {data?.found && !failed3d && <nav className="re-holo-navigation" aria-label="3D 화면 조작">
        {/* One row of views and steps; the gestures do the rest. A mouse also gets
         * turn buttons (a finger turns by dragging anyway). */}
        <div className="re-holo-nav-row">
          <button type="button" onClick={() => navigateView("home")} title="처음 시점으로">⟲ 처음</button>
          <button type="button" onClick={() => navigateView("top")} title="위에서 내려다보기">⤓ 위에서</button>
          <button type="button" aria-label="3D 축소" title="축소" onClick={() => navigateView("out")}>−</button>
          <button type="button" aria-label="3D 확대" title="확대" onClick={() => navigateView("in")}>+</button>
          {!touchMode && <>
            <button type="button" aria-label="3D 왼쪽 회전" title="왼쪽으로 돌리기" onClick={() => navigateView("left")}>↶</button>
            <button type="button" aria-label="3D 오른쪽 회전" title="오른쪽으로 돌리기" onClick={() => navigateView("right")}>↷</button>
          </>}
        </div>
        <p>{touchMode ? "한 손가락 회전 · 두 손가락 이동·확대 · 두 번 탭: 건물로" : "드래그 회전 · 우클릭 이동 · 휠 확대 · 더블클릭: 건물로 · ←→ +− H B"}</p>
      </nav>}
      <footer className="re-holo-foot">
        <a className="re-holo-credit" href="/licenses/tidewater-MIT.txt" target="_blank" rel="noreferrer" title="렌더링 엔진 MIT 라이선스">MIT</a>
        {data?.found ? (
          <>
            <span>건물 {total}개 · 층수·높이 확인 {measured}개{total > measured ? ` · ${data.source === "vworld" ? "층수 미등록 부대시설" : "높이 추정"} ${total - measured}개` : ""}</span>
            <span>{data.source === "vworld" ? "건물 윤곽·높이: " : "건물 윤곽: "}{data.attribution}. 도로: 국가기본도 도로중심선 · 지형: {terrainSource ?? "평지(지형 자료 없음)"}{data.vworld_key ? " · 토지이용: 연속지적도 지목" : ""}. 외벽·창호·조경·가로수·보행자·차량은 표현용</span>
          </>
        ) : <span>{touchMode ? "한 손가락으로 돌리고 두 손가락으로 확대·이동, 건물을 탭하면 동·층수를 봅니다." : "드래그로 회전, 휠로 커서 쪽 확대, 우클릭 드래그로 이동합니다. 지도에서 단지를 누르면 바뀝니다."}</span>}
      </footer>
      {big && <button type="button" className="re-holo-wide-close" onClick={closeBig} aria-label="전체화면 닫기" title="닫기 (Esc)">×</button>}
      {big && !narrow && <button type="button" className="re-holo-resize" aria-label="3D 뷰 크기 조절"
        title="드래그로 화면 크기 조절 · 방향키로 조절 · 두 번 클릭으로 화면 채우기"
        onPointerDown={e => {
          if (e.button !== 0) return;
          e.preventDefault(); e.stopPropagation();
          e.currentTarget.focus();
          const rect = sectionRef.current!.getBoundingClientRect();
          resizeDrag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={e => {
          const drag = resizeDrag.current;
          if (!drag || drag.id !== e.pointerId) return;
          // The panel stays centered, so each corner moves half the size change.
          setBigSize(fitBigSize(drag.w + 2 * (e.clientX - drag.x), drag.h + 2 * (e.clientY - drag.y)));
        }}
        onPointerUp={e => {
          if (resizeDrag.current?.id !== e.pointerId) return;
          resizeDrag.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => { resizeDrag.current = null; }}
        onLostPointerCapture={() => { resizeDrag.current = null; }}
        onDoubleClick={() => setBigSize(null)}
        onKeyDown={e => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation();
          const rect = sectionRef.current!.getBoundingClientRect(), step = e.shiftKey ? 80 : 20;
          setBigSize(fitBigSize(rect.width + (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0),
            rect.height + (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0)));
        }}><span aria-hidden="true">◢</span></button>}
    </section>)}
    {shareStage !== "idle" && (
      <OnScreen>
        <div className="kospi-map-share-backdrop re-holo-share-layer" onClick={() => setShareStage("idle")} />
        <div className="kospi-map-share-popover is-centered re-holo-share-layer" role="status">
          <button type="button" className="kospi-map-share-popover-close" onClick={() => setShareStage("idle")} aria-label="닫기">×</button>
          <p>3D 화면 링크가 복사되었습니다. 카카오톡 채팅창에 Ctrl+V로 붙여넣어 주세요.</p>
        </div>
      </OnScreen>
    )}
    </>
  );
}
