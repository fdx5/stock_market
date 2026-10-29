import {filterPlanting,plantingWaterMask} from './plantingWater';
import * as THREE from "three";
import {DronePlaces,PlaceFootprints} from './sceneCommercialPlaces';
import {observedRoofColour,type BuildingAppearance} from "./buildingAppearance";
import {bridgeNameLabels} from './bridgeNames';
import {droneDetailPriority,droneTilePriority} from "./droneLoadPriority";
import {packedRoadGuard,packedSourceGuard,type NearBuildingSource,type NearBuildingTarget} from './nearBuildingTargets';
import { SceneWorkerPool } from "./sceneWorkerPool";
import type {TerrainGridJob} from './terrainGrid';
import {anchoredTerrainHeight} from './terrainGrid';
import type {TerrainGridResult} from './terrainGridWorker';
import { CoastGeometryJobs } from './coastGeometryJobs';
import {staticSceneTransforms} from './staticSceneTransforms';
import type { RealEstateBuildingsResponse, RealEstateParcel } from "../api/client";
import { buildWater, type WaterField } from "./sceneWater";
import { sceneWork } from "./sceneWorkerClient";
import { buildSeaWorks } from "./sceneSeaWorks";
import { Landmarks, LANDMARK_SITES, type LandmarkSite } from "./sceneLandmarks";
import { ringTile, SURVEY_STYLES, type DroneLabel, type RingResult } from "./ringBuildings";
import type { ColourJob, ColourResult, SurveyJob, SurveyResult } from "./droneSurveyWorker";
import {SurveyGeometryStore} from './surveyGeometryStore';
import { roadTile } from "./droneRoads";
import {fitTileStreetSurfaces} from './tileStreetSurfaces';
import {lowerUnderRiver,type RiverLowerArgs,type RiverLowerResult} from './riverLower';
import { DroneTraffic } from "./droneTraffic";
import { farGround } from "./farGround";
import { vworldSampler, type Terrain } from "./sceneTerrain";
import { gridAt } from "./waterCore";
import { CONTEXT_FLOOR_M, seasonGround, sharedContextMaterial, sharedContextTexturesSliced, type ContextStyle, type Planting } from "./complexScene";
import { buildPlants } from "./scenePlants";
import {jamsilTreeMask,withoutStadiumTrees} from './stadiumPlanting';
import { frameSlice } from "./frameSlice";
import { textureBudgetEnabled } from "./textureBudget";
import {paintedTexture} from './paintedTexture';
import { SeaCoverage, seaOutsideBox } from './coastGeometry';
import { bridgeTileLanes } from './bridgeDeck';
import { PlantPool, groveLeavesLod } from './dronePlantPool';
import { structureChains } from './bridgeChains';

/* The drone's world past the view's own neighbourhood (ComplexHologram: the complex, its 600 m
 * ring of buildings and the ±680 m land-use ground). Fixed square tiles of TILE_M, in the view's
 * frame (metres east / north of the complex, heights from its ground), each made the way the view
 * makes its neighbourhood — the same generators, so the same look:
 *   - relief: VWorld's national DEM (국토지리정보원), the same posts the view's ground samples
 *     (sceneTerrain.vworldSampler), so neighbouring tiles meet exactly;
 *   - buildings: every registered building (국토교통부 GIS건물통합정보) whose centroid is in the
 *     tile, extruded in a worker in the shared neighbourhood facades (ringBuildings.ringTile);
 *   - ground: the parcels in their registered land use (연속지적도 지목), painted in a worker
 *     (farGround.ts), with its park and woodland trees (scenePlants).
 *   - sea: the coastline's sea (bundled on the server, /api/realestate/water), the view's own
 *     water surface — swell, surf, its depth over the sand — at sea level, the ground under it
 *     sunk below it; not inside the view's square (its own water is there).
 * The tiles inside the view's own square draw only what it does not (the ring's corners past
 * 600 m) and give the collision roofs. Loading runs ahead of the drone: by distance from where it
 * will be in a few seconds, more tiles the higher it flies. `clearAhead` tells the flight how far
 * along a direction everything is on screen — the flight keeps 300 m of it ahead (droneFlight.ts).
 *
 * Palace courtyards also receive the requested earth, lawn and flower garden treatment.
 * Where VWorld does not answer, a tile stays empty and is retried. */

export const TILE_M = 340;
/** The coarse sea laid round the drone at once (see regionSea), half a side (m). */
const REGION_SEA = 3000;
/** The view's own neighbourhood: buildings out to RING_M (a disc), land use over ±FAR_HALF. */
export type ViewExtent = { ring: number; farHalf: number };
export type DroneViewBuildings = { ring: RingResult; group: THREE.Group; styles: Partial<Record<ContextStyle, THREE.BufferGeometry>>;roadGuard?:NearBuildingSource['roadGuard'] };

type Roofs = NonNullable<RingResult["roofs"]>;
type TileGrid = { h: Float32Array; n: number; R: number; cell: number; ox: number; oy: number };
type Tile = {
  view?: boolean;
  near?:NearBuildingTarget[];
  nearObjects?:THREE.Object3D[];
  nearRoadGuard?:NearBuildingSource['roadGuard'];
  i: number; j: number; key: string; box: [number, number, number, number]; cx: number; cy: number;
  /** Inside the view's own land-use square: no ground of its own. */
  inner: boolean;
  state: "queued" | "loading" | "placed" | "ready" | "failed";
  tries: number; retryAt: number;
  grid: TileGrid | null; at: ((x: number, y: number) => number) | null;
  roofs: Roofs | null;
  zup: THREE.Group | null; yup: THREE.Group | null;
  materials: THREE.Material[]; dispose: (() => void)[];
  stop: AbortController;
  startedAt: number; readyAt: number;
  /** Its trees (park and woodland), kept to be planted while the drone is within PLANT_R. */
  planting: Planting | null; local: Terrain | null;
  plants: { state: "building" | "placed" | "ready"; group: THREE.Group | null; materials: THREE.Material[]; dispose: () => void } | null;
  /** Its towers (RingResult.towers) and the style meshes they sit in, for their surveyed shapes. */
  towers: Float32Array | null; styleGeo: Partial<Record<ContextStyle, THREE.BufferGeometry>>;
  buildingGroup?: THREE.Group;
  survey: "none" | "running" | "placed" | "ready" | "unavailable";
  surveyHidden?: Set<string>;
  /** A missing/failed model waits with backoff; it never completes the building.
   * Other records can continue instead of twelve failures blocking the tile. */
  surveyDeferred?:Map<string,{at:number;tries:number}>;
  surveyPaint?: { geo: THREE.BufferGeometry; spans: Uint32Array }[];
  surveyGeos?:THREE.BufferGeometry[];
  surveyStore?:SurveyGeometryStore;
  surveyUndo?: { geo: THREE.BufferGeometry; start: number; indices: Uint32Array }[];
  surveyRetryAt?: number; surveyTries?: number; colourRetryAt?: number; colourTries?: number;
  colourVersion?:number;
  /** its buildings' vertex spans and outlines (RingResult.spans), and their aerial colours' state */
  spans?: Float32Array; spanRings?: number[][][]; appearances?:(BuildingAppearance|undefined)[]; colour?: "running" | "done";
  /** its lane paint (true to size, broad) and how many bridges */
  marks?: (THREE.Mesh | null)[]; bridges?: number;
  /** its fine parts, not drawn far off (FINE_R) */
  fine?: THREE.Mesh[];
  /** the live traffic layer's bands (setTraffic colours them): the mesh, each vertex's link, the links */
  traffic?: { mesh: THREE.Mesh; link: Uint16Array; ids: string[]; highway: boolean[]; shown: number; dirty: boolean };
  /** its sidewalks' middle lines ([n, x, y, …]…), for the people */
  walkPaths?: Float32Array;
  /** its lanes for the traffic (droneRoads) */
  lanes?: Float32Array;
  baseLanes?: Float32Array;
  /** its lanes' signal stop lines (droneRoads: per lane in baseLanes order) */
  stops?: Float32Array;
  banks?: Float32Array;
  /** whether its buildings and its trees cast shadows now */
  castB: boolean; castP: boolean;
  surveyGroup: THREE.Group | null;
  /** its water as the server had it (asked before the rest; undefined: not yet asked) */
  seaBody?: SeaBody | null;
  plantWater?:((x:number,y:number)=>boolean);
  riverField?:WaterField;
};
type SeaBody = { rings?: { ring: [number, number][]; kind: string; islands?: [number, number][][] }[]; beaches?: { ring: [number, number][] }[]; works?: { kind: string; closed: boolean; pts: [number, number][] }[] };
/** A ring cut to an axis-aligned box (Sutherland–Hodgman; a concave ring leaving and coming back
 * keeps a seam along the box's edge, harmless to the fill). */
function clipToBox(ring: [number, number][], [x0, y0, x1, y1]: [number, number, number, number]): [number, number][] {
  let pts = ring;
  const edges: [(p: [number, number]) => boolean, (a: [number, number], b: [number, number]) => [number, number]][] = [
    [p => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / ((b[0] - a[0]) || 1e-9)]],
    [p => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / ((b[0] - a[0]) || 1e-9)]],
    [p => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / ((b[1] - a[1]) || 1e-9), y0]],
    [p => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / ((b[1] - a[1]) || 1e-9), y1]],
  ];
  for (const [inside, cross] of edges) {
    if (!pts.length) break;
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + pts.length - 1) % pts.length];
      if (inside(p)) { if (!inside(q)) out.push(cross(q, p)); out.push(p); }
      else if (inside(q)) out.push(cross(q, p));
    }
    pts = out;
  }
  return pts;
}
export type DroneWorldStats = { tiles: number; ready: number; loading: number; failed: number; buildings: number; lastMs: number; radius: number; detailReady: number; detailRunning: number; detailPending: number; detailUnavailable: number; detailMatched: number; detailUnmatched: number; workerPending: number };

const key = (i: number, j: number) => `${i},${j}`;
/** numbers per tower in RingResult.towers */
const TOWER = 9;
/** Shadows off for everything under `root`, or back to what each mesh cast before. */
const castShadows = (root: THREE.Object3D, on: boolean) => root.traverse(o => {
  if (!(o as THREE.Mesh).isMesh) return;
  o.userData.castWas ??= o.castShadow;
  o.castShadow = on && o.userData.castWas;
});
/** Trees are planted on the tiles within this distance of the drone (past it a tree is a dot in the
 * haze; the land use underneath stays green), and kept until 400 m beyond. Within PLANT_NEED, a tile
 * counts as on screen only with its trees. */
const PLANT_R = { hq: 1050, lite: 700 }, PLANT_NEED = 700;
/** The towers in their surveyed shapes (VWorld's 3D models: the real plan, setbacks, rooftop rooms)
 * on the tiles within this distance; kept once made. */
const SURVEY_R = { hq: 800, lite: 500 }, SURVEY_NEED = 600;
/** Past this distance a tile's fine parts — sidewalks, bridge railings and piers, the true-to-size
 * lane paint — are not drawn (each under a pixel there; the broad lane paint stands in). */
const FINE_R = 700;
/** Shadows are cast by the buildings within this distance of the drone and by trees within
 * TREE_SHADOW (past them a shadow is a few pixels in the haze; each caster costs a draw in every
 * shadow cascade it reaches). */
const BUILDING_SHADOW = 700, TREE_SHADOW = 350;
/** Each building's colours from the aerial photographs (roof, facade) on the tiles within this
 * distance — before their towers take their surveyed shapes, which keep the colour they find. */
const COLOUR_R = { hq: 600, lite: 400 };
/** (?dronecolour=0: without them, for comparing) */
const OFF = typeof location !== "undefined" ? (new URLSearchParams(location.search).get("droneoff") ?? "").split(",") : [];
const DTRACE = typeof location !== "undefined" && location.search.includes("dtrace=1");
const NO_COLOUR = typeof location !== "undefined" && (new URLSearchParams(location.search).get("dronecolour") === "0" || OFF.includes("colour"));
const distToBox = (x: number, y: number, b: [number, number, number, number]) =>
  Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]));

