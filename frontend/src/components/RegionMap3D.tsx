import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { api, RealEstatePeriod, RealEstateRegionLevel, RealEstateRegionMove, RealEstateSido } from "../api/client";
import { pct } from "../mapTile";
import { ThemeMode, useThemeMode } from "../theme";
import { changeToRgb } from "../treemap";

/* The 부동산 맵's region map: Korea in relief, one level at a time — the 시·도, one
 * 시·도's 시·군·구, or one 시·군·구's 읍·면·동 — each region raised as a block and
 * coloured by how its apartments moved over the chosen period (the price-weighted
 * mean move of its complexes, from /api/realestate/summary). Picking a region
 * narrows the treemap beside it to that region and steps the map one level down.
 *
 * Boundaries are static files under /geo/realestate, built by
 * scripts/build_realestate_geo.sh: 시·도 and 시·군·구 from the 2026-07 administrative
 * boundaries (vuski/admdongkor, so 전남광주통합특별시 and the new 인천·화성 구 are drawn
 * as they are now), 읍·면·동 from the 법정동 boundaries (juso EMD) the trade data is
 * filed under, each assigned to the 시·군·구 it lies in today. */

type Level = RealEstateRegionLevel;
type Ring = [number, number][];

interface GeoFeature {
  properties: { code: string; name: string; lx: number | null; ly: number | null; area: number };
  geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
}

interface Region {
  /** 시·도/시·군·구 code, or the 읍·면·동's name. */
  key: string;
  name: string;
  label: string;
  lx: number;
  ly: number;
  area: number;
  polygons: Ring[][];
  pickable: boolean;
}

const LEVELS: { key: Level; label: string }[] = [
  { key: "sido", label: "시·도" },
  { key: "sgg", label: "시·군·구" },
  { key: "dong", label: "읍·면·동" },
];

const SIDO_SHORT: Record<string, string> = {
  서울특별시: "서울",
  부산광역시: "부산",
  대구광역시: "대구",
  인천광역시: "인천",
  광주광역시: "광주",
  대전광역시: "대전",
  울산광역시: "울산",
  세종특별자치시: "세종",
  경기도: "경기",
  강원특별자치도: "강원",
  충청북도: "충북",
  충청남도: "충남",
  전북특별자치도: "전북",
  전라남도: "전남",
  전남광주통합특별시: "전남광주",
  경상북도: "경북",
  경상남도: "경남",
  제주특별자치도: "제주",
};

const HIGHLIGHT = "#f2c14e";

/** The scene in each edition: 야간판 blocks on a dark ground, 주간판 blocks on paper
 * — the site's light tile palette, a pale no-trade block, ink edges, a softer shadow. */
const PALETTES: Record<
  ThemeMode,
  { idle: THREE.Color; edge: number; edgeOpacity: number; shadow: number; sky: number; bounce: number; side: number }
> = {
  dark: { idle: new THREE.Color("#25251f"), edge: 0xf5efe0, edgeOpacity: 0.3, shadow: 0.42, sky: 0xf4efe2, bounce: 0x14130f, side: 0.52 },
  light: { idle: new THREE.Color("#d9d2c0"), edge: 0x16140e, edgeOpacity: 0.22, shadow: 0.2, sky: 0xffffff, bounce: 0xb8ae96, side: 0.7 },
};
/** changeToRgb reaches full colour at 5%. */
const RGB_FULL_PCT = 5;

/** Where the colour scale saturates for the regions on screen: most of them (the
 * 85th percentile of |move|) inside it, so a level whose regions all moved 1–3% still
 * reads as a range of colours rather than one shade — rounded to half a percent and
 * kept between 1.5% and 8%. */
function saturationFor(moves: Iterable<RealEstateRegionMove>): number {
  const abs = [...moves].map((m) => Math.abs(m.change ?? NaN)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!abs.length) return 5;
  const p = abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.85))];
  return Math.min(8, Math.max(1.5, Math.round(p * 2) / 2));
}

function capColor(move: RealEstateRegionMove | undefined, saturation: number, theme: ThemeMode): THREE.Color {
  if (!move || move.change === null) return PALETTES[theme].idle.clone();
  const { r, g, b } = changeToRgb((move.change / saturation) * RGB_FULL_PCT, theme);
  return new THREE.Color(`rgb(${r}, ${g}, ${b})`);
}

