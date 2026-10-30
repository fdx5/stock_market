import * as THREE from "three";
import type { StyleName } from "./plan/types";

/* The interior's material library: CC0 scanned PBR sets (Poly Haven; public/3d/walk/SOURCES.md)
 * for the surfaces seen up close — floors, tiles, wallpaper, fabric, leather, wood veneer — and
 * plain physical materials for the rest (paint, ceramic, chrome, glass, lacquer).
 *
 * Every texture is downloaded with progress, decoded off the main thread (createImageBitmap) and
 * uploaded to the GPU behind the loading screen: nothing decodes or uploads once the walk starts. */

const BASE = "/3d/walk/tex/";
/** texture sets: name -> physical size of one repeat (m) */
export const SETS = {
  laminate_floor_02: 1.7, herringbone_parquet: 3.4, marble_white: 1.5, granite_tile: 2.3, plastered_wall_02: 2.23,
  poly_wool_herringbone: 0.27, rough_linen: 0.27, leather_white: 0.3, white_oak_veneer: 0.5, walnut_veneer: 1.8,
  velour_velvet: 0.28,
  wool_boucle: .315, terrazzo_tiles: 2, beige_wall_001: 3, brown_leather: .4, concrete_floor_02: 2,
  // (Poly Haven, CC0: floors and tiles for the further styles — each style downloads only its own)
  laminate_floor_03: 2.08, diagonal_parquet: 2.36, rectangular_parquet: 2.25, wood_floor: 1.7, plank_flooring_02: 1.98, wooden_floor_02: 1.94,
  marble_tiles: 2.0, large_grey_tiles: 3.0, long_white_tiles: 1.27, square_tiles_02: 2.4, floor_tiles_06: 3.0, marble_mosaic_tiles: 2.0, large_floor_tiles_02: 3.0,
} as const;
/** the sets every flat loads; and each style's own besides */
export const BASE_SETS = ["laminate_floor_02", "herringbone_parquet", "marble_white", "granite_tile", "plastered_wall_02", "poly_wool_herringbone", "rough_linen", "leather_white", "white_oak_veneer", "walnut_veneer", "velour_velvet"] as const;
export type SetName = keyof typeof SETS;
type Kind = "diff" | "nor" | "arm";

export interface TexSet { map: THREE.Texture; normalMap: THREE.Texture; arm: THREE.Texture; size: number }

/** Download and decode the sets (progress 0..1 by bytes). */
export async function loadSets(names: SetName[], onProgress: (k: number, label: string) => void, signal?: AbortSignal): Promise<Map<SetName, TexSet>> {
  const files = names.flatMap(n => (["diff", "nor", "arm"] as Kind[]).map(k => ({ n, k, url: `${BASE}${n}_${k}.webp` })));
  const total = new Array(files.length).fill(0), got = new Array(files.length).fill(0);
  const report = () => {
    const t = total.reduce((a, b) => a + (b || 400_000), 0), g = got.reduce((a, b) => a + b, 0);
    onProgress(Math.min(1, g / t), `자재 텍스처 ${(g / 1048576).toFixed(1)} / ${(t / 1048576).toFixed(1)} MB`);
  };
  const fetchOne = async (i: number): Promise<ImageBitmap> => {
    const f = files[i];
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(f.url, { signal });
        if (!res.ok || !res.body) throw new Error(`${res.status} ${f.url}`);
        total[i] = Number(res.headers.get("content-length")) || 0;
        const reader = res.body.getReader(), chunks: Uint8Array[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); got[i] += value.byteLength; report();
        }
        if (!total[i]) total[i] = got[i];
        const blob = new Blob(chunks as BlobPart[], { type: "image/webp" });
        // (normal and packed maps are data: no colour conversion; all flipped here, not on upload)
        return await createImageBitmap(blob, { imageOrientation: "flipY", colorSpaceConversion: f.k === "diff" ? "default" : "none", premultiplyAlpha: "none" });
      } catch (e) {
        if (signal?.aborted || attempt >= 2) throw e;
        got[i] = 0;
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  };
  // a few at a time (a phone on mobile data shouldn't open 36 requests at once)
  const bitmaps: ImageBitmap[] = new Array(files.length);
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (next < files.length) { const i = next++; bitmaps[i] = await fetchOne(i); } }));
  const out = new Map<SetName, TexSet>();
  for (const n of names) {
    const tex = (k: Kind) => {
      const t = new THREE.Texture(bitmaps[files.findIndex(f => f.n === n && f.k === k)]);
      t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = k === "diff" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 16; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
      t.needsUpdate = true;
      return t;
    };
    out.set(n, { map: tex("diff"), normalMap: tex("nor"), arm: tex("arm"), size: SETS[n] });
  }
  return out;
}