export class DroneWorld {
  readonly root = new THREE.Group();
  private tiles = new Map<string, Tile>();
  private viewTiles = new Map<string, Tile>();
  private adoptedView: DroneViewBuildings | null = null;
  private adoptedNear:NearBuildingSource|null=null;
  private base: number | null = null;
  private baseJob: Promise<number | null> | null = null;
  private loading = 0;
  private disposed = false;
  private slice = performance.now();
  /** While the flight is held back by what is still loading ahead (set every frame by the drone):
   * the tile work's slice (ms), let in first, once a frame. Otherwise 0: under load the ordinary
   * queue let in one 1 ms slice per 100 ms — on a slow laptop a tile's road fitting and river took
   * 20-60 s, the drone standing still for it. */
  holding = 0;
  private buildings = 0;
  private lastMs = 0;
  private radius = 900;
  private planting = 0;
  private surveying = 0;
  private shadowCheck = 0;
  private surveyRankAt = -Infinity;
  private chainsAt = -Infinity;
  private surveyFreeWas = 0;
  /** Cores, bands and end walls of the surveyed towers: one material for every tile. */
  private plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  /** The roads (droneRoads): asphalt and lane paint, one material each for every tile. */
  private asphalt = new THREE.MeshStandardMaterial({ color: "#3d4045", roughness: 0.9, metalness: 0 });
  private asphaltMap:THREE.Texture|null=null;
  private paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, emissive: "#ffffff", emissiveIntensity: 0.12 });
  /** Bridge slabs, parapets and piers. */
  private concrete = new THREE.MeshStandardMaterial({ color: "#b9b6ae", roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  /** A tunnel's bore past its portal (the portal itself: concrete). */
  private bore = new THREE.MeshStandardMaterial({ color: "#101213", roughness: 1, metalness: 0, side: THREE.DoubleSide });
  /** The live traffic layer's bands: each vertex coloured by its link's speed (setTraffic). */
  private trafficMat = new THREE.MeshStandardMaterial({ color: "#ffffff", vertexColors: true, roughness: .55, metalness: 0, emissive: "#000000" });
  /** speeds by standard link ID (km/h), and whether the layer is on */
  private trafficSpeeds: Map<string, number> | null = null;
  private trafficOn = false;
  /** Sidewalk paving and kerbs. */
  private paving = new THREE.MeshStandardMaterial({ color: "#a7a39b", roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  /** The cars on them. */
  readonly traffic: DroneTraffic;
  /** the tiles' woodland, pooled by cell (dronePlantPool) */
  private plantPool!: PlantPool;
  private treeLod = false;
  readonly landmarks: Landmarks;
  private places:DronePlaces;
  private placeFootprints=new PlaceFootprints();
  private readonly kx: number;
  private readonly ky = 110540;
  private readonly season = seasonGround(undefined, textureBudgetEnabled());
  private readonly coastJobs = new CoastGeometryJobs();
  private readonly terrainJobs=new SceneWorkerPool<TerrainGridJob,TerrainGridResult>(()=>new Worker(new URL('./terrainGridWorker.ts',import.meta.url),{type:'module'}),2,15000);
  private readonly seaCoverage = new SeaCoverage((g,b,m,s,c) => this.coastJobs.cut(g,b,m,false,s,c));
  private seaCoverageAt = 0;
  private scheduleAt = -Infinity;
  private scheduleX = Infinity; private scheduleY = Infinity;
  private aheadX=0;private aheadY=0;private viewAheadX=0;private viewAheadY=0;private scheduleLook?:[number,number];

  constructor(private readonly o: {
    data: RealEstateBuildingsResponse; terrain: Terrain; extent: ViewExtent; seed: number; hq: boolean;
    addWarm: (parent: THREE.Object3D, obj: THREE.Object3D) => void;
    drawReady: (obj: THREE.Object3D) => boolean;
    forget?: (materials: Set<THREE.Material>) => void;
    /** where the view's own trees stand (view frame): on the collision grid of its tiles */
    viewTrees?: () => [number, number][];
    viewBuildings?: () => DroneViewBuildings | undefined;
    nearBuildings?: () => NearBuildingSource | undefined;
    viewWater?: () => THREE.Mesh[];
    onSeaReady?: (field: WaterField) => void;
    /** a tile's signs (null: gone) */
    onLabels?: (tile: string, labels: DroneLabel[] | null) => void;
  }) {
    this.kx = Math.cos((o.data.center!.lat * Math.PI) / 180) * 111320;
    this.root.name = "drone world";
    // (its workers made now, ahead of the tiles' downloads: their scripts are not queued behind them)
    this.terrainJobs.warm();
    this.root.matrixAutoUpdate = false;
    // (WebGPU: the same asphalt grain as the view's road surfaces)
    this.asphalt.userData.groundDetail = true;
    void paintedTexture('asphalt',1024).then(map=>{if(this.disposed){map.dispose();return;}this.asphaltMap=map;this.asphalt.map=map;this.asphalt.color.set('#ffffff');this.asphalt.needsUpdate=true;});
    this.traffic = new DroneTraffic(o.seed + 31, !o.hq);
    this.root.add(this.traffic.group);
    // (a phone: its far woodland in the lighter leaf levels; ?treelod=0 the comparison path)
    this.treeLod = !o.hq && !/[?&]treelod=0/.test(location.search);
    this.plantPool = new PlantPool({ addWarm: o.addWarm, lod: this.treeLod });
    this.root.add(this.plantPool.root);
    // The landmarks: the palaces and stadiums in VWorld's photo-textured models, 광안대교 built.
    this.landmarks = new Landmarks({
      key: o.data.vworld_key!, lat0: o.data.center!.lat, lon0: o.data.center!.lon, hq: o.hq,
      groundAt: (x, y) => this.groundAt(x, y),
      // (the sea, 0 m on the national DEM: −base in the view frame)
      seaLevel: () => { void this.baseHeight(); return this.base === null ? null : -this.base; },
      addWarm: o.addWarm, forget: o.forget,
      onPlaced: site => { for (const t of this.tiles.values()) this.hideInSite(t, site); },
      onBridgePlaced: () => { for (const t of this.tiles.values()) if (t.state === 'placed' || t.state === 'ready') this.bridgeTraffic(t); },
    });
    this.root.add(this.landmarks.root);
    this.placeFootprints.set('initial',[...o.data.buildings,...o.data.context].map(b=>b.rings[0]));
    this.places=new DronePlaces({lat:o.data.center!.lat,lon:o.data.center!.lon,
      groundAt:(x,y)=>this.groundAt(x,y),roofAt:(x,y)=>this.registeredRoofAt(x,y),
      covered:r=>this.placeFootprints.covered(r),addWarm:o.addWarm,forget:o.forget,onLabels:o.onLabels});
    this.root.add(this.places.root);
  }

  /** One millisecond continuations admitted after drawing, with a bounded
   * frame budget and starvation protection supplied by frameSlice. */
  private async pace(force = false) {
    if (force || performance.now() - this.slice > (this.holding || 1)) { await frameSlice(6, this.holding > 0); this.slice = performance.now(); }
    return !this.disposed;
  }

  private tileAt(x: number, y: number) { return this.tiles.get(key(Math.floor(x / TILE_M), Math.floor(y / TILE_M))); }

  /** Ground height (view frame): the ground drawn there — in the view's land-use square its own
   * relief (the tiles' grids under it are not drawn, and on a mountain stood up to 60 m off it: the
   * drone's height read that much wrong), past it the tile's, else the view's. */
  groundAt(x: number, y: number): number {
    const H = this.o.extent.farHalf;
    if (Math.abs(x) <= H && Math.abs(y) <= H) return this.o.terrain.at(x, y);
    const t = this.tileAt(x, y);
    return t?.at ? t.at(x, y) : this.o.terrain.at(x, y);
  }
  /** The highest roof over (x, y) — from the tile's collision grid — or -1e4 where none. */
  /** the road deck under (x, y), if a lane is there (a bridge, a ramp, an overpass: not the ground under it) */
  roadZ(x: number, y: number): number | null { const l = this.lanePointNear(x, y, 8); return l && l.d < l.w / 2 + 1.2 ? l.z : null; }
  /** the surveyed outline of the building at (x, y) (view frame), if one stands there */
  buildingRingAt(x: number, y: number): [number, number][] | null { return this.placeFootprints.ringAt(x, y); }
  roofAt(x: number, y: number): number {
    return Math.max(this.registeredRoofAt(x,y),this.places.roofAt(x,y));
  }
  private registeredRoofAt(x:number,y:number):number {
    const r = this.tileAt(x, y)?.roofs;
    if (!r) return -1e4;
    const i = Math.floor((x - r.x0) / r.cell), j = Math.floor((y - r.y0) / r.cell);
    return i < 0 || j < 0 || i >= r.nx || j >= r.ny ? -1e4 : r.h[j * r.nx + i];
  }
  /** Whether a tile `d` m from the drone is fully on screen: its buildings and ground, and near
   * the drone its trees too. */
  private shown(t: Tile, _d: number) {
    // (what holds the drone back: the tile's buildings, ground, roads and lane paint. The trees and
    // the towers' surveyed shapes come in over it as it flies, nearest first.)
    return t.state === "ready";
  }
  /** The distance from (x, y) to the nearest tile not yet fully on screen within `max` (m). */
  nearestUnready(x: number, y: number, max: number): number {
    let d = max;
    for (const t of this.tiles.values()) { const b = distToBox(x, y, t.box); if (!this.shown(t, b)) d = Math.min(d, b); }
    // (tiles not even made yet: anything past the loading radius)
    return Math.min(d, this.radius);
  }
  /** How far from (x, y) everything ahead — the half of the world in front along (dx, dy), a
   * unit vector, the sides included — is on screen, up to `max`: the nearest tile not yet on
   * screen there (or the edge of what is loading). */
  clearAhead(x: number, y: number, dx: number, dy: number, max: number): number {
    let d = Math.min(max, this.radius);
    for (const t of this.tiles.values()) {
      const b = distToBox(x, y, t.box);
      if (b >= d || this.shown(t, b)) continue;
      // (in front: any part of the tile past the line through the drone across its flight)
      const ahead = Math.max((t.box[0] - x) * dx, (t.box[2] - x) * dx) + Math.max((t.box[1] - y) * dy, (t.box[3] - y) * dy);
      if (ahead < 0) continue;
      d = b;
    }
    // (and where no tile has been made yet: along the flight itself)
    for (let s = 0; s <= d; s += 20) if (!this.tileAt(x + dx * s, y + dy * s)) return s;
    return d;
  }
  /** The nearest point on a lane's centre line within `r` of (x, y) (view frame), its direction
   * and the lane's width — where a walker set down by the road stands beside it. */
  lanePointNear(x: number, y: number, r: number): { x: number; y: number; z: number; dx: number; dy: number; w: number; d: number } | null {
    let best: { x: number; y: number; z: number; dx: number; dy: number; w: number; d: number } | null = null, bd = r;
    for (const t of this.tiles.values()) {
      const lanes = t.baseLanes; if (!lanes || distToBox(x, y, t.box) > r) continue;
      for (let o = 0; o < lanes.length;) {
        const n = lanes[o], w = lanes[o + 1], at = o + 2;
        for (let i = 1; i < n; i++) {
          const ax = lanes[at + i * 3 - 3], ay = lanes[at + i * 3 - 2], bx = lanes[at + i * 3], by = lanes[at + i * 3 + 1];
          const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey; if (L2 < .01) continue;
          const u = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)), px = ax + ex * u, py = ay + ey * u, d = Math.hypot(px - x, py - y);
          if (d < bd) { bd = d; const L = Math.sqrt(L2), az = lanes[at + i * 3 - 1], bz = lanes[at + i * 3 + 2]; best = { x: px, y: py, z: az + (bz - az) * u, dx: ex / L, dy: ey / L, w, d }; }
        }
        o = at + n * 3;
      }
    }
    return best;
  }
  /** The nearest lane centre line within `r` of (x, y) (view frame): its direction, how far off
   * (signed: + to the lane's left), and the lane's width. */
  laneNear(x: number, y: number, r: number): { dx: number; dy: number; d: number; side: number; w: number } | null {
    let best: { dx: number; dy: number; d: number; side: number; w: number } | null = null, bd = r;
    for (const t of this.tiles.values()) {
      const lanes = t.baseLanes; if (!lanes || distToBox(x, y, t.box) > r) continue;
      for (let o = 0; o < lanes.length;) {
        const n = lanes[o], w = lanes[o + 1], at = o + 2;
        for (let i = 1; i < n; i++) {
          const ax = lanes[at + i * 3 - 3], ay = lanes[at + i * 3 - 2], bx = lanes[at + i * 3], by = lanes[at + i * 3 + 1];
          const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey; if (L2 < .01) continue;
          const u = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)), d = Math.hypot(ax + ex * u - x, ay + ey * u - y);
          if (d < bd) { bd = d; const L = Math.sqrt(L2); best = { dx: ex / L, dy: ey / L, d, side: Math.sign(ex * (y - ay) - ey * (x - ax)) || 1, w }; }
        }
        o = at + n * 3;
      }
    }
    return best;
  }
  /** The sidewalks' middle lines on the tiles within `r` of (x, y) (view frame). */
  walkPathsNear(x: number, y: number, r: number): Float32Array[] {
    const out: Float32Array[] = [];
    for (const t of this.tiles.values()) if (t.walkPaths && t.state === "ready" && distToBox(x, y, t.box) < r) out.push(t.walkPaths);
    return out;
  }
  /** The loading radius's share the memory allows (1 normally): a device of 4 GB or less starts at
   * 0.7; with the page's script memory over 65 % of its limit it steps down (and the tiles past the
   * smaller radius go), under 50 % it steps back up — the page never runs out of memory. */
  private memScale = typeof navigator !== "undefined" && ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4 ? 0.7 : 1;
  private memAt = 0;
  private memoryScale() {
    const now = performance.now();
    if (now - this.memAt > 1000) {
      this.memAt = now;
      const m = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      if (m && m.jsHeapSizeLimit > 0) {
        const use = m.usedJSHeapSize / m.jsHeapSizeLimit;
        if (use > 0.65) this.memScale = Math.max(0.45, this.memScale - 0.1);
        else if (use < 0.5) this.memScale = Math.min(this.memCap(), this.memScale + 0.02);
      }
    }
    return this.memScale;
  }
  private memCap() { return typeof navigator !== "undefined" && ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4 ? 0.7 : 1; }
  /** How much later a tile comes for being out of the camera's view (m in the queue). */
  private offView(t: Tile, x: number, y: number, look?: [number, number]) {
    if (!look) return 0;
    const cx = t.cx - x, cy = t.cy - y, cl = Math.hypot(cx, cy);
    if (cl < TILE_M) return 0;
    const c = (cx * look[0] + cy * look[1]) / cl;
    return c > 0.64 ? 0 : 3000 * (1 - c);
  }
  /** How far round the drone tiles are loaded now (m). */
  get reach() { return this.radius; }
  private liveTile(t: Tile) { return this.tiles.get(t.key) === t || this.viewTiles.get(t.key) === t; }
  private adoptViewBuildings() {
    const view = this.o.viewBuildings?.();
    if (!view || view === this.adoptedView || !view.ring.towers || !view.ring.spans || !view.ring.spanRings) return;
    for (const [k,t] of this.viewTiles) if(!t.near){t.stop.abort();this.clear(t);this.viewTiles.delete(k);}
    this.adoptedView = view;
    this.placeFootprints.set('view',view.ring.footprints,()=>this.o.drawReady(view.group));
    const buckets = new Map<string, { i: number; j: number; towers: number[]; spans: number[]; rings: number[][][]; appearances:(BuildingAppearance|undefined)[]; sources: Map<number,number> }>();
    const towers = view.ring.towers, spans = view.ring.spans, rings = view.ring.spanRings;
    for (let k = 0; k < towers.length; k += TOWER) {
      const style = SURVEY_STYLES[towers[k+6]], index = view.styles[style]?.index;
      if (!index || !Array.from(index.array.slice(towers[k+4], towers[k+4]+3)).some(v => v !== 0)) continue;
      const i = Math.floor(towers[k]/TILE_M), j = Math.floor(towers[k+1]/TILE_M), id = key(i,j);
      let b = buckets.get(id);
      if (!b) buckets.set(id, b = { i, j, towers: [], spans: [], rings: [], appearances:[],sources: new Map() });
      const source = towers[k+7]; let outline = b.sources.get(source);
      if (outline === undefined) { outline = b.rings.length; b.sources.set(source, outline); b.rings.push(rings[source]);b.appearances.push(view.ring.appearances?.[source]); for (let n = 0; n < 5; n++) b.spans.push(spans[source*5+n]); }
      for (let n = 0; n < TOWER; n++) b.towers.push(n === 7 ? outline : towers[k+n]);
    }
    for (const b of buckets.values()) {
      const zup = new THREE.Group(); zup.rotation.x = -Math.PI/2; zup.name = `drone view tile ${b.i},${b.j}`;
      const t: Tile = { view:true,nearRoadGuard:view.roadGuard, i:b.i,j:b.j,key:'view:'+key(b.i,b.j),box:[b.i*TILE_M,b.j*TILE_M,(b.i+1)*TILE_M,(b.j+1)*TILE_M],cx:(b.i+.5)*TILE_M,cy:(b.j+.5)*TILE_M,
        inner:true,state:'ready',tries:0,retryAt:0,grid:null,at:null,roofs:null,zup,yup:null,materials:[],dispose:[],stop:new AbortController(),startedAt:0,readyAt:0,planting:null,local:null,plants:null,
        towers:new Float32Array(b.towers),styleGeo:view.styles,buildingGroup:view.group,survey:'none',surveyGroup:null,castB:true,castP:false,spans:new Float32Array(b.spans),spanRings:b.rings,appearances:b.appearances };
      this.viewTiles.set(t.key,t); this.o.addWarm(this.root,zup);
    }
  }
  private adoptNearBuildings(){
    const source=this.o.nearBuildings?.();if(!source||source===this.adoptedNear)return;
    for(const [k,t] of this.viewTiles)if(t.near){t.stop.abort();this.clear(t);this.viewTiles.delete(k);}
    this.adoptedNear=source;
    const buckets=new Map<string,NearBuildingTarget[]>();
    for(const target of source.targets){const k=key(Math.floor(target.x/TILE_M),Math.floor(target.y/TILE_M));let list=buckets.get(k);if(!list)buckets.set(k,list=[]);list.push(target);}
    for(const [k,near] of buckets){const [i,j]=k.split(',').map(Number),zup=new THREE.Group();zup.rotation.x=-Math.PI/2;
      const towers=new Float32Array(near.flatMap((b,n)=>[b.x,b.y,b.height,b.ground,n,0,Math.max(0,SURVEY_STYLES.indexOf(b.appearance.style as ContextStyle)),n,0]));
      const t:Tile={view:true,near,nearObjects:source.objects,nearRoadGuard:source.roadGuard,i,j,key:'near:'+k,box:[i*TILE_M,j*TILE_M,(i+1)*TILE_M,(j+1)*TILE_M],cx:(i+.5)*TILE_M,cy:(j+.5)*TILE_M,
        inner:true,state:'ready',tries:0,retryAt:0,grid:null,at:null,roofs:null,zup,yup:null,materials:[],dispose:[],stop:new AbortController(),startedAt:0,readyAt:0,planting:null,local:null,plants:null,
        towers,styleGeo:{},survey:'none',surveyGroup:null,castB:true,castP:false,spanRings:near.map(b=>b.outline),appearances:near.map(b=>b.appearance)};
      this.viewTiles.set(t.key,t);this.o.addWarm(this.root,zup);
    }
  }
  // CPU footprints/colours are sufficient to start the network workers. Waiting
  // for coarse GPU uploads delays the measured model until after first sight.
  // Replacement still waits for its own complete GPU readiness in surveyTile.
  private buildingReady(t:Tile){return t.nearObjects?t.nearObjects.every(o=>!!o.parent):!!t.buildingGroup?.parent;}
  /** A tile centre can sit behind the camera while its unprocessed apartments
   * are in front. Rank the next eligible building, not the tile's fixed centre;
   * completed/deferred neighbours cannot hold the visible corridor back. */
  private surveyPriority(t:Tile,x:number,y:number,ax:number,ay:number,lx:number,ly:number,look:[number,number]|undefined,now:number){
    const a=t.towers!,range=this.o.hq?SURVEY_R.hq:SURVEY_R.lite;let best=Infinity;
    for(let i=0;i<a.length;i+=TOWER){const id=a[i+6]+':'+a[i+4];
      if(t.surveyHidden?.has(id)||(t.surveyDeferred?.get(id)?.at??0)>now)continue;
      const dx=a[i]-x,dy=a[i+1]-y,d=Math.hypot(dx,dy),visible=!!look&&(dx*look[0]+dy*look[1])/Math.max(1,d)>.35;
      // The viewing/travel buffers already have visible coarse buildings past
      // the radius centred on the drone. They also need detail: the old radius
      // test left those rendered buildings permanently in the coarse state.
      if(Math.min(d,Math.hypot(a[i]-ax,a[i+1]-ay),Math.hypot(a[i]-lx,a[i+1]-ly))>range&&!visible)continue;
      best=Math.min(best,droneDetailPriority(a[i],a[i+1],t.appearances?.[a[i+7]]?.floors??Math.round(a[i+2]/3),x,y,ax,ay,look));
    }
    return best;
  }
  stats(): DroneWorldStats {
    let ready = 0, failed = 0, detailReady = 0, detailRunning = 0, detailPending = 0, detailUnavailable = 0, detailMatched = 0, detailUnmatched = 0;
    for (const t of this.tiles.values()) {
      if (t.state === "ready") ready++; else if (t.state === "failed") failed++;
    }
    for (const t of [...this.tiles.values(), ...this.viewTiles.values()]) {
      if (t.survey === "ready") detailReady++;
      else if (t.survey === "running" || t.survey === "placed") detailRunning++;
      else if (t.survey === "unavailable") detailUnavailable++;
      else if (t.towers?.length) detailPending++;
      detailMatched += t.surveyHidden?.size ?? 0;
      detailUnmatched += Math.max(0, (t.towers?.length ?? 0)/TOWER - (t.surveyHidden?.size ?? 0));
    }
    return { tiles: this.tiles.size, ready, loading: this.loading, failed, buildings: this.buildings, lastMs: this.lastMs, radius: this.radius, detailReady, detailRunning, detailPending, detailUnavailable, detailMatched, detailUnmatched, workerPending: (this.surveyPool?.pending ?? 0)+(this.colourPool?.pending ?? 0) };
  }

  /** Each frame: tiles wanted round the drone (at x, y, `alt` m over the ground, moving vx, vy)
   * queued nearest-to-where-it-will-be first; tiles left far behind freed; placed tiles checked. */
  /** The live traffic layer: speeds (km/h) by standard link ID, or none; on or off. The bands are
   * coloured again a few tiles a frame (update), never all at once. */
  setTraffic(speeds: Map<string, number> | null, on: boolean) {
    this.trafficSpeeds = speeds; this.trafficOn = on;
    for (const t of this.tiles.values()) if (t.traffic) { t.traffic.dirty = true; this.trafficDirty++; }
  }
  /** The standard link IDs of the bands within r of (x, y) (the speeds to ask for). */
  trafficLinks(x: number, y: number, r: number): string[] {
    const out = new Set<string>();
    for (const t of this.tiles.values()) if (t.traffic && distToBox(x, y, t.box) < r) for (const id of t.traffic.ids) out.add(id);
    return [...out];
  }
  private trafficDirty = 0;
  private colourTraffic() {
    if (!this.trafficDirty) return;
    let budget = 3, left = false;
    for (const t of this.tiles.values()) {
      const tr = t.traffic;
      if (!tr?.dirty) continue;
      if (budget-- <= 0) { left = true; break; }
      tr.dirty = false; this.trafficDirty = Math.max(0, this.trafficDirty - 1);
      const geo = tr.mesh.geometry, speeds = this.trafficSpeeds;
      if (!this.trafficOn || !speeds?.size) { tr.mesh.visible = false; tr.shown = 0; continue; }
      // (by the road's class: TOPIS's own bands — 도시고속도로 70/40 km/h, other roads 25/15)
      const rgb = tr.ids.map((id, i) => {
        const v = speeds.get(id); if (v === undefined) return null;
        const [fast, slow] = tr.highway[i] ? [70, 40] : [25, 15];
        return v >= fast ? [.12, .78, .36] : v >= slow ? [1, .66, .08] : [.92, .12, .14];
      });
      const colour = geo.getAttribute("color") as THREE.BufferAttribute, c = colour.array as Float32Array, index = geo.index!, ix = index.array as Uint32Array;
      let k = 0;
      for (let v = 0; v < tr.link.length; v += 3) {
        const col = rgb[tr.link[v]]; if (!col) continue;
        for (let q = 0; q < 3; q++) { c[(v + q) * 3] = col[0]; c[(v + q) * 3 + 1] = col[1]; c[(v + q) * 3 + 2] = col[2]; ix[k++] = v + q; }
      }
      colour.needsUpdate = true; index.needsUpdate = true;
      geo.setDrawRange(0, k); tr.shown = k;
      tr.mesh.visible = k > 0;
    }
    // (the tiles dropped while waiting count no more)
    if (!left) this.trafficDirty = 0;
  }
  update(x: number, y: number, vx: number, vy: number, alt: number, look?: [number, number]) {
    if (this.disposed) return;
    this.colourTraffic();
    // Streaming decisions do not change at display frequency. Still reconsider
    // immediately after a camera jump; flight and vehicle animation stay 60 Hz.
    const scheduleNow = performance.now();
    if (scheduleNow - this.scheduleAt < 80 && Math.hypot(x - this.scheduleX, y - this.scheduleY) < 20) return;
    this.scheduleAt = scheduleNow; this.scheduleX = x; this.scheduleY = y;
    this.adoptViewBuildings();
    this.adoptNearBuildings();
    if (!OFF.includes("sea") && !this.regionBusy && (!this.region || Math.hypot(x - this.region.x, y - this.region.y) > REGION_SEA * 0.5)) void this.regionSea(x, y);
    if (!OFF.includes("landmarks")) this.landmarks.update(x, y, alt);
    this.places.update(x,y);
    // The bridges' whole links and decks ahead of the tiles that will need them (bridgeChains: kept
    // by cell for the page) — a tile's roads then find them waiting, not asked for in turn.
    if (!OFF.includes("roads") && this.base !== null && scheduleNow - this.chainsAt > 3000) {
      this.chainsAt = scheduleNow;
      // (±600 m here: the chains reach 2 km past it, a dozen cells of links at most)
      const { data } = this.o, M = 600;
      void structureChains(data.vworld_key!, data.vworld_domain, data.center!.lat, data.center!.lon, this.base, [x - M, y - M, x + M, y + M]).catch(() => null);
    }
    // (higher, more of the city in sight: 1.15 km low down, 1.8 km at 500 m; less on a phone — and
    // scheduled toward its predicted position ten seconds ahead)
    // (a phone: 640–740 m round it, past which the haze closes in — the tiles, buildings and cars past it
    // were most of its frame)
    this.radius = Math.min(this.o.hq ? 1820 : 740, (this.o.hq ? 1155 : 640) + Math.max(0, alt) * (this.o.hq ? 1.4 : 0.6)) * this.memoryScale();
    // Prepare both travel and viewing corridors, including looking backward
    // while flying forward. Network failure still uses retry/registered fallback.
    const sp = Math.hypot(vx, vy), fx = sp > 1 ? vx / sp : look?.[0] ?? 0, fy = sp > 1 ? vy / sp : look?.[1] ?? 0;
    const R = this.radius, lead = 10, ax = x + vx * lead + fx * 240, ay = y + vy * lead + fy * 240;
    const viewLead=Math.min(900,300+sp*8),lx=x+(look?.[0]??fx)*viewLead,ly=y+(look?.[1]??fy)*viewLead;
    this.aheadX=ax;this.aheadY=ay;this.viewAheadX=lx;this.viewAheadY=ly;this.scheduleLook=look;
    const now = performance.now(), plantR = this.o.hq ? PLANT_R.hq : PLANT_R.lite;
    if (this.region?.field && this.regionWater && now - this.seaCoverageAt > 500) {
      this.seaCoverageAt = now;
      const { x: sx, y: sy, R } = this.regionWater;
      this.seaCoverage.update(this.o.viewWater?.() ?? [], [sx - R, sy - R, sx + R, sy + R],this.region.field.coast?.data);
    }
    const plantWant: [number, Tile][] = [];
    const far: [number, Tile][] = [];
    for (const t of this.tiles.values()) {
      if (t.state === "placed" && this.placedReady(t)) { t.state = "ready"; t.readyAt = now; this.lastMs = now - t.startedAt; if (DTRACE) { performance.mark?.(`drone:ready ${t.key}`); console.info(`[dtile] ${t.key} ready ${Math.round(now)}`); } }
      const d = Math.min(distToBox(x, y, t.box), distToBox(ax, ay, t.box),distToBox(lx,ly,t.box));
      // (out of reach: freed at once — its meshes, textures and workers' arrays — with 250 m of slack
      // so a tile on the edge is not loaded and freed by turns)
      if (d > R + 250) { this.drop(t); continue; }
      far.push([d, t]);
      // Trees: planted coming within reach, cleared going well past it.
      if (t.plants?.state === "placed" && t.plants.group && this.o.drawReady(t.plants.group)) t.plants.state = "ready";
      if (t.planting && t.state === "ready" && !t.plants && d <= plantR && !OFF.includes("plants")) plantWant.push([d + this.offView(t, x, y, look), t]);
      else if (t.plants && t.plants.state !== "building" && d > plantR + 200) this.unplant(t);
    }
    // Colours from the aerial photographs, two tiles at a time, nearest first.
    const colourR = this.o.hq ? COLOUR_R.hq : COLOUR_R.lite;
    let colourBusy = 0, colourNext: [number, Tile] | null = null;
    for (const t of [...this.tiles.values(), ...this.viewTiles.values()]) {
      if (t.colour === "running") colourBusy++;
      if (!t.buildingGroup || t.colour || now < (t.colourRetryAt ?? 0) || !t.spans?.length) continue;
      // (the cheap tests first: a readiness walk of every tile's buildings on every scheduling
      // pass was a good part of the streaming's frame time)
      const d = distToBox(x, y, t.box);
      if (d > colourR || (colourNext && d >= colourNext[0]) || !this.o.drawReady(t.buildingGroup)) continue;
      colourNext = [d, t];
    }
    if (colourNext && colourBusy < 1) { if (NO_COLOUR) colourNext[1].colour = "done"; else void this.colourTile(colourNext[1]); }
    // Towers: their surveyed shapes, nearest to where the drone is going first, a few tiles at a
    // time (their models come over the network; the merging is the page's, in short slices).
    const surveyWant: [number, Tile][] = [];
    // (ranking every building of every tile is a few ms in a dense city: four times a second is
    // enough to keep both detail slots busy nearest-first — a finished slot is refilled at once)
    const freeSlots = (this.o.hq ? 2 : 1) - this.surveying - [...this.tiles.values(), ...this.viewTiles.values()].filter(t => t.survey === 'placed').length;
    // (ranked at once whenever a slot has just come free — a job done, a swap drawn — else 4 a second)
    const surveyDue = freeSlots > 0 && (now - this.surveyRankAt > 250 || freeSlots > this.surveyFreeWas);
    this.surveyFreeWas = freeSlots;
    if (surveyDue) this.surveyRankAt = now;
    if (surveyDue) for (const t of [...this.tiles.values(), ...this.viewTiles.values()]) {
      if(t.survey==='unavailable'&&now>=(t.surveyRetryAt??0))t.survey='none';
      if (!this.buildingReady(t) || t.survey !== "none" || now < (t.surveyRetryAt ?? 0) || !t.towers?.length) continue;
      if(OFF.includes('survey'))continue;
      const priority=this.surveyPriority(t,x,y,ax,ay,lx,ly,look,now);
      if(Number.isFinite(priority))surveyWant.push([priority,t]);
    }
    surveyWant.sort((a, b) => a[0] - b[0]);
    const placed=[...this.tiles.values(),...this.viewTiles.values()].filter(t=>t.survey==='placed').length;
    const detailSlots=Math.max(0,Math.min((this.o.hq?2:1)-this.surveying-placed,surveyWant.length));
    for(let k=0;k<detailSlots;k++)void this.surveyTile(surveyWant[k][1]);
    // Shadows from the near tiles only (with 80 m of slack: not switched back and forth); the lane
    // paint true to size within ~260 m of the camera (its height counted), broad past it.
    if (this.shadowCheck % 15 === 14) this.plantPool.shadows(x, y, TREE_SHADOW, TILE_M);
    // (a phone: the view's own woodland and its neighbours' in the pool's far models too — the
    // forests round the start were all drawn at full detail out to a kilometre)
    if (this.treeLod && this.shadowCheck % 60 === 37) groveLeavesLod(true);
    if (++this.shadowCheck % 15 === 0) for (const t of this.tiles.values()) {
      const d = distToBox(x, y, t.box);
      // (the lane paint, true to size, drawn within ~700 m of the camera: past it, under a pixel)
      if (t.marks?.[0]) t.marks[0].visible = Math.hypot(d, alt) < (t.marks[0].visible ? 760 : 700);
      const fine = d < FINE_R;
      for (const m of t.fine ?? []) m.visible = fine;
      const b = t.castB ? d < BUILDING_SHADOW + 80 : d < BUILDING_SHADOW, p = t.castP ? d < TREE_SHADOW + 80 : d < TREE_SHADOW;
      if (b !== t.castB) { t.castB = b; if (t.zup) castShadows(t.zup, b); }
      if (p !== t.castP) { t.castP = p; if (t.plants?.group) castShadows(t.plants.group, p); }
      // (a phone: a tile left behind past its reach and 150 m is kept — back at once if the drone
      // turns — but not drawn: every one walked by the renderer each frame, for haze)
      if (!this.o.hq) { const show = d < R + 150; for (const g of [t.zup, t.yup, t.plants?.group]) if (g && g.visible !== show) g.visible = show; }
    }
    // Never more tiles than the device holds: the nearest `cap` places within reach are the only ones
    // made; a tile past them (with a few of slack) goes at once. (Freeing tiles the loop below then made
    // again, frame after frame, was what ran the memory out and kept the ones ahead from loading.)
    const cap = this.o.hq ? 90 : 45;
    const keep = this.nearestPlaces(x, y, ax, ay, R, cap,lx,ly);
    if (far.length > cap) {
      far.sort((a, b) => b[0] - a[0]);
      let over = far.length - cap;
      for (const [, t] of far) { if (over <= 0) break; if (!keep.has(t.key)) { this.drop(t); over--; } }
    }
    plantWant.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < Math.min((this.o.hq ? 4 : 2) - this.planting, plantWant.length); k++) void this.plant(plantWant[k][1]);
    const i0 = Math.floor((Math.min(x, ax,lx) - R) / TILE_M), i1 = Math.floor((Math.max(x, ax,lx) + R) / TILE_M);
    const j0 = Math.floor((Math.min(y, ay,ly) - R) / TILE_M), j1 = Math.floor((Math.max(y, ay,ly) + R) / TILE_M);
    const want: [number, Tile][] = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const box: [number, number, number, number] = [i * TILE_M, j * TILE_M, (i + 1) * TILE_M, (j + 1) * TILE_M];
      const near = Math.min(distToBox(x, y, box), distToBox(ax, ay, box),distToBox(lx,ly,box));
      if (near > R || !keep.has(key(i, j))) continue;
      const order=droneTilePriority(box,x,y,look);
      let t = this.tiles.get(key(i, j));
      if (!t) { t = this.make(i, j, box); this.tiles.set(t.key, t); }
      if (t.state === "queued" || (t.state === "failed" && now > t.retryAt)) want.push([order, t]);
    }
    want.sort((a, b) => a[0] - b[0]);
    this.pumpWarm(x, y);
    // Eight tiles started up to 24 geometry workers at once. Bound decodes too.
    // (six at once on a desktop: a tile waits on its downloads in workers — not the page — most of
    // its two seconds; four left the ring round the drone filling at under two tiles a second)
    const slots = (this.o.hq ? 6 : 2) - this.loading;
    for (let k = 0; k < Math.min(slots, want.length); k++) void this.load(want[k][1]);
  }

  /** The keys of the `cap` places (tiles) nearest the drone or where it is going, within R. */
  private nearestPlaces(x: number, y: number, ax: number, ay: number, R: number, cap: number,lx=ax,ly=ay) {
    const i0 = Math.floor((Math.min(x, ax,lx) - R) / TILE_M), i1 = Math.floor((Math.max(x, ax,lx) + R) / TILE_M);
    const j0 = Math.floor((Math.min(y, ay,ly) - R) / TILE_M), j1 = Math.floor((Math.max(y, ay,ly) + R) / TILE_M);
    const all: [number, string][] = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const box: [number, number, number, number] = [i * TILE_M, j * TILE_M, (i + 1) * TILE_M, (j + 1) * TILE_M];
      const near = Math.min(distToBox(x, y, box), distToBox(ax, ay, box),distToBox(lx,ly,box));
      if (near <= R) all.push([near, key(i, j)]);
    }
    all.sort((a, b) => a[0] - b[0]);
    return new Set(all.slice(0, cap).map(a => a[1]));
  }
  /** The places whose OpenStreetMap answers were asked for already (each once a page). */
  private warmed = new Set<string>();
  /** The asks warming the server's cache, sent nearest the drone first, four at a time: all at
   * once — two for each of some sixty tiles the moment the drone took off — they held up the asks
   * the near tiles were waiting on (and, on a page served over HTTP/1.1, the workers' own scripts,
   * 15 s). A tile gone from the reach before its turn is not asked for. */
  private warmQueue: { k: string; cx: number; cy: number; urls: string[] }[] = [];
  private warmBusy = 0;
  private pumpWarm(x: number, y: number) {
    if (!this.warmQueue.length || this.warmBusy >= 4) return;
    this.warmQueue = this.warmQueue.filter(w => this.tiles.has(w.k));
    this.warmQueue.sort((a, b) => Math.hypot(a.cx - x, a.cy - y) - Math.hypot(b.cx - x, b.cy - y));
    while (this.warmBusy < 4 && this.warmQueue.length) {
      const w = this.warmQueue.shift()!;
      for (const u of w.urls) { this.warmBusy++; void fetch(u).catch(() => {}).finally(() => { this.warmBusy--; }); }
    }
  }
  private make(i: number, j: number, box: [number, number, number, number]): Tile {
    const H = this.o.extent.farHalf;
    // The site's OpenStreetMap answers (water, crossings) asked now, unawaited: the server fetches
    // them on a first ask, and by the time this tile is built they are in its cache.
    if (typeof location !== "undefined" && !this.warmed.has(key(i, j))) {
      this.warmed.add(key(i, j));
      const c = this.o.data.center!, la = +(c.lat + ((box[1] + box[3]) / 2) / this.ky).toFixed(4), lo = +(c.lon + ((box[0] + box[2]) / 2) / this.kx).toFixed(4);
      const q = `lat=${la.toFixed(4)}&lon=${lo.toFixed(4)}`;
      this.warmQueue.push({ k: key(i, j), cx: (box[0] + box[2]) / 2, cy: (box[1] + box[3]) / 2,
        urls: [`${location.origin}/api/realestate/crossings?${q}&r=260&v=3`, `${location.origin}/api/realestate/water?${q}&r=${Math.round((TILE_M / 2) * 1.5)}&v=3&fast=1`] });
    }
    return {
      i, j, key: key(i, j), box, cx: (box[0] + box[2]) / 2, cy: (box[1] + box[3]) / 2,
      inner: box[0] >= -H - 1 && box[2] <= H + 1 && box[1] >= -H - 1 && box[3] <= H + 1,
      state: "queued", tries: 0, retryAt: 0, grid: null, at: null, roofs: null, zup: null, yup: null,
      materials: [], dispose: [], stop: new AbortController(), startedAt: 0, readyAt: 0,
      planting: null, local: null, plants: null, towers: null, styleGeo: {}, survey: "none", surveyGroup: null, castB: true, castP: true,
    };
  }

  /** (checks) the meshes of a tile not yet drawable */
  notReady(k: string) {
    const t = this.tiles.get(k), out: string[] = [];
    for (const g of [t?.zup, t?.yup]) g?.traverseVisible(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !this.o.drawReady(m)) out.push(`${m.name || "?"}|${(Array.isArray(m.material) ? m.material : [m.material]).map(x => x.type + ":" + (x.name || "")).join("+")}|cast${+m.castShadow}|n${(m.geometry.index?.count ?? 0)}`);
    });
    return out.slice(0, 8);
  }
  private placedReady(t: Tile) {
    return (!t.zup || this.o.drawReady(t.zup)) && (!t.yup || this.o.drawReady(t.yup));
  }

  /** The DEM's height at the view's centre, which the view's heights count from. */
  private baseHeight(): Promise<number | null> {
    const { data } = this.o;
    this.baseJob ??= vworldSampler(data.vworld_key!, data.center!.lat, data.center!.lon, 20)
      .then(s => (s ? s(data.center!.lon, data.center!.lat) : null)).catch(() => null)
      .then(b => { this.base = b; return b; });
    return this.baseJob;
  }

  /** The tile's relief on a 4 m grid over it and a margin, and (for long bridges' ends) on a 16 m
   * grid over ±1.3 km round it. */
  private async tileGrid(t: Tile): Promise<{ grid: TileGrid; wide: TileGrid | null } | null> {
    // (a 160 m margin: the buildings across the tile's edge, and a bridge's near end)
    const { data } = this.o, R = TILE_M / 2 + 160, cell = 4, n = Math.round((2 * R) / cell) + 1;
    const lat = data.center!.lat + t.cy / this.ky, lon = data.center!.lon + t.cx / this.kx;
    const WR = 1300, wcell = 16, wn = Math.round((2 * WR) / wcell) + 1;
    const anchor=this.o.terrain.grid?{...this.o.terrain.grid,half:this.o.extent.farHalf}:undefined;
    const gl = (w: string) => { if (DTRACE) console.info(`[dtile] ${t.key} ${w} ${Math.round(performance.now())}`); };
    const [base, sampler, wideSampler] = await Promise.all([this.baseHeight().then(v => { gl('g-base'); return v; }), vworldSampler(data.vworld_key!, lat, lon, R + 8).catch(() => null).then(v => { gl('g-dem'); return v; }),
      t.inner ? Promise.resolve(null) : vworldSampler(data.vworld_key!, lat, lon, WR + 20).catch(() => null).then(v => { gl('g-wide'); return v; })]);
    const fill = async (gr: number, gc: number, gn: number, smp: typeof sampler) => {
      if(smp&&base!==null){
        const result=await this.terrainJobs.run({posts:smp.posts,lon:data.center!.lon,lat:data.center!.lat,kx:this.kx,ky:this.ky,
          base,cx:t.cx,cy:t.cy,R:gr,cell:gc,n:gn,anchor},t.stop.signal);
        gl(result ? `g-job${gn}` : `g-jobfail${gn}`);
        if(this.disposed||t.stop.signal.aborted)return null;
        if(result)return {h:result.h,n:gn,R:gr,cell:gc,ox:t.cx,oy:t.cy};
      }
      const h = new Float32Array(gn * gn);
      for (let j = 0; j < gn; j++) {
        for (let i = 0; i < gn; i++) {
          const x = t.cx - gr + i * gc, y = t.cy - gr + j * gc;
          h[j * gn + i] = anchoredTerrainHeight(anchor,x,y,smp && base !== null ? smp(data.center!.lon + x / this.kx, data.center!.lat + y / this.ky) - base : this.o.terrain.at(x, y));
        }
        if (!await this.pace()) return null;
      }
      return { h, n: gn, R: gr, cell: gc, ox: t.cx, oy: t.cy };
    };
    const grid = await fill(R, cell, n, sampler);
    if (!grid) return null;
    const wide = wideSampler && base !== null ? await fill(WR, wcell, wn, wideSampler) : null;
    return { grid, wide };
  }

  private async load(t: Tile) {
    const { data, hq } = this.o;
    t.state = "loading"; t.tries++; t.startedAt = performance.now();
    if (DTRACE) console.info(`[dtile] ${t.key} begin ${Math.round(t.startedAt)}`);
    this.loading++;
    const stop = t.stop = new AbortController();
    let groundJob: ReturnType<typeof farGround> | null = null;
    let groundClaimed = false;
    const fail = () => {
      if (this.disposed || stop.signal.aborted) return;
      stop.abort(); // Failed tiles must not leave sibling workers running.
      this.clear(t);
      // A failed tile is still missing. Keep retrying with backoff; counting an empty tile
      // as ready after three attempts left permanent holes under the palaces and stadiums.
      t.state = "failed";
      t.retryAt = performance.now() + Math.min(30000, 2500 * t.tries);
    };
    try {
      const grids = await this.tileGrid(t);
      if (DTRACE) console.info(`[dtile] ${t.key} grid ${Math.round(performance.now())}`);
      if (!grids || stop.signal.aborted) return;
      const grid = grids.grid;
      t.grid = grid;
      const local = gridAt(grid);
      t.at = (x, y) => local(x - grid.ox, y - grid.oy);
      // Its water first (the server answers at once from the bundled coastline): without it the
      // sea would be painted as land — no answer, the tile is tried again. A tile all at sea:
      // nothing to ask VWorld for (no building, road or parcel out there) — only the sea.
      let sea: SeaBody | null = null;
      if (!t.inner && !OFF.includes("sea")) {
        sea = await this.seaAnswer(t);
        if (DTRACE) console.info(`[dtile] ${t.key} sea ${Math.round(performance.now())}`);
        if (stop.signal.aborted || this.disposed) return;
        if (!sea) { fail(); return; }
        if (this.seaCovers(sea)) {
          const localTerrain: Terrain = { at: local, base: r => Math.min(...r.map(([x, y]) => local(x, y))), relief: 0, elevation: null, source: "drone tile", grid };
          await this.seaOn(t, null, localTerrain, stop.signal, sea);
          if (stop.signal.aborted || this.disposed) return;
          const zup = new THREE.Group();
          zup.rotation.x = -Math.PI / 2; zup.name = `drone tile ${t.key} (sea)`; zup.updateMatrixWorld();
          t.zup = zup;
          staticSceneTransforms(zup);
          this.o.addWarm(this.root, zup);
          if (t.yup) this.o.addWarm(this.root, t.yup);
          t.state = "placed";
          this.bridgeTraffic(t);
          if (DTRACE) performance.mark?.(`drone:placed ${t.key} sea`);
          return;
        }
        t.seaBody = sea;
      }
      // The tile's three workers at once: its roads (past the view's own square, where it draws none),
      // its ground's land use and its buildings.
      const dlog = (w: string) => { if (DTRACE) console.info(`[dtile] ${t.key} ${w} ${Math.round(performance.now())}`); };
      dlog("start");
      // (its bridges whole, bank to bank: the same deck as the view's and every other tile's —
      // unanswered, the tile is tried again rather than drawing a deck of its own)
      const ringJob = OFF.includes("ring") ? Promise.resolve(null) : ringTile(data.center!.lat, data.center!.lon, data.vworld_key!, data.vworld_domain, t.box, grid,
        { inner: this.o.extent.ring, floorM: CONTEXT_FLOOR_M, seed: this.o.seed + t.i * 7919 + t.j * 104729, heightCell: 2, signal: stop.signal });
      const roadJob = t.inner || OFF.includes("roads") ? Promise.resolve(null) : this.baseHeight()
        .then(b => b === null ? null : structureChains(data.vworld_key!, data.vworld_domain, data.center!.lat, data.center!.lon, b, t.box, stop.signal))
        .then(async chains => {
          if(chains===null||stop.signal.aborted||this.disposed)return null;
          const buildings=await ringJob;
          if(!buildings||stop.signal.aborted||this.disposed)return null;
          this.o.onLabels?.('bridges:'+t.key,bridgeNameLabels(data.center!,chains.filter(c=>c.deck).map(c=>({line:c.line,width:c.deck!.w,lanes:c.deck!.lanes,structure:'bridge',structure_source:'VWorld LT_L_MOCTLINK',profile_line:c.line,profile_s:c.s,profile_z:c.z}))));
          return roadTile(data.center!.lat, data.center!.lon, data.vworld_key!, data.vworld_domain, t.box, grid, grids.wide, stop.signal,
            { lat: data.center!.lat + t.cy / this.ky, lon: data.center!.lon + t.cx / this.kx }, { ...this.roadExtras(t), chains,footprints:buildings.footprints as [number,number][][] });
        });
      const tileLat = data.center!.lat + t.cy / this.ky, tileLon = data.center!.lon + t.cx / this.kx;
      const localTerrain: Terrain = { at: local, base: r => Math.min(...r.map(([x, y]) => local(x, y))), relief: 0, elevation: null, source: "drone tile", grid };
      groundJob = t.inner || OFF.includes("ground") ? Promise.resolve(null) : farGround({ ...data, center: { lat: tileLat, lon: tileLon }, roads: [] } as RealEstateBuildingsResponse, localTerrain,
        { half: TILE_M / 2, size: hq ? 1024 : 512, lawn: this.season.lawn, paddy: this.season.paddy, landscape: textureBudgetEnabled(), nearHalf: 0, footprints: [], signal: stop.signal, rivers: true, lakes: true, water: sea, waterSurface: !OFF.includes('rivers') });
      void roadJob.then(() => dlog("roads done")); void groundJob.then(() => dlog("ground done"));
      const ring = await ringJob;
      if (stop.signal.aborted || this.disposed) return;
      dlog("ring done");
      if (!ring) { fail(); return; }
      t.roofs = ring.roofs ?? null;
      this.placeFootprints.set(t.key,ring.footprints,()=>!!t.buildingGroup&&this.o.drawReady(t.buildingGroup));
      t.towers = ring.towers ?? null;
      t.spans = ring.spans; t.spanRings = ring.spanRings;t.appearances=ring.appearances;
      this.o.onLabels?.(t.key, ring.labels ?? null);
      // (inside the view's square, the trees the view planted itself)
      if (t.inner && t.roofs) this.treesOnGrid(t.roofs, (this.o.viewTrees?.() ?? []).filter(([x, y]) => x >= t.box[0] && y >= t.box[1] && x < t.box[2] && y < t.box[3]), this.o.terrain.at);
      const zup = new THREE.Group();
      zup.rotation.x = -Math.PI / 2;
      zup.name = `drone tile ${t.key}`;
      zup.updateMatrixWorld();
      const buildingGroup = new THREE.Group();
      buildingGroup.name = `drone tile ${t.key} registered buildings`;
      zup.add(buildingGroup);
      // The buildings, a mesh per facade style (the shared neighbourhood materials: no new shaders).
      for (const [style, a] of Object.entries(ring.styles) as [ContextStyle, NonNullable<RingResult["styles"]["apt"]>][]) {
        if (!a.index.length) continue;
        if (!await sharedContextTexturesSliced(style, () => this.pace()) || stop.signal.aborted) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(a.position, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(a.normal, 3));
        geo.setAttribute("uv", new THREE.BufferAttribute(a.uv, 2));
        geo.setAttribute("color", new THREE.BufferAttribute(a.color, 3));
        if(a.facade)geo.setAttribute("facade",new THREE.BufferAttribute(a.facade,4));
        geo.setIndex(new THREE.BufferAttribute(a.index, 1));
        if(a.sphere)geo.boundingSphere=new THREE.Sphere(new THREE.Vector3(a.sphere[0],a.sphere[1],a.sphere[2]),a.sphere[3]);
        else geo.computeBoundingSphere();
        t.dispose.push(() => geo.dispose());
        const mesh = new THREE.Mesh(geo, sharedContextMaterial(style));
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.solid = true;
        mesh.userData.railBuilding = true;
        buildingGroup.add(mesh);
        t.styleGeo[style] = geo;
        // Cached materials and transferred arrays usually take less than 1ms.
        // Yield on the actual slice cost, rather than forcing a 100ms wait for
        // every style when drawing has already used the 6ms spare-time budget.
        if (!await this.pace()) return;
      }
      // (inside a landmark site already on screen: its models stand there, not the boxes)
      for (const site of this.landmarks.placedSites()) this.hideInSite(t, site);
      // Buildings are admitted immediately; roads/land use have independent network
      // lifetimes. Their completion must not block nearby building detail requests.
      t.zup = zup; t.buildingGroup = buildingGroup;
      staticSceneTransforms(buildingGroup);
      this.o.addWarm(this.root, zup);
      // The roads: asphalt to the road's surveyed width on the relief, lane lines, and the lanes for the cars.
      if (DTRACE) console.info(`[dtile] ${t.key} buildings ${Math.round(performance.now())}`);
      const roads = await roadJob;
      if (DTRACE) console.info(`[dtile] ${t.key} roadsin ${Math.round(performance.now())}`);
      if (stop.signal.aborted || this.disposed) return;
      if(!t.inner&&!OFF.includes('roads')&&!roads){fail();return;}
      if(roads){
        const footprints=ring.footprints as [number,number][][];
        const groundRoads=await fitTileStreetSurfaces(roads,footprints,async()=>!stop.signal.aborted&&await this.pace());
        if(stop.signal.aborted||this.disposed)return;
        if(!groundRoads){fail();return;}
        t.nearRoadGuard=packedSourceGuard('tile:'+t.key+':'+t.startedAt,groundRoads,footprints);
      }
      // (the ground cut to the roads in the road worker: the same grid for the ground mesh, the trees
      // and everything stood on it from now on)
      if (roads?.ground && roads.ground.length === grid.h.length) grid.h.set(roads.ground);
      if (roads?.surface) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(roads.surface.position, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(roads.surface.normal, 3));
        if(roads.surface.level)geo.setAttribute('roadLevel',new THREE.BufferAttribute(roads.surface.level,1));
        geo.setIndex(new THREE.BufferAttribute(roads.surface.index, 1));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, this.asphalt);
        mesh.receiveShadow = true; mesh.name = "drone tile ground";
        zup.add(mesh);
        t.dispose.push(() => geo.dispose());
      }
      const mesh = (a: { position: Float32Array; normal: Float32Array; index: Uint32Array; color?: Float32Array;level?:Float32Array } | null, m: THREE.Material, name: string, cast = false) => {
        if (!a) return null;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(a.position, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(a.normal, 3));
        if (a.color) geo.setAttribute("color", new THREE.BufferAttribute(a.color, 3));
        if(a.level)geo.setAttribute('roadLevel',new THREE.BufferAttribute(a.level,1));
        geo.setIndex(new THREE.BufferAttribute(a.index, 1));
        geo.computeBoundingSphere();
        const me = new THREE.Mesh(geo, m);
        me.receiveShadow = true; me.castShadow = cast; me.name = name;
        zup.add(me);
        t.dispose.push(() => geo.dispose());
        return me;
      };
      // lane paint: true to size near, broad far (droneWorld.update shows one of them)
      t.marks = [mesh(roads?.marks ?? null, this.paint, "drone tile ground"), mesh(roads?.marksFar ?? null, this.paint, "drone tile ground")];
      if (t.marks[0]) t.marks[0].visible = false;
      // (tunnel portals: seen from afar, as the hills they are in — not with the fine parts)
      mesh(roads?.portals?.concrete ?? null, this.concrete, "drone tile tunnel portals", true); mesh(roads?.portals?.dark ?? null, this.bore, "drone tile tunnel portals");
      if (roads?.traffic) {
        const tr = roads.traffic, geo = new THREE.BufferGeometry(), n = tr.position.length / 3;
        geo.setAttribute("position", new THREE.BufferAttribute(tr.position, 3));
        // (all faces up: the bands lie flat on the road)
        const normal = new Float32Array(n * 3); for (let i = 0; i < n; i++) normal[i * 3 + 2] = 1;
        geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        // (the links with a speed first in the index, drawn to drawRange: the rest are not drawn)
        geo.setIndex(new THREE.BufferAttribute(new Uint32Array(n), 1));
        geo.setDrawRange(0, 0);
        geo.computeBoundingSphere();
        const me = new THREE.Mesh(geo, this.trafficMat);
        me.name = "drone tile live traffic"; me.visible = false; me.receiveShadow = false;
        zup.add(me);
        t.dispose.push(() => geo.dispose());
        t.traffic = { mesh: me, link: tr.link, ids: tr.ids, highway: tr.ranks.map(r => /고속/.test(r)), shown: 0, dirty: this.trafficOn };
        if (this.trafficOn) this.trafficDirty++;
      }
      t.fine = [mesh(roads?.structure ?? null, this.concrete, "drone tile bridges", true), mesh(roads?.walks ?? null, this.paving, "drone tile ground")].filter(m => !!m) as THREE.Mesh[];
      if (roads?.walkPaths.length) t.walkPaths = roads.walkPaths;
      t.bridges = roads?.bridges ?? 0;
      if (roads?.lanes.length) {
        const lanes = roads.lanes;
        t.lanes = lanes;
        t.baseLanes = lanes;
        t.stops = roads.stops;
        t.banks = roads.banks;
      }
      this.buildings += ring.buildings;
      t.dispose.push(() => { this.buildings -= ring.buildings; });
      // Outside the view's square: its own ground in its land use, and the trees on it.
      if (!t.inner) {
        const fg = await groundJob;
        if (DTRACE) console.info(`[dtile] ${t.key} groundin ${Math.round(performance.now())}`);
        if (stop.signal.aborted || this.disposed) { fg?.bitmap.close(); groundClaimed = true; return; }
        if (!fg) { fail(); return; }
        const ground = this.groundMesh(t, grid, local);
        const tex = new THREE.Texture(fg.bitmap as unknown as HTMLImageElement);
        tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 8; tex.needsUpdate = true;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.userData.releaseAfterUpload = true;
        const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
        // (WebGPU: the same world-space grass, asphalt and paving detail as the view's ground)
        mat.userData.groundDetail = true;
        const mesh = new THREE.Mesh(ground, mat);
        mesh.receiveShadow = true;
        mesh.name = "drone tile ground";
        t.materials.push(mat);
        t.dispose.push(() => { ground.dispose(); tex.dispose(); mat.dispose(); fg.bitmap.close(); });
        groundClaimed = true;
        if (!await this.pace(true)) return;
        if (DTRACE) console.info(`[dtile] ${t.key} groundmesh ${Math.round(performance.now())}`);
        if (!OFF.includes("sea")) await this.seaOn(t, ground, localTerrain, stop.signal);
        if (DTRACE) console.info(`[dtile] ${t.key} seaon ${Math.round(performance.now())}`);
        if (stop.signal.aborted || this.disposed) return;
        if (!OFF.includes("rivers") && fg.water.length) await this.riverOn(t, ground, localTerrain, fg.water, stop.signal);
        if (DTRACE) console.info(`[dtile] ${t.key} riveron ${Math.round(performance.now())}`);
        if (stop.signal.aborted || this.disposed) return;
        // Buildings stream independently, but uncorrected terrain must not flash
        // above the water while its coast worker is still running.
        zup.add(mesh);
        // General park trees are loaded near the drone. The requested palace flower beds
        // and grass tufts also have 3D geometry; their ground colors remain visible from above.
        // (and the street trees by the kerbs of the roads with sidewalks: one species a road)
        const street: [number, number, number][] = [];
        const st = roads?.streetTrees;
        if (st) for (let k = 0; k < st.length; k += 3) street.push([st[k] - t.cx, st[k + 1] - t.cy, st[k + 2]]);
        // (painted before the buildings were in: no tree where a building stands)
        // (nor on a road: the ground's planting was laid without them — a ramp through a wood,
        // a road on the 둔치, under trees, looked sunk in the ground)
        const onRoad = roadClear(roads?.clear);
        const free = ([lx, ly]: [number, number]) => this.roofAt(lx + t.cx, ly + t.cy) < local(lx, ly) + 1 && !onRoad(lx + t.cx, ly + t.cy);
        const gardenBeds = fg.gardens.flatMap(g => g.beds).map(b => ({ ...b, points: b.points.filter(free) })).filter(b => b.points.length);
        const gardenGrass = fg.gardens.flatMap(g => g.grass).filter(free);
        mesh.userData.palaceGardens = fg.gardens.map(g => ({ id: g.id, earthM2: g.earthM2, lawnM2: g.lawnM2, flowerM2: g.flowerM2 }));
        const p = this.dryPlanting(t,withoutStadiumTrees({ ...fg.planting, trees: fg.planting.trees.filter(free), groves: (fg.planting.groves ?? []).map(g => ({ ...g, points: g.points.filter(free) })),
          shrubs: [], flowers: [], grass: gardenGrass, street, woodlandFlowers: gardenBeds },jamsilTreeMask(tileLat,tileLon,TILE_M/2)));
        if (textureBudgetEnabled() && (p.trees.length || p.groves?.length || p.street.length || p.grass?.length || p.woodlandFlowers?.length)) {
          t.planting = p; t.local = localTerrain;
          // (and the drone flies round them)
          if (t.roofs) this.treesOnGrid(t.roofs, [...p.trees, ...p.street.map(([lx, ly]) => [lx, ly] as [number, number]), ...(p.groves ?? []).flatMap(g => g.points)].map(([lx, ly]) => [lx + t.cx, ly + t.cy] as [number, number]), (x, y) => local(x - t.cx, y - t.cy));
        }
      }
      if (this.disposed || stop.signal.aborted) return;
      t.zup = zup;
      staticSceneTransforms(zup);
      if (!zup.parent) this.o.addWarm(this.root, zup);
      if (t.yup) this.o.addWarm(this.root, t.yup);
      t.state = "placed";
      this.bridgeTraffic(t);
      if (DTRACE) { performance.mark?.(`drone:placed ${t.key}`); console.info(`[dtile] ${t.key} placed ${Math.round(performance.now())}`); }
    } catch (err) {
      console.info("[3D] drone tile failed:", t.key, err);
      fail();
    } finally {
      // Ground may have finished before a failed building/road. Its bitmap never
      // reached a texture owner in that path, so release it when the result arrives.
      if (groundJob && !groundClaimed) void groundJob.then(fg => fg?.bitmap.close());
      this.loading--;
      if (t.state === "loading" && !this.disposed && !stop.signal.aborted) fail();
    }
  }

  /** The sea on a tile (see the top): its surface under t.yup (the tile's centre), the tile's
   * ground (view frame, z up) sunk under it. */
  /** The sea round the drone out to REGION_SEA, at once (the bundled coastline): a coarse surface
   * a little under the tiles' own, so the sea is there before they come in — not their land-use
   * picture's lawn — and past what is loaded. Laid again when the drone has gone half its reach;
   * none inside the view's square (its own sea is there). */
  private region: { x: number; y: number; mesh: THREE.Mesh; field?: WaterField; dispose: () => void } | null = null;
  /** the region's answer (view frame): its sea rings with their islands, and the beaches */
  private regionWater: { x: number; y: number; R: number; rings: { ring: [number, number][]; islands: [number, number][][] }[]; beaches: [number, number][][]; works: NonNullable<SeaBody["works"]> } | null = null;
  private regionWait: (() => void)[] = [];
  private regionBusy = false;
  private async regionSea(x: number, y: number) {
    if (typeof location === "undefined") return;
    this.regionBusy = true;
    try {
      const c = this.o.data.center!, R = REGION_SEA;
      const lat = c.lat + y / this.ky, lon = c.lon + x / this.kx;
      let body: SeaBody | null = null;
      for (let k = 0; k < 4 && !body && !this.disposed; k++) {
        if (k) await new Promise(r => setTimeout(r, 1500 * k));
        body = await fetch(`${location.origin}/api/realestate/water?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&r=${R}&v=3&fast=1`, { signal: AbortSignal.timeout(15000) })
          .then(r => (r.ok ? r.json() : null)).catch(() => null) as SeaBody | null;
      }
      if (this.disposed || !body) return;
      // (its rings in the view frame, for the tiles to cut theirs from: no request a tile)
      const shift = (r: [number, number][]) => r.map(([px, py]) => [px + x, py + y] as [number, number]);
      // (islands under 2500 m² — a bridge pier's footing, a rock — are no hole in the sea: the pier
      // stands in the water)
      const big = (r: [number, number][]) => Math.abs(r.reduce((a, [px, py], i) => { const q = r[(i + 1) % r.length]; return a + px * q[1] - q[0] * py; }, 0) / 2) >= 2500;
      this.regionWater = { x, y, R, rings: (body.rings ?? []).filter(w => w.kind === "sea").map(w => ({ ring: shift(w.ring), islands: (w.islands ?? []).filter(big).map(shift) })), beaches: (body.beaches ?? []).map(b => shift(b.ring)), works: (body.works ?? []).map(w => ({ ...w, pts: shift(w.pts) })) };
      for (const f of this.regionWait.splice(0)) f();
      const seas = (body?.rings ?? []).filter(w => w.kind === "sea");
      if (!seas.length) { this.dropRegion(); this.region = { x, y, mesh: new THREE.Mesh(), dispose: () => {} }; return; }
      const parcels: RealEstateParcel[] = this.regionWater.rings.map(w => ({ kind: "유", sea: true, ring: w.ring, holes: w.islands, open: [x - R, y - R, x + R, y + R] }));
      // National sea datum is 0 m. Per-tile DEM noise must not create different sea levels.
      await this.baseHeight();
      const seaLevel = -(this.base ?? 0);
      const seaTerrain: Terrain = { ...this.o.terrain, elevation: this.base, at: () => seaLevel,
        grid: { h: new Float32Array([seaLevel, seaLevel, seaLevel, seaLevel]), n: 2, R: 1, cell: 2 } };
      const water = await buildWater(parcels, parcels.map(() => false), seaTerrain, () => this.pace());
      if (!water || this.disposed) { water?.dispose(); return; }
      // One sea covers the near view and streamed tiles alike. Near rivers keep their own surface.
      water.mesh.position.y = 0;
      water.mesh.name = "drone region sea";
      water.mesh.updateMatrixWorld();
      this.dropRegion();
      this.region = { x, y, mesh: water.mesh, field: water.field, dispose: () => water.dispose() };
      this.o.onSeaReady?.(water.field);
      // Tile requests can finish before regional coastline. Invalidate both pooled
      // meshes and worker builds; the ordinary bounded planting queue rebuilds them.
      for(const t of this.tiles.values())if(t.planting){
        const safe=this.dryPlanting(t,t.planting);
        if(safe!==t.planting){this.unplant(t);t.planting=safe;}
      }
      // Tiles may have finished first. Give every sea patch the same regional shore/depth field.
      for (const t of this.tiles.values()) for (const mesh of t.yup?.children ?? []) {
        const material = (mesh as THREE.Mesh).material as THREE.Material | undefined;
        if (material?.userData.water && this.regionCovers(t.cx, t.cy)) {
          // Two reflective layers at the same location make the tile grid visible in WebGPU.
          // The continuous regional surface now replaces this temporary tile surface.
          mesh.removeFromParent(); this.o.forget?.(new Set([material]));
        }
      }
      this.seaCoverage.update(this.o.viewWater?.() ?? [], [x - R, y - R, x + R, y + R],water.field.coast?.data);
      this.o.addWarm(this.root, water.mesh);
    } finally { this.regionBusy = false; }
  }
  private dropRegion() {
    const r = this.region;
    if (!r) return;
    this.region = null;
    if (r.mesh.parent) { r.mesh.removeFromParent(); this.o.forget?.(new Set([r.mesh.material as THREE.Material])); }
    r.dispose();
  }

  /** What a tile's roads need of the sea and the landmark bridge: the sea round it (out to
   * 1.5 km: a bridge's ends), its level, and 광안대교's deck when it is near. */
  private roadExtras(t: Tile) {
    const w = this.regionWater, M = 1500;
    const box: [number, number, number, number] = [t.box[0] - M, t.box[1] - M, t.box[2] + M, t.box[3] + M];
    const sea = w ? w.rings.map(r => clipToBox(r.ring, box)).filter(r => r.length >= 3) : [];
    const seaHoles=w?w.rings.flatMap(r=>r.islands.map(h=>clipToBox(h,box)).filter(h=>h.length>=3)):[];
    const seaLevel = this.base === null ? undefined : -this.base;
    const d = this.landmarks.gwanganDeck();
    const near = d && d.P.some(([x, y]) => x > box[0] && x < box[2] && y > box[1] && y < box[3]);
    return { sea, seaHoles, seaLevel, deck: near ? { pts: d.P, z: d.z } : undefined };
  }

  /** Landmark lanes also exist on all-sea tiles and inside the initial scene square. */
  private bridgeTraffic(t: Tile) {
    const deck = this.landmarks.gwanganDeck();
    const extra = deck && !OFF.includes('roads') ? bridgeTileLanes(deck.sections, deck.lower, t.box) : new Float32Array();
    const base = t.baseLanes ?? new Float32Array();
    const lanes = new Float32Array(base.length + extra.length);
    lanes.set(base); lanes.set(extra, base.length); t.lanes = lanes;
    if (lanes.length) this.traffic.addTile(t.key, lanes, t.stops,t.banks);
    else this.traffic.removeTile(t.key);
  }

  /** A landmark site's boxes (the register's extrusions on this tile, inside the site's radius)
   * folded away: the site's surveyed models stand there. */
  private hideInSite(t: Tile, site: LandmarkSite) {
    const spans = t.spans, rings = t.spanRings;
    if (!spans || !rings) return;
    const [sx, sy] = this.landmarks.at(site.lat, site.lon), touched = new Set<THREE.BufferGeometry>();
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      if (!r?.length) continue;
      const cx = r.reduce((a, q) => a + q[0], 0) / r.length, cy = r.reduce((a, q) => a + q[1], 0) / r.length;
      if (Math.hypot(cx - sx, cy - sy) > site.radius) continue;
      if (!this.landmarks.hasModelAt(site, cx, cy)) continue;
      const g = t.styleGeo[SURVEY_STYLES[spans[i * 5]]];
      const pos = g?.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!g || !pos) continue;
      const a = pos.array as Float32Array, w0 = spans[i * 5 + 1], px = a[w0 * 3], py = a[w0 * 3 + 1], pz = a[w0 * 3 + 2] - 50;
      // (every vertex of it at one point under the ground: its triangles have no area)
      const fold = (start: number, count: number) => { for (let v = start; v < start + count; v++) { a[v * 3] = px; a[v * 3 + 1] = py; a[v * 3 + 2] = pz; } };
      fold(spans[i * 5 + 1], spans[i * 5 + 2]); fold(spans[i * 5 + 3], spans[i * 5 + 4]);
      touched.add(g);
    }
    for (const g of touched) { (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true; g.computeBoundingSphere(); }
  }

  /** The tile's water, as the server has it at once (its sea from the bundled coastline). */
  private async seaAnswer(t: Tile): Promise<SeaBody | null> {
    if (typeof location === "undefined") return null;
    const H = TILE_M / 2, c = this.o.data.center!;
    // (the region's answer, cut to the tile: waited for a few seconds as it comes)
    const covers = () => { const w = this.regionWater; return !!w && Math.max(Math.abs(t.cx - w.x), Math.abs(t.cy - w.y)) + H <= w.R; };
    if (!covers()) await Promise.race([new Promise<void>(r => this.regionWait.push(r)), new Promise(r => setTimeout(r, 8000))]);
    if (covers()) {
      const w = this.regionWater!, box: [number, number, number, number] = [t.cx - H, t.cy - H, t.cx + H, t.cy + H];
      const local = (r: [number, number][]) => r.map(([px, py]) => [px - t.cx, py - t.cy] as [number, number]);
      const rings: NonNullable<SeaBody["rings"]> = [];
      for (const sw of w.rings) {
        const cut = clipToBox(sw.ring, box);
        if (cut.length < 3) continue;
        const islands = sw.islands.map(h => clipToBox(h, box)).filter(h => h.length >= 3).map(local);
        rings.push({ ring: local(cut), kind: "sea", ...(islands.length ? { islands } : {}) });
      }
      const beaches = w.beaches.map(b => clipToBox(b, box)).filter(b => b.length >= 3).map(b => ({ ring: local(b) }));
      // (the works with a point on the tile — each on the one tile its first point is on, whole)
      const works = w.works.filter(k => { const [px, py] = k.pts[0]; return px >= box[0] && py >= box[1] && px < box[2] && py < box[3]; }).map(k => ({ ...k, pts: local(k.pts) }));
      return { rings, beaches, works };
    }
    const lat = c.lat + t.cy / this.ky, lon = c.lon + t.cx / this.kx;
    return fetch(`${location.origin}/api/realestate/water?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&r=${H}&v=3&fast=1`, { signal: AbortSignal.timeout(12000) })
      .then(r => (r.ok ? r.json() : null)).catch(() => null) as Promise<SeaBody | null>;
  }
  /** Whether the sea covers the whole tile (its islands, rocks and piers aside: under 0.5 %). */
  private seaCovers(body: SeaBody) {
    const area = (r: [number, number][]) => Math.abs(r.reduce((a, [x, y], i) => { const q = r[(i + 1) % r.length]; return a + x * q[1] - q[0] * y; }, 0) / 2);
    let wet = 0;
    for (const w of body.rings ?? []) if (w.kind === "sea") wet += area(w.ring) - (w.islands ?? []).reduce((a, h) => a + area(h), 0);
    return wet >= TILE_M * TILE_M * 0.995;
  }
  /** Tile boundaries are neither shores nor depth changes. Sample the region in world metres. */
  private alignSea(mesh: THREE.Mesh, ox: number, oy: number) {
    const geo = mesh.geometry, pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const shore = geo.getAttribute("aShore") as THREE.BufferAttribute, flow = geo.getAttribute("aFlow") as THREE.BufferAttribute;
    const field = this.region?.field, level = this.base === null ? null : -this.base + 0.12;
    for (let i = 0; i < pos.count; i++) {
      if (level !== null) pos.setY(i, level);
      if (!field) continue;
      const x = pos.getX(i) + ox, y = -pos.getZ(i) + oy, sh = field.shore(x, y);
      shore.setX(i, sh);
      const gx = field.shore(x + 3, y) - field.shore(x - 3, y), gy = field.shore(x, y + 3) - field.shore(x, y - 3), gl = Math.hypot(gx, gy);
      const k = Math.min(1, Math.max(0, (sh - 30) / 50));
      let fx = -0.6, fy = 0.8;
      if (gl > 1e-3 && k < 1) { fx = -gx / gl * (1 - k) - 0.6 * k; fy = gy / gl * (1 - k) + 0.8 * k; const n = Math.hypot(fx, fy) || 1; fx /= n; fy /= n; }
      flow.setXY(i, fx, fy);
    }
    pos.needsUpdate = true; shore.needsUpdate = true; flow.needsUpdate = true;
    geo.computeBoundingSphere();
  }
  private regionCovers(x: number, y: number) {
    const r = this.region, w = this.regionWater;
    return !!r?.field && !!w && Math.max(Math.abs(x - r.x), Math.abs(y - r.y)) + TILE_M / 2 <= w.R;
  }
  private async seaOn(t: Tile, ground: THREE.BufferGeometry | null, terrain: Terrain, signal: AbortSignal, answer?: SeaBody | null) {
    const H = TILE_M / 2;
    const regional=this.regionCovers(t.cx,t.cy)?this.region?.field?.coast?.data:null;
    const sink=async(data:NonNullable<WaterField['coast']>['data'])=>{
      if(!ground)return;
      const sunk=await this.coastJobs.sink(ground,data,0,signal);
      if(signal.aborted||this.disposed){sunk?.dispose();return;}
      if(!sunk)throw Error('Sea ground cut unavailable');
      for(const[name,a]of Object.entries(sunk.attributes))ground.setAttribute(name,a);
      ground.setIndex(sunk.index);ground.boundingSphere=sunk.boundingSphere;sunk.dispose();
    };
    // A tile-local query may omit a thin coastline fragment still covered by the
    // regional water. Cut its ground from that same source even without local sea.
    if(regional)await sink(regional);
    if(signal.aborted||this.disposed)return;
    const body = answer !== undefined ? answer : t.seaBody !== undefined ? t.seaBody : await this.seaAnswer(t);
    const seas = (body?.rings ?? []).filter(w => w.kind === "sea");
    t.plantWater=plantingWaterMask(body?.rings ?? []);
    if (!seas.length || signal.aborted || this.disposed) return;
    const parcels: RealEstateParcel[] = seas.map(w => ({ kind: "유", sea: true, ring: w.ring, holes: w.islands, open: [-H, -H, H, H] }));
    const water = await buildWater(parcels, parcels.map(() => false), terrain, () => this.pace());
    if (!water || signal.aborted || this.disposed) { water?.dispose(); return; }
    this.alignSea(water.mesh, t.cx, t.cy);
    // (none of it inside the view's square: the view's own sea is there)
    const F = this.o.extent.farHalf;
    const cut = seaOutsideBox(water.mesh.geometry, [-F - t.cx, -F - t.cy, F - t.cx, F - t.cy]);
    water.mesh.geometry = cut;
    t.dispose.push(() => cut.dispose());
    // the tile's ground under the sea: below its surface (the DEM's coast rises through it)
    if(ground&&!regional&&water.field.coast){
      const data=water.field.coast.data,shift=(ring:[number,number][])=>ring.map(([x,y])=>[x+t.cx,y+t.cy] as [number,number]);
      const coast:NonNullable<WaterField['coast']>['data']={...data,rings:data.rings.map(shift),holes:data.holes.map(shift),
        level:this.base===null?data.level:-this.base,open:data.open?[data.open[0]+t.cx,data.open[1]+t.cy,data.open[2]+t.cx,data.open[3]+t.cy]:null};
      try{await sink(coast);}catch(err){water.dispose();throw err;}
      if(signal.aborted||this.disposed){water.dispose();return;}
    }
    const yup = t.yup ?? new THREE.Group();
    yup.name = `drone tile ${t.key} sea`;
    yup.position.set(t.cx, 0, -t.cy);
    if (!this.regionCovers(t.cx, t.cy)) yup.add(water.mesh);
    // its breakwaters, groynes and piers (none inside the view's square: the view has its own)
    const works = (body?.works ?? []).filter(k => { const [px, py] = k.pts[0]; return Math.abs(px + t.cx) >= this.o.extent.farHalf || Math.abs(py + t.cy) >= this.o.extent.farHalf; });
    if (works.length) {
      let lvl = this.base === null ? NaN : -this.base;
      if (!Number.isFinite(lvl)) for (const k of works) for (const [px, py] of k.pts) { if (water.field.wet(px, py)) { lvl = water.field.level(px, py); break; } }
      if (!Number.isFinite(lvl)) { const g = (water.mesh.geometry.getAttribute("position") as THREE.BufferAttribute); if (g.count) lvl = g.getY(0) - 0.12; }
      const sw = buildSeaWorks(works, lvl, this.o.seed + t.i * 31 + t.j * 17, { maxTetrapods: this.o.hq ? 1500 : 700 });
      if (sw) {
        yup.add(sw.group);
        sw.group.traverse(o => { const m = (o as THREE.Mesh).material; if (m) for (const x of Array.isArray(m) ? m : [m]) t.materials.push(x); });
        t.dispose.push(() => sw.dispose());
      }
    }
    yup.updateMatrixWorld(true);
    staticSceneTransforms(yup);
    t.yup = yup;
    t.materials.push(water.mesh.material as THREE.Material);
    t.dispose.push(() => water.dispose());
  }

  /** The tile's rivers, streams and ponds as the view's own water (sceneWater: the same surface,
   * waves, reflections and depth): the open-water parcels and stream areas, the channel where the
   * relief is within 0.7 m of its lowest; the ground under it lowered below the surface, so the
   * water's edge is where the surveyed banks rise out of it. Not where the sea already is. */
  private async riverOn(t: Tile, ground: THREE.BufferGeometry, terrain: Terrain, water: { ring: [number, number][]; holes: [number, number][][] }[], signal: AbortSignal) {
    const H = TILE_M / 2;
    const seaRings = (t.seaBody?.rings ?? []).filter(w => w.kind === 'sea').map(w => w.ring);
    const parcels: RealEstateParcel[] = water.map(w => ({ kind: '천', ring: w.ring, holes: [...w.holes, ...seaRings], open: [-H - 80, -H - 80, H + 80, H + 80] }));
    const rt = (w: string) => { if (DTRACE) console.info(`[dtile] ${t.key} river-${w} ${Math.round(performance.now())}`); };
    rt('begin');
    // (its field made 12 m past the tile — no shore at its edge — and its surface laid over the
    // rings cut exactly to it: the next tile's surface meets it edge to edge, no strip of bed between
    // them, no two surfaces over one another)
    const made = await buildWater(parcels, parcels.map(() => false), terrain, () => this.pace(), { clip: H });
    if (!made || signal.aborted || this.disposed) { made?.dispose(); return; }
    t.riverField=made.field;
    rt('built');
    rt('cut');
    // The bed under the water, and the streets and lanes kept over it: in the scene worker (riverLower.ts).
    const p = ground.getAttribute('position') as THREE.BufferAttribute, nor = ground.getAttribute('normal') as THREE.BufferAttribute;
    const skirt = ground.userData.skirtGrid as { row: number; cell: number } | undefined;
    const streets = (t.zup?.children ?? []).filter(m => { const me = m as THREE.Mesh, mat = me.material; return me.isMesh && (mat === this.asphalt || mat === this.paint || mat === this.paving); }) as THREE.Mesh[];
    const copy = (): RiverLowerArgs => ({ field: made.field.data, grid: terrain.grid ?? null, H, cx: t.cx, cy: t.cy,
      ground: (p.array as Float32Array).slice(), normal: (nor.array as Float32Array).slice(), skirtRow: skirt?.row ?? null,
      surfaces: streets.map(m => ({ position: (m.geometry.getAttribute('position').array as Float32Array).slice(), lift: m.material === this.paint ? 0.08 : m.material === this.paving ? 0.15 : 0 })),
      lanes: t.baseLanes ? t.baseLanes.slice() : null });
    // (copies, handed over: the meshes keep theirs till the answer is in)
    const args = copy(), job = terrain.grid ? sceneWork('riverLower', args, [args.ground.buffer, args.normal.buffer, ...args.surfaces.map(s => s.position.buffer), ...(args.lanes ? [args.lanes.buffer] : [])]) : null;
    let low: RiverLowerResult | null = null;
    if (job) try { low = await job; } catch { low = null; }
    if (!low) low = lowerUnderRiver(copy(), terrain.at);
    if (signal.aborted || this.disposed || !await this.pace()) { made.dispose(); return; }
    if (low.ground) {
      (p.array as Float32Array).set(low.ground); p.needsUpdate = true;
      if (low.normal) { (nor.array as Float32Array).set(low.normal); nor.needsUpdate = true; }
      ground.computeBoundingSphere();
    }
    rt('bed');
    low.surfaces.forEach((q, i) => { if (!q) return; const g = streets[i].geometry, a = g.getAttribute('position') as THREE.BufferAttribute; (a.array as Float32Array).set(q); a.needsUpdate = true; g.computeBoundingSphere(); });
    if (low.lanes && t.baseLanes && t.baseLanes.length === low.lanes.length) t.baseLanes.set(low.lanes);
    // Waves continuous across the tiles: every river surface's waves in one direction (the sea's)
    // and its uv in world metres — each tile's own channel axis and origin drew its edge as a line.
    {
      const g = made.mesh.geometry, pos = g.getAttribute('position') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined, flow = g.getAttribute('aFlow') as THREE.BufferAttribute | undefined;
      for (let i = 0; i < pos.count; i++) {
        if (uv) uv.setXY(i, pos.getX(i) + t.cx, -pos.getZ(i) + t.cy);
        if (flow) flow.setXY(i, -0.6, 0.8);
      }
      if (uv) uv.needsUpdate = true; if (flow) flow.needsUpdate = true;
    }
    rt('roads');
    made.mesh.name = 'drone tile river';
    const yup = t.yup ?? new THREE.Group();
    if (!t.yup) { yup.name = `drone tile ${t.key} water`; yup.position.set(t.cx, 0, -t.cy); }
    yup.add(made.mesh);
    yup.updateMatrixWorld(true);
    staticSceneTransforms(yup);
    t.yup = yup;
    t.materials.push(made.mesh.material as THREE.Material);
    t.dispose.push(() => made.dispose());
  }

  /** The tile's ground: a 4 m grid on its relief, uv over the land-use picture (north at v 0),
   * with a 4 m skirt round it (no crack against the view's own ground or a neighbour). */
  private groundMesh(t: Tile, grid: TileGrid, at: (x: number, y: number) => number) {
    const S = Math.round(TILE_M / grid.cell), row = S + 1, cell = grid.cell;
    const n = row * row + 4 * row;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), UV = new Float32Array(n * 2);
    const [x0, y0] = t.box;
    const h = (x: number, y: number) => at(x - grid.ox, y - grid.oy);
    for (let j = 0; j < row; j++) for (let i = 0; i < row; i++) {
      const k = j * row + i, x = x0 + i * cell, y = y0 + j * cell, z = h(x, y);
      P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z;
      const nx = h(x - cell, y) - h(x + cell, y), ny = h(x, y - cell) - h(x, y + cell), nz = 2 * cell, l = Math.hypot(nx, ny, nz);
      N[k * 3] = nx / l; N[k * 3 + 1] = ny / l; N[k * 3 + 2] = nz / l;
      UV[k * 2] = i / S; UV[k * 2 + 1] = 1 - j / S;
    }
    const idx: number[] = [];
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
    // Skirts: each edge's vertices again, 4 m lower.
    const edges = [
      Array.from({ length: row }, (_, i) => i),
      Array.from({ length: row }, (_, j) => j * row + S),
      Array.from({ length: row }, (_, i) => S * row + S - i),
      Array.from({ length: row }, (_, j) => (S - j) * row),
    ];
    let o = row * row;
    for (const e of edges) {
      const start = o;
      for (const k of e) {
        P[o * 3] = P[k * 3]; P[o * 3 + 1] = P[k * 3 + 1]; P[o * 3 + 2] = P[k * 3 + 2] - 4;
        N.copyWithin(o * 3, k * 3, k * 3 + 3); UV[o * 2] = UV[k * 2]; UV[o * 2 + 1] = UV[k * 2 + 1];
        o++;
      }
      for (let q = 0; q + 1 < e.length; q++) {
        const a = e[q], b = e[q + 1], c = start + q, d = start + q + 1;
        idx.push(a, c, d, a, d, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(UV, 2));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    geo.userData.skirtGrid = { row, cell, edges };
    geo.computeBoundingSphere();
    return geo;
  }

  /** A tile's towers in their surveyed shapes, as the view's ring does its apartment blocks
   * (ComplexHologram): VWorld's 3D model of each — shape only, never its photograph — made in a
   * worker (droneSurveyWorker.ts); the page makes a mesh per material and, once those are drawn,
   * empties the boxes they replace from the style meshes. */
  private async surveyTile(t: Tile) {
    const { data } = this.o, stop = t.stop;
    // (not the towers of a landmark site: its photo-textured models stand there — sceneLandmarks)
    const inSite = (x: number, y: number) => LANDMARK_SITES.some(st => { const [sx, sy] = this.landmarks.at(st.lat, st.lon); return Math.hypot(x - sx, y - sy) < st.radius; });
    const all = t.towers!, candidates:number[]=[];
    const eligible:number[]=[];
    for(let i=0;i<all.length;i+=TOWER)if(!inSite(all[i],all[i+1])&&!t.surveyHidden?.has(all[i+6]+':'+all[i+4])){
      eligible.push(i);if(performance.now()>=(t.surveyDeferred?.get(all[i+6]+':'+all[i+4])?.at??0))candidates.push(i);
    }
    // A whole dense 340m tile could monopolise both workers for twenty seconds.
    // Apply small near-first batches so visible buildings finish while the rest
    // continue with the same worker/download limits and full source resolution.
    const priority=(i:number)=>droneDetailPriority(all[i],all[i+1],t.appearances?.[all[i+7]]?.floors??Math.round(all[i+2]/3),this.scheduleX,this.scheduleY,this.aheadX,this.aheadY,this.scheduleLook);
    candidates.sort((a,b)=>priority(a)-priority(b));
    const selected=candidates.slice(0,12),keepT:number[]=[];
    for(const i of selected)for(let k=0;k<TOWER;k++)keepT.push(all[i+k]);
    const towers = new Float32Array(keepT);
    const nextState=()=>{
      const remaining=eligible.filter(i=>!t.surveyHidden?.has(all[i+6]+':'+all[i+4]));
      if(!remaining.length){t.survey='ready';t.surveyRetryAt=undefined;return;}
      const next=Math.min(...remaining.map(i=>t.surveyDeferred?.get(all[i+6]+':'+all[i+4])?.at??0));
      t.survey=next<=performance.now()?'none':'unavailable';t.surveyRetryAt=next;
    };
    const defer=(hide:ArrayLike<number>,retry:boolean)=>{
      const matched=new Set<string>();for(let i=0;i<hide.length;i+=3)matched.add(hide[i]+':'+hide[i+1]);
      t.surveyDeferred??=new Map();
      for(let i=0;i<towers.length;i+=TOWER){const id=towers[i+6]+':'+towers[i+4];
        if(matched.has(id)){t.surveyDeferred.delete(id);continue;}
        const tries=(t.surveyDeferred.get(id)?.tries??0)+1;
        t.surveyDeferred.set(id,{tries,at:performance.now()+(retry?Math.min(30000,2500*tries):60000)});
      }
    };
    if (!towers.length) {nextState();return;}
    t.survey = "running";
    t.surveyTries = (t.surveyTries ?? 0) + 1;
    this.surveying++;
    try {
      // (each block's colour, from its box: the shape is painted as the box was)
      const n = towers.length / TOWER, tints = new Float32Array(n * 3), facadeScale = new Float32Array(n).fill(1);
      const colourVersion=t.colourVersion??0,surfaceTints=t.spans?new Float32Array(n*6).fill(NaN):undefined;
      for (let i = 0; i < n; i++) {
        const near=t.near?.[towers[i*TOWER+7]];
        if(near){tints.set(near.appearance.wall,i*3);facadeScale[i]=1/near.appearance.storey;continue;}
        const g = t.styleGeo[SURVEY_STYLES[towers[i * TOWER + 6]]];
        if (!g?.index) continue;
        const col = g.getAttribute("color"), v = g.index.getX(towers[i * TOWER + 4]);
        tints[i * 3] = col.getX(v); tints[i * 3 + 1] = col.getY(v); tints[i * 3 + 2] = col.getZ(v);
        const source = towers[i*TOWER+7], first = t.spans?.[source*5+1];
        if(surfaceTints&&t.spans)for(let surface=0;surface<2;surface++){
          const vertex=t.spans[source*5+(surface===1?3:1)];
          if(vertex!==undefined&&vertex<col.count)surfaceTints.set([col.getX(vertex),col.getY(vertex),col.getZ(vertex)],i*6+surface*3);
        }
        const p = g.getAttribute('position'), uv = g.getAttribute('uv');
        if (first !== undefined && p && uv && first+2 < p.count) {
          const dz = p.getZ(first+2)-p.getZ(first);
          if (Math.abs(dz)>1) facadeScale[i] = Math.abs((uv.getY(first+2)-uv.getY(first))/dz);
        }
      }
      // Every target carries its registered outline. This also locates towers
      // whose model's centre/height differs from the building register.
      const outlines: [number, number][][] = [];
      for (let i = 0; i < n; i++) {
        outlines.push((t.spanRings?.[towers[i * TOWER + 7]] ?? []) as [number, number][]);
      }
      const res = await this.surveyWork({ key: data.vworld_key!, lat0: data.center!.lat, lon0: data.center!.lon, towers: towers.slice(), tints, surfaceTints, facadeScale, outlines,appearances:Array.from({length:n},(_,i)=>t.appearances?.[towers[i*TOWER+7]]),roadGuard:packedRoadGuard(t.nearRoadGuard),debug:typeof location!=='undefined'&&new URLSearchParams(location.search).get('dronedebug')==='1' }, stop.signal) as SurveyResult | null;
      if (!res){defer([],true);nextState();return;}
      if(this.disposed || stop.signal.aborted || !t.zup || !this.liveTile(t))return;
      (t as unknown as { surveyInfo: unknown }).surveyInfo = { models: res.models, matched: res.matched, expected: n, retry: res.retry, tall: res.tall,misses:res.misses };
      if (!res.parts.length) {defer([],res.retry);nextState();return;}
      if(!t.surveyStore){t.surveyStore=new SurveyGeometryStore();const store=t.surveyStore;t.dispose.push(()=>store.dispose());}
      const store=t.surveyStore,transaction=store.append(res.parts);
      const group=t.surveyGroup??new THREE.Group(),newMeshes:THREE.Mesh[]=[];
      group.name = `drone tile ${t.key} surveyed`;
      for (const entry of transaction.newEntries) {
        const mesh = new THREE.Mesh(entry.geo,entry.material >= 0 && entry.geo.getAttribute('uv') ? sharedContextMaterial(SURVEY_STYLES[entry.material]) : this.plain);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.solid = true;
        mesh.userData.railBuilding = true;
        group.add(mesh);
        newMeshes.push(mesh);
      }
      const rollback=()=>{newMeshes.forEach(m=>m.removeFromParent());transaction.rollback();};
      // Most batches already carry exact current wall/roof evidence from the
      // worker. Only a late/in-progress aerial update needs page-side repaint.
      try{if((t.colourVersion??0)!==colourVersion||(t.colourVersion??0)%2===1)await this.paintSurvey(t, transaction.paints);}catch(error){rollback();throw error;}
      if (this.disposed || stop.signal.aborted || !t.zup) { rollback(); return; }
      t.zup.add(group);
      group.updateMatrixWorld(true);
      staticSceneTransforms(group);
      if (!t.castB) castShadows(group, false);
      // Keep the preceding meshes until the full replacement is GPU-ready.
      t.surveyGroup=group;t.surveyGeos=store.entries.map(e=>e.geo);t.surveyPaint=store.entries;
      t.survey = "placed";
      const hide = res.hide;
      const uploadedAt=performance.now();
      const retryUpload=()=>{rollback();t.surveyGeos=store.entries.map(e=>e.geo);t.surveyPaint=store.entries;defer([],true);nextState();};
      // (the boxes go once the shapes are drawn: never a frame with neither)
      const swap = () => {
        if (!group.parent || stop.signal.aborted || !this.liveTile(t)) return;
        try{
          if (!this.o.drawReady(group)) {
            if(performance.now()-uploadedAt>=15000){retryUpload();return;}
            requestAnimationFrame(swap); return;
          }
        }catch{retryUpload();return;}
        for (let k = 0; k < hide.length; k += 3) {
          if(t.near){t.near[hide[k+1]]?.hide();t.surveyHidden??=new Set();t.surveyHidden.add(hide[k]+':'+hide[k+1]);continue;}
          const g = t.styleGeo[SURVEY_STYLES[hide[k]]];
          if (!g?.index) continue;
          if (t.view) { t.surveyUndo ??= []; t.surveyUndo.push({ geo:g, start:hide[k+1], indices:new Uint32Array(g.index.array.slice(hide[k+1], hide[k+1]+hide[k+2])) }); }
          (g.index.array as Uint32Array).fill(0, hide[k + 1], hide[k + 1] + hide[k + 2]);
          g.index.addUpdateRange(hide[k+1],hide[k+2]);
          g.index.needsUpdate = true;
          t.surveyHidden ??= new Set(); t.surveyHidden.add(hide[k]+':'+hide[k + 1]);
        }
        defer(hide,res.retry);
        transaction.commit();
        nextState();
      };
      requestAnimationFrame(swap);
    } catch {
      console.info("[3D] drone survey will retry:", t.key);
    } finally {
      this.surveying--;
      if(t.survey==='running'){defer([],true);nextState();}
    }
  }
  /** Bounded colour evidence, with a neutral per-building fallback for uncertain
   * roof medians. Constructed facades retain their registered material profile. */
  private async colourTile(t: Tile) {
    const { data } = this.o, spans = t.spans!, rings = t.spanRings!, stop = t.stop;
    t.colour = "running";
    t.colourTries = (t.colourTries ?? 0) + 1;
    try {
      const res = await this.surveyWork({ kind: "colours", key: data.vworld_key!, lat0: data.center!.lat, lon0: data.center!.lon, rings: rings as [number, number][][] }, stop.signal) as ColourResult | null;
      if (!res || res.retry || this.disposed || stop.signal.aborted || !this.liveTile(t)) return;
      t.colourVersion=(t.colourVersion??0)+1;
      const touched = new Set<THREE.BufferGeometry>();
      for (let i = 0; i < res.colours.length; i++) {
        const c = res.colours[i];
        if (!c) continue;
        const g = t.styleGeo[SURVEY_STYLES[spans[i * 5]]];
        const col = g?.getAttribute("color") as THREE.BufferAttribute | undefined;
        if (!g || !col) continue;
        const a = col.array as Float32Array;
        const paint = (start: number, count: number, rgb: [number, number, number]) => { for (let v = start; v < start + count; v++) { a[v * 3] = rgb[0]; a[v * 3 + 1] = rgb[1]; a[v * 3 + 2] = rgb[2]; } };
        // (the walls: the photograph's paint only where it is clearly paint — bright, not a wall in
        // shade — mixed into the colour the structure gave; the roof as the photograph shows it)
        const ws = spans[i * 5 + 1], f = c.facade;
        if (!t.appearances?.[i]&&f && 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2] > 0.42) {
          const mix: [number, number, number] = [a[ws * 3] * 0.35 + f[0] * 0.65, a[ws * 3 + 1] * 0.35 + f[1] * 0.65, a[ws * 3 + 2] * 0.35 + f[2] * 0.65];
          paint(ws, spans[i * 5 + 2], mix);
        }
        const appearance=t.appearances?.[i];
        paint(spans[i * 5 + 3], spans[i * 5 + 4], appearance?observedRoofColour(appearance,c.roof,c.pitched):c.roof);
        touched.add(g);
        if (i % 200 === 199 && !await this.pace()) return;
      }
      for (const g of touched) (g.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
      t.colourVersion=(t.colourVersion??0)+1;
      await this.paintSurvey(t);
      if (this.disposed || stop.signal.aborted || !this.liveTile(t)) return;
      t.colour = "done";
    } catch {
      console.info("[3D] drone colours will retry:", t.key);
    } finally {
      // A partially applied update is also a new stable source snapshot when
      // its coroutine exits; the next retry must begin with an even revision.
      if((t.colourVersion??0)%2===1)t.colourVersion=(t.colourVersion??0)+1;
      if (t.colour === "running") { t.colour = undefined; t.colourRetryAt = performance.now() + Math.min(30000, 2500 * (t.colourTries ?? 1)); }
    }
  }

  /** Late aerial colours must also update the surveyed replacements. Paint in
   * bounded slices, keeping each roof independent of its facade and plain ends. */
  private async paintSurvey(t: Tile, paints = t.surveyPaint ?? []) {
    const source = t.spans;
    if (!source) return;
    for (const { geo, spans } of paints) {
      if(!spans.length)continue;
      const target = geo.getAttribute('color') as THREE.BufferAttribute;
      const a = target.array as Float32Array;
      for (let k = 0; k < spans.length; k += 5) {
        const [style, outline, first, count, surface] = spans.subarray(k, k + 5);
        const col = t.styleGeo[SURVEY_STYLES[style]]?.getAttribute('color');
        const vertex = source[outline*5 + (surface === 1 ? 3 : 1)], scale = surface === 2 ? .86 : 1;
        if (!col || vertex === undefined) continue;
        const r = col.getX(vertex)*scale, g = col.getY(vertex)*scale, b = col.getZ(vertex)*scale;
        for (let v = first; v < first+count; v++) {
          a[v*3] = r; a[v*3+1] = g; a[v*3+2] = b;
          if ((v-first)%8192 === 8191 && (!await this.pace() || t.stop.signal.aborted)) return;
        }
        target.addUpdateRange(first*3,count*3);
      }
      target.needsUpdate = true;
    }
  }

  private surveyPool: SceneWorkerPool<Omit<SurveyJob, "id"> | Omit<ColourJob, "id">, SurveyResult | ColourResult> | null = null;
  private colourPool: SceneWorkerPool<Omit<ColourJob, "id">, ColourResult> | null = null;
  private surveyWork(job: Omit<SurveyJob, "id"> | Omit<ColourJob, "id">, signal: AbortSignal): Promise<SurveyResult | ColourResult | null> {
    // Image analysis cannot hold both detailed-shape slots while the drone moves.
    if ('kind' in job) {
      this.colourPool ??= new SceneWorkerPool(() => new Worker(new URL("./droneSurveyWorker.ts", import.meta.url), { type: "module" }), 1);
      return this.colourPool.run(job, signal);
    }
    this.surveyPool ??= new SceneWorkerPool(() => new Worker(new URL("./droneSurveyWorker.ts", import.meta.url), { type: "module" }), this.o.hq ? 2 : 1);
    return this.surveyPool.run(job, signal, [job.towers.buffer, job.tints.buffer, ...(job.surfaceTints ? [job.surfaceTints.buffer] : []), ...(job.facadeScale ? [job.facadeScale.buffer] : [])]);
  }

  /** Trees (view frame) on a collision grid: each a crown ~4.5 m round, up to 12 m over its
   * ground (the kit's park and woodland trees are 6–14 m tall). */
  private treesOnGrid(r: Roofs, trees: [number, number][], ground: (x: number, y: number) => number) {
    const reach = Math.ceil(4.5 / r.cell);
    for (const [x, y] of trees) {
      const top = ground(x, y) + 12, ci = Math.floor((x - r.x0) / r.cell), cj = Math.floor((y - r.y0) / r.cell);
      for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= r.nx || j >= r.ny || Math.hypot(di, dj) * r.cell > 4.5) continue;
        if (r.h[j * r.nx + i] < top) r.h[j * r.nx + i] = top;
      }
    }
  }

  /** Plant a tile's trees (scenePlants, as the view's own: the same kit, its workers). */
  /** The last trees' build times (ms), for the checks. */
  plantMs: number[] = [];
  private dryPlanting(t:Tile,p:Planting){
    return filterPlanting(p,(x,y)=>!t.plantWater?.(x,y)&&!t.riverField?.wet(x,y)&&!this.region?.field?.wet(x+t.cx,y+t.cy));
  }
  private async plant(t: Tile) {
    if (!t.planting || !t.local || t.plants) return;
    t.planting=this.dryPlanting(t,t.planting);
    const planting=t.planting;
    const entry: NonNullable<Tile["plants"]> = { state: "building", group: null, materials: [], dispose: () => {} };
    t.plants = entry;
    this.planting++;
    try {
      const pt0 = performance.now();
      const plants = await buildPlants(planting, this.o.seed + 887 + t.i * 31 + t.j * 17, t.local, this.o.hq).catch(() => null);
      this.plantMs.push(Math.round(performance.now() - pt0)); if (this.plantMs.length > 50) this.plantMs.shift();
      if (this.disposed || t.plants !== entry || !this.tiles.has(t.key)) { plants?.dispose(); return; }
      if(this.dryPlanting(t,planting)!==planting){plants?.dispose();t.planting=this.dryPlanting(t,planting);t.plants=null;return;}
      if (!plants) { t.planting = null; t.plants = null; return; }
      const yup = new THREE.Group();
      yup.name = `drone tile ${t.key} plants`;
      yup.position.set(t.cx, 0, -t.cy);
      yup.add(plants.mesh);
      yup.updateMatrixWorld(true);
      staticSceneTransforms(yup);
      // (its woodland drawn from its cell's pooled meshes)
      this.plantPool.adopt(t.key, t.i, t.j, yup);
      plants.mesh.traverse(o => { const m = (o as THREE.Mesh).material; if (m) for (const x of Array.isArray(m) ? m : [m]) entry.materials.push(x); });
      entry.group = yup; entry.dispose = () => plants.dispose();
      if (!t.castP) castShadows(yup, false);
      this.o.addWarm(this.root, yup);
      entry.state = "placed";
    } finally { this.planting--; }
  }
  private unplant(t: Tile) {
    const p = t.plants;
    if (!p) return;
    t.plants = null;
    this.plantPool.release(t.key);
    if (p.group) { p.group.userData.sceneDiscarded=true; this.root.remove(p.group); }
    if (p.materials.length) this.o.forget?.(new Set(p.materials));
    p.dispose();
  }

  private clear(t: Tile) {
    t.near?.forEach(b=>b.restore());t.near=undefined;t.nearObjects=undefined;t.nearRoadGuard=undefined;
    for (const row of t.surveyUndo ?? []) if (row.geo.index) { (row.geo.index.array as Uint32Array).set(row.indices,row.start);row.geo.index.addUpdateRange(row.start,row.indices.length); row.geo.index.needsUpdate = true; }
    t.surveyUndo = undefined;
    this.unplant(t);
    this.traffic.removeTile(t.key);
    this.o.onLabels?.(t.key, null);
    this.placeFootprints.remove(t.key);
    this.o.onLabels?.('bridges:'+t.key, null);
    for (const g of [t.zup, t.yup]) if (g) this.root.remove(g);
    if (t.materials.length) this.o.forget?.(new Set(t.materials));
    for (const f of t.dispose) f();
    t.zup = t.yup = null; t.materials = []; t.dispose = []; t.roofs = null; t.surveyGroup = null; t.styleGeo = {}; t.lanes = t.baseLanes = t.stops = undefined;
    t.survey = "none"; t.colour = undefined; t.towers = null; t.spans = undefined; t.spanRings = undefined;t.appearances=undefined;
    t.buildingGroup = undefined; t.surveyHidden = undefined; t.surveyPaint = undefined;t.surveyDeferred=undefined;t.surveyGeos=undefined;t.surveyStore=undefined;
    t.plantWater=undefined;t.riverField=undefined;t.seaBody=undefined;
    t.planting = null; t.local = null; t.marks = undefined; t.fine = undefined; t.walkPaths = undefined;
  }
  private drop(t: Tile) {
    t.stop.abort();
    this.clear(t);
    this.tiles.delete(t.key);
  }
  dispose() {
    this.disposed = true;
    for (const t of [...this.tiles.values()]) this.drop(t);
    for (const t of this.viewTiles.values()) { t.stop.abort(); this.clear(t); }
    this.viewTiles.clear(); this.adoptedView = null;
    this.dropRegion();
    this.seaCoverage.restore();
    this.coastJobs.dispose();
    this.terrainJobs.dispose();
    this.landmarks.dispose();
    this.places.dispose();
    this.placeFootprints.clear();
    this.plantPool.dispose();
    if (this.treeLod) groveLeavesLod(false);
    this.o.forget?.(new Set([this.plain, this.asphalt, this.paint, this.concrete, this.bore, this.trafficMat, this.paving, ...this.traffic.materials()]));
    this.plain.dispose(); this.asphalt.dispose(); this.paint.dispose(); this.concrete.dispose(); this.bore.dispose(); this.trafficMat.dispose(); this.paving.dispose();
    this.asphaltMap?.dispose();this.asphaltMap=null;
    this.traffic.dispose();
    this.surveyPool?.dispose(); this.surveyPool = null;
    this.colourPool?.dispose(); this.colourPool = null;
    this.root.removeFromParent();
  }
}