/** "+4.3%": one decimal is plenty for a region's mean. */
function shortPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

// ── geometry ────────────────────────────────────────────────────────────────

const geoCache = new Map<string, Promise<GeoFeature[]>>();

function loadGeo(path: string): Promise<GeoFeature[]> {
  let hit = geoCache.get(path);
  if (!hit) {
    hit = fetch(`/geo/realestate/${path}`)
      .then((r) => {
        if (!r.ok) throw new Error(`geo ${r.status}`);
        return r.json();
      })
      .then((fc: { features: GeoFeature[] }) => fc.features);
    hit.catch(() => geoCache.delete(path));
    geoCache.set(path, hit);
  }
  return hit;
}

function polygonsOf(f: GeoFeature): Ring[][] {
  return f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
}

/** An equirectangular projection around the regions' centre, x scaled by cos(lat) —
 * true to shape at the scale of Korea — sized so the longer side spans 100 units. */
function projection(regions: Region[]) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const r of regions)
    for (const poly of r.polygons)
      for (const [x, y] of poly[0]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const lon0 = (x0 + x1) / 2;
  const lat0 = (y0 + y1) / 2;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const span = Math.max((x1 - x0) * k, y1 - y0) || 1;
  const s = 100 / span;
  return (lon: number, lat: number): [number, number] => [(lon - lon0) * k * s, (lat - lat0) * s];
}