export interface MatOpts { color?: THREE.ColorRepresentation; roughness?: number; roughnessScale?: number; normalScale?: number; metalness?: number; clearcoat?: number; clearcoatRoughness?: number; sheen?: number; sheenColor?: THREE.ColorRepresentation; ao?: number; useMap?: boolean; side?: THREE.Side }

/** Interior materials. UVs are in metres everywhere (geometry built that way), so a texture set's
 * repeat is 1 / its physical size. */
export class Library {
  readonly all: THREE.Material[] = [];
  constructor(private sets: Map<SetName, TexSet>) {}

  textured(set: SetName, o: MatOpts = {}): THREE.MeshPhysicalMaterial {
    const s = this.sets.get(set)!;
    const rep = 1 / s.size;
    const clone = (t: THREE.Texture) => { const c = t.clone(); c.repeat.set(rep, rep); c.needsUpdate = false; c.source = t.source; return c; };
    const m = new THREE.MeshPhysicalMaterial({
      map: o.useMap === false ? null : clone(s.map), normalMap: clone(s.normalMap), roughnessMap: clone(s.arm), aoMap: clone(s.arm),
      color: o.color ?? "#ffffff", roughness: o.roughnessScale ?? 1, metalness: o.metalness ?? 0, aoMapIntensity: o.ao ?? 0.6,
      normalScale: new THREE.Vector2(o.normalScale ?? 1, o.normalScale ?? 1),
      clearcoat: o.clearcoat ?? 0, clearcoatRoughness: o.clearcoatRoughness ?? 0.2,
      sheen: o.sheen ?? 0, sheenColor: new THREE.Color(o.sheenColor ?? "#ffffff"), sheenRoughness: 0.6,
      side: o.side ?? THREE.FrontSide,
    });
    // (the packed map: ambient occlusion in red, roughness in green, metalness unused)
    this.all.push(m);
    return m;
  }
  plain(o: MatOpts & { transparent?: boolean; opacity?: number; emissive?: THREE.ColorRepresentation; emissiveIntensity?: number; transmission?: number; ior?: number }): THREE.MeshPhysicalMaterial {
    const m = new THREE.MeshPhysicalMaterial({
      color: o.color ?? "#ffffff", roughness: o.roughness ?? 0.5, metalness: o.metalness ?? 0,
      clearcoat: o.clearcoat ?? 0, clearcoatRoughness: o.clearcoatRoughness ?? 0.1,
      sheen: o.sheen ?? 0, sheenColor: new THREE.Color(o.sheenColor ?? "#ffffff"),
      transparent: !!o.transparent, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide,
      emissive: new THREE.Color(o.emissive ?? "#000000"), emissiveIntensity: o.emissiveIntensity ?? 1,
      ior: o.ior ?? 1.5,
    });
    if (o.transparent) m.depthWrite = false;
    this.all.push(m);
    return m;
  }
  basic(o: { color: THREE.ColorRepresentation; transparent?: boolean; opacity?: number; side?: THREE.Side; forceSinglePass?: boolean }): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ color: o.color, transparent: !!o.transparent, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide, depthWrite: !o.transparent, forceSinglePass: !!o.forceSinglePass });
    this.all.push(m);
    return m;
  }
  dispose() {
    const seen = new Set<THREE.Texture>();
    for (const m of this.all) {
      for (const k of ["map", "normalMap", "roughnessMap", "aoMap", "emissiveMap"] as const) { const t = (m as THREE.MeshPhysicalMaterial)[k]; if (t && !seen.has(t)) { seen.add(t); t.dispose(); } }
      m.dispose();
    }
    // (the decoded pictures are let go with the textures; closing them here while a clone is still
    // queued for upload would hand WebGL a detached image)
    for (const s of this.sets.values()) for (const t of [s.map, s.normalMap, s.arm]) t.dispose();
  }
}

