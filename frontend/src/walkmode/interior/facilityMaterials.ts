import * as THREE from "three";
import type { Library, Palette } from "./materials";
import type { Extra } from "./facilityModels";
import { monitorTexture, SignAtlas } from "./facilitySigns";
import type { FacilityKind } from "./plan/types";
import { patternTexture, PATTERN_SIZE, type PatternName } from "./facilityPatterns";
import { ProductAtlas } from "./productDisplay";
import type { SetName } from "./materials";

/* A building's surfaces beside a flat's: carpet tiles in its offices, sheet vinyl in its clinics,
 * concrete in its car park; and its own things — the brand colour of its counters and signs, the
 * upholstery of its seats, the stock on its shelves, the cars on its decks. Made from the palette's
 * own (the same textures, other colours), so nothing more is downloaded. */

const ACCENTS = ["#1f6fd1", "#0f8f7a", "#c8462c", "#5b4fc4", "#c48a1c", "#1f8fb0", "#2f8f4a"];

/** a department's colour (a large hospital's floors are found by them): muted, paint-like */
const TONES = ["#7fa3c4", "#86b597", "#d9b47a", "#c597a5", "#9a98cb", "#79b5b3", "#cf9d7a", "#a3b97c"];

export function facilityLook(P: Palette, kind: FacilityKind, name: string, lib?: Library, level = 1): { P: Palette; X: Extra; signs: SignAtlas; finishes: Record<string, THREE.Material>; dispose(): void } {
  const own: { dispose(): void }[] = [];
  const pm = (o: THREE.MeshPhysicalMaterialParameters) => { const m = new THREE.MeshPhysicalMaterial(o); own.push(m); return m; };
  const re = (m: THREE.Material, o: Partial<THREE.MeshPhysicalMaterialParameters>) => { const c = (m as THREE.MeshPhysicalMaterial).clone(); c.setValues(o); own.push(c); return c; };
  const h = Math.abs([...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 11));
  const accent = kind === "clinic" || kind === "ward" ? "#14907e" : kind === "civic" ? "#1f5fa8" : ACCENTS[h % ACCENTS.length];
  const dark = new THREE.Color(accent).multiplyScalar(0.45).getStyle();
  const Q: Palette = { ...P };
  // floors: a building's rooms by its use
  if (kind === "office" || kind === "civic" || kind === "hotel") Q.floorRoom = re(P.rug, { color: kind === "hotel" ? ["#6a5547", "#4c5a6b", "#7a4a4a"][h % 3] : ["#5a6068", "#4f5c6b", "#6b6458", "#3f4a44"][h % 4] });
  else if (kind === "clinic" || kind === "ward") Q.floorRoom = pm({ color: "#d6d9d2", roughness: 0.32, clearcoat: 0.4, clearcoatRoughness: 0.2 });
  else if (kind === "gym") Q.floorRoom = pm({ color: "#2b2e32", roughness: 0.92 });
  else if (kind === "parking" || kind === "plant") {
    const conc = re(P.floorEntry, { color: "#c4c5c0" });
    Q.floorRoom = conc; Q.floorMain = re(P.floorEntry, { color: "#b4b5b0", clearcoat: 0.35, clearcoatRoughness: 0.4 });
    Q.wall = pm({ color: "#e4e4de", roughness: 0.9 }); Q.ceiling = pm({ color: "#dcdcd6", roughness: 0.95 });
  }
  if (kind === "clinic" || kind === "ward") Q.wall = re(P.wall, { color: "#f1f3f1" });
  const monTex = monitorTexture(accent); own.push(monTex);
  const signs = new SignAtlas(accent); own.push(signs);
  const X: Extra = {
    accent: pm({ color: accent, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.1 }),
    accentDark: pm({ color: dark, roughness: 0.45, clearcoat: 0.4 }),
    seat: re(P.linen, { color: kind === "clinic" || kind === "ward" ? ["#4f8f95", "#6f9fb8", "#8aa36a"][h % 3] : ["#3b4350", "#3d5a80", "#7a4b3a", "#4d6b55", "#5b4f6e", "#8a7a5c"][h % 6] }),
    mesh: pm({ color: "#232529", roughness: 0.75, sheen: 0.4, sheenColor: new THREE.Color("#666a70") }),
    vinyl: re(P.leather, { color: kind === "gym" ? "#202225" : "#5d8f96" }),
    laminate: kind === "school" || h % 2 ? re(P.woodLight, { color: ["#ffffff", "#e8dccb", "#d9c3a5"][h % 3] }) : pm({ color: ["#eeebe5", "#f4f4f2", "#d9d6d0"][h % 3], roughness: 0.38, clearcoat: 0.2 }),
    partition: pm({ color: kind === "office" || kind === "civic" ? "#c9ced3" : "#e3ddd2", roughness: 0.32, clearcoat: 0.5 }),
    whiteboard: pm({ color: "#fbfbf9", roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 }),
    monitor: pm({ color: "#050506", emissive: new THREE.Color("#ffffff"), emissiveMap: monTex, emissiveIntensity: 0.9, roughness: 0.25, clearcoat: 1 }),
    sign: signs.material,
    products: ["#b8433a", "#d9a43b", "#3f6fae", "#4d8a5b", "#ecebe6", "#7a5c96", "#c9c2b4", "#5aa3c2", "#3a3a3c", "#d68650", "#e7d9c0", "#8b2f3c"].map(c => pm({ color: c, roughness: 0.55, clearcoat: 0.25 })),
    carPaint: ["#f2f2f0", "#1c1d20", "#8a8f96", "#24324a", "#b8bcc2", "#6b1d1d", "#2d4a3a"].map(c => pm({ color: c, roughness: 0.3, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.05 })),
    paintWhite: pm({ color: "#eceae4", roughness: 0.7 }), paintYellow: pm({ color: "#e8b923", roughness: 0.6 }),
    concrete: re(P.floorEntry, { color: "#a7a8a3" }),
    sheetGreen: re(P.linen, { color: "#9fc4b4" }),
    curtain: re(P.linen, { color: "#b6d3d6", side: THREE.DoubleSide }),
    mat: pm({ color: "#3b3f45", roughness: 0.95 }),
    mirrorWall: pm({ color: "#ffffff", roughness: 0.02, metalness: 1 }),
    hazard: pm({ color: "#f0c22e", roughness: 0.5 }),
    tail: pm({ color: "#b3261e", roughness: 0.35, clearcoat: 0.6 }),
  };
  // a room's own finishes (Room.finish, a large floor's: plan/surveyed.ts) — the lobby's stone, the
  // main hall's terrazzo, the waiting areas' wood-look vinyl, the clinic rooms' sheet flooring, the
  // departments' colours — from the palette's textures, nothing more downloaded
  const finishes: Record<string, THREE.Material> = {
    // (the stones from the white marble set — the granite one reads dark across a lobby)
    "floor:terrazzo": lib ? lib.textured("marble_white", { color: "#efe8dc", roughnessScale: 0.6, normalScale: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.2, ao: 0.4 }) : re(P.floorWet, { color: "#f4efe6", clearcoat: 0.55 }),
    "floor:stone": lib ? lib.textured("marble_white", { color: "#ffffff", roughnessScale: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.15, ao: 0.4 }) : re(P.floorWet, { color: "#e9e3d8", clearcoat: 0.75 }),
    "floor:vinyl": pm({ color: "#d3d0c8", roughness: 0.38, clearcoat: 0.3, clearcoatRoughness: 0.25 }),
    "floor:vinylWood": re(P.floorRoom, { color: "#e6d3b8", clearcoat: 0.3, clearcoatRoughness: 0.22 }),
    "floor:sheet": pm({ color: "#c9d5cf", roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.2 }),
    "wall:stone": lib ? lib.textured("marble_white", { color: "#f3eee6", roughnessScale: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.15, ao: 0.4 }) : re(P.floorEntry, { color: "#ece6dc", clearcoat: 0.35 }),
    "wall:wood": re(P.woodLight, { color: "#f0e2cc" }),
    ...Object.fromEntries(TONES.map((c, i) => [`wall:tone${i}`, pm({ color: c, roughness: 0.82 })])),
  };
  // ---- the building's look by room type: what a good one of its kind is finished in ----
  // (each a scanned set's relief and roughness under a painted or scanned face; only from sets the
  // facility loads — FACILITY_SETS)
  if (lib) {
    themed(lib, kind, h, finishes, own, level, /마트|코스트코|트레이더스|창고형|홈플러스|하나로/.test(name));
    X.floorFin = {};
    for (const [k, m] of Object.entries(finishes)) if (k.startsWith("type:") && k.endsWith(":floor")) X.floorFin[k.slice(0, -6)] = m;
    shopFloors(lib, X.floorFin, own);
    X.brass = pm({ color: "#c9a24a", metalness: 1, roughness: 0.28, clearcoat: 0.3 });
    X.lacquer = pm({ color: "#141416", roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 });
    X.counterStone = lib.textured("marble_white", { color: "#f5f1ea", roughnessScale: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.08, ao: 0.4 });
    X.veneer = lib.textured("walnut_veneer", { roughnessScale: 0.6, clearcoat: 0.45, clearcoatRoughness: 0.15 });
    // (every product on the floor: one atlas, one material — productDisplay.ts)
    X.atlas = new ProductAtlas(lib.plain({ roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.2 })); own.push(X.atlas);
  }
  // Public interiors use a satin finish. Glossy apartment marble and the probe's bright
  // ceiling panels otherwise produce white streaks on floors and wash out stone walls.
  // (a satin sheen, not a mirror: the probe's bright ceiling panels streaked white across glossy
  // floors; the themed finishes keep their own)
  for (const material of new Set([Q.floorMain, Q.floorRoom, Q.floorEntry, Q.floorWet,
    ...Object.entries(finishes).filter(([key]) => key.startsWith("floor:")).map(([, m]) => m)])) {
    const m = material as THREE.MeshPhysicalMaterial;
    m.roughness = Math.max(m.roughness, .5);
    m.clearcoat = .22; m.clearcoatRoughness = .32; m.envMapIntensity = .32;
  }
  for (const material of new Set([Q.wall, Q.wallAccent, Q.wallWet,
    ...Object.entries(finishes).filter(([key]) => key.startsWith("wall:")).map(([, m]) => m)])) {
    const m = material as THREE.MeshPhysicalMaterial;
    m.roughness = Math.max(m.roughness, .8); m.clearcoat = 0; m.sheen = 0; m.envMapIntensity = .35;
  }
  Q.ledPanel.emissiveIntensity = 2.4; Q.ledWarm.emissiveIntensity = 2;
  return { P: Q, X, signs, finishes, dispose: () => own.forEach(o => o.dispose()) };
}