function ringPoints(ring: Ring, proj: (lon: number, lat: number) => [number, number]): THREE.Vector2[] {
  const pts = ring.map(([lon, lat]) => new THREE.Vector2(...proj(lon, lat)));
  if (pts.length > 1 && pts[0].equals(pts[pts.length - 1])) pts.pop();
  return pts;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ── scene ───────────────────────────────────────────────────────────────────

interface Block {
  region: Region;
  group: THREE.Group;
  mesh: THREE.Mesh;
  cap: THREE.MeshStandardMaterial;
  side: THREE.MeshStandardMaterial;
  edges: THREE.LineSegments;
  label: HTMLDivElement;
  labelSize: { w: number; h: number } | null;
  anchor: THREE.Vector3;
  lift: number;
  color: THREE.Color;
  target: THREE.Color;
  delay: number;
  grow: number;
}

interface Pose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

class RegionScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 5000);
  private controls: OrbitControls;
  private root = new THREE.Group();
  private ground: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private theme: ThemeMode = "dark";
  private blocks = new Map<string, Block>();
  private outline = new THREE.Group();
  private outlineMat = new LineMaterial({ color: HIGHLIGHT, linewidth: 2.4, transparent: true, depthTest: false });
  private raycaster = new THREE.Raycaster();
  private depth = 3;
  private fit: Pose | null = null;
  private tween: { from: Pose; to: Pose; start: number; ms: number } | null = null;
  private introStart = 0;
  private raf = 0;
  private dirty = true;
  private width = 1;
  private height = 1;
  private hovered: string | null = null;
  private selected: string | null = null;
  private moves = new Map<string, RealEstateRegionMove>();
  private saturation = 5;
  private resizeObserver: ResizeObserver;
  private down: { x: number; y: number; t: number } | null = null;
  private labelLayer: HTMLDivElement;

  onHover: (region: Region | null, x: number, y: number) => void = () => {};
  onPick: (region: Region) => void = () => {};

  constructor(private host: HTMLDivElement, labelLayer: HTMLDivElement, touch: boolean) {
    this.labelLayer = labelLayer;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.prepend(this.renderer.domElement);

    this.camera.up.set(0, 0, 1);
    this.scene.add(this.root);
    this.root.add(this.outline);

    this.hemi = new THREE.HemisphereLight(PALETTES.dark.sky, PALETTES.dark.bounce, 1.15);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff6e5, 1.6);
    this.sun.position.set(-60, -40, 120);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -80;
    sc.right = sc.top = 80;
    sc.near = 1;
    sc.far = 400;
    this.scene.add(this.sun);
    const rim = new THREE.DirectionalLight(0x9fb4ff, 0.35);
    rim.position.set(70, 90, 40);
    this.scene.add(rim);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: 0.42 }));
    this.ground.receiveShadow = true;
    this.ground.position.z = -0.01;
    this.scene.add(this.ground);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.55;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = 1.12;
    this.controls.minAzimuthAngle = -0.85;
    this.controls.maxAzimuthAngle = 0.85;
    // A finger on a phone scrolls the page; turning the map is a mouse gesture.
    this.controls.enabled = !touch;
    this.controls.addEventListener("change", () => (this.dirty = true));
    this.controls.addEventListener("start", () => (this.tween = null));

    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.handleMove);
    el.addEventListener("pointerleave", this.handleLeave);
    el.addEventListener("pointerdown", this.handleDown);
    el.addEventListener("pointerup", this.handleUp);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.loop();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.clear();
    this.controls.dispose();
    this.outlineMat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private clear() {
    for (const b of this.blocks.values()) {
      b.mesh.geometry.dispose();
      b.cap.dispose();
      b.side.dispose();
      b.edges.geometry.dispose();
      (b.edges.material as THREE.Material).dispose();
      b.label.remove();
      this.root.remove(b.group);
    }
    this.blocks.clear();
    this.clearOutline();
  }

  private clearOutline() {
    for (const child of [...this.outline.children]) {
      (child as LineSegments2).geometry.dispose();
      this.outline.remove(child);
    }
  }

  setRegions(regions: Region[], level: Level) {
    this.clear();
    this.hovered = null;
    if (!regions.length) return;
    const proj = projection(regions);
    // Taller blocks for fewer, larger regions; a 동 map stays low so its labels read.
    this.depth = level === "sido" ? 4.2 : level === "sgg" ? 3.4 : 2.8;
    let maxDist = 1;
    const centre = new THREE.Vector2();
    for (const region of regions) {
      const shapes: THREE.Shape[] = [];
      const edgePts: number[] = [];
      const z = this.depth + 0.02;
      for (const poly of region.polygons) {
        const outer = ringPoints(poly[0], proj);
        if (outer.length < 3) continue;
        const shape = new THREE.Shape(outer);
        for (const hole of poly.slice(1)) {
          const h = ringPoints(hole, proj);
          if (h.length >= 3) shape.holes.push(new THREE.Path(h));
        }
        shapes.push(shape);
        for (const ring of [outer, ...shape.holes.map((h) => h.getPoints())]) {
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i];
            const b = ring[(i + 1) % ring.length];
            edgePts.push(a.x, a.y, z, b.x, b.y, z);
          }
        }
      }
      if (!shapes.length) continue;
      const geometry = new THREE.ExtrudeGeometry(shapes, { depth: this.depth, bevelEnabled: false, curveSegments: 1 });
      const palette = PALETTES[this.theme];
      const cap = new THREE.MeshStandardMaterial({ color: palette.idle, roughness: 0.58, metalness: 0.06 });
      const side = new THREE.MeshStandardMaterial({ color: palette.idle.clone().multiplyScalar(palette.side), roughness: 0.85, metalness: 0 });
      const mesh = new THREE.Mesh(geometry, [cap, side]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.key = region.key;
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute("position", new THREE.Float32BufferAttribute(edgePts, 3));
      const edges = new THREE.LineSegments(
        edgeGeo,
        new THREE.LineBasicMaterial({ color: palette.edge, transparent: true, opacity: palette.edgeOpacity }),
      );
      const group = new THREE.Group();
      group.add(mesh, edges);
      group.scale.z = 0.001;
      this.root.add(group);

      const [ax, ay] = region.lx !== null ? proj(region.lx, region.ly) : [0, 0];
      const dist = centre.distanceTo(new THREE.Vector2(ax, ay));
      maxDist = Math.max(maxDist, dist);
      const label = document.createElement("div");
      label.className = "rm3-label";
      this.labelLayer.appendChild(label);
      this.blocks.set(region.key, {
        region,
        group,
        mesh,
        cap,
        side,
        edges,
        label,
        labelSize: null,
        anchor: new THREE.Vector3(ax, ay, this.depth),
        lift: 0,
        color: palette.idle.clone(),
        target: palette.idle.clone(),
        delay: dist,
        grow: 0,
      });
    }
    // Blocks rise from the centre outwards.
    for (const b of this.blocks.values()) b.delay = (b.delay / maxDist) * 380;
    this.introStart = performance.now();
    this.applyMoves();
    this.applySelected();
    this.frame(true);
  }

  setTheme(theme: ThemeMode) {
    this.theme = theme;
    const palette = PALETTES[theme];
    this.hemi.color.setHex(palette.sky);
    this.hemi.groundColor.setHex(palette.bounce);
    (this.ground.material as THREE.ShadowMaterial).opacity = palette.shadow;
    for (const b of this.blocks.values()) {
      const edge = b.edges.material as THREE.LineBasicMaterial;
      edge.color.setHex(palette.edge);
      edge.opacity = palette.edgeOpacity;
    }
    this.applyMoves();
  }

  setMoves(moves: Map<string, RealEstateRegionMove>, saturation: number) {
    this.moves = moves;
    this.saturation = saturation;
    this.applyMoves();
  }

  private applyMoves() {
    for (const b of this.blocks.values()) {
      const move = this.moves.get(b.region.key);
      b.target = capColor(move, this.saturation, this.theme);
      const change = move?.change ?? null;
      const tone = change === null ? "idle" : change > 0 ? "up" : change < 0 ? "down" : "flat";
      b.label.dataset.tone = tone;
      b.label.innerHTML = "";
      const name = document.createElement("b");
      name.textContent = b.region.label;
      const value = document.createElement("span");
      value.textContent = change === null ? "—" : shortPct(change);
      b.label.append(name, value);
      b.labelSize = null;
    }
    this.dirty = true;
  }

  setSelected(key: string | null) {
    this.selected = key;
    this.applySelected();
  }

  private applySelected() {
    this.clearOutline();
    for (const b of this.blocks.values()) b.label.classList.toggle("is-selected", b.region.key === this.selected);
    const b = this.selected ? this.blocks.get(this.selected) : null;
    if (b) {
      const pos = b.edges.geometry.getAttribute("position") as THREE.BufferAttribute;
      // The outline traces the block's top edge in screen-space-wide segments.
      const lineGeo = new LineSegmentsGeometry();
      lineGeo.setPositions(Array.from(pos.array as Float32Array));
      const line = new LineSegments2(lineGeo, this.outlineMat);
      line.renderOrder = 10;
      line.userData.key = b.region.key;
      this.outline.add(line);
    }
    this.dirty = true;
  }

  /** Points the camera at the regions, from above and a little south-west. */
  private fitPose(): Pose | null {
    if (!this.blocks.size) return null;
    const box = new THREE.Box3();
    for (const b of this.blocks.values()) box.expandByObject(b.mesh);
    if (box.isEmpty()) return null;
    box.max.z = this.depth;
    box.min.z = 0;
    const target = box.getCenter(new THREE.Vector3());
    target.z = 0;
    const polar = 0.58;
    const azimuth = -0.18;
    const dir = new THREE.Vector3(Math.sin(polar) * Math.sin(azimuth), -Math.sin(polar) * Math.cos(azimuth), Math.cos(polar));
    const corners = [
      new THREE.Vector3(box.min.x, box.min.y, 0),
      new THREE.Vector3(box.max.x, box.min.y, 0),
      new THREE.Vector3(box.min.x, box.max.y, 0),
      new THREE.Vector3(box.max.x, box.max.y, 0),
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ];
    const cam = this.camera.clone();
    let distance = 160;
    for (let i = 0; i < 4; i++) {
      cam.position.copy(target).addScaledVector(dir, distance);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      let extent = 0;
      for (const c of corners) {
        const p = c.clone().project(cam);
        extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
      }
      distance *= extent / 0.94;
    }
    return { position: target.clone().addScaledVector(dir, distance), target };
  }

  private frame(animate: boolean) {
    const pose = this.fitPose();
    if (!pose) return;
    this.fit = pose;
    this.moveTo(pose, animate ? 850 : 0);
  }

  private moveTo(pose: Pose, ms: number) {
    if (ms <= 0) {
      this.camera.position.copy(pose.position);
      this.controls.target.copy(pose.target);
      this.controls.update();
      this.tween = null;
    } else {
      this.tween = {
        from: { position: this.camera.position.clone(), target: this.controls.target.clone() },
        to: pose,
        start: performance.now(),
        ms,
      };
    }
    this.dirty = true;
  }

  reset() {
    this.frame(true);
  }

  zoom(factor: number) {
    if (!this.fit) return;
    const target = this.controls.target.clone();
    const offset = this.camera.position.clone().sub(target);
    const fitDist = this.fit.position.distanceTo(this.fit.target);
    const next = THREE.MathUtils.clamp(offset.length() * factor, fitDist * 0.3, fitDist * 1.5);
    this.moveTo({ position: target.clone().add(offset.setLength(next)), target }, 320);
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.outlineMat.resolution.set(w, h);
    if (this.fit) this.frame(false);
    this.dirty = true;
  }

  private step(now: number): boolean {
    let active = false;
    if (this.tween) {
      const t = Math.min(1, (now - this.tween.start) / this.tween.ms);
      const e = easeInOut(t);
      this.camera.position.lerpVectors(this.tween.from.position, this.tween.to.position, e);
      this.controls.target.lerpVectors(this.tween.from.target, this.tween.to.target, e);
      if (t >= 1) this.tween = null;
      active = true;
    }
    for (const b of this.blocks.values()) {
      const g = Math.min(1, Math.max(0, (now - this.introStart - b.delay) / 620));
      if (g !== b.grow) {
        b.grow = g;
        b.group.scale.z = Math.max(0.001, easeOut(g));
        active = true;
      }
      const lift = b.region.key === this.selected ? this.depth * 0.5 : b.region.key === this.hovered ? this.depth * 0.32 : 0;
      if (Math.abs(lift - b.lift) > 0.005) {
        b.lift += (lift - b.lift) * 0.22;
        b.group.position.z = b.lift;
        active = true;
      }
      if (!b.color.equals(b.target)) {
        b.color.lerp(b.target, 0.14);
        const close = Math.abs(b.color.r - b.target.r) + Math.abs(b.color.g - b.target.g) + Math.abs(b.color.b - b.target.b) < 0.004;
        if (close) b.color.copy(b.target);
        active = true;
      }
      const shown = b.color.clone();
      if (b.region.key === this.hovered) shown.offsetHSL(0, 0, 0.06);
      b.cap.color.copy(shown);
      b.side.color.copy(shown).multiplyScalar(PALETTES[this.theme].side);
    }
    const sel = this.selected ? this.blocks.get(this.selected) : null;
    if (sel) this.outline.position.z = sel.lift + (sel.group.scale.z - 1) * this.depth;
    this.outline.visible = !!sel && sel.grow >= 1;
    return active;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const active = this.step(now);
    const moved = this.controls.update();
    if (active || moved || this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.placeLabels();
      this.dirty = false;
    }
  };

  /** Labels over each region's inner point, the selected and the larger regions
   * first; one that would overlap a placed label is hidden until there is room. */
  private placeLabels() {
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const order = [...this.blocks.values()].sort((a, b) => {
      const rank = (x: Block) => (x.region.key === this.selected ? 2 : x.region.key === this.hovered ? 1 : 0);
      return rank(b) - rank(a) || b.region.area - a.region.area;
    });
    const v = new THREE.Vector3();
    for (const b of order) {
      if (b.region.lx === null || b.grow < 0.6) {
        b.label.style.opacity = "0";
        continue;
      }
      v.copy(b.anchor);
      v.z = this.depth * b.group.scale.z + b.lift;
      v.project(this.camera);
      const x = (v.x * 0.5 + 0.5) * this.width;
      const y = (-v.y * 0.5 + 0.5) * this.height;
      if (!b.labelSize) b.labelSize = { w: b.label.offsetWidth, h: b.label.offsetHeight };
      const { w, h } = b.labelSize;
      const box = { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
      const inside = box.x0 >= 0 && box.y0 >= 0 && box.x1 <= this.width && box.y1 <= this.height;
      const free = placed.every((p) => box.x1 < p.x0 || box.x0 > p.x1 || box.y1 < p.y0 || box.y0 > p.y1);
      const show = inside && (free || b.region.key === this.selected);
      if (show) placed.push(box);
      b.label.style.opacity = show ? "1" : "0";
      b.label.style.transform = `translate(${(x - w / 2).toFixed(1)}px, ${(y - h / 2).toFixed(1)}px)`;
    }
  }

  private pick(clientX: number, clientY: number): Block | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(
      [...this.blocks.values()].map((b) => b.mesh),
      false,
    );
    const key = hits[0]?.object.userData.key as string | undefined;
    return key ? (this.blocks.get(key) ?? null) : null;
  }

  private handleMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const b = this.pick(e.clientX, e.clientY);
    const key = b?.region.key ?? null;
    if (key !== this.hovered) {
      this.hovered = key;
      this.dirty = true;
    }
    this.renderer.domElement.style.cursor = b?.region.pickable ? "pointer" : this.controls.enabled ? "grab" : "default";
    const rect = this.host.getBoundingClientRect();
    this.onHover(b?.region ?? null, e.clientX - rect.left, e.clientY - rect.top);
  };

  private handleLeave = () => {
    this.hovered = null;
    this.dirty = true;
    this.onHover(null, 0, 0);
  };

  private handleDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private handleUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 700) return;
    const b = this.pick(e.clientX, e.clientY);
    if (b?.region.pickable) this.onPick(b.region);
  };
}