/** The palette of one interior style: what each surface is made of. */
export interface Palette {
  floorMain: THREE.Material; floorRoom: THREE.Material; floorWet: THREE.Material; floorEntry: THREE.Material;
  wall: THREE.Material; wallAccent: THREE.Material; wallWet: THREE.Material; ceiling: THREE.Material; trim: THREE.Material;
  door: THREE.Material; doorFrame: THREE.Material; frontDoor: THREE.Material; handle: THREE.Material;
  winFrame: THREE.Material; glass: THREE.Material; sill: THREE.Material;
  cabinet: THREE.Material; cabinetUpper: THREE.Material; counter: THREE.Material; steel: THREE.Material; chrome: THREE.Material; blackMetal: THREE.Material;
  ceramic: THREE.Material; mirror: THREE.Material; fabricSofa: THREE.Material; fabricBed: THREE.Material; linen: THREE.Material; sheer: THREE.Material; drape: THREE.Material;
  leather: THREE.Material; velvet: THREE.Material; woodLight: THREE.Material; woodDark: THREE.Material; rug: THREE.Material;
  appliance: THREE.Material; applianceDark: THREE.Material; screen: THREE.Material; plastic: THREE.Material; rubber: THREE.Material;
  ledPanel: THREE.MeshPhysicalMaterial; ledWarm: THREE.MeshPhysicalMaterial; lampShade: THREE.MeshPhysicalMaterial;
  plantLeaf: THREE.Material; pot: THREE.Material; soil: THREE.Material; book: THREE.Material; art: THREE.Material; water: THREE.Material;
  threshold: THREE.Material; grout: THREE.Material;
}

export const STYLE_LABEL: Record<StyleName, string> = { modern_white: "모던 화이트", wood_natural: "우드 내추럴", gray_minimal: "그레이 미니멀", classic_walnut: "클래식 월넛", nordic_bright: "북유럽 화이트우드", hotel_dark: "호텔 다크", vintage_warm: "빈티지 웜", japandi: "재팬디 오크", sage_terrazzo: "세이지 테라조", urban_loft: "어반 로프트", cream_boucle: "크림 부클레", coastal_blue: "코스탈 블루" };
export const STYLE_SETS: Record<StyleName, SetName[]> = {
  modern_white: ["long_white_tiles", "large_floor_tiles_02"],
  wood_natural: ["square_tiles_02"],
  gray_minimal: ["large_grey_tiles"],
  classic_walnut: ["rectangular_parquet", "wood_floor", "marble_tiles"],
  nordic_bright: ["laminate_floor_03", "plank_flooring_02", "square_tiles_02", "long_white_tiles"],
  hotel_dark: ["large_grey_tiles", "wooden_floor_02", "marble_tiles", "large_floor_tiles_02"],
  vintage_warm: ["diagonal_parquet", "laminate_floor_03", "floor_tiles_06", "marble_mosaic_tiles"],
  japandi: ["laminate_floor_03", "beige_wall_001", "wool_boucle", "square_tiles_02"],
  sage_terrazzo: ["terrazzo_tiles", "beige_wall_001", "laminate_floor_03"],
  urban_loft: ["concrete_floor_02", "brown_leather", "large_grey_tiles"],
  cream_boucle: ["wool_boucle", "beige_wall_001", "marble_tiles", "laminate_floor_03"],
  coastal_blue: ["plank_flooring_02", "terrazzo_tiles", "beige_wall_001"],
};