/** Whether a point lies on a road's ground (RoadTileResult.clear), by a 20 m hash of its segments. */
function roadClear(clear: Float32Array | undefined) {
  if (!clear?.length) return () => false;
  const cell = 20, hash = new Map<string, number[]>();
  for (let i = 0; i < clear.length;) {
    const n = clear[i], h = clear[i + 1], p = i + 2;
    for (let k = 1; k < n; k++) {
      const ax = clear[p + 2 * k - 2], ay = clear[p + 2 * k - 1], bx = clear[p + 2 * k], by = clear[p + 2 * k + 1];
      for (let x = Math.floor((Math.min(ax, bx) - h) / cell); x <= Math.floor((Math.max(ax, bx) + h) / cell); x++)
        for (let y = Math.floor((Math.min(ay, by) - h) / cell); y <= Math.floor((Math.max(ay, by) + h) / cell); y++) {
          const key = x + ',' + y, l = hash.get(key); if (l) l.push(ax, ay, bx, by, h); else hash.set(key, [ax, ay, bx, by, h]);
        }
    }
    i = p + 2 * n;
  }
  return (x: number, y: number) => {
    const l = hash.get(Math.floor(x / cell) + ',' + Math.floor(y / cell));
    if (!l) return false;
    for (let q = 0; q < l.length; q += 5) {
      const ax = l[q], ay = l[q + 1], ex = l[q + 2] - ax, ey = l[q + 3] - ay, L2 = ex * ex + ey * ey || 1, t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2));
      if (Math.hypot(ax + ex * t - x, ay + ey * t - y) < l[q + 4]) return true;
    }
    return false;
  };
}