/** the scanned sets a building's floor loads besides the flat's (its stones, tiles and timbers) */
export const FACILITY_SETS: SetName[] = ["terrazzo_tiles", "marble_tiles", "large_floor_tiles_02", "large_grey_tiles", "wooden_floor_02", "square_tiles_02", "long_white_tiles", "concrete_floor_02", "beige_wall_001",
  "ceiling_interior", "plastered_wall_04", "oak_veneer_01", "rounded_square_tiled_wall"];
/** a building's sets by its kind: the common ones, and its own (a clinic's sheet vinyl, a gym's
 * rubber, a car park's epoxy, a restaurant's tiles) — nothing another kind uses is downloaded */
export function facilitySets(kind: FacilityKind): SetName[] {
  const own: Partial<Record<FacilityKind, SetName[]>> = {
    clinic: ["linoleum_brown", "smoked_walnut_veneer"], ward: ["linoleum_brown"], school: ["linoleum_brown", "plaster_grey_04"],
    office: ["smoked_walnut_veneer", "ribbed_concrete_wall", "patterned_concrete_wall", "plaster_grey_04"], civic: ["linoleum_brown", "smoked_walnut_veneer", "patterned_concrete_wall"],
    retail: ["smooth_concrete_floor", "smoked_walnut_veneer", "ribbed_concrete_wall", "rectangular_facade_tiles"], food: ["floor_tiles_08", "interior_tiles", "smoked_walnut_veneer", "plaster_grey_04"],
    hotel: ["smoked_walnut_veneer", "quatrefoil_jacquard_fabric", "patterned_concrete_wall"], museum: ["plaster_grey_04", "smooth_concrete_floor", "patterned_concrete_wall"],
    gym: ["rubber_tiles", "painted_concrete", "plaster_grey_04"], parking: ["painted_concrete"], plant: ["smooth_concrete_floor"],
  };
  return [...FACILITY_SETS, ...(own[kind] ?? [])];
}