// ── component ───────────────────────────────────────────────────────────────

interface Props {
  regions: RealEstateSido[];
  sido: string;
  sgg: string;
  dong: string;
  period: RealEstatePeriod;
  periodLabel: string;
  touch: boolean;
  onSelect: (sel: { sido: string; sgg: string; dong: string }) => void;
}

function supportsWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function RegionMap3D({ regions, sido, sgg, dong, period, periodLabel, touch, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<RegionScene | null>(null);
  const [webgl] = useState(supportsWebGL);
  const theme = useThemeMode();
  const [level, setLevel] = useState<Level>(sgg ? "dong" : "sgg");
  const [shapes, setShapes] = useState<{ key: string; level: Level; features: GeoFeature[] } | null>(null);
  const [geoError, setGeoError] = useState(false);
  const [moves, setMoves] = useState<{ key: string; items: RealEstateRegionMove[]; pending: number } | null>(null);
  const [hover, setHover] = useState<{ region: Region; x: number; y: number } | null>(null);

  // A new 시·군·구 steps the map down to its 읍·면·동; leaving one steps back up to the
  // 시·도's 시·군·구. A tab chosen by hand stays until the selection changes.
  const last = useRef({ sido, sgg });
  useEffect(() => {
    const prev = last.current;
    if (sgg && sgg !== prev.sgg) setLevel("dong");
    else if (!sgg && (prev.sgg || sido !== prev.sido)) setLevel("sgg");
    last.current = { sido, sgg };
  }, [sido, sgg]);

  const sidoNode = regions.find((r) => r.code === sido);
  const sggNode = sidoNode?.sgg.find((g) => g.code === sgg);
  const shownLevel: Level = level === "dong" && !sgg ? "sgg" : level;
  const geoPath = shownLevel === "sido" ? "sido.json" : shownLevel === "sgg" ? `sgg/${sido}.json` : `emd/${sgg}.json`;
  const moveKey = `${shownLevel}:${shownLevel === "sgg" ? sido : shownLevel === "dong" ? sgg : ""}:${period}`;

  useEffect(() => {
    let cancelled = false;
    setGeoError(false);
    loadGeo(geoPath)
      .then((features) => !cancelled && setShapes({ key: geoPath, level: shownLevel, features }))
      .catch(() => !cancelled && setGeoError(true));
    return () => {
      cancelled = true;
    };
  }, [geoPath, shownLevel]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const load = () => {
      api
        .realEstateSummary({
          level: shownLevel,
          sido: shownLevel === "sgg" ? sido : undefined,
          sgg: shownLevel === "dong" ? sgg : undefined,
          period,
        })
        .then((res) => {
          if (cancelled) return;
          setMoves({ key: moveKey, items: res.items, pending: res.pending });
          if (res.pending > 0) timer = window.setTimeout(load, 3500);
        })
        .catch(() => {
          if (!cancelled) timer = window.setTimeout(load, 8000);
        });
    };
    load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [moveKey, shownLevel, sido, sgg, period]);

  // What each drawn shape stands for, and whether it can be picked.
  const drawn: Region[] = useMemo(() => {
    if (!shapes) return [];
    const known =
      shapes.level === "sido"
        ? new Set(regions.map((r) => r.code))
        : shapes.level === "sgg"
          ? new Set((sidoNode?.sgg ?? []).map((g) => g.code))
          : new Set(sggNode?.dongs ?? []);
    // Names come from the region table ("고양시 덕양구"), not the boundary files.
    const official = new Map<string, string>(
      shapes.level === "sido" ? regions.map((r) => [r.code, r.name]) : (sidoNode?.sgg ?? []).map((g) => [g.code, g.name]),
    );
    const labelOf = (name: string) => {
      if (shapes.level === "sido") return SIDO_SHORT[name] ?? name;
      if (shapes.level === "sgg") return name.split(" ").pop() ?? name;
      return name;
    };
    return shapes.features.map((f) => {
      const p = f.properties;
      const key = shapes.level === "dong" ? p.name : p.code;
      const name = shapes.level === "dong" ? p.name : (official.get(p.code) ?? p.name);
      return {
        key,
        name,
        label: labelOf(name),
        lx: p.lx ?? 0,
        ly: p.ly ?? 0,
        area: p.area,
        polygons: polygonsOf(f),
        pickable: known.has(key),
      };
    });
  }, [shapes, regions, sidoNode, sggNode]);

  const moveMap = useMemo(() => {
    const m = new Map<string, RealEstateRegionMove>();
    if (moves && moves.key === moveKey) for (const it of moves.items) m.set(it.code, it);
    return m;
  }, [moves, moveKey]);

  useEffect(() => {
    if (!webgl || !hostRef.current || !labelsRef.current) return;
    const scene = new RegionScene(hostRef.current, labelsRef.current, touch);
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [webgl, touch]);

  useEffect(() => {
    sceneRef.current?.setTheme(theme);
  }, [theme, webgl, touch]);

  useEffect(() => {
    sceneRef.current?.setRegions(drawn, shapes?.level ?? "sgg");
    // A card left over from the regions just replaced would name the wrong place.
    setHover(null);
  }, [drawn, shapes?.level]);

  const saturation = useMemo(() => saturationFor(moveMap.values()), [moveMap]);
  useEffect(() => {
    sceneRef.current?.setMoves(moveMap, saturation);
  }, [moveMap, saturation, drawn]);

  const selectedKey = shownLevel === "sido" ? sido : shownLevel === "sgg" ? sgg || null : dong || null;
  useEffect(() => {
    sceneRef.current?.setSelected(selectedKey);
  }, [selectedKey, drawn]);

  const pickRef = useRef<(r: Region) => void>(() => {});
  pickRef.current = (r: Region) => {
    // Picking the region already chosen still steps down into it.
    if (shownLevel === "sido") {
      if (r.key === sido && !sgg) setLevel("sgg");
      else onSelect({ sido: r.key, sgg: "", dong: "" });
    } else if (shownLevel === "sgg") {
      if (r.key === sgg) {
        if (dong) onSelect({ sido, sgg, dong: "" });
        setLevel("dong");
      } else onSelect({ sido, sgg: r.key, dong: "" });
    } else onSelect({ sido, sgg, dong: r.key === dong ? "" : r.key });
  };
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.onPick = (r) => pickRef.current(r);
    scene.onHover = (region, x, y) => setHover(region ? { region, x, y } : null);
  }, [webgl, touch]);

  const hoverMove = hover ? moveMap.get(hover.region.key) : undefined;
  const pending = moves && moves.key === moveKey ? moves.pending : 0;
  const readyShare =
    moves && moves.key === moveKey && moves.items.length && moves.items[0].ready !== undefined
      ? moves.items.reduce((s, it) => s + (it.ready ?? 1), 0) / moves.items.length
      : 1;
  const loading = !shapes || shapes.key !== geoPath || !moves || moves.key !== moveKey;

  const crumbs: { label: string; go: (() => void) | null }[] = [
    { label: "전국", go: () => setLevel("sido") },
    ...(sidoNode ? [{ label: SIDO_SHORT[sidoNode.name] ?? sidoNode.name, go: () => (sgg ? onSelect({ sido, sgg: "", dong: "" }) : setLevel("sgg")) }] : []),
    ...(sggNode ? [{ label: sggNode.name, go: () => (dong ? onSelect({ sido, sgg, dong: "" }) : setLevel("dong")) }] : []),
    ...(dong ? [{ label: dong, go: null }] : []),
  ];

  return (
    <section className="rm3" data-mode={theme} aria-label="지역별 등락 3D 지도">
      <header className="rm3-head">
        <div className="rm3-tabs" role="tablist" aria-label="지도 단위">
          {LEVELS.map((l) => (
            <button
              key={l.key}
              type="button"
              role="tab"
              aria-selected={shownLevel === l.key}
              className={shownLevel === l.key ? "active" : ""}
              disabled={l.key === "dong" && !sgg}
              onClick={() => setLevel(l.key)}
            >
              {l.label}
            </button>
          ))}
        </div>
        <nav className="rm3-crumbs" aria-label="선택한 지역">
          {crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && <i aria-hidden="true">›</i>}
              {c.go && i < crumbs.length - 1 ? (
                <button type="button" onClick={c.go}>
                  {c.label}
                </button>
              ) : (
                <b>{c.label}</b>
              )}
            </span>
          ))}
        </nav>
      </header>

      <div className="rm3-stage" ref={hostRef}>
        <div className="rm3-labels" ref={labelsRef} aria-hidden="true" />
        {!webgl && <p className="rm3-fallback">이 브라우저는 3D 지도(WebGL)를 지원하지 않습니다. 위의 지역 선택을 이용해 주세요.</p>}
        {geoError && <p className="rm3-fallback">지도 경계를 불러오지 못했습니다.</p>}
        {(loading || pending > 0) && webgl && !geoError && (
          <div className="rm3-busy" role="status">
            <span className="rm3-spinner" />
            {pending > 0 ? `지역 등락 집계 중 ${Math.round(readyShare * 100)}%` : "지도를 그리는 중…"}
          </div>
        )}
        {hover && !touch && (
          <div
            className="rm3-tip"
            // Beside the pointer, on whichever side keeps the card inside the map.
            style={{
              transform: `translate(${
                hover.x > (hostRef.current?.clientWidth ?? 0) * 0.55 ? `calc(${Math.round(hover.x - 14)}px - 100%)` : `${Math.round(hover.x + 14)}px`
              }, ${
                hover.y > (hostRef.current?.clientHeight ?? 0) * 0.6 ? `calc(${Math.round(hover.y - 14)}px - 100%)` : `${Math.round(hover.y + 14)}px`
              })`,
            }}
          >
            <strong>{hover.region.name}</strong>
            {hoverMove && hoverMove.change !== null ? (
              <>
                <em data-tone={hoverMove.change > 0 ? "up" : hoverMove.change < 0 ? "down" : "flat"}>{pct(hoverMove.change)}</em>
                <small>
                  {periodLabel} · 거래 단지 {hoverMove.moved.toLocaleString()}곳 (▲{hoverMove.up} ▼{hoverMove.down})
                </small>
              </>
            ) : (
              <small>{periodLabel} 기간 내 비교 거래 없음</small>
            )}
            {hover.region.pickable && (
              <span className="rm3-tip-hint">
                {shownLevel === "sido" ? "클릭하면 시·군·구 지도로" : shownLevel === "sgg" ? "클릭하면 읍·면·동 지도로" : "클릭하면 이 동만 보기"}
              </span>
            )}
          </div>
        )}
        {webgl && (
          <div className="rm3-controls">
            {!touch && (
              <>
                <button type="button" onClick={() => sceneRef.current?.zoom(0.8)} aria-label="확대">
                  +
                </button>
                <button type="button" onClick={() => sceneRef.current?.zoom(1.25)} aria-label="축소">
                  −
                </button>
              </>
            )}
            <button type="button" onClick={() => sceneRef.current?.reset()} aria-label="시점 초기화" title="시점 초기화">
              ⟲
            </button>
          </div>
        )}
      </div>

      <footer className="rm3-legend">
        <span>하락</span>
        <i className="rm3-legend-bar" aria-hidden="true" />
        <span>상승</span>
        <small>
          지역 평균 {periodLabel} 등락 · ±{saturation}%에서 최대 색
          <i className="rm3-legend-idle" aria-hidden="true" />
          거래 없음
        </small>
      </footer>
    </section>
  );
}
