import * as THREE from "three";
import type { Library, Palette } from "./materials";
import type { Extra } from "./facilityModels";
import { monitorTexture, SignAtlas } from "./facilitySigns";
import type { FacilityKind } from "./plan/types";

/* A building's surfaces beside a flat's: carpet tiles in its offices, sheet vinyl in its clinics,
 * concrete in its car park; and its own things — the brand colour of its counters and signs, the
 * upholstery of its seats, the stock on its shelves, the cars on its decks. Made from the palette's
 * own (the same textures, other colours), so nothing more is downloaded. */

const ACCENTS = ["#1f6fd1", "#0f8f7a", "#c8462c", "#5b4fc4", "#c48a1c", "#1f8fb0", "#2f8f4a"];

/** a department's colour (a large hospital's floors are found by them): muted, paint-like */
const TONES = ["#7fa3c4", "#86b597", "#d9b47a", "#c597a5", "#9a98cb", "#79b5b3", "#cf9d7a", "#a3b97c"];

export function facilityLook(P: Palette, kind: FacilityKind, name: string, lib?: Library): { P: Palette; X: Extra; signs: SignAtlas; finishes: Record<string, THREE.Material>; dispose(): void } {
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
  // Public interiors use a satin finish. Glossy apartment marble and the probe's bright
  // ceiling panels otherwise produce white streaks on floors and wash out stone walls.
  for (const material of new Set([Q.floorMain, Q.floorRoom, Q.floorEntry, Q.floorWet,
    ...Object.entries(finishes).filter(([key]) => key.startsWith("floor:")).map(([, m]) => m)])) {
    const m = material as THREE.MeshPhysicalMaterial;
    m.roughness = Math.max(m.roughness, .76); m.roughnessMap = null;
    m.clearcoat = .05; m.clearcoatRoughness = .8; m.envMapIntensity = .18;
  }
  for (const material of new Set([Q.wall, Q.wallAccent, Q.wallWet,
    ...Object.entries(finishes).filter(([key]) => key.startsWith("wall:")).map(([, m]) => m)])) {
    const m = material as THREE.MeshPhysicalMaterial;
    m.roughness = Math.max(m.roughness, .9); m.roughnessMap = null; m.clearcoat = 0; m.sheen = 0; m.envMapIntensity = .3;
  }
  Q.ledPanel.emissiveIntensity = 2.4; Q.ledWarm.emissiveIntensity = 2;
  return { P: Q, X, signs, finishes, dispose: () => own.forEach(o => o.dispose()) };
}