type Finish = { set: SetName; noMap?: boolean; color?: string; pattern?: [PatternName, string[]]; rough?: number; normal?: number; coat?: number; coatRough?: number; env?: number; metal?: number; ceiling?: CeilingSystem; ao?: number; flat?: boolean };
/** how a room's ceiling is built (build.ts draws its fittings to it) */
export type CeilingSystem = "tbar" | "gypsum" | "exposed" | "baffle" | "strip";
/** what each kind of building's rooms are finished in: floor, all walls, one feature wall */
function theme(kind: FacilityKind, h: number, level = 1, mart = false): Record<string, Finish> {
  const pick = <T,>(a: T[]) => a[h % a.length];
  // (a choice by the building, its floor and the room: no two buildings, nor two floors, alike)
  const per = <T,>(key: string, a: T[]) => a[Math.abs(h + level * 7919 + [...key].reduce((x, c) => (x * 31 + c.charCodeAt(0)) | 0, 3)) % a.length];
  // (a polished stone that reads as stone — veins, slab joints, a soft reflection)
  const stone = (c = "#f2ede4", v = "#9a9088"): Finish => ({ set: "marble_tiles", pattern: ["stonePanel", [c, v]], rough: 0.32, normal: 0.35, coat: 0.55, coatRough: 0.12, env: 0.55 });
  const darkStone: Finish = { set: "marble_tiles", pattern: ["darkStone", ["#26292d", "#c9c3b5"]], rough: 0.28, normal: 0.3, coat: 0.6, coatRough: 0.1, env: 0.55 };
  const travertine: Finish = { set: "terrazzo_tiles", pattern: ["travertine", ["#e3d6bf", "#b49c78"]], rough: 0.55, normal: 0.5, coat: 0.25, coatRough: 0.3, env: 0.4 };
  const terrazzo: Finish = { set: "terrazzo_tiles", color: pick(["#f3efe8", "#ebe6dc", "#efe9e1"]), rough: 0.45, normal: 0.6, coat: 0.4, coatRough: 0.18, env: 0.45 };
  const oak: Finish = { set: "wooden_floor_02", color: pick(["#ffffff", "#f1e4d2"]), rough: 0.7, normal: 0.8, coat: 0.3, coatRough: 0.25, env: 0.35 };
  const bigTile: Finish = { set: "large_floor_tiles_02", color: "#ffffff", rough: 0.35, normal: 0.4, coat: 0.5, coatRough: 0.12, env: 0.5 };
  const greyTile: Finish = { set: "large_grey_tiles", color: "#ffffff", rough: 0.45, normal: 0.5, coat: 0.35, coatRough: 0.2, env: 0.4 };
  const carpet = (cols: string[]): Finish => ({ set: "concrete_floor_02", pattern: ["carpetTile", cols], rough: 1, normal: 0.25, env: 0.1 });
  const hotelCarpet = (cols: string[]): Finish => ({ set: "concrete_floor_02", pattern: ["hotelCarpet", cols], rough: 1, normal: 0.2, env: 0.1 });
  const restTile: Finish = { set: "long_white_tiles", color: "#ffffff", rough: 0.3, normal: 0.6, coat: 0.6, coatRough: 0.08, env: 0.5 };
  const restFloor: Finish = { set: "square_tiles_02", color: "#d9d7d2", rough: 0.5, normal: 0.6, coat: 0.25, coatRough: 0.25, env: 0.35 };
  const paint = (c: string): Finish => ({ set: "beige_wall_001", noMap: true, color: c, rough: 0.92, normal: 0.25, env: 0.3 });
  const slat = (c = "#b98a5c"): Finish => ({ set: "wooden_floor_02", pattern: ["woodSlat", [c]], rough: 0.65, normal: 0.25, coat: 0.15, coatRough: 0.4, env: 0.35 });
  const damask = (cols: string[]): Finish => ({ set: "beige_wall_001", noMap: true, pattern: ["damask", cols], rough: 0.7, normal: 0.2, env: 0.35 });
  const grass = (c: string): Finish => ({ set: "beige_wall_001", noMap: true, pattern: ["grasscloth", [c]], rough: 0.9, normal: 0.35, env: 0.25 });
  const T: Record<string, Finish> = {
    "restroom:wall": restTile, "restroom:floor": restFloor,
    "lobby:floor": stone(), "lobby:wall": stone("#f4efe7", "#b5aba0"), "lobby:feature": slat(),
    "liftHall:floor": stone(), "liftHall:wall": stone("#ebe5db", "#9d9287"), "corridor:floor": terrazzo,
    "pantry:floor": restFloor, "meeting:floor": oak, "meeting:feature": slat("#8a5a3a"),
  };
  // ---- what real buildings of each kind are built with (2026-11-05): ceilings, floors, walls ----
  const tbar = (c = "#f4f3ef", grid = "#e2e2de"): Finish => ({ set: "ceiling_interior", pattern: ["ceilingTile", [c, grid]], rough: 0.95, normal: 0.45, env: 0.12, ceiling: "tbar" });
  const gypsum = (c = "#f6f5f1"): Finish => ({ set: "ceiling_interior", noMap: true, color: c, rough: 0.95, normal: 0.22, env: 0.18, ceiling: "gypsum" });
  const strip = (c = "#e9e8e4"): Finish => ({ set: "ceiling_interior", pattern: ["metalStrip", [c, "#2c2e31"]], rough: 0.38, normal: 0.15, coat: 0.2, coatRough: 0.25, metal: 0.25, env: 0.55, ceiling: "strip" });
  const exposed = (c = "#34363a"): Finish => ({ set: "plastered_wall_04", noMap: true, color: c, rough: 0.92, normal: 0.6, env: 0.1, ceiling: "exposed" });
  const baffle = (c = "#3a3c40"): Finish => ({ set: "plastered_wall_04", noMap: true, color: c, rough: 0.92, normal: 0.4, env: 0.1, ceiling: "baffle" });
  const vinyl = (c: string, f = "#8f948c"): Finish => ({ set: "linoleum_brown", pattern: ["vinylSheet", [c, f]], rough: 0.5, normal: 0.3, coat: 0.3, coatRough: 0.25, env: 0.3, ao: 0.15 });
  const epoxy = (c: string): Finish => ({ set: "painted_concrete", pattern: ["epoxy", [c]], rough: 0.42, normal: 0.12, coat: 0.45, coatRough: 0.18, env: 0.4, ao: 0.05, flat: true });
  const polished = (c: string): Finish => ({ set: "smooth_concrete_floor", pattern: ["epoxy", [c]], rough: 0.5, normal: 0.3, coat: 0.35, coatRough: 0.22, env: 0.4, ao: 0.08, flat: true });
  const rubber: Finish = { set: "rubber_tiles", color: "#ffffff", rough: 0.95, normal: 0.8, env: 0.08 };
  const carpetP = (cols: string[]): Finish => ({ set: "concrete_floor_02", pattern: ["carpetPlank", cols], rough: 1, normal: 0.25, env: 0.08 });
  const lvt = (c: string): Finish => ({ set: "wooden_floor_02", pattern: ["lvtPlank", [c]], rough: 0.55, normal: 0.35, coat: 0.3, coatRough: 0.25, env: 0.3 });
  const plaster = (c: string): Finish => ({ set: "plastered_wall_04", noMap: true, color: c, rough: 0.88, normal: 0.35, env: 0.25 });
  const rawConc = (c = "#d8d6d0"): Finish => ({ set: "plaster_grey_04", color: c, rough: 0.9, normal: 0.6, env: 0.2 });
  const veneer = (dark = false): Finish => ({ set: dark ? "smoked_walnut_veneer" : "oak_veneer_01", color: dark ? "#c9a787" : "#f3e5d0", rough: 0.55, normal: 0.5, coat: 0.25, coatRough: 0.3, env: 0.35 });
  const ribbed: Finish = { set: "ribbed_concrete_wall", color: "#e6e3dc", rough: 0.9, normal: 0.9, env: 0.2 };
  const blockConc: Finish = { set: "patterned_concrete_wall", color: "#efebe4", rough: 0.85, normal: 0.8, env: 0.2 };
  const mosaicWall = (c = "#ffffff"): Finish => ({ set: "rounded_square_tiled_wall", noMap: true, color: c, rough: 0.35, normal: 0.7, coat: 0.5, coatRough: 0.12, env: 0.45 });
  const cladding: Finish = { set: "rectangular_facade_tiles", noMap: true, color: "#f2f1ee", rough: 0.4, normal: 0.6, coat: 0.4, coatRough: 0.15, env: 0.4 };
  const warmWhite = (k: string) => per(k, ["#f2f0eb", "#eeebe4", "#f3f2ee", "#ece8df", "#e9ece9"]);
  const WORK = ["office", "openOffice", "meeting", "consult", "treatment", "staffroom", "classroom", "pharmacy", "waiting", "service", "pantry", "ward", "guest", "shop", "cafe", "gallery", "gym"];
  // the common ground: every kind's ceilings, walls with a plaster's relief, washrooms in tile
  for (const r of WORK) { T[`${r}:ceiling`] = per(r + "c", [tbar(), tbar("#f7f6f2", "#d9d9d5"), gypsum()]); T[`${r}:wall`] ??= plaster(warmWhite(r)); }
  Object.assign(T, {
    "corridor:ceiling": per("corc", [tbar(), gypsum(), strip()]), "lobby:ceiling": per("lobc", [gypsum(), strip(), gypsum("#f2efe8")]), "liftHall:ceiling": per("lhc", [gypsum(), strip("#d9d6cf")]),
    "stair:ceiling": gypsum(), "storage:ceiling": exposed("#c9c8c3"), "plant:ceiling": exposed("#bdbcb6"), "parking:ceiling": exposed("#c3c2bc"),
    "restroom:ceiling": per("rrc", [strip("#eeeeea"), gypsum()]), "restroom:wall": per("rrw", [restTile, mosaicWall(), mosaicWall("#e9eef0")]),
    "corridor:wall": plaster(warmWhite("corw")), "storage:wall": rawConc(), "plant:wall": rawConc("#cfcdc6"), "storage:floor": polished("#bdbbb5"), "plant:floor": polished("#a9a8a2"),
    "parking:floor": epoxy(per("pk", ["#8c958e", "#7f8a91", "#9a9a94"])), "parking:wall": rawConc("#d6d4cd"), "stair:floor": per("stf", [terrazzo, greyTile]),
    "lobby:feature": per("lobf", [slat(), veneer(), veneer(true), ribbed, blockConc, stone("#efe9df", "#a9a094")]),
  });
  switch (kind) {
    case "hotel": {
      const [c1, c2, c3] = pick([["#3a1f2b", "#5a2f3d", "#c9a46a"], ["#1f2a3d", "#2f3f5a", "#c9a46a"], ["#2b2a24", "#4a4536", "#b89866"]]);
      Object.assign(T, {
        "lobby:floor": darkStone, "lobby:wall": stone("#efe6d6", "#b89a6a"), "lobby:feature": { ...darkStone, pattern: ["goldInlay", ["#2a2522", "#d8c9a8"]] },
        "liftHall:floor": darkStone, "liftHall:wall": damask(["#ddd0b4", "#cfbf9e", "#e8dcc4"]),
        "corridor:floor": hotelCarpet([c1, c2, c3]), "corridor:wall": damask(["#e9e0cf", "#ddd1ba", "#f1ead9"]),
        "guest:floor": hotelCarpet([c2, c1, c3]), "guest:wall": grass("#d9ccb4"), "guest:feature": slat("#6e4a32"),
        "service:floor": darkStone, "cafe:floor": oak, "cafe:feature": damask(["#2f3a33", "#3f4d43", "#b89866"]),
      });
      break;
    }
    case "museum": {
      const gal = pick(["#2f3e4f", "#5a2e2e", "#2f4237", "#3b3b3f"]);
      Object.assign(T, {
        "lobby:floor": stone("#e9e5de", "#8e8a84"), "lobby:wall": stone("#f3f1ec", "#c9c3b9"), "lobby:feature": travertine,
        "gallery:floor": oak, "gallery:wall": paint("#f2f0eb"), "gallery:feature": paint(gal),
        "corridor:floor": terrazzo, "corridor:wall": paint("#ece9e3"), "shop:floor": oak, "cafe:floor": oak,
      });
      break;
    }
    case "civic": {
      Object.assign(T, {
        "lobby:floor": { ...greyTile }, "lobby:wall": travertine, "lobby:feature": slat("#c49a6c"),
        "service:floor": greyTile, "service:wall": paint("#f1efe9"), "service:feature": slat("#c49a6c"),
        "openOffice:floor": carpet(["#4f5a66", "#3d4652", "#6c7884"]), "office:floor": carpet(["#5a5248", "#463f37", "#7a7064"]),
        "corridor:wall": paint("#eeece6"), "consult:floor": oak,
      });
      break;
    }
    case "retail": case "food": {
      Object.assign(T, {
        "corridor:floor": bigTile, "corridor:wall": paint("#f4f3f0"), "lobby:floor": stone("#f4f1ec", "#a9a196"), "lobby:feature": { ...darkStone, pattern: ["goldInlay", ["#1e1e20", "#c9c1b0"]] },
        "liftHall:wall": stone("#f0ece6", "#a79f94"),
      });
      break;
    }
    case "office": {
      Object.assign(T, {
        "openOffice:floor": carpet(pick([["#4c5563", "#3a414c", "#6a7482"], ["#5b5650", "#46423d", "#7a746c"]])), "office:floor": carpet(["#3f4a44", "#323b36", "#5d6a62"]),
        "staffroom:floor": carpet(["#5b5650", "#46423d", "#7a746c"]), "corridor:floor": greyTile, "corridor:wall": paint("#efedea"), "openOffice:feature": grass("#c8bfae"),
      });
      break;
    }
    case "clinic": case "ward": {
      Object.assign(T, { "lobby:feature": slat("#c8a27a"), "waiting:floor": oak, "corridor:wall": paint("#f3f4f1") });
      break;
    }
    case "school": {
      Object.assign(T, { "classroom:floor": oak, "corridor:floor": terrazzo, "classroom:feature": paint("#dbe6d4"), "lobby:feature": slat("#c8a27a") });
      break;
    }
    case "gym": { Object.assign(T, { "lobby:feature": { ...darkStone } }); break; }
  }
  // ---- by kind, over the common ground ----
  const SOFT = ["#d9dcd6", "#d6d2c8", "#cfd8d6", "#dcd8cc", "#d3d9df"];
  switch (kind) {
    case "clinic": case "ward": {
      const v = vinyl(per("cv", SOFT), per("cvf", ["#9aa39b", "#a39a8a", "#8e9aa3"]));
      Object.assign(T, {
        "corridor:floor": v, "treatment:floor": vinyl(per("tv", SOFT)), "consult:floor": vinyl(per("csv", SOFT)), "staffroom:floor": vinyl(per("sv", SOFT)), "ward:floor": vinyl(per("wv", SOFT)),
        "pharmacy:floor": vinyl(per("pv", SOFT)), "waiting:floor": per("wf", [oak, lvt("#d8b48c"), lvt("#c9a27a"), v]),
        "corridor:ceiling": per("ccc", [tbar(), tbar("#f7f7f4", "#d8dad8")]), "lobby:ceiling": per("clc", [strip("#efeee9"), gypsum(), gypsum("#f4f1ea")]),
        "lobby:feature": per("clf", [veneer(), slat("#c8a27a"), veneer(true), stone("#f1ece3", "#b3a99c")]), "waiting:feature": per("cwf", [veneer(), plaster("#dfe7e2"), plaster("#e8e1d6")]),
      });
      break;
    }
    case "school": {
      Object.assign(T, { "classroom:floor": per("clsf", [lvt("#cda57a"), oak, vinyl("#d8d3c2")]), "corridor:floor": per("scf", [terrazzo, vinyl("#d3d1c8", "#8b8a82")]),
        "classroom:wall": plaster(per("clw", ["#f1efe6", "#eef0ea", "#f2ece2"])), "classroom:feature": plaster(per("clsfe", ["#dbe6d4", "#dfe3ec", "#ece3d1"])), "staffroom:floor": vinyl(per("ssv", SOFT)), "gym:floor": oak });
      break;
    }
    case "office": {
      const it = per("oit", [0, 0, 1]) === 1;
      Object.assign(T, {
        "openOffice:floor": per("oof", [carpetP(["#4a525e", "#3b424c", "#7b8594"]), carpetP(["#5a554e", "#48443e", "#8a8378"]), carpet(["#4c5563", "#3a414c", "#6a7482"]), lvt("#c8a47c")]),
        "meeting:floor": per("omf", [carpetP(["#3f4a44", "#323b36", "#6d7a71"]), oak, carpet(["#5b5650", "#46423d", "#7a746c"])]),
        "openOffice:ceiling": it ? exposed(per("oex", ["#2f3134", "#e8e6e1"])) : per("ooc", [tbar(), tbar("#f7f6f2", "#d9d9d5")]),
        "openOffice:feature": per("oofe", [veneer(), ribbed, blockConc, grass("#c8bfae"), plaster("#3f4a55")]), "meeting:feature": per("omfe", [veneer(true), slat("#8a5a3a"), plaster("#2f3a44")]),
        "corridor:floor": per("ocf", [greyTile, polished("#b9b8b2"), carpetP(["#4a525e", "#3b424c", "#7b8594"])]), "lobby:floor": per("olf", [stone(), darkStone, bigTile, stone("#e7e2d9", "#7e776f")]),
      });
      break;
    }
    case "civic": {
      Object.assign(T, { "service:ceiling": per("svc", [tbar(), strip()]), "corridor:floor": per("cvf", [greyTile, vinyl("#d6d4cc", "#8e8c85")]), "service:floor": per("svf", [greyTile, vinyl("#d1d3cf"), polished("#c3c1ba")]) });
      break;
    }
    case "retail": {
      Object.assign(T, mart ? {
        "corridor:floor": epoxy(per("mf", ["#d6d4cc", "#cfd1cf", "#ddd8cd"])), "shop:floor": epoxy(per("msf", ["#d6d4cc", "#cfd1cf"])), "corridor:ceiling": exposed("#3a3c40"), "shop:ceiling": exposed("#3a3c40"), "lobby:ceiling": exposed("#3a3c40"),
        "corridor:wall": cladding,
      } : {
        "corridor:floor": per("rcf", [bigTile, polished("#c7c4bc"), stone("#f4f1ec", "#a9a196"), terrazzo]), "corridor:ceiling": per("rcc", [gypsum(), strip(), gypsum("#f1eee7")]),
        "corridor:wall": per("rcw", [plaster("#f4f3f0"), cladding, plaster("#ece8e0")]),
      });
      break;
    }
    case "food": {
      Object.assign(T, { "cafe:floor": per("ff", [{ set: "floor_tiles_08", color: "#ffffff", rough: 0.6, normal: 0.6, coat: 0.25, coatRough: 0.25, env: 0.3 } as Finish, { set: "interior_tiles", color: "#ffffff", rough: 0.4, normal: 0.6, coat: 0.4, coatRough: 0.15, env: 0.4 } as Finish, oak, polished("#a9a39a")]),
        "cafe:ceiling": per("fcc", [exposed("#2e3033"), baffle(), gypsum()]), "cafe:wall": per("fcw", [plaster("#efe8dc"), rawConc("#d9d4ca"), veneer()]), "corridor:floor": per("fcf", [terrazzo, bigTile]) });
      break;
    }
    case "gym": {
      Object.assign(T, { "gym:floor": rubber, "gym:ceiling": exposed("#2b2d30"), "gym:wall": per("gw", [rawConc("#cfccc4"), plaster("#3a3d42"), ribbed]), "corridor:floor": rubber });
      break;
    }
    case "museum": {
      Object.assign(T, { "gallery:ceiling": per("gc", [gypsum(), exposed("#2a2c2f"), baffle("#2a2c2f")]), "gallery:floor": per("gf", [oak, polished("#9f9d97"), polished("#c4c0b7")]), "lobby:ceiling": per("mlc", [gypsum(), baffle()]) });
      break;
    }
    case "hotel": {
      Object.assign(T, { "guest:ceiling": gypsum(), "corridor:ceiling": gypsum("#f3efe6"), "lobby:ceiling": gypsum("#f1ece2") });
      break;
    }
  }
  return T;
}