export function makePalette(lib: Library, style0: StyleName): Palette {
  const L = lib;
  // (each further style is one of the first three changed: its own floors, tiles, woods, fabrics, appliance colours)
  const style = style0 === "classic_walnut" || style0 === "vintage_warm" ? "wood_natural" : style0 === "nordic_bright" ? "modern_white" : style0 === "hotel_dark" ? "gray_minimal" : style0;
  const white = style === "modern_white", wood = style === "wood_natural";
  const paint = (c: string, r = 0.85) => L.plain({ color: c, roughness: r });
  const P: Palette = {
    // 거실: porcelain slab (white), oak 강마루 (natural), grey porcelain (minimal); rooms: 강마루
    floorMain: white ? L.textured("marble_white", { color: "#ffffff", roughnessScale: 0.55, clearcoat: 0.6, clearcoatRoughness: 0.08, ao: 0.4 })
      : wood ? L.textured("laminate_floor_02", { roughnessScale: 0.85, clearcoat: 0.25, clearcoatRoughness: 0.25 })
      : L.textured("granite_tile", { color: "#d9d7d3", roughnessScale: 0.6, clearcoat: 0.45, clearcoatRoughness: 0.12 }),
    floorRoom: style === "gray_minimal" ? L.textured("laminate_floor_02", { color: "#c9c3bc", roughnessScale: 0.85, clearcoat: 0.2, clearcoatRoughness: 0.3 })
      : L.textured(white ? "laminate_floor_02" : "herringbone_parquet", { color: white ? "#f3ece4" : "#ffffff", roughnessScale: 0.85, clearcoat: 0.25, clearcoatRoughness: 0.25 }),
    floorWet: L.textured("granite_tile", { color: white ? "#cfcdca" : "#a9a7a4", roughnessScale: 0.7, ao: 0.8 }),
    floorEntry: L.textured("granite_tile", { color: "#8f8c88", roughnessScale: 0.75, ao: 0.8 }),
    // 실크 벽지: the plaster set's relief only, under a flat colour, a little sheen
    wall: L.textured("plastered_wall_02", { useMap: false, color: white ? "#f4f2ee" : wood ? "#efe9df" : "#e3e2df", roughnessScale: 0.95, normalScale: 0.15, sheen: 0.25, sheenColor: "#ffffff", ao: 0.3 }),
    wallAccent: white ? L.textured("marble_white", { color: "#f7f5f2", roughnessScale: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.1 })
      : wood ? L.textured("walnut_veneer", { roughnessScale: 0.7, clearcoat: 0.3 })
      : L.textured("granite_tile", { color: "#9b9894", roughnessScale: 0.65 }),
    wallWet: L.textured("marble_white", { color: wood ? "#f7efe2" : "#ffffff", roughnessScale: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.05, ao: 0.5 }),
    ceiling: paint("#f7f6f3", 0.95),
    trim: paint(white ? "#f5f4f1" : wood ? "#ebe5dc" : "#d8d6d2", 0.6),
    door: white ? L.plain({ color: "#f3f2ee", roughness: 0.42, clearcoat: 0.3 }) : wood ? L.textured("white_oak_veneer", { roughnessScale: 0.7, clearcoat: 0.2 }) : L.plain({ color: "#9d9a96", roughness: 0.5, clearcoat: 0.2 }),
    doorFrame: white ? L.plain({ color: "#f3f2ee", roughness: 0.45 }) : wood ? L.textured("white_oak_veneer", { roughnessScale: 0.75 }) : L.plain({ color: "#8e8b87", roughness: 0.5 }),
    frontDoor: L.plain({ color: "#3a3b3d", roughness: 0.55, metalness: 0.4, clearcoat: 0.2 }),
    handle: L.plain({ color: style === "gray_minimal" ? "#1b1b1c" : "#cfd1d3", roughness: style === "gray_minimal" ? 0.35 : 0.18, metalness: 1 }),
    winFrame: L.plain({ color: "#f2f2ef", roughness: 0.35, clearcoat: 0.2 }),
    // (glass takes no light of its own: an area light's highlight on it reads as a lamp in the window)
    glass: L.basic({ color: "#dfeaea", transparent: true, opacity: 0.07, side: THREE.DoubleSide, forceSinglePass: true }),
    sill: L.textured("marble_white", { color: "#ffffff", roughnessScale: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.05 }),
    cabinet: white ? L.plain({ color: "#f6f5f2", roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 }) : wood ? L.textured("white_oak_veneer", { roughnessScale: 0.65, clearcoat: 0.2 }) : L.plain({ color: "#4a4b4d", roughness: 0.6 }),
    cabinetUpper: white || wood ? L.plain({ color: "#f6f5f2", roughness: white ? 0.12 : 0.5, clearcoat: white ? 1 : 0.2, clearcoatRoughness: 0.05 }) : L.plain({ color: "#5a5b5d", roughness: 0.6 }),
    counter: L.textured("marble_white", { color: "#ffffff", roughnessScale: 0.25, clearcoat: 1, clearcoatRoughness: 0.03, ao: 0.3 }),
    steel: L.plain({ color: "#c8cacc", roughness: 0.32, metalness: 1 }),
    chrome: L.plain({ color: "#e6e8ea", roughness: 0.06, metalness: 1 }),
    blackMetal: L.plain({ color: "#1d1d1f", roughness: 0.4, metalness: 0.8 }),
    ceramic: L.plain({ color: "#fbfbfa", roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02 }),
    mirror: L.plain({ color: "#ffffff", roughness: 0.0, metalness: 1 }),
    fabricSofa: L.textured(style === "gray_minimal" ? "leather_white" : "poly_wool_herringbone", { color: white ? "#d8d4ce" : wood ? "#cbbba4" : "#bfb6aa", roughnessScale: 1, sheen: 0.6, sheenColor: "#ffffff", normalScale: 0.8 }),
    fabricBed: L.textured("rough_linen", { color: "#ffffff", sheen: 0.5, sheenColor: "#ffffff", normalScale: 0.7 }),
    linen: L.textured("rough_linen", { color: wood ? "#d9c7aa" : white ? "#e3ddd3" : "#a9a6a1", sheen: 0.5, normalScale: 0.8 }),
    sheer: L.textured("rough_linen", { color: "#ffffff", roughnessScale: 1, side: THREE.DoubleSide, sheen: 0.4, normalScale: 0.4 }),
    drape: L.textured("rough_linen", { color: white ? "#e6dfd3" : wood ? "#cbb593" : "#9a9792", side: THREE.DoubleSide, sheen: 0.6, normalScale: 0.9 }),
    leather: L.textured("leather_white", { color: "#a07c5c", roughnessScale: 0.8, clearcoat: 0.15 }),
    velvet: L.textured("velour_velvet", { color: wood ? "#6f7a5a" : white ? "#7e8b96" : "#5e5b57", sheen: 1, sheenColor: "#ffffff" }),
    woodLight: L.textured("white_oak_veneer", { roughnessScale: 0.7, clearcoat: 0.25 }),
    woodDark: L.textured("walnut_veneer", { roughnessScale: 0.65, clearcoat: 0.3 }),
    rug: L.textured("poly_wool_herringbone", { color: white ? "#e8e3db" : wood ? "#d7cbb8" : "#a8a49f", sheen: 0.8, normalScale: 1.2, ao: 1 }),
    appliance: L.plain({ color: "#e9e8e4", roughness: 0.35, metalness: 0.1, clearcoat: 0.6 }),
    applianceDark: L.plain({ color: "#2b2c2e", roughness: 0.25, metalness: 0.3, clearcoat: 0.8 }),
    screen: L.plain({ color: "#050506", roughness: 0.05, metalness: 0.2, clearcoat: 1, emissive: "#ffffff", emissiveIntensity: 0 }),
    plastic: L.plain({ color: "#f4f4f2", roughness: 0.45 }),
    rubber: L.plain({ color: "#1a1a1a", roughness: 0.8 }),
    ledPanel: L.plain({ color: "#ffffff", roughness: 0.6, emissive: "#fff7ee", emissiveIntensity: 6 }),
    ledWarm: L.plain({ color: "#ffffff", roughness: 0.6, emissive: "#ffd9a8", emissiveIntensity: 5 }),
    lampShade: L.plain({ color: "#f4ede2", roughness: 0.9, emissive: "#ffcf96", emissiveIntensity: 0.65, side: THREE.DoubleSide }),
    plantLeaf: L.plain({ color: "#3f6b34", roughness: 0.55, sheen: 0.4, sheenColor: "#bfe39a", side: THREE.DoubleSide }),
    pot: L.plain({ color: white ? "#e9e6e1" : "#8a7f73", roughness: 0.7 }),
    soil: L.plain({ color: "#2e241c", roughness: 1 }),
    book: L.plain({ color: "#b5a58f", roughness: 0.8 }),
    art: L.plain({ color: "#ffffff", roughness: 0.9 }),
    water: L.plain({ color: "#cfe6ef", roughness: 0.02, transparent: true, opacity: 0.55, ior: 1.33 }),
    threshold: L.textured("marble_white", { color: "#ffffff", roughnessScale: 0.35, clearcoat: 0.7 }),
    grout: paint("#d6d3ce", 0.9),
  };
  // (made for the flat's style only: the others' textures are not downloaded)
  const O: Partial<Record<StyleName, () => Partial<Palette>>> = {
    japandi: () => ({
      floorMain: L.textured("laminate_floor_03", {color:"#d7c2a2",roughnessScale:.95,clearcoat:.08}),
      floorRoom: L.textured("laminate_floor_03", {color:"#e3cfb0",roughnessScale:.95}),
      wall: L.textured("beige_wall_001", {color:"#e7dcc8",normalScale:.22,roughnessScale:1}),
      wallAccent: L.textured("white_oak_veneer", {color:"#cdb28c",normalScale:.4,roughnessScale:.9}),
      cabinet: L.textured("white_oak_veneer", {color:"#d2b58e",roughnessScale:.85}), cabinetUpper:paint("#d4c8b5"),
      fabricSofa:L.textured("wool_boucle",{color:"#ded3bf",sheen:.65,normalScale:.65}),
      rug:L.textured("wool_boucle",{color:"#baaa8d",sheen:.5,normalScale:.8}),
      floorWet:L.textured("square_tiles_02",{color:"#c9bda8",roughnessScale:.95}),
      door:L.textured("white_oak_veneer",{color:"#c9ae89",roughnessScale:.9}),handle:L.plain({color:"#3a3732",metalness:.8,roughness:.38}),
    }),
    sage_terrazzo: () => ({
      floorMain:L.textured("laminate_floor_03",{color:"#d8cab3",roughnessScale:.85}),
      floorWet:L.textured("terrazzo_tiles",{color:"#e5dcd0",roughnessScale:.8,normalScale:.4}),
      floorEntry:L.textured("terrazzo_tiles",{color:"#d5c8b6",roughnessScale:.85}),
      wall:L.textured("beige_wall_001",{color:"#dfded0",normalScale:.15}),wallAccent:paint("#a0b09b"),
      cabinet:paint("#7f9781",.65),cabinetUpper:paint("#e3ddcf",.7),counter:L.textured("terrazzo_tiles",{color:"#ebe4d8",normalScale:.3,roughnessScale:.65}),
      fabricSofa:L.textured("rough_linen",{color:"#b6b79d",sheen:.55}),appliance:L.plain({color:"#c6c7bb",roughness:.4,clearcoat:.25}),
    }),
    urban_loft: () => ({
      floorMain:L.textured("concrete_floor_02",{color:"#b7b4ad",useMap:false,roughnessScale:.92,normalScale:.35}),
      floorRoom:L.textured("walnut_veneer",{color:"#8e7460",roughnessScale:.8}),
      wall:L.textured("concrete_floor_02",{color:"#ccc8bd",useMap:false,normalScale:.16,roughnessScale:1}),wallAccent:paint("#666b6b"),
      floorWet:L.textured("large_grey_tiles",{color:"#8a8983",roughnessScale:.9}),
      fabricSofa:L.textured("brown_leather",{color:"#d4b89c",roughnessScale:.8,clearcoat:.12}),leather:L.textured("brown_leather",{roughnessScale:.85}),
      cabinet:paint("#414745",.7),cabinetUpper:L.textured("walnut_veneer",{color:"#ae8f72",roughnessScale:.85}),
      appliance:L.plain({color:"#606568",roughness:.4,metalness:.65}),door:paint("#5c625f",.7),winFrame:paint("#353a38",.5),
    }),
    cream_boucle: () => ({
      floorMain:L.textured("laminate_floor_03",{color:"#e7d8bf",roughnessScale:.9}),floorRoom:L.textured("laminate_floor_03",{color:"#e2cfaf",roughnessScale:.9}),
      wall:L.textured("beige_wall_001",{color:"#e6d9c6",normalScale:.18}),wallAccent:paint("#c4ad94"),
      fabricSofa:L.textured("wool_boucle",{color:"#e3d9c9",sheen:.65,normalScale:.7}),fabricBed:L.textured("wool_boucle",{color:"#f1e6d5",sheen:.6,normalScale:.5}),
      rug:L.textured("wool_boucle",{color:"#c9b99f",sheen:.6,normalScale:1}),
      floorWet:L.textured("marble_tiles",{color:"#d4c8b4",roughnessScale:.7}),cabinet:paint("#d7c6ad",.6),cabinetUpper:paint("#e8dece",.7),
      appliance:L.plain({color:"#d6c9b5",roughness:.4,clearcoat:.35}),handle:L.plain({color:"#b49b74",metalness:.8,roughness:.3}),
    }),
    coastal_blue: () => ({
      floorMain:L.textured("plank_flooring_02",{color:"#e0d7c4",roughnessScale:.9}),floorRoom:L.textured("plank_flooring_02",{color:"#d8c9ad",roughnessScale:.9}),
      wall:L.textured("beige_wall_001",{color:"#dedfd7",normalScale:.15}),wallAccent:paint("#8ea9af"),cabinet:paint("#668793",.65),cabinetUpper:paint("#deded4",.65),
      floorWet:L.textured("terrazzo_tiles",{color:"#c7d3d0",roughnessScale:.8}),fabricSofa:L.textured("rough_linen",{color:"#829da8",sheen:.5}),
      drape:L.textured("rough_linen",{color:"#c6d1ce",side:THREE.DoubleSide,sheen:.5}),appliance:L.plain({color:"#bac8c9",roughness:.45,clearcoat:.2}),
    }),
    // the first three: their bathrooms and appliances
    modern_white: () => ({
      wallWet: L.textured("long_white_tiles", { color: "#ffffff", roughnessScale: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.05, ao: 0.6 }),
      floorWet: L.textured("large_floor_tiles_02", { color: "#e9e7e3", roughnessScale: 0.6, ao: 0.7 }),
      appliance: L.plain({ color: "#f4f3f0", roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 }),
    }),
    wood_natural: () => ({
      floorWet: L.textured("square_tiles_02", { color: "#d8d2c8", roughnessScale: 0.7, ao: 0.8 }),
      appliance: L.plain({ color: "#e4dccd", roughness: 0.4, clearcoat: 0.5 }),
    }),
    gray_minimal: () => ({
      floorWet: L.textured("large_grey_tiles", { color: "#b9b7b4", roughnessScale: 0.65, ao: 0.8 }),
      appliance: L.plain({ color: "#a3a6a9", roughness: 0.3, metalness: 0.65, clearcoat: 0.4 }),
    }),
    // 클래식 월넛: walnut parquet and doors, a leather sofa, marble tiles, stainless appliances
    classic_walnut: () => ({
      floorMain: L.textured("rectangular_parquet", { color: "#d8b894", roughnessScale: 0.75, clearcoat: 0.35, clearcoatRoughness: 0.2 }),
      floorRoom: L.textured("wood_floor", { color: "#c9a27c", roughnessScale: 0.85, clearcoat: 0.25, clearcoatRoughness: 0.25 }),
      wall: L.textured("plastered_wall_02", { useMap: false, color: "#eee5d6", roughnessScale: 0.95, normalScale: 0.15, sheen: 0.25, sheenColor: "#ffffff", ao: 0.3 }),
      wallAccent: L.textured("walnut_veneer", { roughnessScale: 0.6, clearcoat: 0.35 }),
      door: L.textured("walnut_veneer", { roughnessScale: 0.65, clearcoat: 0.3 }), doorFrame: L.textured("walnut_veneer", { roughnessScale: 0.7 }),
      cabinet: L.textured("walnut_veneer", { roughnessScale: 0.6, clearcoat: 0.3 }), cabinetUpper: paint("#efe8dc", 0.5),
      fabricSofa: L.textured("leather_white", { color: "#6e4a32", roughnessScale: 0.75, clearcoat: 0.2 }),
      velvet: L.textured("velour_velvet", { color: "#2f4a3a", sheen: 1, sheenColor: "#ffffff" }),
      rug: L.textured("poly_wool_herringbone", { color: "#7a3a34", sheen: 0.8, normalScale: 1.2, ao: 1 }),
      floorWet: L.textured("marble_tiles", { color: "#ffffff", roughnessScale: 0.45, clearcoat: 0.5, ao: 0.7 }),
      wallWet: L.textured("marble_tiles", { color: "#f6f2ea", roughnessScale: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.05, ao: 0.5 }),
      appliance: L.plain({ color: "#c3c6c8", roughness: 0.28, metalness: 0.85, clearcoat: 0.3 }),
      handle: L.plain({ color: "#b8955a", roughness: 0.25, metalness: 1 }),
    }),
    // 북유럽 화이트우드: pale oak planks, white walls, linen-grey fabric, small white tiles
    nordic_bright: () => ({
      floorMain: L.textured("laminate_floor_03", { color: "#f1e8dc", roughnessScale: 0.85, clearcoat: 0.15, clearcoatRoughness: 0.3 }),
      floorRoom: L.textured("plank_flooring_02", { color: "#f4ebde", roughnessScale: 0.9, clearcoat: 0.1, clearcoatRoughness: 0.35 }),
      wall: L.textured("plastered_wall_02", { useMap: false, color: "#f7f6f2", roughnessScale: 0.95, normalScale: 0.12, sheen: 0.2, sheenColor: "#ffffff", ao: 0.3 }),
      wallAccent: L.textured("white_oak_veneer", { color: "#f6efe4", roughnessScale: 0.75 }),
      cabinet: L.textured("white_oak_veneer", { color: "#f3ebe0", roughnessScale: 0.7, clearcoat: 0.15 }),
      fabricSofa: L.textured("rough_linen", { color: "#cfcbc3", sheen: 0.5, sheenColor: "#ffffff", normalScale: 0.8 }),
      velvet: L.textured("velour_velvet", { color: "#c9b48e", sheen: 1, sheenColor: "#ffffff" }),
      rug: L.textured("poly_wool_herringbone", { color: "#efe9df", sheen: 0.8, normalScale: 1.2, ao: 1 }),
      floorWet: L.textured("square_tiles_02", { color: "#ecebe7", roughnessScale: 0.7, ao: 0.8 }),
      wallWet: L.textured("long_white_tiles", { color: "#ffffff", roughnessScale: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.05, ao: 0.6 }),
      appliance: L.plain({ color: "#efece6", roughness: 0.55, clearcoat: 0.2 }),
    }),
    // 호텔 다크: large dark porcelain, smoked oak, marble walls, charcoal velvet, black appliances
    hotel_dark: () => ({
      floorMain: L.textured("large_grey_tiles", { color: "#7f7d7a", roughnessScale: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.1, ao: 0.5 }),
      floorRoom: L.textured("wooden_floor_02", { color: "#9a8572", roughnessScale: 0.8, clearcoat: 0.3, clearcoatRoughness: 0.2 }),
      wall: L.textured("plastered_wall_02", { useMap: false, color: "#d8d4ce", roughnessScale: 0.95, normalScale: 0.15, sheen: 0.25, sheenColor: "#ffffff", ao: 0.3 }),
      wallAccent: L.textured("walnut_veneer", { color: "#7a6a5c", roughnessScale: 0.55, clearcoat: 0.4 }),
      door: L.plain({ color: "#3a3836", roughness: 0.45, clearcoat: 0.3 }), doorFrame: L.plain({ color: "#33312f", roughness: 0.5 }),
      cabinet: L.plain({ color: "#2b2b2d", roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }), cabinetUpper: L.plain({ color: "#3a3a3c", roughness: 0.3, clearcoat: 0.6 }),
      fabricSofa: L.textured("velour_velvet", { color: "#4a4846", sheen: 1, sheenColor: "#ffffff" }),
      velvet: L.textured("velour_velvet", { color: "#5a2f38", sheen: 1, sheenColor: "#ffffff" }),
      rug: L.textured("poly_wool_herringbone", { color: "#56524e", sheen: 0.8, normalScale: 1.2, ao: 1 }),
      floorWet: L.textured("large_floor_tiles_02", { color: "#8d8a86", roughnessScale: 0.55, ao: 0.7 }),
      wallWet: L.textured("marble_tiles", { color: "#cfcac2", roughnessScale: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.05, ao: 0.5 }),
      appliance: L.plain({ color: "#1f2022", roughness: 0.12, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03 }),
      handle: L.plain({ color: "#1b1b1c", roughness: 0.3, metalness: 1 }),
      trim: paint("#4a4744", 0.6),
    }),
    // 빈티지 웜: diagonal parquet, cream walls, mint painted kitchen, a mustard velvet sofa, mosaic tiles, a mint retro fridge
    vintage_warm: () => ({
      floorMain: L.textured("diagonal_parquet", { color: "#e0bf98", roughnessScale: 0.8, clearcoat: 0.3, clearcoatRoughness: 0.25 }),
      floorRoom: L.textured("laminate_floor_03", { color: "#d9b48a", roughnessScale: 0.85, clearcoat: 0.2, clearcoatRoughness: 0.3 }),
      wall: L.textured("plastered_wall_02", { useMap: false, color: "#f1e6d0", roughnessScale: 0.95, normalScale: 0.18, sheen: 0.2, sheenColor: "#ffffff", ao: 0.3 }),
      wallAccent: paint("#a9c4b4", 0.8),
      cabinet: L.plain({ color: "#9fc2b2", roughness: 0.45, clearcoat: 0.4 }), cabinetUpper: L.plain({ color: "#f0e8d8", roughness: 0.5, clearcoat: 0.3 }),
      fabricSofa: L.textured("velour_velvet", { color: "#c4922e", sheen: 1, sheenColor: "#ffffff" }),
      velvet: L.textured("velour_velvet", { color: "#8a3f3a", sheen: 1, sheenColor: "#ffffff" }),
      rug: L.textured("poly_wool_herringbone", { color: "#c46a4a", sheen: 0.8, normalScale: 1.2, ao: 1 }),
      floorWet: L.textured("floor_tiles_06", { color: "#e8e2d6", roughnessScale: 0.7, ao: 0.8 }),
      wallWet: L.textured("marble_mosaic_tiles", { color: "#ffffff", roughnessScale: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.06, ao: 0.6 }),
      appliance: L.plain({ color: "#a8cdbf", roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.06 }),
      handle: L.plain({ color: "#c9a25a", roughness: 0.2, metalness: 1 }),
    }),
  };
  return Object.assign(P, O[style0]?.() ?? {});
}