function themed(lib: Library, kind: FacilityKind, h: number, out: Record<string, THREE.Material>, own: { dispose(): void }[], level = 1, mart = false) {
  const made = new Map<string, THREE.Material>();
  for (const [key, f] of Object.entries(theme(kind, h, level, mart))) {
    const sig = JSON.stringify(f);
    let m = made.get(sig) as THREE.MeshPhysicalMaterial | undefined;
    if (!m) {
      if (!lib.has(f.set)) continue;
      m = lib.textured(f.set, { useMap: !f.noMap, color: f.pattern ? "#ffffff" : f.color ?? "#ffffff", roughnessScale: f.rough ?? 0.8, normalScale: f.normal ?? 0.6, clearcoat: f.coat ?? 0, clearcoatRoughness: f.coatRough ?? 0.3, metalness: f.metal ?? 0, ao: f.ao ?? 0.45 });
      if (f.pattern) {
        // (the painted face replaces the set's colour; its relief and roughness kept, finer)
        const [name, cols] = f.pattern, t = patternTexture(name, cols, h + key.length);
        m.map = t; own.push(t);
        const rep = 1 / PATTERN_SIZE[name];
        for (const tx of [m.normalMap, m.roughnessMap, m.aoMap]) tx?.repeat.set(rep * 2, rep * 2);
      }
      m.envMapIntensity = f.env ?? 0.35;
      if (f.ceiling) m.userData.ceiling = f.ceiling;
      // (a sealed floor is even: only the scan's relief, not its stains in the roughness and AO)
      if (f.flat) { m.roughnessMap = null; m.aoMap = null; m.metalnessMap = null; m.roughness = f.rough ?? 0.5; m.needsUpdate = true; }
      made.set(sig, m);
    }
    out[`type:${key}`] = m;
  }
}

/** a business's own floor by its kind (shopInteriors.ts): polished white stone for cosmetics, oak
 * for clothes and books, terrazzo for a bakery, grey tile for electronics, rubber for a gym */
function shopFloors(lib: Library, out: Record<string, THREE.Material>, own: { dispose(): void }[]) {
  const t = (set: SetName, color: string, rough: number, coat = 0.3, env = 0.4, pattern?: [PatternName, string[]]) => {
    if (!lib.has(set)) return undefined;
    const m = lib.textured(set, { color: pattern ? "#ffffff" : color, roughnessScale: rough, normalScale: 0.6, clearcoat: coat, clearcoatRoughness: 0.15, ao: 0.45 });
    if (pattern) { const tx = patternTexture(pattern[0], pattern[1], 3); m.map = tx; own.push(tx); }
    m.envMapIntensity = env; return m;
  };
  const S: Record<string, THREE.Material | undefined> = {
    cosmetics: t("large_floor_tiles_02", "#ffffff", 0.28, 0.6, 0.55), clothing: t("wooden_floor_02", "#f3e6d4", 0.7), bank: t("marble_tiles", "#fff", 0.32, 0.55, 0.5, ["stonePanel", ["#ece6dc", "#a69b8d"]]),
    books: t("wooden_floor_02", "#d8b892", 0.75), bakery: t("terrazzo_tiles", "#f4ead8", 0.5), restaurant: t("wooden_floor_02", "#c79e74", 0.75), salon: t("large_floor_tiles_02", "#f2f2f2", 0.3, 0.5, 0.5),
    electronics: t("large_grey_tiles", "#f0f0f0", 0.35, 0.45, 0.45), eyewear: t("marble_tiles", "#fff", 0.32, 0.55, 0.5, ["stonePanel", ["#f2efe9", "#b8b0a5"]]), pcroom: t("concrete_floor_02", "#2a2433", 0.9, 0),
    gym: t("concrete_floor_02", "#2d2d2d", 1, 0), variety: t("large_floor_tiles_02", "#f3f0ea", 0.4), mart: t("large_floor_tiles_02", "#eeeae2", 0.35, 0.45, 0.45),
    department: t("marble_tiles", "#fff", 0.3, 0.6, 0.55, ["stonePanel", ["#f4f0ea", "#b5ab9f"]]), shoes: t("wooden_floor_02", "#e9dcc8", 0.7), bags: t("marble_tiles", "#fff", 0.3, 0.6, 0.55, ["darkStone", ["#2a2725", "#cfc6b4"]]),
  };
  for (const [k, m] of Object.entries(S)) if (m) out[`shop:${k}`] = m;
}
